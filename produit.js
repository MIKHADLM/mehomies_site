// Produit page logic: Firebase + UI interactions (extracted from produit.html inline scripts)
import { firebaseConfig, APP_CHECK_SITE_KEY } from './firebase-config.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js";
// Firestore SDK not needed for this page after switching to REST fetch
import { getAppCheckToken } from './appcheck.js';

const app = initializeApp(firebaseConfig);
if (APP_CHECK_SITE_KEY) {
  try {
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(APP_CHECK_SITE_KEY),
      isTokenAutoRefreshEnabled: true,
    });
  } catch (e) { /* no-op */ }
}
// No Firestore SDK initialization needed here (using REST API)

const params = new URLSearchParams(window.location.search);
const produitId = params.get("id");

let quantite = 1;
let imageIndex = 0;
let images = [];

window.afficherImage = function(index) {
  const imgElement = document.getElementById("produit-image");
  if (images[index]) {
    imgElement.src = images[index];
    imageIndex = index;

    const allIndicators = document.querySelectorAll("#carousel-indicators span");
    allIndicators.forEach((el, idx) => {
      el.classList.toggle("active", idx === index);
    });
  }
}

if (!produitId) {
  alert("Aucun ID produit trouvé dans l'URL.");
} else {
  // Fetch product via Firestore REST with App Check header
  let token = null;
  try { token = await getAppCheckToken(); } catch (_) {}
  fetch(`https://europe-west1-mehomiesstore.cloudfunctions.net/getProduct?id=${encodeURIComponent(produitId)}`, {
    headers: {
      ...(token ? { 'X-Firebase-AppCheck': token } : {})
    }
  }).then(r => r.json()).then(data => {
    if (data && data.id) {
      const produit = {
        nom: data.nom || "",
        prix: parseFloat(data.prix ?? 0),
        description: data.description || "",
        tailles: Array.isArray(data.tailles) ? data.tailles : [],
        image: data.image || "",
        image2: data.image2,
        image3: data.image3,
        image4: data.image4,
        image5: data.image5,
        stock: data.stock ?? 0,
      };
      const descriptionLines = (produit.description || "")
        .split(/\n+/)
        .filter(line => line.trim() !== "");
      const produitDescription = document.getElementById("produit-description");
      const ul = document.createElement('ul');
      descriptionLines.forEach(line => {
        const li = document.createElement('li');
        li.textContent = line.trim();
        ul.appendChild(li);
      });
      produitDescription.innerHTML = '';
      produitDescription.appendChild(ul);

      document.getElementById("produit-nom").textContent = produit.nom;
      document.getElementById("produit-prix").textContent = `${produit.prix} €`;

      const tailles = produit.tailles || [];
      const selectTaille = document.getElementById("taille-select");
      const labelTaille = document.querySelector("label[for='taille-select']");

      if (tailles.length > 0) {
        tailles.forEach(taille => {
          const option = document.createElement("option");
          option.value = taille;
          option.textContent = taille;
          selectTaille.appendChild(option);
        });
        const defaultOption = selectTaille.querySelector('option[value=""]');
        if (defaultOption && selectTaille.value === "") {
          document.getElementById("ajouter-panier").disabled = true;
          document.getElementById("acheter-maintenant").disabled = true;
          document.getElementById("ajouter-panier").style.opacity = "0.5";
          document.getElementById("acheter-maintenant").style.opacity = "0.5";
          document.getElementById("ajouter-panier").style.pointerEvents = "none";
          document.getElementById("acheter-maintenant").style.pointerEvents = "none";
        }
      } else {
        selectTaille.style.display = "none";
        labelTaille.style.display = "none";
      }

      if (tailles.length > 0) {
        selectTaille.addEventListener("change", () => {
          if (selectTaille.value === "") {
            document.getElementById("ajouter-panier").disabled = true;
            document.getElementById("acheter-maintenant").disabled = true;
            document.getElementById("ajouter-panier").style.opacity = "0.5";
            document.getElementById("acheter-maintenant").style.opacity = "0.5";
            document.getElementById("ajouter-panier").style.pointerEvents = "none";
            document.getElementById("acheter-maintenant").style.pointerEvents = "none";
            document.getElementById("produit-stock").style.display = "none";
            return;
          } else {
            document.getElementById("ajouter-panier").disabled = false;
            document.getElementById("acheter-maintenant").disabled = false;
            document.getElementById("ajouter-panier").style.opacity = "1";
            document.getElementById("acheter-maintenant").style.opacity = "1";
            document.getElementById("ajouter-panier").style.pointerEvents = "auto";
            document.getElementById("acheter-maintenant").style.pointerEvents = "auto";
            document.getElementById("produit-stock").style.display = "block";
          }
          const selected = selectTaille.value;
          if (produit.stock && typeof produit.stock === 'object') {
            currentStock = produit.stock[selected] || 0;
          } else if (typeof produit.stock === 'number') {
            currentStock = produit.stock;
          } else {
            currentStock = 0;
          }
          if (quantite > currentStock) {
            quantite = currentStock > 0 ? 1 : 0;
            document.getElementById("quantite").textContent = quantite;
          }
          document.getElementById("produit-stock").textContent = `${currentStock} en stock`;
          document.getElementById("ajouter-panier").disabled = currentStock === 0;
          document.getElementById("acheter-maintenant").disabled = currentStock === 0;
        });
      }

      let stock = produit.stock;
      let currentStock = typeof stock === 'number' ? stock : 0;
      const stockElement = document.createElement("p");
      stockElement.id = "produit-stock";
      stockElement.textContent = `${currentStock} en stock`;
      document.querySelector(".infos").insertBefore(stockElement, document.querySelector(".actions"));
      if (selectTaille && selectTaille.value === "") {
        stockElement.style.display = "none";
      }

      images = [produit.image];
      if (produit.image2) images.push(produit.image2);
      if (produit.image3) images.push(produit.image3);
      if (produit.image4) images.push(produit.image4);
      if (produit.image5) images.push(produit.image5);

      window.images = images;

      const indicatorsContainer = document.getElementById("carousel-indicators");
      indicatorsContainer.innerHTML = "";
      images.forEach((_, idx) => {
        const span = document.createElement("span");
        if (idx === imageIndex) span.classList.add("active");
        indicatorsContainer.appendChild(span);
      });

      afficherImage(imageIndex);
      window.imageIndex = imageIndex;
      window.images = images;

      if (currentStock === 0) {
        document.getElementById("ajouter-panier").disabled = true;
        document.getElementById("acheter-maintenant").disabled = true;
      }

      document.getElementById("ajouter-panier").addEventListener("click", () => {
        if (quantite > currentStock) {
          alert("Quantité demandée supérieure au stock disponible.");
          return;
        }
        const selectTailleElem = document.getElementById("taille-select");
        let selectedTaille = "";
        if (selectTailleElem && selectTailleElem.style.display !== "none") {
          selectedTaille = selectTailleElem.value;
          if (!selectedTaille) {
            alert("Veuillez sélectionner une taille.");
            return;
          }
        }
        let panier = JSON.parse(localStorage.getItem("panier")) || [];
        const produitExistant = panier.find(p =>
          p.id === produitId && (selectedTaille ? p.taille === selectedTaille : !p.taille)
        );
        if (produitExistant) {
          if ((produitExistant.quantite + quantite) > currentStock) {
            alert("Impossible d'ajouter cette quantité, stock insuffisant pour cette taille.");
            return;
          }
          produitExistant.quantite += quantite;
        } else {
          panier.push({
            id: produitId,
            nom: produit.nom,
            prix: produit.prix,
            quantite: quantite,
            ...(selectedTaille && { taille: selectedTaille })
          });
        }
        localStorage.setItem("panier", JSON.stringify(panier));
        if (typeof window.updateCartCount === 'function') window.updateCartCount();
        alert(`${produit.nom} ajouté au panier (${quantite}${selectedTaille ? ' - ' + selectedTaille : ''})`);
      });

      document.getElementById("acheter-maintenant").addEventListener("click", async () => {
        if (quantite > currentStock) {
          alert("Quantité demandée supérieure au stock disponible.");
          return;
        }
        const selectTailleElem = document.getElementById("taille-select");
        let selectedTaille = "";
        if (selectTailleElem && selectTailleElem.style.display !== "none") {
          selectedTaille = selectTailleElem.value;
          if (!selectedTaille) {
            alert("Veuillez sélectionner une taille.");
            return;
          }
        }

        const items = [{
          id: produitId,
          nom: produit.nom,
          prix: produit.prix,
          quantite: quantite,
          ...(selectedTaille && { taille: selectedTaille })
        }];

        const isPickup = document.getElementById("remise-main-propre").checked;

        try {
          const appCheckToken = await getAppCheckToken();
          const response = await fetch('https://europe-west1-mehomiesstore.cloudfunctions.net/createCheckoutSession', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(appCheckToken ? { 'X-Firebase-AppCheck': appCheckToken } : {})
            },
            body: JSON.stringify({ items, isPickup })
          });
          let data = {};
          try { data = await response.json(); } catch (_) { data = {}; }
          if (!response.ok) {
            alert("Stock réservé, veuillez réessayer ultérieurement.");
            return;
          }
          if (data.url) {
            window.location.href = data.url;
          } else {
            alert(data.error || "Le paiement n'a pas pu être initialisé. Veuillez réessayer ultérieurement.");
          }
        } catch (error) {
          alert("Une erreur est survenue lors de la création du paiement. Veuillez réessayer ultérieurement.");
        }
      });

      document.getElementById("plus").addEventListener("click", () => {
        if (quantite < currentStock) {
          quantite++;
          document.getElementById("quantite").textContent = quantite;
        } else {
          alert("Stock maximum atteint.");
        }
      });

      document.getElementById("moins").addEventListener("click", () => {
        if (quantite > 1) {
          quantite--;
          document.getElementById("quantite").textContent = quantite;
        }
      });
    } else {
      alert("Produit introuvable.");
    }
  }).catch(() => alert("Erreur de chargement du produit."));
}

