// GMAO A2CIM - Initialisation Firebase + authentification + cache hors-ligne
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import {
  getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut,
  setPersistence, browserLocalPersistence, browserSessionPersistence
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import {
  initializeAppCheck, ReCaptchaV3Provider
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app-check.js";

const firebaseConfig = {
  apiKey: "AIzaSyAvKqfjnjJ4a64QpK2Idt2ms32E0zALFJ4",
  authDomain: "gmao-a2cim.firebaseapp.com",
  projectId: "gmao-a2cim",
  storageBucket: "gmao-a2cim.firebasestorage.app",
  messagingSenderId: "687654110395",
  appId: "1:687654110395:web:5ce86666b10c3ad028d59e"
};

// Clé reCAPTCHA v3 (console Firebase > App Check). Laisser vide tant qu'elle n'est pas créée.
const RECAPTCHA_SITE_KEY = "";

export const app = initializeApp(firebaseConfig);

if (RECAPTCHA_SITE_KEY) {
  initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(RECAPTCHA_SITE_KEY),
    isTokenAutoRefreshEnabled: true
  });
}

// Cache hors-ligne : les techniciens peuvent consulter et saisir sans réseau, la synchro se fait au retour
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});

export const auth = getAuth(app);

export function logout() {
  return signOut(auth).then(() => location.reload());
}

const AUTH_ERRORS = {
  "auth/invalid-credential": "Email ou mot de passe incorrect.",
  "auth/invalid-email": "Adresse email invalide.",
  "auth/user-disabled": "Ce compte est désactivé.",
  "auth/too-many-requests": "Trop de tentatives. Réessayez dans quelques minutes.",
  "auth/network-request-failed": "Pas de connexion réseau."
};

// Se résout uniquement quand un utilisateur est connecté.
// app.js attend cette promesse avant de lancer le moindre onSnapshot.
export const authReady = new Promise((resolve) => {
  const lock = document.getElementById("lockScreen");
  const form = document.getElementById("loginForm");
  const emailEl = document.getElementById("loginEmail");
  const passEl = document.getElementById("loginPassword");
  const errEl = document.getElementById("authError");
  const btn = document.getElementById("loginBtn");
  const rememberEl = document.getElementById("loginRemember");

  // Pré-remplit l'email (jamais le mot de passe) et l'état de la case
  try {
    const lastEmail = localStorage.getItem("gmao_last_email");
    if (lastEmail) emailEl.value = lastEmail;
    if (localStorage.getItem("gmao_remember") === "0") rememberEl.checked = false;
  } catch (_) { /* stockage indisponible : on ignore */ }

  const showLock = () => { lock.classList.remove("hidden"); lock.classList.add("flex"); };
  const hideLock = () => { lock.classList.add("hidden"); lock.classList.remove("flex"); };

  onAuthStateChanged(auth, (user) => {
    if (user) { hideLock(); resolve(user); } else { showLock(); }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errEl.classList.add("hidden");
    btn.disabled = true;
    try {
      // Case cochée : session conservée sur l'appareil (survit à la fermeture et aux mises à jour du code)
      // Case décochée : session limitée à l'onglet en cours
      const remember = rememberEl.checked;
      await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
      await signInWithEmailAndPassword(auth, emailEl.value.trim(), passEl.value);
      try {
        localStorage.setItem("gmao_remember", remember ? "1" : "0");
        localStorage.setItem("gmao_last_email", emailEl.value.trim());
      } catch (_) { /* ignoré */ }
      passEl.value = "";
    } catch (err) {
      errEl.textContent = AUTH_ERRORS[err.code] || "Connexion impossible.";
      errEl.classList.remove("hidden");
    } finally {
      btn.disabled = false;
    }
  });
});
