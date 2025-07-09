function updateCartCount() {
  const badge = document.getElementById('cart-count');
  if (!badge) return;

  const panier = JSON.parse(localStorage.getItem('panier')) || [];
  const totalCount = panier.reduce((sum, item) => sum + item.quantite, 0);

  if (totalCount > 0) {
    badge.textContent = totalCount;
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }
}

window.updateCartCount = updateCartCount;  // Expose globalement