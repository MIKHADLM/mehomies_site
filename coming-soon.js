// Configuration Firebase - À remplacer par votre configuration
const firebaseConfig = {
  apiKey: "AIzaSyB4D3VvzD3YwL3YwL3YwL3YwL3YwL3YwL3Y",
  authDomain: "votre-projet.firebaseapp.com",
  projectId: "votre-projet",
  storageBucket: "votre-projet.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdef123456"
};

// Initialisation de Firebase
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getFirestore, collection, addDoc, serverTimestamp, query, where, getDocs } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Éléments du DOM
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const subscribeBtn = document.getElementById('subscribe-btn');
const showPasswordBtn = document.getElementById('show-password-btn');
const accessBtn = document.getElementById('access-btn');
const backBtn = document.getElementById('back-btn');
const newsletterForm = document.getElementById('newsletter-form');
const passwordForm = document.getElementById('password-form');
const messageDiv = document.getElementById('message');

// Mot de passe d'accès (à remplacer par un mot de passe sécurisé en production)
const ACCESS_PASSWORD = "mehomies2024";

// Afficher le formulaire de mot de passe
showPasswordBtn.addEventListener('click', () => {
  newsletterForm.style.display = 'none';
  passwordForm.style.display = 'block';
});

// Revenir au formulaire de newsletter
backBtn.addEventListener('click', () => {
  passwordForm.style.display = 'none';
  newsletterForm.style.display = 'block';
  clearMessage();
});

// Gérer l'inscription à la newsletter
subscribeBtn.addEventListener('click', async (e) => {
  e.preventDefault();
  
  const email = emailInput.value.trim();
  
  if (!isValidEmail(email)) {
    showMessage("Veuillez entrer une adresse email valide.", 'error');
    return;
  }
  
  try {
    // Vérifier si l'email existe déjà
    const q = query(collection(db, 'newsletter'), where('email', '==', email));
    const querySnapshot = await getDocs(q);
    
    if (!querySnapshot.empty) {
      showMessage("Vous êtes déjà inscrit(e) à notre newsletter !", 'success');
      return;
    }
    
    // Ajouter l'email à la collection newsletter
    await addDoc(collection(db, 'newsletter'), {
      email: email,
      createdAt: serverTimestamp(),
      source: 'coming-soon-page'
    });
    
    showMessage("Merci pour votre inscription ! Vous serez informé(e) de notre lancement.", 'success');
    emailInput.value = ''; // Vider le champ après l'inscription
  } catch (error) {
    console.error("Erreur lors de l'inscription : ", error);
    showMessage("Une erreur est survenue. Veuillez réessayer plus tard.", 'error');
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

// Fonction pour afficher les messages
function showMessage(message, type) {
  messageDiv.textContent = message;
  messageDiv.className = `message ${type}`;
  messageDiv.style.display = 'block';
  
  // Masquer le message après 5 secondes
  setTimeout(clearMessage, 5000);
}

// Fonction pour effacer les messages
function clearMessage() {
  messageDiv.textContent = '';
  messageDiv.className = 'message';
  messageDiv.style.display = 'none';
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
