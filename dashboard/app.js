// Dashboard App
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js";
import { firebaseConfig, APP_CHECK_SITE_KEY } from "../firebase-config.js";
import { getAppCheckToken } from "../appcheck.js";

// Constants
const FUNCTIONS_BASE = "https://europe-west1-mehomiesstore.cloudfunctions.net";
const ADMIN_EMAIL = "mehomies.contact@gmail.com"; // Keep in sync with server allowlist

// DOM helpers
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// Init Firebase
const app = initializeApp(firebaseConfig);
if (APP_CHECK_SITE_KEY) {
  try {
    initializeAppCheck(app, { provider: new ReCaptchaV3Provider(APP_CHECK_SITE_KEY), isTokenAutoRefreshEnabled: true });
  } catch (_) {}
}
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

// UI Elements
const authGate = $("#authGate");
const appRoot = $("#app");
const googleBtn = $("#googleSignInBtn");
const signOutBtn = $("#signOutBtn");
const userEmailEl = $("#userEmail");
const authError = $("#authError");

// Sections
const sections = {
  orders: $("#section-orders"),
  stock: $("#section-stock"),
  traffic: $("#section-traffic"),
  marketing: $("#section-marketing"),
};

// Navigation
$$("aside nav button").forEach((btn) => {
  btn.addEventListener("click", () => {
    $$("aside nav button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const target = btn.dataset.section;
    Object.entries(sections).forEach(([key, el]) => {
      el.classList.toggle("visible", key === target);
    });
  });
});

// Sign-in / Sign-out
if (googleBtn) {
  googleBtn.addEventListener("click", async () => {
    authError.textContent = "";
    try {
      await signInWithPopup(auth, provider);
    } catch (e) {
      const code = e?.code || "";
      if (code === "auth/popup-closed-by-user") {
        authError.textContent = "La fenêtre s'est fermée avant la fin. Réessaie en autorisant les pop-ups.";
        return;
      }
      if (code === "auth/popup-blocked") {
        authError.textContent = "Popup bloqué par le navigateur. Autorise les pop-ups pour mehomies.com et réessaie.";
        return;
      }
      authError.textContent = e?.message || "Connexion échouée";
    }
  });
}
if (signOutBtn) {
  signOutBtn.addEventListener("click", () => signOut(auth));
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    userEmailEl.textContent = "";
    appRoot.classList.add("hidden");
    authGate.classList.remove("hidden");
    return;
  }
  userEmailEl.textContent = user.email || "";

  // Optional client-side guard
  if (user.email !== ADMIN_EMAIL) {
    await signOut(auth);
    authError.textContent = `Ce compte n'est pas autorisé: ${user.email || ""}.`;
    authGate.classList.remove("hidden");
    appRoot.classList.add("hidden");
    return;
  }

  authGate.classList.add("hidden");
  appRoot.classList.remove("hidden");

  await Promise.all([
    loadOrders(),
    loadStock(),
    renderTrafficPlaceholder(),
    renderMarketingPlaceholder(),
  ]);
});

// Helpers to call Cloud Functions
async function getHeaders(includeAuth = true) {
  const headers = { "Content-Type": "application/json" };
  try {
    const appCheckToken = await getAppCheckToken();
    if (appCheckToken) headers["X-Firebase-AppCheck"] = appCheckToken;
  } catch (_) {}
  if (includeAuth && auth.currentUser) {
    const idToken = await auth.currentUser.getIdToken();
    headers["Authorization"] = `Bearer ${idToken}`;
  }
  return headers;
}

// Orders
const ordersFiltersForm = $("#ordersFilters");
const ordersTableBody = $("#ordersTable tbody");
const ordersRevenueEl = $("#ordersRevenue");
const ordersCountEl = $("#ordersCount");

ordersFiltersForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  await loadOrders();
});

