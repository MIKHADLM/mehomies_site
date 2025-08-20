const getRawBody = require('raw-body');
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const stripeWebhookSecret = defineSecret('STRIPE_WEBHOOK_SECRET');
const stripeSecret = defineSecret('STRIPE_SECRET_KEY');

// Do not load dotenv in production functions; use Secret Manager instead
// require('dotenv').config();
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

// Initialize Stripe lazily inside handlers using injected secret
const getStripe = () => {
  const Stripe = require('stripe');
  return new Stripe(process.env.STRIPE_SECRET_KEY);
};

const ALLOWED_ORIGINS = [
  'https://www.mehomies.com',
  'https://mehomies.vercel.app',
  'https://mehomies-site-lx2nroux4-mikhadlms-projects.vercel.app'
];

function setCors(res, origin) {
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
  }
  res.set('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Firebase-AppCheck');
}

async function verifyAuthOrAppCheck(req) {
  // Try Firebase Auth
  const authHeader = req.headers.authorization || '';
  const idToken = authHeader.startsWith('Bearer ')
    ? authHeader.substring('Bearer '.length)
    : null;
  if (idToken) {
    try {
      const decoded = await admin.auth().verifyIdToken(idToken);
      return { uid: decoded.uid, method: 'auth' };
    } catch (_) {}
  }
  // Try App Check
  const appCheckToken = req.headers['x-firebase-appcheck'];
  if (appCheckToken) {
    try {
      const { token } = await admin.appCheck().verifyToken(appCheckToken);
      return { appCheckToken: token, method: 'appcheck' };
    } catch (_) {}
  }
  return null;
}

exports.createCheckoutSession = onRequest({ region: 'europe-west1', secrets: [stripeSecret] }, async (req, res) => {
  const origin = req.headers.origin;
  setCors(res, origin);
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (!ALLOWED_ORIGINS.includes(origin)) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }

  try {
      // Require Auth or App Check
      const authContext = await verifyAuthOrAppCheck(req);
      if (!authContext) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const items = req.body.items;
      const isPickup = req.body.isPickup; // boolean indicating if "remise en main propre" is checked

      if (!Array.isArray(items)) {
        return res.status(400).json({ error: 'Le champ items doit être un tableau.' });
      }

      // Validate products
      const validatedItems = [];
      for (const item of items) {
        if (!item.id || typeof item.prix !== 'number' || typeof item.quantite !== 'number') {
          return res.status(400).json({ error: 'Produit invalide ou informations manquantes.' });
        }

        const produitRef = db.collection("produits").doc(item.id);
        const produitSnap = await produitRef.get();

        if (!produitSnap.exists) {
          return res.status(400).json({ error: `Produit avec l'id ${item.id} introuvable.` });
        }

        const produitData = produitSnap.data();

        // Vérifier le prix
        if (produitData.prix !== item.prix) {
          return res.status(400).json({ error: `Le prix pour le produit ${item.nom || item.id} ne correspond pas.` });
        }

        // Vérifier la quantité disponible
        if (typeof produitData.stock === 'number') {
          if (item.quantite > produitData.stock) {
            return res.status(400).json({ error: `Quantité insuffisante pour le produit ${item.nom || item.id}.` });
          }
        } else if (typeof produitData.stock === 'object' && item.taille) {
          const stockParTaille = produitData.stock;
          const stockActuel = stockParTaille[item.taille] || 0;
          if (item.quantite > stockActuel) {
            return res.status(400).json({ error: `Quantité insuffisante pour le produit ${item.nom || item.id} taille ${item.taille}.` });
          }
        } else {
          return res.status(400).json({ error: `Stock invalide pour le produit ${item.nom || item.id}.` });
        }

        validatedItems.push(item);
      }

      // Create a new order in Firestore with status "pending"
      const orderRef = await db.collection("orders").add({
        items: validatedItems,
        isPickup,
        status: "pending",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        ...(authContext.uid && { userId: authContext.uid })
      });

      const lineItems = validatedItems.map(item => ({
        price_data: {
          currency: 'eur',
          product_data: {
            name: item.nom,
          },
          unit_amount: item.prix * 100,
        },
        quantity: item.quantite,
      }));

      // Add shipping fee if not pickup
      if (!isPickup) {
        lineItems.push({
          price_data: {
            currency: 'eur',
            product_data: { name: 'Frais de port Colissimo' },
            unit_amount: 455, // 4.55 euros in cents
          },
          quantity: 1,
        });
      }

      const stripe = getStripe();
      const session = await stripe.checkout.sessions.create({
        metadata: {
          panier: JSON.stringify(validatedItems),
          isPickup: String(isPickup),
          orderId: orderRef.id
        },
        payment_method_types: ['card'],
        line_items: lineItems,
        mode: 'payment',
        success_url: `${req.headers.origin}/confirmation.html?order_id=${orderRef.id}`,
        cancel_url: 'https://www.mehomies.com/panier.html',
        billing_address_collection: 'required', // always collect billing address
        phone_number_collection: {
          enabled: true,
        },
        shipping_address_collection: {
          allowed_countries: ['FR'], // always collect shipping address, even for pickup
        },
        customer_email: req.body.email,
      }, { idempotencyKey: orderRef.id });

      await orderRef.update({ stripeSessionId: session.id });

      res.status(200).json({ url: session.url, orderId: orderRef.id });
    } catch (error) {
      console.error('createCheckoutSession error:', error.message);
      res.status(500).json({ error: 'Erreur lors de la création de la session Stripe' });
    }
    
});

