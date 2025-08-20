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

    card.innerHTML = `
      <a href="produit.html?id=${doc.id}" class="product-link">
        <img src="${produit.image}" alt="${produit.nom}" data-image1="${produit.image}" data-image2="${produit.image2}">
        <h4>${produit.nom}</h4>
        <p>${produit.prix} €</p>
      </a>
    `;

    productsContainer.appendChild(card);

    // Gestion des événements d'image secondaire (desktop & mobile)
    const img = card.querySelector('img');
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
