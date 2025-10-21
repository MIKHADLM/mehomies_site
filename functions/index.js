const getRawBody = require('raw-body');
const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { defineSecret } = require('firebase-functions/params');
const stripeWebhookSecret = defineSecret('STRIPE_WEBHOOK_SECRET');
const stripeSecret = defineSecret('STRIPE_SECRET_KEY');
const brevoApiKey = defineSecret('BREVO_API_KEY');
const previewPassword = defineSecret('PREVIEW_PASSWORD');
const previewSecret = defineSecret('PREVIEW_SECRET');

// Do not load dotenv in production functions; use Secret Manager instead
// require('dotenv').config();
const admin = require("firebase-admin");
const crypto = require('crypto');

admin.initializeApp();
const db = admin.firestore();

// TEMP: Development mode to bypass auth checks for dashboard during active development.
// WARNING: DO NOT enable in production. Remember to set back to false before deploying.
const DEV_MODE = true;

// Initialize Stripe lazily inside handlers using injected secret
const getStripe = () => {
  const Stripe = require('stripe');
  return new Stripe(process.env.STRIPE_SECRET_KEY);
};

// Fonction pour libérer le stock d'une commande
async function releaseStockForOrder(orderRef, orderData) {
  const batch = db.batch();
  
  // Pour chaque article de la commande, remettre le stock à jour
  for (const item of orderData.items) {
    const productRef = db.collection('produits').doc(item.id);
    
    // Vérifier si le stock est géré par taille ou non
    if (item.taille) {
      // Mise à jour du stock par taille
      const productDoc = await productRef.get();
      if (productDoc.exists) {
        const productData = productDoc.data();
        if (productData.stock && typeof productData.stock === 'object') {
          const updatedStock = { ...productData.stock };
          if (updatedStock[item.taille] !== undefined) {
            updatedStock[item.taille] = (updatedStock[item.taille] || 0) + item.quantite;
            batch.update(productRef, { stock: updatedStock });
          }
        }
      }
    } else {
      // Mise à jour du stock simple
      batch.update(productRef, {
        stock: admin.firestore.FieldValue.increment(item.quantite)
      });
    }
  }
  
  // Marquer la commande comme expirée
  batch.update(orderRef, {
    status: 'expired',
    expiredAt: admin.firestore.FieldValue.serverTimestamp(),
    stockReserved: false
  });
  
  return batch.commit();
}

// Fonction pour nettoyer les commandes expirées non traitées
exports.cleanupExpiredOrders = onSchedule({
  schedule: 'every 1 hours',
  region: 'europe-west1'
}, async (event) => {
  console.log('Début du nettoyage des commandes expirées...');
  
  try {
    const now = admin.firestore.Timestamp.now();
    // Chercher les commandes réservées dont la date d'expiration est dépassée
    const expiredOrders = await db.collection('orders')
      .where('status', '==', 'reserved')
      .where('expiresAt', '<=', now)
      .get();
    
    console.log(`Nombre de commandes expirées à traiter: ${expiredOrders.size}`);
    
    // Traiter chaque commande expirée
    for (const doc of expiredOrders.docs) {
      try {
        console.log(`Traitement de la commande expirée: ${doc.id}`);
        await releaseStockForOrder(doc.ref, doc.data());
        console.log(`Commande marquée comme expirée: ${doc.id}`);
      } catch (error) {
        console.error(`Erreur lors du traitement de la commande ${doc.id}:`, error);
      }
    }
    
    console.log('Nettoyage des commandes expirées terminé');
  } catch (error) {
    console.error('Erreur lors du nettoyage des commandes expirées:', error);
  }
});

// Lazy Brevo (Sendinblue) client factory using Secret Manager
const getBrevo = (apiKey) => {
  const Sib = require('sib-api-v3-sdk');
  const client = Sib.ApiClient.instance;
  client.authentications['api-key'].apiKey = apiKey;
  return new Sib.TransactionalEmailsApi();
};

