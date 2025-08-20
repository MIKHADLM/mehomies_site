// Firebase initialization and product loading (extracted from inline <script type="module"> in index.html)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js";
import { getFirestore, collection, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, APP_CHECK_SITE_KEY } from "./firebase-config.js";

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

const db = getFirestore(app);

const productsContainer = document.querySelector('.products');

async function chargerProduits() {
  const querySnapshot = await getDocs(collection(db, "produits"));
  querySnapshot.forEach((doc) => {
    const produit = doc.data();

    const card = document.createElement('div');
    card.className = "product-card";

    const link = document.createElement('a');
    link.href = `produit.html?id=${doc.id}`;
    link.className = 'product-link';

    const img = document.createElement('img');
    img.src = produit.image;
    img.alt = produit.nom;
    img.dataset.image1 = produit.image || '';
    if (produit.image2) img.dataset.image2 = produit.image2;

    const h4 = document.createElement('h4');
    h4.textContent = produit.nom;

    const price = document.createElement('p');
    price.textContent = `${produit.prix} €`;

    link.appendChild(img);
    link.appendChild(h4);
    link.appendChild(price);
    card.appendChild(link);

    productsContainer.appendChild(card);

    // Gestion des événements d'image secondaire (desktop & mobile)
    const originalSrc = img.dataset.image1;
    const secondSrc = img.dataset.image2;

    // Hover pour desktop
    img.addEventListener('mouseenter', () => {
      img.src = secondSrc;
    });
    img.addEventListener('mouseleave', () => {
      img.src = originalSrc;
    });

    // Touch pour mobile
    img.addEventListener('touchstart', () => {
      img.src = secondSrc;
    });
    img.addEventListener('touchend', () => {
      img.src = originalSrc;
    });
  });

  // Réactive les boutons "Ajouter au panier"
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
