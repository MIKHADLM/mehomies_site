// Confirmation page logic (extracted from confirmation.html inline scripts)
import { getAppCheckToken } from './appcheck.js';

(function() {
  console.log('[DEBUG] Initialisation de la page confirmation via Cloud Function');

  const params = new URLSearchParams(window.location.search);
  const orderId = params.get('order_id');
  const orderNumberEl = document.getElementById('order-number');

  if (!orderId) {
    console.error('[DEBUG] Aucun order_id trouvé dans l\'URL');
    if (orderNumberEl) {
      orderNumberEl.innerHTML = '<span class="error">Aucun numéro de commande trouvé dans l\'URL.</span>';
    }
    return;
  }

  console.log('[DEBUG] Tentative de récupération de la commande via Cloud Function:', orderId);

  (async () => {
    try {
      const appCheckToken = await getAppCheckToken();
      const res = await fetch(`https://europe-west1-mehomiesstore.cloudfunctions.net/getOrderDetails?orderId=${orderId}`, {
        headers: {
          ...(appCheckToken ? { 'X-Firebase-AppCheck': appCheckToken } : {})
        }
      });
      const data = await res.json();
      if (data.numeroCommande) {
        if (orderNumberEl) {
          orderNumberEl.textContent = `Votre numéro de commande : ${data.numeroCommande}`;
          orderNumberEl.classList.remove('error');
          orderNumberEl.classList.add('success');
        }
        // Vider le panier après confirmation
        localStorage.removeItem('panier');
        if (typeof window.updateCartCount === 'function') window.updateCartCount();
        console.log('[DEBUG] Commande affichée avec succès via Cloud Function');
      } else {
        if (orderNumberEl) {
          orderNumberEl.textContent = data.error || 'Commande introuvable.';
          orderNumberEl.classList.remove('success');
          orderNumberEl.classList.add('error');
        }
        console.error('[DEBUG] Erreur renvoyée par la Cloud Function:', data.error);
      }
    } catch (err) {
      console.error('[DEBUG] Erreur lors de l\'appel à getOrderDetails:', err);
      if (orderNumberEl) {
        orderNumberEl.textContent = 'Erreur lors de la récupération de la commande.';
        orderNumberEl.classList.remove('success');
        orderNumberEl.classList.add('error');
      }
    }
  })();
})();