// Custom cursor & carousel hover logic (extracted)
(function() {
  const cursor = document.createElement("div");
  cursor.classList.add("custom-cursor");
  cursor.innerHTML = "&larr;";
  document.body.appendChild(cursor);
  const carousel = document.querySelector(".image-carousel");
  if (!carousel) return;
  carousel.addEventListener("mouseenter", () => {
    cursor.style.display = "flex";
  });
  carousel.addEventListener("mouseleave", () => {
    cursor.style.display = "none";
  });
  document.addEventListener("mousemove", (e) => {
    if (carousel.matches(":hover")) {
      cursor.style.left = `${e.clientX - 20}px`;
      cursor.style.top = `${e.clientY - 20}px`;
    }
  });
  const leftZone = document.querySelector(".carousel-hover-left");
  const rightZone = document.querySelector(".carousel-hover-right");
  if (leftZone) leftZone.addEventListener("mouseenter", () => cursor.innerHTML = "&larr;");
  if (rightZone) rightZone.addEventListener("mouseenter", () => cursor.innerHTML = "&rarr;");
  if (leftZone) leftZone.addEventListener("click", () => {
    if (typeof window.afficherImage === 'function' && Array.isArray(window.images) && window.images.length > 1 && typeof window.imageIndex === 'number') {
      const newIndex = (window.imageIndex - 1 + window.images.length) % window.images.length;
      window.imageIndex = newIndex;
      window.afficherImage(window.imageIndex);
    }
  });
  if (rightZone) rightZone.addEventListener("click", () => {
    if (typeof window.afficherImage === 'function' && Array.isArray(window.images) && window.images.length > 1 && typeof window.imageIndex === 'number') {
      const newIndex = (window.imageIndex + 1) % window.images.length;
      window.imageIndex = newIndex;
      window.afficherImage(window.imageIndex);
    }
  });
  let startX = 0;
  let isSwiping = false;
  carousel.addEventListener("touchstart", (e) => {
    startX = e.touches[0].clientX;
    isSwiping = true;
  });
  carousel.addEventListener("touchmove", (e) => {
    if (!isSwiping) return;
    const currentX = e.touches[0].clientX;
    const deltaX = currentX - startX;
    if (Math.abs(deltaX) > 50) {
      let newIndex;
      if (deltaX > 0) {
        newIndex = (window.imageIndex - 1 + window.images.length) % window.images.length;
      } else {
        newIndex = (window.imageIndex + 1) % window.images.length;
      }
      window.imageIndex = newIndex;
      window.afficherImage(window.imageIndex);
      isSwiping = false;
    }
  });
  carousel.addEventListener("touchend", () => {
    isSwiping = false;
  });
})();
