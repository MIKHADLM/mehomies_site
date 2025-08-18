const getRawBody = require('raw-body');
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const stripeWebhookSecret = defineSecret('STRIPE_WEBHOOK_SECRET');

require('dotenv').config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const cors = require("cors")({ origin: true });
const express = require("express");
const bodyParser = require("body-parser");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

exports.createCheckoutSession = onRequest({ region: 'europe-west1' }, async (req, res) => {
  cors(req, res, async () => {
    try {
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
        createdAt: admin.firestore.FieldValue.serverTimestamp()
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
      });

      await orderRef.update({ stripeSessionId: session.id });

      res.status(200).json({ url: session.url, orderId: orderRef.id });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erreur lors de la création de la session Stripe' });
    }
    
  });
});

exports.stripeWebhook = onRequest(
  {
    memory: "256MB",
    timeoutSeconds: 30,
    region: 'europe-west1',
    rawBody: true,
    secrets: [stripeWebhookSecret],
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
      event = stripe.webhooks.constructEvent(req.rawBody, sig, endpointSecret);
    } catch (err) {
      console.error("Webhook Stripe invalide :", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;

      console.log('=== DEBUT DEBUG SESSION STRIPE ===');
      console.log('Session ID:', session.id);
      console.log('Session mode:', session.mode);
      console.log('Payment status:', session.payment_status);
      console.log('Customer Details:', JSON.stringify(session.customer_details, null, 2));
      console.log('Shipping:', JSON.stringify(session.shipping, null, 2));
      console.log('Customer Details Address:', JSON.stringify(session.customer_details?.address, null, 2));
      console.log('Metadata:', JSON.stringify(session.metadata, null, 2));
      console.log('Toutes les clés de session:', Object.keys(session));
      console.log('Checks:');
      console.log('- session.shipping existe:', !!session.shipping);
      console.log('- session.shipping.address existe:', !!session.shipping?.address);
      console.log('- session.customer_details existe:', !!session.customer_details);
      console.log('- session.customer_details.address existe:', !!session.customer_details?.address);
      console.log('=== FIN DEBUG SESSION STRIPE ===');

      const metadata = session.metadata;
      const panier = JSON.parse(metadata.panier || "[]");

      // Mise à jour du stock pour chaque produit
      for (const item of panier) {
        const produitRef = db.collection("produits").doc(item.id);
        const doc = await produitRef.get();
        if (doc.exists) {
          const produit = doc.data();

          if (typeof produit.stock === 'number') {
            const nouveauStock = Math.max(produit.stock - item.quantite, 0);
            await produitRef.update({ stock: nouveauStock });
          } else if (typeof produit.stock === 'object' && item.taille) {
            const stockParTaille = produit.stock;
            const taille = item.taille;
            const stockActuel = stockParTaille[taille] || 0;
            stockParTaille[taille] = Math.max(stockActuel - item.quantite, 0);
            await produitRef.update({ stock: stockParTaille });
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

        await orderRef.update(updateData);
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
  cors(req, res, async () => {
    try {
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

      // Retourner uniquement les informations sécurisées
      return res.status(200).json({
        numeroCommande: orderData.orderNumber,
        status: orderData.status
      });
    } catch (error) {
      console.error("Erreur getOrderDetails:", error);
      return res.status(500).json({ error: "Erreur serveur" });
    }
  });
});