async function loadOrders() {
  const params = new URLSearchParams();
  const formData = new FormData(ordersFiltersForm);
  const status = formData.get("status");
  const productId = formData.get("productId");
  const startDate = formData.get("startDate");
  const endDate = formData.get("endDate");
  if (status) params.set("status", status);
  if (productId) params.set("productId", productId);
  if (startDate) params.set("startDate", startDate);
  if (endDate) params.set("endDate", endDate);

  const url = `${FUNCTIONS_BASE}/adminListOrders?${params.toString()}`;
  const res = await fetch(url, { headers: await getHeaders(true) });
  if (!res.ok) {
    console.error("adminListOrders failed", await res.text());
    ordersTableBody.innerHTML = `<tr><td colspan="6">Erreur chargement</td></tr>`;
    return;
  }
  const data = await res.json();
  const orders = data.orders || [];

  // Stats
  const revenue = orders.reduce((sum, o) => sum + (Number(o.totalEuros) || 0), 0);
  ordersRevenueEl.textContent = revenue.toFixed(2);
  ordersCountEl.textContent = String(orders.length);

  // Render table
  ordersTableBody.innerHTML = orders.map((o) => {
    const date = o.createdAt?.toDate?.() ? o.createdAt.toDate() : (o.createdAt?._seconds ? new Date(o.createdAt._seconds * 1000) : null);
    const dateStr = date ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(date) : "—";
    const prods = (o.items || []).map(i => `${i.nom || i.id} ×${i.quantite}`).join(", ");
    return `<tr>
      <td>${dateStr}</td>
      <td>${o.orderNumber || o.id}</td>
      <td>${o.status || ""}</td>
      <td>${(Number(o.totalEuros) || 0).toFixed(2)}</td>
      <td>${o.customerEmail || ""}</td>
      <td>${prods}</td>
    </tr>`;
  }).join("");
}

// Stock
const stockTableBody = $("#stockTable tbody");

async function loadStock() {
  const url = `${FUNCTIONS_BASE}/listProducts`;
  const headers = await getHeaders(true);
  const res = await fetch(url, { headers });
  if (!res.ok) {
    console.error("listProducts failed", await res.text());
    stockTableBody.innerHTML = `<tr><td colspan="3">Erreur chargement</td></tr>`;
    return;
  }
  const data = await res.json();
  const produits = data.produits || [];

  const LOW_STOCK_THRESHOLD = 5;

  stockTableBody.innerHTML = produits.map((p) => {
    let stockStr = "—";
    let low = false;
    if (typeof p.stock === "number") {
      stockStr = String(p.stock);
      low = p.stock <= LOW_STOCK_THRESHOLD;
    } else if (p.stock && typeof p.stock === "object") {
      const entries = Object.entries(p.stock);
      const parts = entries.map(([t, q]) => `${t}:${q}`);
      stockStr = parts.join(" / ");
      low = entries.some(([, q]) => Number(q) <= LOW_STOCK_THRESHOLD);
    }
    return `<tr>
      <td>${p.nom || p.id}</td>
      <td>${stockStr}</td>
      <td>${low ? "⚠️ Bas" : ""}</td>
    </tr>`;
  }).join("");
}

// Traffic placeholder
let trafficChart;
async function renderTrafficPlaceholder() {
  const ctx = $("#trafficChart");
  if (!ctx) return;
  const labels = Array.from({ length: 7 }, (_, i) => `J-${6 - i}`);
  const data = labels.map(() => Math.round(Math.random() * 100));
  if (trafficChart) trafficChart.destroy();
  trafficChart = new Chart(ctx, {
    type: "line",
    data: { labels, datasets: [{ label: "Sessions", data, tension: 0.3, borderColor: "#111", fill: false }] },
    options: { responsive: true, maintainAspectRatio: false }
  });
  $("#sessions7d").textContent = data.reduce((a, b) => a + b, 0);
}

// Marketing placeholder
async function renderMarketingPlaceholder() {
  $("#brevoContacts").textContent = "—";
  $("#brevoOpenRate").textContent = "—";
}
