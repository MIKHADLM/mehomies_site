// Importer la fonction d'inscription à la newsletter
import { subscribe } from './newsletter.js';

// Éléments du DOM
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const showPasswordBtn = document.getElementById('show-password-btn');
const accessBtn = document.getElementById('access-btn');
const backBtn = document.getElementById('back-btn');
const newsletterForm = document.getElementById('newsletter-form');
const passwordForm = document.getElementById('password-form');
const feedbackDiv = document.getElementById('newsletter-feedback');
const messageBox = document.getElementById('message');

// Mot de passe d'accès (à remplacer par un mot de passe sécurisé en production)
const ACCESS_PASSWORD = "mehomies2024";

// Afficher le formulaire de mot de passe
showPasswordBtn.addEventListener('click', () => {
  if (passwordForm.style.display === 'none' || !passwordForm.style.display) {
    passwordForm.style.display = 'block';
    showPasswordBtn.textContent = 'Masquer le formulaire';
  } else {
    passwordForm.style.display = 'none';
    showPasswordBtn.textContent = 'Entrez le mot de passe';
  }
  clearFeedback();
});

// Revenir au formulaire de newsletter
backBtn.addEventListener('click', (e) => {
  e.preventDefault();
  passwordForm.style.display = 'none';
  showPasswordBtn.textContent = 'Entrez le mot de passe';
  clearFeedback();
});

// Gérer l'inscription à la newsletter
newsletterForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const email = emailInput.value.trim();
  
  if (!isValidEmail(email)) {
    setFeedback("Merci d'entrer un email valide.");
    return;
  }
  
  const submitBtn = newsletterForm.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  
  try {
    await subscribe(email);
    setFeedback('Merci ! Inscription confirmée. 👌', true);
    emailInput.value = '';
  } catch (error) {
    console.error("Erreur lors de l'inscription : ", error);
    setFeedback(error.message || "Une erreur est survenue. Veuillez réessayer plus tard.");
  } finally {
    submitBtn.disabled = false;
  }
});

// Permettre la touche Entrée dans le champ mot de passe
passwordInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    accessBtn.click();
  }
});

// Gérer l'accès avec mot de passe
accessBtn.addEventListener('click', (e) => {
  e.preventDefault();
  
  const password = passwordInput.value.trim();
  
  if (password === '') {
    showMessage("Veuillez entrer le mot de passe.", 'error');
    return;
  }
  
  if (password === ACCESS_PASSWORD) {
    // Stocker en session que l'utilisateur a accès
    sessionStorage.setItem('hasAccess', 'true');
    // Rediriger vers la page d'accueil
    window.location.href = 'index.html';
  } else {
    showMessage("Mot de passe incorrect. Veuillez réessayer.", 'error');
    passwordInput.value = ''; // Vider le champ en cas d'erreur
  }
});

// Fonction pour valider l'email
function isValidEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

// Fonction pour afficher les messages de feedback
function setFeedback(message, isSuccess = false) {
  if (!feedbackDiv) return;
  feedbackDiv.textContent = message || '';
  feedbackDiv.style.color = isSuccess ? '#8bf18b' : '#ffb3b3';
  
  // Masquer le message après 5 secondes
  if (message) {
    setTimeout(clearFeedback, 5000);
  }
}

// Fonction pour effacer les messages de feedback
function clearFeedback() {
  if (feedbackDiv) {
    feedbackDiv.textContent = '';
  }
}

// Afficher un message global (succès/erreur) pour la section mot de passe
function showMessage(msg, type = 'error') {
  if (!messageBox) return;
  messageBox.textContent = msg || '';
  messageBox.classList.remove('success', 'error');
  if (type === 'success') messageBox.classList.add('success');
  else messageBox.classList.add('error');
  messageBox.style.display = msg ? 'block' : 'none';
  if (msg) {
    setTimeout(() => { if (messageBox) messageBox.style.display = 'none'; }, 5000);
  }
}

// Vérifier si l'utilisateur a déjà accès
function checkAccess() {
  // Si l'utilisateur a déjà accès et est sur la page coming-soon, le rediriger vers index.html
  if (sessionStorage.getItem('hasAccess') === 'true' && 
      window.location.pathname.endsWith('coming-soon.html')) {
    window.location.href = 'index.html';
  }
}

// Vérifier l'accès au chargement de la page
window.addEventListener('load', checkAccess);
