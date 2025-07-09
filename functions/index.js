const functions = require("firebase-functions");
const { onRequest } = require("firebase-functions/v2/https");
require('dotenv').config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const cors = require("cors")({ origin: true });

exports.createCheckoutSession = onRequest({ region: 'europe-west1' }, async (req, res) => {
  cors(req, res, async () => {
    try {
      const items = req.body.items;

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

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: lineItems,
        mode: 'payment',
        success_url: 'https://www.mehomies.com/confirmation.html',
        cancel_url: 'https://www.mehomies.com/panier.html',
        billing_address_collection: 'required',
        phone_number_collection: {
          enabled: true,
        },
        shipping_address_collection: {
          allowed_countries: ['FR', 'BE', 'DE'],
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
