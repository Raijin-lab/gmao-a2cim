# Modifications à appliquer

## 0. Ordre de mise en place

1. Console Firebase > Authentication > activer **Email/Mot de passe**, créer un compte par technicien.
2. Firestore > créer la collection `users`, un document par compte, **ID = UID du compte**, champ `role` = `"admin"` (chef) ou `"tech"`.
3. Firestore > Règles > coller `firestore.rules` > Publier.
4. Remplacer `sw.js` et `manifest.json`, ajouter `firebase-init.js`.
5. Appliquer les points 1 à 8 ci-dessous.
6. Authentication > Settings > Domaines autorisés : ne garder que votre domaine.
7. Google Cloud Console > Identifiants > restreindre la clé API aux référents HTTP de votre domaine.
8. (Recommandé) App Check : créer la clé reCAPTCHA v3, la mettre dans `firebase-init.js`, activer l'application en mode « Enforce » après test.

Bump aussi `?v=38` en `?v=39` dans index.html (style.css et app.js).

---

## 1. index.html : remplacer tout le bloc `#lockScreen`

```html
<div id="lockScreen" class="fixed inset-0 bg-brand-900 z-50 flex items-center justify-center p-4">
  <div class="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-8 text-center">
    <div class="w-16 h-16 bg-brand-50 text-brand-900 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl shadow-inner"><i class="fa-solid fa-lock"></i></div>
    <h2 class="text-xl font-bold text-slate-800 mb-1">GMAO pro A2CIM</h2>
    <form id="loginForm" class="space-y-4 mt-6">
      <input type="email" id="loginEmail" placeholder="Email" required autocomplete="username" class="w-full px-4 py-3 border border-slate-300 rounded-xl bg-slate-50">
      <input type="password" id="loginPassword" placeholder="Mot de passe" required autocomplete="current-password" class="w-full px-4 py-3 border border-slate-300 rounded-xl bg-slate-50">
      <p id="authError" class="hidden text-sm text-red-600 font-medium"></p>
      <button type="submit" id="loginBtn" class="w-full bg-brand-500 hover:bg-brand-600 text-white font-medium py-3 rounded-xl shadow-sm">Se connecter</button>
    </form>
  </div>
</div>
```

Ajouter dans `<head>` (avant les scripts) une politique de sécurité de contenu :

```html
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com https://cdn.jsdelivr.net https://www.gstatic.com https://www.google.com https://www.recaptcha.net; style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://fonts.googleapis.com; font-src https://cdnjs.cloudflare.com https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' https://*.googleapis.com https://*.firebaseio.com https://cdn.jsdelivr.net https://tessdata.projectnaptha.com https://*.gstatic.com; worker-src 'self' blob:; frame-src https://www.google.com https://www.recaptcha.net;">
```
(`unsafe-inline` reste nécessaire tant que les `onclick` inline existent ; à retirer après le point 3.)

---

## 2. app.js : remplacer l'en-tête et supprimer le PIN

Remplacer les 3 premières lignes d'import/config/`initializeApp`/`getFirestore` par :

```js
import {
  collection, addDoc, setDoc, deleteDoc, updateDoc, doc, onSnapshot, query, orderBy,
  serverTimestamp, arrayUnion, arrayRemove, writeBatch
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { db, auth, authReady, logout } from "./firebase-init.js";

const currentUser = await authReady;   // bloque tout tant que l'utilisateur n'est pas connecté

// ---------- Utilitaires ----------
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
const p2 = (n) => String(n).padStart(2, "0");
const localDateStr = (d = new Date()) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const parseLocal = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const recurrenceId = (c, m, d, t) => [c, m, d, t].join("__").replace(/[^\w-]/g, "_");
```

Supprimer entièrement le bloc `// --- GESTION DU CODE PIN ---` (const CORRECT_PIN et le listener `pinForm`).
Garder `escapeHtml` plus bas ou le remplacer par `esc`.

---

## 3. XSS : échapper toutes les données injectées

Règle : **toute** valeur issue de Firestore ou d'un champ de saisie passe par `esc()` dans les templates. Exemples :

- `${data.nom}` devient `${esc(data.nom)}` (parc, selects, calendrier)
- `${m}` devient `${esc(m)}`
- `${p.nom}`, `${p.ref}`, `${data.client}`, `${data.machine}`, `${m.technicien}`, `${group.client}` : idem
- Dans les `<option value="...">` : `value="${esc(data.nom)}"`
- Le texte copié `textToCopy` : OK (encodé), mais `esc()` les valeurs affichées.

Remplacer les `onclick="fn('${x}', '${y}')"` par des attributs `data-*` + un seul écouteur délégué, ce qui supprime l'injection par apostrophes :

