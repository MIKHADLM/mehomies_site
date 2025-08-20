// Panier page logic (extracted from panier.html inline scripts)
import { getAppCheckToken } from './appcheck.js';

(function() {
  function afficherPanier() {
    const panier = JSON.parse(localStorage.getItem('panier')) || [];
    const tbody = document.querySelector('#liste-panier tbody');
    const totalSpan = document.getElementById('total');
    const boutonPayer = document.getElementById('finaliser-commande');
    let total = 0;
    tbody.innerHTML = '';

    if (panier.length === 0) {
      const main = document.querySelector('main');
      const table = document.getElementById('liste-panier');
      const checkout = document.querySelector('.checkout-section');
      if (table) table.style.display = "none";
      if (checkout) checkout.style.display = "none";
      const titrePanier = main.querySelector('h1');
      if (titrePanier) titrePanier.style.display = "none";
      const oldVide = document.getElementById('panier-vide-message');
      if (oldVide) oldVide.remove();
      const videContainer = document.createElement('div');
      videContainer.id = 'panier-vide-message';
      videContainer.style.textAlign = "center";
      videContainer.style.padding = "3rem 1rem";
      const videTitre = document.createElement('h2');
      videTitre.textContent = "Votre panier est vide.";
      videTitre.style.marginBottom = "1rem";
      const lienAccueil = document.createElement('a');
      lienAccueil.href = "index.html";
      lienAccueil.textContent = "Continuer mes achats";
      lienAccueil.style.display = "inline-block";
      lienAccueil.style.marginTop = "1rem";
      lienAccueil.style.padding = "0.75rem 1.5rem";
      lienAccueil.style.backgroundColor = "#000";
      lienAccueil.style.color = "#fff";
      lienAccueil.style.borderRadius = "30px";
      lienAccueil.style.textDecoration = "none";
      lienAccueil.style.fontWeight = "bold";
      videContainer.appendChild(videTitre);
      videContainer.appendChild(lienAccueil);
      main.insertBefore(videContainer, main.firstChild);
      if(boutonPayer) boutonPayer.style.display = "none";
      totalSpan.textContent = "0";
      return;
    } else {
      const table = document.getElementById('liste-panier');
      const checkout = document.querySelector('.checkout-section');
      if (table) table.style.display = "";
      if (checkout) checkout.style.display = "";
      const main = document.querySelector('main');
      const titrePanier = main.querySelector('h1');
      if (titrePanier) titrePanier.style.display = "";
      const oldVide = document.getElementById('panier-vide-message');
      if (oldVide) oldVide.remove();
      if(boutonPayer) boutonPayer.style.display = "";
    }

    panier.forEach((p, index) => {
      const tr = document.createElement('tr');
      const produitInfo = catalogueProduits[p.id] || {};
      let stock = 99;
      if (produitInfo.stock !== undefined) {
        if (typeof produitInfo.stock === "object" && !Array.isArray(produitInfo.stock) && p.taille) {
          stock = produitInfo.stock[p.taille] !== undefined ? produitInfo.stock[p.taille] : 0;
        } else if (typeof produitInfo.stock === "number") {
          stock = produitInfo.stock;
        }
      }

      const tdNom = document.createElement('td');
      tdNom.style.display = "flex";
      tdNom.style.flexDirection = "column";
      tdNom.style.alignItems = "flex-start";

      const containerProduit = document.createElement('div');
      containerProduit.style.display = "flex";
      containerProduit.style.alignItems = "flex-start";

      const img = document.createElement('img');
      img.src = produitInfo.image ? `/${produitInfo.image}` : '';
      img.alt = produitInfo.nom || p.nom;
      img.style.width = "100px";
      img.style.height = "100px";
      img.style.objectFit = "cover";
      img.style.borderRadius = "6px";
      img.style.marginRight = "10px";

      const texteConteneur = document.createElement('div');
      texteConteneur.style.display = "flex";
      texteConteneur.style.flexDirection = "column";
      texteConteneur.style.justifyContent = "flex-start";
      texteConteneur.style.alignItems = "flex-start";

      const nomSpan = document.createElement('span');
      nomSpan.textContent = produitInfo.nom || p.nom;
      nomSpan.style.fontWeight = "bold";
      nomSpan.style.marginBottom = "0.25rem";
      const lienNom = document.createElement('a');
      lienNom.href = `produit.html?id=${p.id}`;
      lienNom.style.textDecoration = "none";
      lienNom.style.color = "inherit";
      lienNom.appendChild(nomSpan);
      texteConteneur.appendChild(lienNom);

      if (p.taille) {
        const tailleSpan = document.createElement('span');
        tailleSpan.textContent = `Taille : ${p.taille}`;
        tailleSpan.style.fontSize = "0.95em";
        tailleSpan.style.marginBottom = "0.25rem";
        tailleSpan.style.color = "#555";
        texteConteneur.appendChild(tailleSpan);
      }

      const btnSuppr = document.createElement('button');
      btnSuppr.textContent = 'Enlever';
      btnSuppr.dataset.index = index;
      btnSuppr.className = 'supprimer';
      btnSuppr.style.alignSelf = "flex-start";
      btnSuppr.style.background = "none";
      btnSuppr.style.border = "none";
      btnSuppr.style.color = "#000";
      btnSuppr.style.cursor = "pointer";
      btnSuppr.style.padding = "0";
      btnSuppr.style.textDecoration = "underline";
      btnSuppr.style.textDecorationThickness = "1px";
      btnSuppr.style.textDecorationColor = "#000";
      texteConteneur.appendChild(btnSuppr);

      if (window.innerWidth <= 600) {
        const quantityMobile = document.createElement('div');
        quantityMobile.className = 'quantity-control-mobile';
        quantityMobile.innerHTML = `
          <button class="moins" data-index="${index}">−</button>
          <span>${p.quantite}</span>
          <button class="plus" data-index="${index}" ${p.quantite >= stock ? 'disabled' : ''}>+</button>
        `;
        texteConteneur.appendChild(quantityMobile);
      }

      const lienProduit = document.createElement('a');
      lienProduit.href = `produit.html?id=${p.id}`;
      lienProduit.appendChild(img);
      containerProduit.appendChild(lienProduit);
      containerProduit.appendChild(texteConteneur);
      tdNom.appendChild(containerProduit);

      const tdPrix = document.createElement('td');
      tdPrix.textContent = `${p.prix.toFixed(2)} €`;

      const tdQuantite = document.createElement('td');
      const disablePlus = p.quantite >= stock ? 'disabled' : '';
      tdQuantite.innerHTML = `
        <div class="quantity-control">
          <button class="moins" data-index="${index}">−</button>
          <span>${p.quantite}</span>
          <button class="plus" data-index="${index}" ${disablePlus}>+</button>
        </div>
      `;

      const tdTotal = document.createElement('td');
      const totalLigne = p.prix * p.quantite;
      tdTotal.textContent = `${totalLigne.toFixed(2)} €`;

      tr.append(tdNom, tdPrix, tdQuantite, tdTotal);
      tbody.appendChild(tr);
      total += totalLigne;
    });

    totalSpan.textContent = `${total.toFixed(2)}€`;

    window.addEventListener('resize', () => {
      afficherPanier();
    });
  }

  document.addEventListener('click', function (e) {
    let panier = JSON.parse(localStorage.getItem('panier')) || [];

    if (e.target.classList.contains('plus')) {
      const index = e.target.dataset.index;
      const produitInfo = catalogueProduits[panier[index].id];
      let stock = 99;
      if (produitInfo && produitInfo.stock !== undefined) {
        if (typeof produitInfo.stock === "object" && !Array.isArray(produitInfo.stock) && panier[index].taille) {
          stock = produitInfo.stock[panier[index].taille] !== undefined ? produitInfo.stock[panier[index].taille] : 0;
        } else if (typeof produitInfo.stock === "number") {
          stock = produitInfo.stock;
        }
      }
      if (panier[index].quantite < stock) {
        panier[index].quantite++;
        localStorage.setItem('panier', JSON.stringify(panier));
        afficherPanier();
        if (typeof window.updateCartCount === 'function') window.updateCartCount();
      }
    }

    if (e.target.classList.contains('moins')) {
      const index = e.target.dataset.index;
      if (panier[index].quantite > 1) {
        panier[index].quantite--;
      } else {
        panier.splice(index, 1);
      }
      localStorage.setItem('panier', JSON.stringify(panier));
      afficherPanier();
      if (typeof window.updateCartCount === 'function') window.updateCartCount();
    }

    if (e.target.classList.contains('supprimer')) {
      e.preventDefault();
      e.stopPropagation();
      const index = e.target.dataset.index;
      panier.splice(index, 1);
      localStorage.setItem('panier', JSON.stringify(panier));
      afficherPanier();
      if (typeof window.updateCartCount === 'function') window.updateCartCount();
    }
  });

  let catalogueProduits = {};
  async function chargerCatalogue() {
    const appCheckToken = await getAppCheckToken();
    const response = await fetch('https://europe-west1-mehomiesstore.cloudfunctions.net/listProducts', {
      headers: {
        ...(appCheckToken ? { 'X-Firebase-AppCheck': appCheckToken } : {})
      }
    });
    const data = await response.json();
    (data.produits || []).forEach(p => {
      catalogueProduits[p.id] = {
        nom: p.nom,
        prix: p.prix,
        image: p.image,
        stock: p.stock
      };
    });
  }

  function initStripeCheckout() {
    const boutonPayer = document.getElementById('finaliser-commande');
    if (!boutonPayer) return;
    boutonPayer.addEventListener('click', async function (e) {
      e.preventDefault();
      const panier = JSON.parse(localStorage.getItem('panier')) || [];
      const remiseMainPropre = document.getElementById('remise-main-propre').checked;
      try {
        const appCheckToken = await getAppCheckToken();
        const res = await fetch('https://europe-west1-mehomiesstore.cloudfunctions.net/createCheckoutSession', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(appCheckToken ? { 'X-Firebase-AppCheck': appCheckToken } : {})
          },
          body: JSON.stringify({ items: panier, isPickup: remiseMainPropre })
        });
        const data = await res.json();
        if (data.url) {
          window.location.href = data.url;
        } else {
          alert("Erreur : aucun lien de paiement reçu.");
        }
      } catch (error) {
        console.error('Erreur Stripe :', error);
        alert("Une erreur est survenue lors de la création du paiement.");
      }
    });
  }

  // Bootstrap
  chargerCatalogue().then(() => {
    afficherPanier();
    if (typeof window.updateCartCount === 'function') window.updateCartCount();
  });
  initStripeCheckout();
})();