exports.stripeWebhook = onRequest(
  {
    memory: "256MB",
    timeoutSeconds: 30,
    region: 'europe-west1',
    rawBody: true,
    secrets: [stripeWebhookSecret, stripeSecret],
  },
  async (req, res) => {
    if (req.method !== "POST") {
      return res.status(405).send("Method Not Allowed");
    }

    const sig = req.headers['stripe-signature'];
    const endpointSecret = stripeWebhookSecret.value();

    let event;
    try {
      // Vérification de la signature Stripe pour s'assurer que la requête est authentique
      const stripe = getStripe();
      event = stripe.webhooks.constructEvent(req.rawBody, sig, endpointSecret);
    } catch (err) {
      console.error("Webhook Stripe invalide :", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      console.log('Stripe checkout.session.completed received:', session.id);

      const metadata = session.metadata;
      const panier = JSON.parse(metadata.panier || "[]");

      // Idempotency guard: if order already paid, return early
      if (metadata.orderId) {
        const orderRef = db.collection("orders").doc(metadata.orderId);
        const orderSnap = await orderRef.get();
        if (orderSnap.exists && orderSnap.data().status === 'paid') {
          console.log('Order already paid, skipping:', metadata.orderId);
          return res.status(200).send('OK');
        }
      }

      // Transactional stock update per product
      for (const item of panier) {
        const produitRef = db.collection('produits').doc(item.id);
        await db.runTransaction(async (tx) => {
          const snap = await tx.get(produitRef);
          if (!snap.exists) return;
          const produit = snap.data();
          if (typeof produit.stock === 'number') {
            const nouveauStock = Math.max((produit.stock || 0) - item.quantite, 0);
            tx.update(produitRef, { stock: nouveauStock });
          } else if (typeof produit.stock === 'object' && item.taille) {
            const stockParTaille = { ...(produit.stock || {}) };
            const taille = item.taille;
            const stockActuel = stockParTaille[taille] || 0;
            stockParTaille[taille] = Math.max(stockActuel - item.quantite, 0);
            tx.update(produitRef, { stock: stockParTaille });
          }
        });
      }

      const shippingAddress = session.shipping?.address ? {
        line1: session.shipping.address.line1 || '',
        line2: session.shipping.address.line2 || '',
        city: session.shipping.address.city || '',
        postal_code: session.shipping.address.postal_code || '',
        country: session.shipping.address.country || '',
        state: session.shipping.address.state || ''
      } : null;

      const billingAddress = session.customer_details?.address ? {
        line1: session.customer_details.address.line1 || '',
        line2: session.customer_details.address.line2 || '',
        city: session.customer_details.address.city || '',
        postal_code: session.customer_details.address.postal_code || '',
        country: session.customer_details.address.country || '',
        state: session.customer_details.address.state || ''
      } : null;

      // Mise à jour du statut de la commande en "paid"
      if (metadata.orderId) {
        const orderRef = db.collection("orders").doc(metadata.orderId);

        // Récupération des informations client
        const customerDetails = session.customer_details || {};

        const updateData = {
          status: "paid",
          paymentConfirmedAt: admin.firestore.FieldValue.serverTimestamp(),
          stripeSessionId: session.id,
          customerEmail: customerDetails.email || null,
          phoneNumber: customerDetails.phone || null,
          customerName: customerDetails.name || null
        };

        if (shippingAddress) {
          updateData.shippingAddress = shippingAddress;
          console.log('Adresse de livraison ajoutée:', shippingAddress);
        } else {
          console.log('Aucune adresse de livraison trouvée dans session.shipping.address');
        }

        if (billingAddress) {
          updateData.billingAddress = billingAddress;
          console.log('Adresse de facturation ajoutée:', billingAddress);
        } else {
          console.log('Aucune adresse de facturation trouvée dans session.customer_details.address');
        }

        await orderRef.set(updateData, { merge: true });
        console.log("Commande mise à jour à paid :", metadata.orderId);

        // Gestion du numéro de commande automatique (version corrigée)
        const currentYear = new Date().getFullYear().toString();
        const counterRef = db.collection("Counter").doc("Orders");

        await db.runTransaction(async (transaction) => {
          const counterDoc = await transaction.get(counterRef);
          let sequences = 0;
          let yearStored = currentYear;

          if (counterDoc.exists) {
            const data = counterDoc.data();
            // Assurez-vous que les noms de champs correspondent exactement à votre Firestore
            sequences = data.Sequences || 0;
            yearStored = data.Year || currentYear;
          }

          // Si l'année a changé, on remet la séquence à zéro
          if (yearStored !== currentYear) {
            sequences = 0;
            yearStored = currentYear;
          }

          sequences += 1;
          const orderNumber = `MEH-${currentYear}-${sequences.toString().padStart(3, '0')}`;

          // Mettre à jour le compteur et la commande
          transaction.set(counterRef, { Year: yearStored, Sequences: sequences }, { merge: true });
          transaction.update(orderRef, { orderNumber });
        });
      }
    }

    res.status(200).send("OK");
  });


exports.getOrderDetails = onRequest({ region: 'europe-west1' }, async (req, res) => {
  const origin = req.headers.origin;
  setCors(res, origin);
  if (req.method === 'OPTIONS') return res.status(204).send('');
  try {
      // Require Auth or App Check to avoid open enumeration
      const authContext = await verifyAuthOrAppCheck(req);
      if (!authContext) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const orderId = req.query.orderId;

      if (!orderId) {
        return res.status(400).json({ error: "orderId manquant" });
      }

      const orderRef = db.collection("orders").doc(orderId);
      const orderSnap = await orderRef.get();

      if (!orderSnap.exists) {
        return res.status(404).json({ error: "Commande introuvable" });
      }

      const orderData = orderSnap.data();

      // If auth present and order has userId, ensure ownership
      if (orderData.userId && authContext.uid && orderData.userId !== authContext.uid) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      // Retourner uniquement les informations sécurisées
      return res.status(200).json({
        numeroCommande: orderData.orderNumber,
        status: orderData.status
      });
    } catch (error) {
      console.error("Erreur getOrderDetails:", error.message);
      return res.status(500).json({ error: "Erreur serveur" });
    }
});