```js
// Dans les templates :
// <button data-act="kit" data-client="${esc(data.nom)}" data-machine="${esc(m)}">…</button>
// <button data-act="del-machine" data-id="${esc(docId)}" data-machine="${esc(m)}">…</button>
// <button data-act="del-client" data-id="${esc(docId)}">…</button>
// <div data-act="group" data-key="${esc(key)}">…</div>
// <div data-act="open-intv" data-id="${esc(m.id)}">…</div>
// <button data-act="del-piece" data-ref="${esc(p.ref)}" data-nom="${esc(p.nom)}">…</button>
// <button data-act="del-ht" data-id="${esc(data.id)}">…</button>

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (!el) return;
  const { act, client, machine, id, key, ref, nom } = el.dataset;
  switch (act) {
    case "kit": return ouvrirModalKit(client, machine);
    case "del-machine": return supprimerMachineParc(id, machine);
    case "del-client": return supprimerClientParc(id);
    case "group": return ouvrirModalGroupe(key);
    case "open-intv": fermerModalGroupe(); return ouvrirActionModal(id);
    case "del-piece": return retirerPieceDuKitTemp(ref, nom);
    case "del-ht": return supprimerHypertherm(id);
  }
});
```
Les formulaires `onsubmit="ajouterMachineParc(event, '${docId}')"` deviennent :
`<form data-machine-form="${esc(docId)}">` avec un écouteur `submit` délégué sur `document`.

---

## 4. Archivage sûr (ne plus archiver avant l'impression)

Dans `redigerFicheGlobaleTerminee`, **supprimer** la ligne :
`await updateDoc(doc(db, "interventions", m.id), { statut: "Archivé" });`
et mémoriser les IDs à la place :

```js
window.__pendingArchive = group.machines.map((m) => m.id);
```

Dans `prepareAndPrint`, remplacer le `setTimeout(() => { window.print(); ... })` par :

```js
window.addEventListener("afterprint", async function once() {
  window.removeEventListener("afterprint", once);
  document.title = originalTitle;
  const ids = window.__pendingArchive || [];
  if (ids.length) {
    try {
      const batch = writeBatch(db);
      ids.forEach((id) => batch.update(doc(db, "interventions", id), { statut: "Archivé" }));
      await batch.commit();
      window.__pendingArchive = [];
    } catch (err) { console.error(err); alert("Fiche imprimée, mais l'archivage a échoué : " + err.message); }
  }
  btnGenerer.disabled = false;
  btnGenerer.innerHTML = '<i class="fa-solid fa-print mr-2"></i> Sauvegarder & Imprimer le PDF';
});
setTimeout(() => window.print(), 300);
```

Et enregistrer l'historique avec l'auteur, en attendant le résultat :

```js
const historiqueData = { /* …champs existants… */, uid: currentUser.uid, email: currentUser.email, timestamp_creation: serverTimestamp() };
try { await addDoc(collection(db, "historique_interventions"), historiqueData); }
catch (err) { console.error(err); if (!confirm("L'historique n'a pas pu être enregistré. Imprimer quand même ?")) { btnGenerer.disabled = false; return; } }
```
(`prepareAndPrint` devient `async`.)

---

## 5. Récurrences sans doublon (Valider sur 2 appareils)

Remplacer chaque `addDoc(collection(db, "interventions"), {...})` créant la prochaine échéance (bouton « Valider », Hypertherm, récurrence classique) par un ID déterministe :

```js
const nextDate = localDateStr(cycleInfo.dateObj);          // ou dateObj calculé
const id = recurrenceId(intv.client, intv.machine, nextDate, "Préventif");
await setDoc(doc(db, "interventions", id), {
  client: intv.client, machine: intv.machine, date: nextDate, type: "Préventif",
  technicien: "Équipe A2CIM", statut: "Planifié", frequence: "Hypertherm",
  timestamp: serverTimestamp()
});
```
Même échéance cliquée deux fois = même document, pas de doublon.

---

## 6. Dates locales (plus de décalage UTC)

- Tous les `x.toISOString().split('T')[0]` deviennent `localDateStr(x)`.
- `new Date(instDateStr)` / `new Date(intv.date)` / `new Date(dateVal)` / `new Date(data.date)` deviennent `parseLocal(...)`.
- `todayStr` : `const todayStr = localDateStr();`
- Dans `getNextHyperthermCycle` : `const instDate = parseLocal(instDateStr);`

---

## 7. Gestion d'erreurs et suppressions

Entourer d'un `try/catch` avec `alert` les écritures nues : `ajouterMachineParc`, `supprimerMachineParc`, `supprimerClientParc`, `supprimerHypertherm`, `btnDeleteEvent`, `btnSetEnCours`, `sauvegarderKitFinal`, ajout client. Exemple :

```js
window.supprimerClientParc = async function (docId) {
  if (!confirm("Attention : supprimer ce client ?")) return;
  try { await deleteDoc(doc(db, "clients", docId)); }
  catch (err) { alert("Action refusée ou échouée : " + err.message); }
};
```
Les règles réservent déjà ces suppressions à l'admin ; un technicien verra donc ce message au lieu d'une perte silencieuse.

Ajouter un bouton de déconnexion (ex. dans la barre latérale) : `onclick` remplacé par `data-act="logout"` puis `case "logout": return logout();`.

---

## 8. Dépendances

- **Tailwind CDN** : à remplacer à terme par une version compilée (`npx tailwindcss -o tailwind.css --minify`) et hébergée avec le projet.
- Figer les versions : `fullcalendar@6.1.15` et `tesseract.js@5` (idéalement `@5.1.1` précis) ; héberger les fichiers localement pour le hors-ligne total.
- Le service worker fourni met déjà ces bibliothèques en cache après la première visite en ligne.
