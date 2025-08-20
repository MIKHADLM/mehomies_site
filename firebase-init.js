// Firebase initialization and product loading (extracted from inline <script type="module"> in index.html)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js";
// Firestore SDK not required on index (using REST API to avoid Listen/channel)
import { firebaseConfig, APP_CHECK_SITE_KEY } from "./firebase-config.js";
import { getAppCheckToken } from "./appcheck.js";

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Optional App Check initialization
if (APP_CHECK_SITE_KEY) {
  try {
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(APP_CHECK_SITE_KEY),
      isTokenAutoRefreshEnabled: true,
    });
  } catch (e) {
    // no-op
  }
}

// No Firestore SDK initialization; all reads go through REST

const productsContainer = document.querySelector('.products');

async function chargerProduits() {
  // Fetch via Firestore REST with App Check header to avoid Listen/channel
  let token = null;
  try { token = await getAppCheckToken(); } catch (_) {}
  const res = await fetch('https://europe-west1-mehomiesstore.cloudfunctions.net/listProducts', {
    headers: {
      ...(token ? { 'X-Firebase-AppCheck': token } : {})
    }
  });
  const data = await res.json();
  (data.produits || []).forEach((p) => {
    const id = p.id;
    const nom = p.nom || '';
    const prix = p.prix || 0;
    const image1 = p.image || '';
    const image2 = p.image2 || '';

    const card = document.createElement('div');
    card.className = "product-card";

    const link = document.createElement('a');
    link.href = `produit.html?id=${id}`;
    link.className = 'product-link';

    const img = document.createElement('img');
    img.src = image1;
    img.alt = nom;
    img.dataset.image1 = image1;
    if (image2) img.dataset.image2 = image2;

    const h4 = document.createElement('h4');
    h4.textContent = nom;

    const price = document.createElement('p');
    price.textContent = `${prix} €`;

    link.appendChild(img);
    link.appendChild(h4);
    link.appendChild(price);
    card.appendChild(link);

    productsContainer.appendChild(card);

    const originalSrc = img.dataset.image1;
    const secondSrc = img.dataset.image2;
    img.addEventListener('mouseenter', () => { if (secondSrc) img.src = secondSrc; });
    img.addEventListener('mouseleave', () => { img.src = originalSrc; });
    img.addEventListener('touchstart', () => { if (secondSrc) img.src = secondSrc; });
    img.addEventListener('touchend', () => { img.src = originalSrc; });
  });

  activerAjoutPanier();
}

function activerAjoutPanier() {
  document.querySelectorAll('.ajouter-panier').forEach(bouton => {
    bouton.addEventListener('click', function () {
      const id = this.dataset.id;
      const nom = this.dataset.nom;
      const prix = parseFloat(this.dataset.prix);

      let panier = JSON.parse(localStorage.getItem('panier')) || [];
      const produitExistant = panier.find(p => p.id === id);
      if (produitExistant) {
        produitExistant.quantite++;
      } else {
        panier.push({ id, nom, prix, quantite: 1 });
      }

      localStorage.setItem('panier', JSON.stringify(panier));

      // Mise à jour du badge panier si disponible
      if (typeof window.updateCartCount === 'function') {
        window.updateCartCount();
      }

      alert(`${nom} ajouté au panier`);
    });
  });
}

// Start
chargerProduits();
