// Handles newsletter signup form submission with App Check
// This module is dynamically imported by layout-loader.js after the footer is injected
import { getAppCheckToken } from './appcheck.js';

function $(sel, root = document) { return root.querySelector(sel); }

function setFeedback(msg, ok = false) {
  const box = $('#newsletter-feedback');
  if (!box) return;
  box.textContent = msg || '';
  box.style.color = ok ? '#8bf18b' : '#ffb3b3';
}

async function subscribe(email) {
  // Prefer the regional endpoint used elsewhere in the app
  const url = 'https://europe-west1-mehomiesstore.cloudfunctions.net/subscribeNewsletter';
  let token = null;
  try { token = await getAppCheckToken(); } catch (_) {}

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'X-Firebase-AppCheck': token } : {})
    },
    body: JSON.stringify({ email })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || 'Inscription indisponible, réessaie plus tard.');
  }
  return data;
}

function attachHandler() {
  const form = $('#newsletter-form');
  const emailInput = $('#newsletter-email');
  if (!form || !emailInput) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    setFeedback('');
    const email = (emailInput.value || '').trim();
    if (!email) { setFeedback("Merci d'entrer un email valide."); return; }

    form.querySelector('button')?.setAttribute('disabled', 'true');
    try {
      await subscribe(email);
      setFeedback('Merci ! Inscription confirmée. 👌', true);
      emailInput.value = '';
    } catch (err) {
      setFeedback(err?.message || 'Une erreur est survenue.');
    } finally {
      form.querySelector('button')?.removeAttribute('disabled');
    }
  });
}

// Initialize when footer is loaded
if (document.readyState === 'loading') {
  document.addEventListener('footer:loaded', attachHandler, { once: true });
} else {
  // Footer may already be present if user navigated fast
  attachHandler();
}
