// Shared App Check utility for fetching App Check token and safe initialization
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { initializeAppCheck, ReCaptchaV3Provider, getAppCheck, getToken } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js";
import { firebaseConfig, APP_CHECK_SITE_KEY } from "./firebase-config.js";

let appInstance = null;
let appCheckInitialized = false;

function ensureFirebaseApp() {
  if (!appInstance) {
    if (getApps().length === 0) {
      appInstance = initializeApp(firebaseConfig);
    } else {
      appInstance = getApp();
    }
  }
  return appInstance;
}

function ensureAppCheck() {
  const app = ensureFirebaseApp();
  if (!appCheckInitialized && APP_CHECK_SITE_KEY) {
    try {
      initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider(APP_CHECK_SITE_KEY),
        isTokenAutoRefreshEnabled: true,
      });
      appCheckInitialized = true;
    } catch (_) {
      // ignore if already initialized by another module
      appCheckInitialized = true;
    }
  }
  return getAppCheck(app);
}

export async function getAppCheckToken(forceRefresh = false) {
  try {
    const ac = ensureAppCheck();
    const { token } = await getToken(ac, forceRefresh);
    return token;
  } catch (e) {
    return null;
  }
}

export function getFirebaseApp() {
  return ensureFirebaseApp();
}
