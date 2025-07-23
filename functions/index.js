const getRawBody = require('raw-body');
const functions = require("firebase-functions");
const { onRequest } = require("firebase-functions/v2/https");
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

      const lineItems = items.map(item => ({
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
          panier: JSON.stringify(items),
          isPickup: String(isPickup)
        },
        payment_method_types: ['card'],
        line_items: lineItems,
        mode: 'payment',
        success_url: 'https://www.mehomies.com/confirmation.html',
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

      res.status(200).json({ url: session.url });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erreur lors de la création de la session Stripe' });
    }
    
  });
});

exports.stripeWebhook = functions.https.onRequest((req, res) => {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  getRawBody(req)
    .then((rawBodyBuffer) => {
      const sig = req.headers['stripe-signature'];
      const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

      let event;

      try {
        event = stripe.webhooks.constructEvent(rawBodyBuffer, sig, endpointSecret);
      } catch (err) {
        console.error("Erreur dans Stripe Webhook :", err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
      }

      if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const metadata = session.metadata;
        const panier = JSON.parse(metadata.panier || "[]");

        panier.forEach(async item => {
          const produitRef = db.collection("produits").doc(item.id);
          const doc = await produitRef.get();
          if (doc.exists) {
            const currentStock = doc.data().stock || 0;
            const nouveauStock = Math.max(currentStock - item.quantite, 0);
            await produitRef.update({ stock: nouveauStock });
          }
        });
      }

      res.status(200).send("OK");
    })
    .catch(err => {
      console.error("Erreur raw body :", err);
      res.status(400).send("Erreur raw body");
    });
});