// Simple admin allowlist by email (update to your admin email). Consider moving to Secret Manager or Firestore settings.
const ALLOWED_ADMIN_EMAILS = new Set([
  'mehomies.contact@gmail.com'
]);

async function requireAdmin(req) {
  // Only Firebase Auth (not App Check) is accepted for admin endpoints
  const authHeader = req.headers.authorization || '';
  const idToken = authHeader.startsWith('Bearer ')
    ? authHeader.substring('Bearer '.length)
    : null;
  if (!idToken) return null;
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    const email = decoded.email || null;
    if (!email || !ALLOWED_ADMIN_EMAILS.has(email)) return null;
    return { uid: decoded.uid, email };
  } catch (_) {
    return null;
  }
}

const ALLOWED_ORIGINS = [
  'https://www.mehomies.com',
  'https://mehomies.com',
  'https://mehomies.vercel.app',
  'https://mehomies-site-lx2nroux4-mikhadlms-projects.vercel.app',
  'https://dashboard.mehomies.com',
  'http://localhost:3000'
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
  if (DEV_MODE) {
    // Bypass for development only
    return { uid: 'dev-user', method: 'dev' };
  }
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

      // Load shipping settings from Firestore (admin-configurable)
      const settingsSnap = await db.collection('settings').doc('shipping').get();
      const settingsData = settingsSnap.exists ? settingsSnap.data() : {};
      const defaultFeeCents = (typeof settingsData?.defaultFeeCents === 'number') ? settingsData.defaultFeeCents : 455;
      const configuredShippingCents = isPickup ? 0 : defaultFeeCents;

      if (!Array.isArray(items)) {
        return res.status(400).json({ error: 'Le champ items doit être un tableau.' });
      }
      // Allocate an orderRef (ID used as idempotency key)
      const orderRef = db.collection("orders").doc();

      // Reserve stock atomically and create order document in the same transaction
      let validatedItems = [];
      // default reservation minutes if products don't override
      let minReservationMinutes = 30;

      await db.runTransaction(async (tx) => {
        // Validate each product and update stock
        validatedItems = [];
        // Sum quantities per product to enforce per-product maxpc
        const totalPerProduct = items.reduce((acc, it) => {
          acc[it.id] = (acc[it.id] || 0) + (typeof it.quantite === 'number' ? it.quantite : 0);
          return acc;
        }, {});

        // First pass: validate maxpc and collect reservation window
        const productCache = new Map();
        for (const productId of Object.keys(totalPerProduct)) {
          const produitRef = db.collection('produits').doc(productId);
          const snap = await tx.get(produitRef);
          if (!snap.exists) {
            throw new Error(`Produit avec l'id ${productId} introuvable.`);
          }
          const produitData = snap.data();
          productCache.set(productId, { ref: produitRef, data: produitData });

          // Enforce per-product maximum per order
          const maxpc = typeof produitData.maxpc === 'number' && produitData.maxpc > 0 ? produitData.maxpc : null;
          if (maxpc !== null && totalPerProduct[productId] > maxpc) {
            const nom = produitData.nom || productId;
            throw new Error(`Quantité maximale par commande atteinte pour le produit ${nom} (maximum: ${maxpc}).`);
          }

          // Collect reservation duration (take minimum across products)
          const overrideMinutes = typeof produitData.reservationMinutes === 'number' && produitData.reservationMinutes > 0
            ? Math.floor(produitData.reservationMinutes)
            : null;
          if (overrideMinutes) {
            // clamp to avoid extreme values
            const clamped = Math.max(3, Math.min(60, overrideMinutes));
            minReservationMinutes = Math.min(minReservationMinutes, clamped);
          }
        }

        // Second pass: per-line validations (prix/stock) and stock updates
        for (const item of items) {
          if (!item.id || typeof item.prix !== 'number' || typeof item.quantite !== 'number') {
            throw new Error('Produit invalide ou informations manquantes.');
          }

          const cached = productCache.get(item.id);
          const produitRef = cached?.ref || db.collection('produits').doc(item.id);
          const produitData = cached?.data || (await (async () => { const s = await tx.get(produitRef); if (!s.exists) throw new Error(`Produit avec l'id ${item.id} introuvable.`); return s.data(); })());

          // Prix exact requis
          if (produitData.prix !== item.prix) {
            throw new Error(`Le prix pour le produit ${item.nom || item.id} ne correspond pas.`);
          }

          // Vérification stricte et réservation
          if (typeof produitData.stock === 'number') {
            const disponible = produitData.stock || 0;
            if (item.quantite > disponible) {
              throw new Error(`Quantité insuffisante pour le produit ${item.nom || item.id}.`);
            }
            tx.update(produitRef, { stock: disponible - item.quantite });
          } else if (typeof produitData.stock === 'object' && item.taille) {
            const stockParTaille = { ...(produitData.stock || {}) };
            const stockActuel = stockParTaille[item.taille] || 0;
            if (item.quantite > stockActuel) {
              throw new Error(`Quantité insuffisante pour le produit ${item.nom || item.id} taille ${item.taille}.`);
            }
            stockParTaille[item.taille] = stockActuel - item.quantite;
            tx.update(produitRef, { stock: stockParTaille });
          } else {
            throw new Error(`Stock invalide pour le produit ${item.nom || item.id}.`);
          }

          validatedItems.push(item);
        }

        // Create order as reserved
        const expiresAt = admin.firestore.Timestamp.fromDate(new Date(Date.now() + minReservationMinutes * 60 * 1000));
        tx.set(orderRef, {
          items: validatedItems,
          isPickup,
          // Persist shipping fee for downstream uses (emails, dashboards)
          shippingFeeCents: configuredShippingCents,
          status: 'reserved',
          stockReserved: true,
          reservedAt: admin.firestore.FieldValue.serverTimestamp(),
          expiresAt,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          ...(authContext.uid && { userId: authContext.uid })
        });
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
            unit_amount: configuredShippingCents, // Admin-configured shipping
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
      // Surface validation errors
      if (typeof error.message === 'string' && /Quantité insuffisante|introuvable|invalide|prix/.test(error.message)) {
        return res.status(400).json({ error: error.message });
      }
      res.status(500).json({ error: 'Erreur lors de la création de la session Stripe' });
    }
    
});

// Firestore trigger: send transactional confirmation email when status transitions to paid
// Path: orders/{orderId}
exports.sendOrderConfirmationEmail = onDocumentUpdated(
  {
    region: 'europe-west1',
    document: 'orders/{orderId}',
    secrets: [brevoApiKey],
    maxInstances: 20,
    retry: false,
  },
  async (event) => {
    try {
      const before = event.data?.before?.data() || {};
      const after = event.data?.after?.data() || {};
      const orderId = event.params.orderId;

      // Only send when order is paid, includes an orderNumber, and hasn't been sent yet.
      const wasPaid = before.status === 'paid';
      const isPaid = after.status === 'paid';
      const hadOrderNumber = Boolean(before.orderNumber);
      const hasOrderNumber = Boolean(after.orderNumber);
      const alreadySent = Boolean(after.confirmationEmailSentAt);
      if (!isPaid || alreadySent || !hasOrderNumber) return;
      // Allow send either on the transition to paid OR when orderNumber appears after paid
      if (!(before.status !== 'paid' || (!hadOrderNumber && hasOrderNumber))) return;

      const toEmail = after.email || after.customerEmail;
      if (!toEmail) return;

      // Guard: wait until totals are fully written by webhook
      const hasTotalCents = typeof after.totalCents === 'number';
      const hasPositiveShipping = typeof after.shippingFeeCents === 'number' && after.shippingFeeCents > 0;
      if (!(hasTotalCents || hasPositiveShipping)) {
        console.log('Deferring email send until totals available', { orderId, hasTotalCents, shippingFeeCents: after.shippingFeeCents });
        return;
      }

      const items = Array.isArray(after.items) ? after.items : [];
      const itemsTotal = items.reduce((sum, it) => sum + (Number(it.prix) * Number(it.quantite || 0)), 0);
      const knownShippingCents = (typeof after.shippingFeeCents === 'number') ? after.shippingFeeCents : null;
      const derivedShippingCents = (typeof after.totalCents === 'number')
        ? Math.max(0, Math.round(after.totalCents - Math.round(itemsTotal * 100)))
        : null;
      // Prefer a positive derived shipping if known is 0, to avoid missing row when known was incorrectly 0
      const shippingCents = Math.max(
        Number.isFinite(knownShippingCents) ? knownShippingCents : 0,
        Number.isFinite(derivedShippingCents) ? derivedShippingCents : 0
      );

      console.log('Email totals debug', {
        orderId,
        itemsTotalEuros: itemsTotal,
        totalCents: after.totalCents,
        knownShippingCents,
        derivedShippingCents,
        shippingCents,
        isPickup: after.isPickup,
      });
      const total = (typeof after.totalCents === 'number')
        ? (after.totalCents / 100).toFixed(2)
        : (itemsTotal + shippingCents / 100).toFixed(2);
      const orderNumber = after.orderNumber || orderId;
      const customerName = after.customerName || after.name || '';

      const apiKey = brevoApiKey.value();
      const api = getBrevo(apiKey);

      const tmplIdRaw = process.env.BREVO_TEMPLATE_ID;
      const templateId = tmplIdRaw ? Number(tmplIdRaw) : null;

      if (templateId && !Number.isNaN(templateId)) {
        const sendPayload = {
          to: [{ email: toEmail, name: customerName || undefined }],
          sender: { email: 'contact@mehomies.com', name: 'Mehomies' },
          replyTo: { email: 'contact@mehomies.com', name: 'Mehomies' },
          templateId,
          params: {
            orderNumber,
            total,
            items: items.map(i => ({ name: i.nom || i.id, qty: i.quantite, price: i.prix })),
            firstName: customerName || 'Client',
            shipping: shippingCents ? (shippingCents / 100).toFixed(2) : undefined,
          },
        };
        await api.sendTransacEmail(sendPayload);
      } else {
        const itemsRows = items.map(i => `
          <tr>
            <td style="padding:6px 8px;border:1px solid #eee;">${(i.nom || i.id)}</td>
            <td style="padding:6px 8px;border:1px solid #eee;text-align:center;">${i.quantite || 0}</td>
            <td style="padding:6px 8px;border:1px solid #eee;text-align:right;">${Number(i.prix).toFixed(2)} €</td>
          </tr>
        `).join('');
        const shippingRow = shippingCents > 0 ? `
          <tr>
            <td colspan="2" style="padding:6px 8px;border:1px solid #eee;text-align:left;">Frais de port</td>
            <td style="padding:6px 8px;border:1px solid #eee;text-align:right;">${(shippingCents / 100).toFixed(2)} €</td>
          </tr>
        ` : '';
        const html = `
          <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:14px;color:#111;">
            <h1 style="margin:0 0 12px;">Merci pour ta commande</h1>
            <p>Bonjour ${customerName || 'Mehomies'},</p>
            <p>Nous avons bien reçu ta commande. Voici le récapitulatif:</p>
            <p style="font-weight:600">Numéro de commande: ${orderNumber}</p>
            <table style="border-collapse:collapse;width:100%;max-width:640px;margin:8px 0;">
              <thead>
                <tr>
                  <th style="text-align:left;padding:6px 8px;border:1px solid #eee;background:#fafafa;">Article</th>
                  <th style="text-align:center;padding:6px 8px;border:1px solid #eee;background:#fafafa;">Qté</th>
                  <th style="text-align:right;padding:6px 8px;border:1px solid #eee;background:#fafafa;">Prix</th>
                </tr>
              </thead>
              <tbody>
                ${itemsRows}
                ${shippingRow}
              </tbody>
            </table>
            <p style="font-size:16px;font-weight:700;">Total payé: ${total} €</p>
            <p>Merci pour ta confiance.<br/>L’équipe Mehomies</p>
          </div>
        `;
        const sendPayload = {
          to: [{ email: toEmail, name: customerName || undefined }],
          sender: { email: 'contact@mehomies.com', name: 'Mehomies' },
          replyTo: { email: 'contact@mehomies.com', name: 'Mehomies' },
          subject: `Confirmation de commande ${orderNumber} – Mehomies`,
          htmlContent: html,
        };
        await api.sendTransacEmail(sendPayload);
      }

      // Mark as sent (idempotency)
      await db.collection('orders').doc(orderId).set({ confirmationEmailSentAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      console.log('Order confirmation email sent for order', orderId);
    } catch (err) {
      console.error('sendOrderConfirmationEmail error:', err.message);
    }
  }
);

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


    // Handle successful payment
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

      // If order was reserved earlier, do NOT decrement again
      if (metadata.orderId) {
        const orderRef = db.collection('orders').doc(metadata.orderId);
        const orderSnap = await orderRef.get();
        const orderData = orderSnap.exists ? orderSnap.data() : null;
        if (!orderData) {
          console.warn('Order not found at webhook completion:', metadata.orderId);
        } else if (orderData.stockReserved) {
          console.log('Stock already reserved. Skipping decrement. Order:', metadata.orderId);
        } else {
          // Backwards compatibility: decrement now with strict check
          for (const item of panier) {
            const produitRef = db.collection('produits').doc(item.id);
            await db.runTransaction(async (tx) => {
              const snap = await tx.get(produitRef);
              if (!snap.exists) return;
              const produit = snap.data();
              if (typeof produit.stock === 'number') {
                const disponible = produit.stock || 0;
                if (item.quantite > disponible) {
                  throw new Error(`Stock insuffisant pour finaliser la commande ${metadata.orderId} sur ${item.id}`);
                }
                tx.update(produitRef, { stock: disponible - item.quantite });
              } else if (typeof produit.stock === 'object' && item.taille) {
                const stockParTaille = { ...(produit.stock || {}) };
                const stockActuel = stockParTaille[item.taille] || 0;
                if (item.quantite > stockActuel) {
                  throw new Error(`Stock insuffisant pour finaliser la commande ${metadata.orderId} sur ${item.id} ${item.taille}`);
                }
                stockParTaille[item.taille] = stockActuel - item.quantite;
                tx.update(produitRef, { stock: stockParTaille });
              }
            });
          }
        }
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
        const updateData = {
          status: 'paid',
          paidAt: admin.firestore.FieldValue.serverTimestamp(),
          stripeSessionId: session.id,
          paymentIntentId: session.payment_intent,
          customerEmail: session.customer_details?.email || null
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
        console.log("Commande marquée comme payée :", metadata.orderId);
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

    // Handle expired checkout session
    if (event.type === 'checkout.session.expired') {
      const session = event.data.object;
      console.log('Stripe checkout.session.expired received:', session.id);

      const metadata = session.metadata || {};
      const orderId = metadata.orderId;
      
      if (!orderId) {
        console.log('No orderId in metadata, skipping');
        return res.status(200).send('OK');
      }

      const orderRef = db.collection('orders').doc(orderId);
      const orderDoc = await orderRef.get();
      
      // Vérifier si la commande existe et est toujours en statut 'reserved'
      if (!orderDoc.exists || orderDoc.data().status !== 'reserved') {
        console.log(`Order ${orderId} not found or not in reserved state, skipping`);
        return res.status(200).send('OK');
      }

      const orderData = orderDoc.data();
      // Utiliser la fonction releaseStockForOrder pour libérer le stock
      try {
        await releaseStockForOrder(orderRef, orderData);
        console.log(`Stock libéré pour la commande expirée: ${orderId}`);
      } catch (error) {
        console.error('Erreur lors de la libération du stock:', error);
      }
    }

    res.status(200).send("OK");
  });

// Fonction pour récupérer les détails d'une commande
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

      // If order has userId, require authenticated user and ensure ownership
      if (orderData.userId) {
        if (!authContext.uid) {
          return res.status(401).json({ error: 'Authentication required' });
        }
        if (orderData.userId !== authContext.uid) {
          return res.status(403).json({ error: 'Forbidden' });
        }
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

// Public product listing via Cloud Function, protected by App Check or Auth
exports.listProducts = onRequest({ region: 'europe-west1' }, async (req, res) => {
  const origin = req.headers.origin;
  setCors(res, origin);
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (!ALLOWED_ORIGINS.includes(origin)) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  try {
    const authContext = await verifyAuthOrAppCheck(req);
    if (!authContext) return res.status(401).json({ error: 'Unauthorized' });

    const snap = await db.collection('produits').get();
    const produits = snap.docs.map(d => {
      const data = d.data();
      return {
        id: d.id,
        nom: data.nom || '',
        prix: data.prix || 0,
        image: data.image || '',
        image2: data.image2 || '',
        image3: data.image3 || '',
        image4: data.image4 || '',
        image5: data.image5 || '',
        image6: data.image6 || '',
        image7: data.image7 || '',
        image8: data.image8 || '',
        image9: data.image9 || '',
        image10: data.image10 || '',
        tailles: Array.isArray(data.tailles) ? data.tailles : [],
        stock: data.stock ?? 0,
        maxpc: typeof data.maxpc === 'number' ? data.maxpc : null,
        reservationMinutes: typeof data.reservationMinutes === 'number' ? data.reservationMinutes : null,
      };
    });
    return res.status(200).json({ produits });
  } catch (err) {
    console.error('listProducts error:', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Public single product fetch via Cloud Function, protected by App Check or Auth
exports.getProduct = onRequest({ region: 'europe-west1' }, async (req, res) => {
  const origin = req.headers.origin;
  setCors(res, origin);
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (!ALLOWED_ORIGINS.includes(origin)) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  try {
    const authContext = await verifyAuthOrAppCheck(req);
    if (!authContext) return res.status(401).json({ error: 'Unauthorized' });

    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'id manquant' });
    const ref = db.collection('produits').doc(id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: 'Produit introuvable' });
    const data = snap.data();
    return res.status(200).json({
      id: snap.id,
      nom: data.nom || '',
      prix: data.prix || 0,
      description: data.description || '',
      tailles: Array.isArray(data.tailles) ? data.tailles : [],
      image: data.image || '',
      image2: data.image2 || '',
      image3: data.image3 || '',
      image4: data.image4 || '',
      image5: data.image5 || '',
      image6: data.image6 || '',
      image7: data.image7 || '',
      image8: data.image8 || '',
      image9: data.image9 || '',
      image10: data.image10 || '',
      stock: data.stock ?? 0,
      maxpc: typeof data.maxpc === 'number' ? data.maxpc : null,
      reservationMinutes: typeof data.reservationMinutes === 'number' ? data.reservationMinutes : null,
    });
  } catch (err) {
    console.error('getProduct error:', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// =============================
// Secure Preview Access Endpoints
// =============================
function b64urlEncode(str) {
  return Buffer.from(str).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function b64urlDecode(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64').toString('utf8');
}

function hmacSign(input, secret) {
  return crypto
    .createHmac('sha256', secret)
    .update(input)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function makeAccessCookie(value, maxAgeSeconds) {
  const parts = [
    `mh_access=${value}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  return parts.join('; ');
}

// POST /api/verify-access  body: { password }
exports.verifyAccess = onRequest({ region: 'europe-west1', secrets: [previewPassword, previewSecret] }, async (req, res) => {
  try {
    if (req.method === 'OPTIONS') return res.status(204).send('');
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const pwd = (req.body && typeof req.body.password === 'string') ? String(req.body.password) : '';
    const expected = previewPassword.value();
    if (!pwd || pwd !== expected) {
      return res.status(401).json({ error: 'Mot de passe invalide' });
    }

    const secret = previewSecret.value();
    const ttl = 24 * 60 * 60; // 24h
    const exp = Math.floor(Date.now() / 1000) + ttl;
    const payload = b64urlEncode(JSON.stringify({ exp }));
    const sig = hmacSign(payload, secret);
    const token = `${payload}.${sig}`;
    res.setHeader('Set-Cookie', makeAccessCookie(token, ttl));
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('verifyAccess error:', e.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/check-access
exports.checkAccess = onRequest({ region: 'europe-west1', secrets: [previewSecret] }, async (req, res) => {
  try {
    if (req.method === 'OPTIONS') return res.status(204).send('');
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

    const raw = String(req.headers.cookie || '');
    const m = raw.match(/(?:^|; )mh_access=([^;]+)/);
    if (!m) return res.status(401).json({ error: 'No access' });
    const token = decodeURIComponent(m[1]);
    const [payload, sig] = token.split('.');
    if (!payload || !sig) return res.status(401).json({ error: 'Invalid token' });

    const secret = previewSecret.value();
    const expected = hmacSign(payload, secret);
    if (expected !== sig) return res.status(401).json({ error: 'Bad signature' });

    let data;
    try { data = JSON.parse(b64urlDecode(payload)); } catch (_) {}
    if (!data || typeof data.exp !== 'number') return res.status(401).json({ error: 'Invalid payload' });
    if (data.exp <= Math.floor(Date.now() / 1000)) return res.status(401).json({ error: 'Expired' });

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('checkAccess error:', e.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});
// Scheduled cleanup: release reservations that exceeded our own expiresAt window
exports.cleanupExpiredReservations = onSchedule({ schedule: 'every 1 minutes', region: 'europe-west1' }, async (event) => {
  const now = admin.firestore.Timestamp.now();
  const q = await db.collection('orders')
    .where('status', '==', 'reserved')
    .where('expiresAt', '<=', now)
    .limit(50)
    .get();
  if (q.empty) return;
  for (const doc of q.docs) {
    const orderRef = doc.ref;
    const data = doc.data();
    const items = Array.isArray(data.items) ? data.items : [];
    try {
      await db.runTransaction(async (tx) => {
        // restore stock per item
        for (const item of items) {
          const produitRef = db.collection('produits').doc(item.id);
          const psnap = await tx.get(produitRef);
          if (!psnap.exists) continue;
          const produit = psnap.data();
          if (typeof produit.stock === 'number') {
            const actuel = produit.stock || 0;
            tx.update(produitRef, { stock: actuel + (item.quantite || 0) });
          } else if (typeof produit.stock === 'object' && item.taille) {
            const stockParTaille = { ...(produit.stock || {}) };
            const actuel = stockParTaille[item.taille] || 0;
            stockParTaille[item.taille] = actuel + (item.quantite || 0);
            tx.update(produitRef, { stock: stockParTaille });
          }
        }
        tx.update(orderRef, { status: 'canceled', stockReserved: false, canceledAt: admin.firestore.FieldValue.serverTimestamp() });
      });
      console.log('Expired reservation cleaned:', orderRef.id);
    } catch (e) {
      console.error('Failed to clean reservation', orderRef.id, e.message);
    }
  }
});

// Public HTTPS function to subscribe an email to Brevo list (ID 4)
// Requires App Check or Auth, and enforces CORS from allowed origins
exports.subscribeNewsletter = onRequest({ region: 'europe-west1', secrets: [brevoApiKey] }, async (req, res) => {
  const origin = req.headers.origin;
  setCors(res, origin);
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (!ALLOWED_ORIGINS.includes(origin)) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    // Require Auth or App Check
    const authContext = await verifyAuthOrAppCheck(req);
    if (!authContext) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const email = (req.body && typeof req.body.email === 'string') ? String(req.body.email).trim() : '';
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      return res.status(400).json({ error: 'Email invalide' });
    }

    // Init Brevo Contacts API
    const Sib = require('sib-api-v3-sdk');
    const apiKey = brevoApiKey.value();
    const client = Sib.ApiClient.instance;
    client.authentications['api-key'].apiKey = apiKey;
    const contactsApi = new Sib.ContactsApi();

    // Upsert contact into list 4
    const payload = {
      email,
      listIds: [4],
      updateEnabled: true,
    };

    try {
      await contactsApi.createContact(payload);
    } catch (e) {
      // If contact exists and updateEnabled didn't take effect due to API nuance,
      // fall back to add existing contact to list
      try {
        await contactsApi.addContactToList(4, { emails: [email] });
      } catch (inner) {
        console.error('Brevo subscribe failed:', inner.message || inner);
        return res.status(500).json({ error: 'Impossible de vous inscrire pour le moment' });
      }
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('subscribeNewsletter error:', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Admin-only: list orders with optional filters. Requires Firebase Auth of an allowed admin email.
exports.adminListOrders = onRequest({ region: 'europe-west1' }, async (req, res) => {
  const origin = req.headers.origin;
  setCors(res, origin);
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (!ALLOWED_ORIGINS.includes(origin)) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  // Only allow GET
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const adminCtx = DEV_MODE ? { uid: 'dev-user', email: 'dev@local' } : await requireAdmin(req);
    if (!adminCtx) return res.status(401).json({ error: 'Unauthorized' });

    const { status, productId, startDate, endDate, limit } = req.query;
    let q = db.collection('orders');

    // status filter
    if (typeof status === 'string' && status) {
      q = q.where('status', '==', status);
    }

    // date range on createdAt
    if (typeof startDate === 'string' && startDate) {
      const ts = admin.firestore.Timestamp.fromDate(new Date(startDate));
      q = q.where('createdAt', '>=', ts);
    }
    if (typeof endDate === 'string' && endDate) {
      const ts = admin.firestore.Timestamp.fromDate(new Date(endDate));
      q = q.where('createdAt', '<=', ts);
    }

    // order by createdAt desc
    q = q.orderBy('createdAt', 'desc');

    const max = Math.max(1, Math.min(500, Number(limit) || 200));
    const snap = await q.limit(max).get();

    let orders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (typeof productId === 'string' && productId) {
      orders = orders.filter(o => Array.isArray(o.items) && o.items.some(it => it && it.id === productId));
    }

    // shape response: compute totalPaidEuros and flatten some fields
    const result = orders.map(o => {
      const items = Array.isArray(o.items) ? o.items : [];
      const itemsTotal = items.reduce((sum, it) => sum + (Number(it.prix) * Number(it.quantite || 0)), 0);
      const shippingCents = Number.isFinite(o.shippingFeeCents) ? o.shippingFeeCents : 0;
      const totalCents = Number.isFinite(o.totalCents) ? o.totalCents : Math.round(itemsTotal * 100) + shippingCents;
      return {
        id: o.id,
        status: o.status || null,
        orderNumber: o.orderNumber || null,
        totalCents,
        totalEuros: (totalCents / 100),
        shippingFeeCents: shippingCents,
        customerEmail: o.customerEmail || o.email || null,
        customerName: o.customerName || o.name || null,
        isPickup: !!o.isPickup,
        reservedAt: o.reservedAt || null,
        createdAt: o.createdAt || null,
        paymentConfirmedAt: o.paymentConfirmedAt || null,
        items: items.map(i => ({ id: i.id, nom: i.nom, quantite: i.quantite, prix: i.prix, taille: i.taille }))
      };
    });

    return res.status(200).json({ orders: result });
  } catch (err) {
    console.error('adminListOrders error:', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});