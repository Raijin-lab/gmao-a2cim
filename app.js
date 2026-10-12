// =====================================================================
// GMAO pro A2CIM - app.js (version sécurisée)
// Prérequis : firebase-init.js, firestore.rules, nouveau #lockScreen dans index.html
// =====================================================================
import {
  collection, addDoc, setDoc, getDoc, deleteDoc, updateDoc, doc, onSnapshot, query, orderBy,
  serverTimestamp, arrayUnion, arrayRemove, writeBatch, limit, where, getDocs
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { db, authReady, logout } from "./firebase-init.js";

// ---------------------------------------------------------------------
// UTILITAIRES
// ---------------------------------------------------------------------
const esc = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
const $ = (id) => document.getElementById(id);
const p2 = (n) => String(n).padStart(2, "0");
const localDateStr = (d = new Date()) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const parseLocal = (s) => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, (m || 1) - 1, d || 1); };
const recurrenceId = (...parts) => parts.join("__").replace(/[^\w-]/g, "_");
const kitKey = (c, m) => `${c}||${m}`;
const SPINNER = '<i class="fa-solid fa-spinner fa-spin mr-2"></i>';

function addMonths(d, n) {
  const r = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate();
  r.setDate(Math.min(d.getDate(), last));
  return r;
}

function toast(msg, type = "info") {
  const el = document.createElement("div");
  const color = type === "error" ? "bg-red-600" : type === "success" ? "bg-green-600" : "bg-slate-800";
  el.className = `fixed top-4 left-1/2 -translate-x-1/2 z-[100] px-4 py-3 rounded-xl shadow-lg text-sm font-bold text-white max-w-[90vw] ${color}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4500);
}
const onListenError = (label) => (err) => {
  console.error(label, err);
  toast(`Synchronisation impossible (${label}) : ${err.code || err.message}`, "error");
};
window.addEventListener("offline", () => toast("Hors-ligne : les modifications seront synchronisées au retour du réseau."));
window.addEventListener("online", () => toast("Connexion rétablie.", "success"));

// ---------------------------------------------------------------------
// AUTHENTIFICATION & RÔLE
// ---------------------------------------------------------------------
const currentUser = await authReady;
let isAdmin = false;
try {
  const snap = await getDoc(doc(db, "users", currentUser.uid));
  if (!snap.exists()) {
    alert("Compte non autorisé : aucun profil n'a été créé pour cet utilisateur. Contactez l'administrateur.");
    await logout();
  } else {
    const role = snap.data().role;
    isAdmin = role === "admin";
    localStorage.setItem("gmao_role_" + currentUser.uid, role);
  }
} catch (err) {
  // Hors-ligne : on reprend le dernier rôle connu (les règles Firestore restent le vrai verrou)
  isAdmin = localStorage.getItem("gmao_role_" + currentUser.uid) === "admin";
}

function applyRoleUI() {
  if (!isAdmin) {
    ["formAddClient", "formAddHypertherm"].forEach((id) => { const f = $(id); if (f && f.parentElement) f.parentElement.classList.add("hidden"); });
  }
  const aside = document.querySelector("aside");
  const info = `<div class="text-xs text-blue-200 mb-2 truncate">${esc(currentUser.email)} · ${isAdmin ? "Admin" : "Technicien"}</div>`;
  if (aside) {
    aside.insertAdjacentHTML("beforeend", `<div class="p-4 border-t border-brand-800">${info}<button data-act="logout" class="w-full text-left px-4 py-2 text-sm text-brand-100 hover:bg-brand-800 rounded-xl"><i class="fa-solid fa-right-from-bracket mr-2"></i>Déconnexion</button></div>`);
  }
  const mobileHeader = document.querySelector("div.flex-1 > header");
  if (mobileHeader) mobileHeader.insertAdjacentHTML("beforeend", `<button data-act="logout" class="text-blue-200 text-sm"><i class="fa-solid fa-right-from-bracket"></i></button>`);
}
applyRoleUI();

// ---------------------------------------------------------------------
// ÉTAT GLOBAL
// ---------------------------------------------------------------------
let allInterventions = [];
let knownIds = new Set();
let clientsCache = [];
let parcClientsDB = {};
let kitsDB = {};
let hyperthermDB = [];
let groupedInterventionsGlobal = {};
let tempKitPieces = [];
let fullCalendarInstance = null;
let currentClientFilter = "ALL";
let currentTypeFilter = "ALL";
let historiqueDB = [];
let historiqueFilter = "";
let currentFicheId = null;   // non nul = on modifie une fiche déjà enregistrée
window.__pendingArchive = [];
const withTimeout = (p, ms = 4000) => Promise.race([p, new Promise((res) => setTimeout(() => res("timeout"), ms))]);

// ---------------------------------------------------------------------
// ÉCRITURES SÛRES (anti-doublons)
// ---------------------------------------------------------------------
function isDuplicate(c, m, d, t) {
  return allInterventions.some((i) => i.client === c && i.machine === m && i.date === d && i.type === t && i.statut === "Planifié");
}

async function createIntervention(data) {
  const id = recurrenceId(data.client, data.machine, data.date, data.type);
  if (knownIds.has(id) || isDuplicate(data.client, data.machine, data.date, data.type)) return false;
  await setDoc(doc(db, "interventions", id), { ...data, timestamp: serverTimestamp() });
  knownIds.add(id);
  return true;
}

async function upsertKit(client, machine, pieces) {
  const existing = kitsDB[kitKey(client, machine)];
  if (existing) await updateDoc(doc(db, "kits", existing.id), { pieces });
  else await addDoc(collection(db, "kits"), { client, machine, pieces });
}

// ---------------------------------------------------------------------
// KITS (NOMENCLATURE)
// ---------------------------------------------------------------------
onSnapshot(query(collection(db, "kits")), (snapshot) => {
  kitsDB = {};
  snapshot.forEach((d) => { const x = d.data(); kitsDB[kitKey(x.client, x.machine)] = { id: d.id, pieces: x.pieces || [] }; });
  renderParc();
}, onListenError("kits"));

window.ouvrirModalKit = function (client, machine) {
  $("kitModalMachineName").textContent = `${client} | ${machine}`;
  $("currentKitClient").value = client;
  $("currentKitMachine").value = machine;
  const existing = kitsDB[kitKey(client, machine)];
  tempKitPieces = existing ? [...existing.pieces] : [];
  afficherPiecesKitTemp();
  $("kitModal").classList.remove("hidden"); $("kitModal").classList.add("flex");
};
window.fermerKitModal = function () { $("kitModal").classList.add("hidden"); $("kitModal").classList.remove("flex"); };

window.ajouterPieceAuKitTemp = function () {
  const ref = $("kitNewRef").value.trim() || "N/A";
  const nom = $("kitNewNom").value.trim();
  const qte = parseInt($("qtePieceKit").value, 10);
  if (!nom || !(qte >= 1)) return toast("Saisissez au moins la désignation et une quantité valide.", "error");
  const idx = tempKitPieces.findIndex((p) => p.ref === ref && p.nom === nom);
  if (idx >= 0) tempKitPieces[idx].qte = qte; else tempKitPieces.push({ ref, nom, qte });
  $("kitNewRef").value = ""; $("kitNewNom").value = ""; $("qtePieceKit").value = "1";
  afficherPiecesKitTemp();
};

function afficherPiecesKitTemp() {
  const ul = $("listePiecesKitTemp");
  if (tempKitPieces.length === 0) { ul.innerHTML = '<li class="text-sm text-slate-400 italic text-center py-2">Aucune pièce associée.</li>'; return; }
  ul.innerHTML = tempKitPieces.map((p) =>
    `<li class="flex justify-between items-center bg-slate-50 border border-slate-100 p-2 rounded text-sm"><span><strong>${esc(p.qte)}x</strong> [${esc(p.ref)}] ${esc(p.nom)}</span><button data-act="del-piece" data-ref="${esc(p.ref)}" data-nom="${esc(p.nom)}" class="text-red-500 hover:text-red-700"><i class="fa-solid fa-xmark"></i></button></li>`
  ).join("");
}

window.sauvegarderKitFinal = async function () {
  try {
    await upsertKit($("currentKitClient").value, $("currentKitMachine").value, tempKitPieces);
    toast("Nomenclature enregistrée.", "success");
    fermerKitModal();
  } catch (err) { console.error(err); toast("Enregistrement refusé : " + (err.code || err.message), "error"); }
};

// ---------------------------------------------------------------------
// PARC CLIENTS
// ---------------------------------------------------------------------
onSnapshot(query(collection(db, "clients"), orderBy("nom", "asc")), (snapshot) => {
  clientsCache = []; parcClientsDB = {};
  snapshot.forEach((d) => {
    const x = d.data();
    const entry = { id: d.id, nom: x.nom, machines: Array.isArray(x.machines) ? x.machines : [], machinesInfo: Array.isArray(x.machinesInfo) ? x.machinesInfo : [] };
    clientsCache.push(entry);
    parcClientsDB[x.nom] = { id: d.id, machines: entry.machines };
  });
  renderClientSelects();
  renderParc();
}, onListenError("clients"));

function renderClientSelects() {
  const formSel = $("formClient"), htSel = $("htClient"), calSel = $("calendarClientFilter");
  const prevForm = formSel ? formSel.value : "";
  const opts = clientsCache.map((c) => `<option value="${esc(c.nom)}">${esc(c.nom)}</option>`).join("");
  if (formSel) { formSel.innerHTML = '<option value="" disabled selected>Sélectionner...</option>' + opts; if (parcClientsDB[prevForm]) formSel.value = prevForm; }
  if (htSel) htSel.innerHTML = '<option value="" disabled selected>Client...</option>' + opts;
  if (calSel) { calSel.innerHTML = '<option value="ALL">Tous les clients</option>' + opts; calSel.value = parcClientsDB[currentClientFilter] ? currentClientFilter : "ALL"; }
}

function renderParc() {
  const container = $("parc-container"); if (!container) return;
  container.innerHTML = clientsCache.map((cl) => {
    const machinesHTML = cl.machines.length === 0
      ? '<p class="text-xs text-slate-400 italic mb-2">Aucune machine.</p>'
      : cl.machines.map((m) => {
          const kit = kitsDB[kitKey(cl.nom, m)];
          const info = cl.machinesInfo.find((i) => i.label === m);
          const serieHTML = info && info.serie ? `<span class="block text-[10px] text-slate-400 font-normal">S/N ${esc(info.serie)}</span>` : "";
          const iconColor = kit && kit.pieces.length > 0 ? "text-brand-500" : "text-slate-300";
          const delBtn = isAdmin ? `<button data-act="edit-machine" data-id="${esc(cl.id)}" data-machine="${esc(m)}" class="text-slate-300 hover:text-brand-500 px-1"><i class="fa-solid fa-pen"></i></button><button data-act="del-machine" data-id="${esc(cl.id)}" data-machine="${esc(m)}" class="text-slate-300 hover:text-red-500 px-1"><i class="fa-solid fa-xmark"></i></button>` : "";
          return `<div class="flex items-center justify-between bg-slate-50 px-3 py-2 rounded-lg mb-2 border border-slate-100"><span class="text-sm text-slate-700 font-medium truncate flex-1"><i class="fa-solid fa-microchip text-slate-400 mr-2"></i>${esc(m)}${serieHTML}</span><div class="flex items-center space-x-2 shrink-0"><button data-act="kit" data-client="${esc(cl.nom)}" data-machine="${esc(m)}" class="px-2 py-1 bg-white border border-slate-200 rounded hover:bg-slate-100"><i class="fa-solid fa-boxes-stacked ${iconColor}"></i></button>${delBtn}</div></div>`;
        }).join("");
    const delClient = isAdmin ? `<button data-act="del-client" data-id="${esc(cl.id)}" class="absolute top-4 right-4 text-slate-300 hover:text-red-500"><i class="fa-solid fa-trash-can"></i></button>` : "";
    const addForm = isAdmin ? `<form data-machine-form="${esc(cl.id)}" class="mt-auto space-y-2 border-t border-slate-100 pt-3"><input type="text" name="type" placeholder="Type (ex : HPR 260)" required class="w-full px-3 py-1.5 text-sm border rounded-lg focus:ring-2 focus:ring-brand-500"><div class="flex gap-2"><input type="text" name="repere" placeholder="Repère (ex : Atelier A)" class="flex-1 min-w-0 px-3 py-1.5 text-sm border rounded-lg focus:ring-2 focus:ring-brand-500"><input type="text" name="serie" placeholder="N° série" class="w-1/3 min-w-0 px-3 py-1.5 text-sm border rounded-lg focus:ring-2 focus:ring-brand-500"></div><button type="submit" class="w-full bg-slate-800 text-white py-1.5 rounded-lg text-sm hover:bg-slate-700"><i class="fa-solid fa-plus mr-1"></i> Ajouter la machine</button></form>` : ""; 
    return `<div class="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden flex flex-col relative h-full">${delClient}<div class="p-5 border-b border-slate-100 bg-brand-50"><h3 class="text-lg font-bold text-brand-900"><i class="fa-solid fa-building mr-2 text-brand-500"></i>${esc(cl.nom)}</h3></div><div class="p-5 flex-1 flex flex-col"><div class="mb-4 max-h-[200px] overflow-y-auto custom-scroll pr-2">${machinesHTML}</div>${addForm}</div></div>`;
  }).join("");
}

function syncMachinesDropdown(clientSelectId, machineSelectId, allowAll) {
  const cs = $(clientSelectId), ms = $(machineSelectId);
  if (!cs || !ms) return;
  cs.addEventListener("change", (e) => {
    const nom = e.target.value;
    let html = '<option value="" disabled selected>Machine...</option>';
    if (parcClientsDB[nom]) {
      const list = parcClientsDB[nom].machines;
      if (allowAll && list.length > 0) html += `<option value="TOUTES_LES_MACHINES" class="font-bold text-brand-600">🌟 Toutes les machines (${list.length})</option>`;
      html += list.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join("");
    }
    ms.innerHTML = html;
  });
}
syncMachinesDropdown("formClient", "formMachine", true);
syncMachinesDropdown("htClient", "htMachine", false);

async function safe(fn, okMsg) {
  try { await fn(); if (okMsg) toast(okMsg, "success"); }
  catch (err) { console.error(err); toast("Action refusée ou échouée : " + (err.code || err.message), "error"); }
}
// Nom affiché d'une machine = Type · Repère (ou N° de série si pas de repère). Unique par client.
function machineLabel({ type, repere, serie }) {
  return [type, repere || (serie ? `S/N ${serie}` : "")].filter(Boolean).join(" · ");
}
const DUP_MSG = (label) => `« ${label} » existe déjà chez ce client. Ajoutez un repère (ex : Atelier A, Ligne 2) ou un N° de série pour les distinguer.`;

async function ajouterMachineParc(docId, data) {
  const cl = clientsCache.find((c) => c.id === docId); if (!cl) return false;
  const info = { type: data.type.trim(), repere: data.repere.trim(), serie: data.serie.trim() };
  if (!info.type) { toast("Le type de machine est obligatoire.", "error"); return false; }
  info.label = machineLabel(info);
  if (cl.machines.some((m) => m.toLowerCase() === info.label.toLowerCase())) { toast(DUP_MSG(info.label), "error"); return false; }
  try {
    await updateDoc(doc(db, "clients", docId), { machines: arrayUnion(info.label), machinesInfo: arrayUnion(info) });
    toast("Machine ajoutée.", "success");
    return true;
  } catch (err) { console.error(err); toast("Action refusée ou échouée : " + (err.code || err.message), "error"); return false; }
}

const supprimerMachineParc = (docId, nom) => {
  if (!confirm(`Supprimer la machine "${nom}" ?`)) return;
  const cl = clientsCache.find((c) => c.id === docId);
  const info = cl && cl.machinesInfo.find((i) => i.label === nom);
  const upd = { machines: arrayRemove(nom) };
  if (info) upd.machinesInfo = arrayRemove(info);
  return safe(() => updateDoc(doc(db, "clients", docId), upd));
};

// Renommer / compléter une machine : met à jour aussi nomenclatures, interventions et suivi Hypertherm.
// L'historique des fiches déjà imprimées n'est volontairement pas modifié.
async function renameMachine(docId, oldLabel, data) {
  const cl = clientsCache.find((c) => c.id === docId); if (!cl) return false;
  if (!navigator.onLine) { toast("Connexion requise pour modifier une machine.", "error"); return false; }
  const info = { type: data.type.trim(), repere: data.repere.trim(), serie: data.serie.trim() };
  if (!info.type) { toast("Le type de machine est obligatoire.", "error"); return false; }
  info.label = machineLabel(info);
  const changed = info.label !== oldLabel;
  if (changed && cl.machines.some((m) => m !== oldLabel && m.toLowerCase() === info.label.toLowerCase())) { toast(DUP_MSG(info.label), "error"); return false; }
  try {
    const ops = [{
      ref: doc(db, "clients", docId),
      data: {
        machines: cl.machines.map((m) => (m === oldLabel ? info.label : m)),
        machinesInfo: cl.machinesInfo.filter((i) => i.label !== oldLabel).concat(info)
      }
    }];
    if (changed) {
      for (const col of ["kits", "interventions", "hypertherm"]) {
        const snap = await getDocs(query(collection(db, col), where("client", "==", cl.nom), where("machine", "==", oldLabel)));
        snap.forEach((d) => ops.push({ ref: d.ref, data: { machine: info.label } }));
      }
    }
    for (let i = 0; i < ops.length; i += 400) {
      const batch = writeBatch(db);
      ops.slice(i, i + 400).forEach((o) => batch.update(o.ref, o.data));
      await batch.commit();
    }
    toast(`Machine mise à jour (${ops.length - 1} élément(s) lié(s)).`, "success");
    return true;
  } catch (err) { console.error(err); toast("Modification échouée : " + (err.code || err.message), "error"); return false; }
}

function openMachineEditor(docId, oldLabel) {
  const cl = clientsCache.find((c) => c.id === docId); if (!cl) return;
  const info = cl.machinesInfo.find((i) => i.label === oldLabel) || { type: oldLabel, repere: "", serie: "" };
  const inputCls = "w-full px-3 py-2 border border-slate-300 rounded-lg text-sm";
  const ov = document.createElement("div");
  ov.className = "fixed inset-0 bg-slate-900 bg-opacity-60 flex items-center justify-center z-[80] px-4";
  ov.innerHTML = `<form class="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 space-y-3"><h3 class="text-lg font-bold text-slate-800">Modifier la machine</h3><p class="text-xs text-slate-500">Les interventions, nomenclatures et le suivi Hypertherm de cette machine sont mis à jour automatiquement. Les fiches déjà imprimées ne changent pas.</p><input name="type" value="${esc(info.type)}" placeholder="Type (ex : HPR 260)" required class="${inputCls}"><input name="repere" value="${esc(info.repere)}" placeholder="Repère (ex : Atelier A)" class="${inputCls}"><input name="serie" value="${esc(info.serie)}" placeholder="N° de série" class="${inputCls}"><div class="flex gap-2 pt-2"><button type="button" data-cancel class="flex-1 py-2 bg-slate-100 rounded-xl text-sm font-bold">Annuler</button><button type="submit" class="flex-1 py-2 bg-brand-500 text-white rounded-xl text-sm font-bold">Enregistrer</button></div></form>`;
  document.body.appendChild(ov);
  ov.querySelector("[data-cancel]").addEventListener("click", () => ov.remove());
  ov.querySelector("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const btn = e.target.querySelector('button[type="submit"]'); btn.disabled = true;
    const ok = await renameMachine(docId, oldLabel, { type: fd.get("type"), repere: fd.get("repere"), serie: fd.get("serie") });
    if (ok) ov.remove(); else btn.disabled = false;
  });
}
const supprimerClientParc = (docId) => confirm("Attention : supprimer ce client ?") && safe(() => deleteDoc(doc(db, "clients", docId)));

if ($("formAddClient")) {
  $("formAddClient").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = $("newClientName"); const nom = input.value.trim(); if (!nom) return;
    if (parcClientsDB[nom]) return toast("Ce client existe déjà.", "error");
    await safe(() => addDoc(collection(db, "clients"), { nom, machines: [] }));
    input.value = "";
  });
}

// ---------------------------------------------------------------------
// HYPERTHERM (calcul des échéances)
// ---------------------------------------------------------------------
const HALF_YEAR = 182.5;

function getHTRules(modele) {
  const standard = modele === "HPR260" || modele === "MAXPRO200";
  if (standard) {
    return {
      "6M": [{ ref: "027664", nom: "Filtre à air principal" }, { ref: "028872", nom: "Coolant (Liquide ref.)" }, { ref: "027665", nom: "Filtre liquide ref." }, { ref: "128879", nom: "Kit entretien torche Std" }],
      "12M": [{ ref: "003149", nom: "Relais arc pilote" }, { ref: "003150", nom: "Contacteur principal" }, { ref: "220162", nom: "Corps de torche (Standard)" }],
      "24M": [{ ref: "023274", nom: "Pompe à eau" }, { ref: "228292", nom: "Faisceaux de torche Std" }],
      "36M": [{ ref: "027666", nom: "Ventilateurs" }, { ref: "027667", nom: "Moteur pompe" }]
    };
  }
  return {
    "6M": [{ ref: "027664", nom: "Filtre à air principal" }, { ref: "028872", nom: "Coolant 70/30" }, { ref: "027665", nom: "Filtre liquide ref." }, { ref: "428383", nom: "Kit d'entretien torche XD/XPR" }],
    "12M": [{ ref: "003149", nom: "Relais arc pilote" }, { ref: "003150", nom: "Contacteur principal" }, { ref: "428144", nom: "Corps de torche XD/XPR" }],
    "24M": [{ ref: "428384", nom: "Kit pompe à eau" }, { ref: "428385", nom: "Faisceaux de torche (Leads)" }],
    "36M": [{ ref: "027666", nom: "Ventilateurs" }, { ref: "027667", nom: "Moteur hydraulique" }]
  };
}

// Jalons tous les 6 mois d'usage effectif (corrigé : l'ancien calcul ne détectait jamais 12M/24M/36M)
// n = index du semestre : n%6==0 -> 36M, n%4==0 -> 24M, n%2==0 -> 12M, sinon 6M
function getNextHyperthermCycle(instDateStr, shifts, modele) {
  const s = shifts || 1;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const instDate = parseLocal(instDateStr);
  const rules = getHTRules(modele);

  let n = 1;
  if (instDate <= today) {
    const ageDays = Math.floor((today - instDate) / 86400000);
    n = Math.floor((ageDays * s) / HALF_YEAR) + 1;
  }
  let cycleType = "6M";
  if (n % 6 === 0) cycleType = "36M"; else if (n % 4 === 0) cycleType = "24M"; else if (n % 2 === 0) cycleType = "12M";

  const dateObj = new Date(instDate);
  dateObj.setDate(dateObj.getDate() + Math.round((n * HALF_YEAR) / s));
  return { cycleType, dateObj, parts: rules[cycleType] };
}

function purchaseText(data, cycleInfo) {
  return `Demande PDR - Préventif Hypertherm A2CIM\nClient: ${data.client}\nMachine: ${data.machine} (${data.modele})\nIntervention: ${cycleInfo.cycleType}\n\nPièces à commander :\n` +
    cycleInfo.parts.map((p) => `- [Réf: ${p.ref}] ${p.nom}`).join("\n") + "\n";
}

onSnapshot(query(collection(db, "hypertherm")), (snapshot) => {
  hyperthermDB = [];
  snapshot.forEach((d) => hyperthermDB.push({ ...d.data(), id: d.id }));
  hyperthermDB.sort((a, b) => String(a.dateInstallation).localeCompare(String(b.dateInstallation)));
  renderHypertherm();
}, onListenError("hypertherm"));

function renderHypertherm() {
  const container = $("hypertherm-container"); if (!container) return;
  if (hyperthermDB.length === 0) { container.innerHTML = '<p class="text-slate-500 italic">Aucun générateur Hypertherm enregistré.</p>'; return; }
  container.innerHTML = hyperthermDB.map((data) => {
    const shifts = data.shifts || 1;
    const cycleInfo = getNextHyperthermCycle(data.dateInstallation, shifts, data.modele);
    const instStr = parseLocal(data.dateInstallation).toLocaleDateString("fr-FR");
    const nextStr = cycleInfo.dateObj.toLocaleDateString("fr-FR");
    const partsHTML = '<ul class="mt-3 space-y-2">' + cycleInfo.parts.map((p) =>
      `<li class="flex justify-between items-center text-xs border-b border-amber-200/50 pb-1.5"><span class="text-slate-700 font-medium">${esc(p.nom)}</span><span class="font-mono font-bold text-amber-700 bg-amber-100/50 px-2 py-0.5 rounded border border-amber-200">Réf: ${esc(p.ref)}</span></li>`).join("") + "</ul>";
    const delBtn = isAdmin ? `<button data-act="del-ht" data-id="${esc(data.id)}" class="absolute top-4 right-4 text-slate-300 hover:text-red-500"><i class="fa-solid fa-trash-can"></i></button>` : "";
    return `<div class="bg-white rounded-2xl shadow-sm border border-slate-100 p-5 relative overflow-hidden">${delBtn}<div class="flex items-center gap-3 mb-4"><div class="w-12 h-12 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-500 text-2xl shadow-inner"><i class="fa-solid fa-bolt"></i></div><div><h3 class="font-bold text-lg text-slate-800 uppercase">${esc(data.client)} <span class="text-slate-400 font-normal mx-1">|</span> ${esc(data.machine)}</h3><p class="text-sm text-slate-500 font-medium">${esc(data.modele)} &nbsp;&bull;&nbsp; <span class="text-slate-400">Installé le ${instStr} (${esc(shifts)} Poste${shifts > 1 ? "s" : ""})</span></p></div></div><div class="bg-amber-50/50 border border-amber-100 rounded-xl p-4 mt-2"><div class="flex items-center justify-between mb-3"><span class="text-xs font-bold uppercase tracking-wider text-slate-500">Prochaine Échéance : ${esc(cycleInfo.cycleType)}</span><span class="text-[10px] font-bold px-2 py-1 rounded uppercase tracking-wider bg-amber-100 text-amber-800"><i class="fa-solid fa-calendar-day mr-1"></i> ${nextStr}</span></div><div class="flex justify-between items-center mb-1"><p class="text-amber-900 font-bold text-xs uppercase tracking-wider"><i class="fa-solid fa-boxes-stacked mr-1 text-amber-500"></i> Liste d'achat</p><button data-act="copy-ht" data-id="${esc(data.id)}" class="text-[10px] bg-amber-200 hover:bg-amber-300 text-amber-900 px-2 py-1.5 rounded-lg font-bold transition-colors shadow-sm"><i class="fa-solid fa-copy mr-1"></i> Copier</button></div>${partsHTML}</div></div>`;
  }).join("");
}

if ($("formAddHypertherm")) {
  $("formAddHypertherm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]'); const orig = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>'; btn.disabled = true;
    try {
      const client = $("htClient").value, machine = $("htMachine").value, modele = $("htModel").value;
      const dateInst = $("htDateInst").value, shifts = parseInt($("htShifts").value, 10) || 1;
      if (!client || !machine) return toast("Sélectionnez un client et une machine.", "error");

      await setDoc(doc(db, "hypertherm", recurrenceId("HT", client, machine)), { client, machine, modele, dateInstallation: dateInst, shifts, timestamp: serverTimestamp() });
      const cycleInfo = getNextHyperthermCycle(dateInst, shifts, modele);
      await createIntervention({ client, machine, date: localDateStr(cycleInfo.dateObj), type: "Préventif", technicien: "Équipe A2CIM", statut: "Planifié", frequence: "Hypertherm" });
      await upsertKit(client, machine, cycleInfo.parts.map((p) => ({ ref: p.ref, nom: p.nom, qte: 1 })));

      e.target.reset(); $("htMachine").innerHTML = '<option value="" disabled selected>Machine...</option>';
      alert(`✅ ${modele} surveillé pour ${client}.\n\n📅 Prochaine révision calculée : ${cycleInfo.dateObj.toLocaleDateString("fr-FR")} (${cycleInfo.cycleType}).`);
    } catch (err) { console.error(err); toast("Erreur : " + (err.code || err.message), "error"); }
    finally { btn.innerHTML = orig; btn.disabled = false; }
  });
}
const supprimerHypertherm = (id) => confirm("Arrêter la surveillance ?") && safe(() => deleteDoc(doc(db, "hypertherm", id)));

// ---------------------------------------------------------------------
// STATUTS & CALENDRIER
// ---------------------------------------------------------------------
const statusConfig = {
  "En retard": { bg: "#fef2f2", border: "#ef4444", text: "#b91c1c", color: "#ef4444" },
  "En cours": { bg: "#fff7ed", border: "#f97316", text: "#c2410c", color: "#f97316" },
  "Planifié": { bg: "#eff6ff", border: "#3b82f6", text: "#1d4ed8", color: "#3b82f6" },
  "Terminé": { bg: "#f0fdf4", border: "#22c55e", text: "#15803d", color: "#22c55e" },
  "Archivé": { bg: "#f3f4f6", border: "#d1d5db", text: "#374151", color: "#9ca3af" }
};

function initCalendar() {
  const el = $("calendar");
  if (!el || typeof FullCalendar === "undefined") return;
  if (fullCalendarInstance) fullCalendarInstance.destroy();
  const mobile = window.innerWidth < 768;
  fullCalendarInstance = new FullCalendar.Calendar(el, {
    initialView: mobile ? "listMonth" : "dayGridMonth", locale: "fr", weekNumbers: true, weekText: "S",
    dayMaxEvents: 2, moreLinkClick: "listDay",
    headerToolbar: { left: "prev,next today", center: "title", right: mobile ? "" : "dayGridMonth,listDay" },
    buttonText: { today: "Aujourd'hui", month: "Mois", list: "Jour" }, height: "100%", events: [],
    eventClick: (info) => (info.event.extendedProps && info.event.extendedProps.multiJours ? openDossier(info.event.id) : ouvrirActionModal(info.event)),
    dateClick: (info) => fullCalendarInstance.changeView("listDay", info.dateStr)
  });
  fullCalendarInstance.render();
}

function updateCalendarEvents() {
  if (!fullCalendarInstance) return;
  fullCalendarInstance.removeAllEvents();
  const todayStr = localDateStr();
  const preventifDates = new Set();
  allInterventions.forEach((data) => {
    if (currentClientFilter !== "ALL" && data.client !== currentClientFilter) return;
    if (currentTypeFilter !== "ALL" && data.type !== currentTypeFilter) return;
    let color = statusConfig[data.statut]?.color || "#3b82f6";
    if (data.statut !== "Terminé" && data.date < todayStr && !data.multiJours) color = "#ef4444";
    else if (data.statut === "Planifié" && data.type === "Curatif") color = "#ef4444";
    if (data.type === "Préventif") preventifDates.add(data.date);
    fullCalendarInstance.addEvent({
      id: data.id, title: `${data.multiJours ? "📂" : data.type === "Curatif" ? "🚨" : "🔧"} ${data.client} - ${data.machine}`, start: data.date,
      backgroundColor: color, borderColor: color,
      extendedProps: { client: data.client, statut: data.statut, frequence: data.frequence || "Ponctuel", type: data.type, machine: data.machine, technicien: data.technicien, multiJours: !!data.multiJours }
    });
  });
  preventifDates.forEach((d) => fullCalendarInstance.addEvent({ start: d, display: "background", backgroundColor: "#f1f5f9" }));
}

if ($("calendarClientFilter")) $("calendarClientFilter").addEventListener("change", (e) => { currentClientFilter = e.target.value; updateCalendarEvents(); });
if ($("calendarTypeFilter")) $("calendarTypeFilter").addEventListener("change", (e) => { currentTypeFilter = e.target.value; updateCalendarEvents(); });
initCalendar();

// ---------------------------------------------------------------------
// MODAL D'ACTION (MACHINE INDIVIDUELLE)
// ---------------------------------------------------------------------
const actionModal = $("eventActionModal");

function ouvrirActionModal(eventOrId) {
  let id, props;
  if (typeof eventOrId === "string") {
    const i = allInterventions.find((x) => x.id === eventOrId); if (!i) return;
    id = i.id; props = { client: i.client, machine: i.machine, statut: i.statut, frequence: i.frequence || "Ponctuel", type: i.type };
  } else {
    if (eventOrId.display === "background") return;
    id = eventOrId.id; props = eventOrId.extendedProps;
  }
  const exact = allInterventions.find((x) => x.id === id);
  $("actionModalTitle").textContent = props.machine;
  $("actionModalSub").textContent = `${props.client} | ${props.frequence}`;
  $("actionEventId").value = id; $("actionEventDate").value = exact ? exact.date : "";
  $("actionEventClient").value = props.client; $("actionEventType").value = props.type;

  $("btnSetEnCours").style.display = props.statut === "Planifié" ? "block" : "none";
  $("btnSetTermine").style.display = props.statut !== "Terminé" ? "block" : "none";
  $("deleteOptionsDiv").style.display = isAdmin ? "block" : "none";

  const kit = kitsDB[kitKey(props.client, props.machine)];
  const ul = $("actionModalPDRList");
  if (props.type === "Préventif" && kit && kit.pieces.length > 0) {
    ul.innerHTML = kit.pieces.map((p) => `<li><span class="font-black bg-white text-brand-700 px-2 py-0.5 rounded mr-2 border border-brand-100">${esc(p.qte)}x</span> [${esc(p.ref)}] ${esc(p.nom)}</li>`).join("");
    $("actionModalPDR").classList.remove("hidden");
  } else { ul.innerHTML = ""; $("actionModalPDR").classList.add("hidden"); }
  actionModal.classList.remove("hidden"); actionModal.classList.add("flex");
}
function fermerActionModal() { actionModal.classList.add("hidden"); actionModal.classList.remove("flex"); }

$("btnCloseActionModal").addEventListener("click", fermerActionModal);
$("btnDeleteEvent").addEventListener("click", async () => {
  if (!confirm("Supprimer l'intervention pour cette machine uniquement ?")) return;
  await safe(() => deleteDoc(doc(db, "interventions", $("actionEventId").value)));
  fermerActionModal();
});
$("btnSetEnCours").addEventListener("click", async () => {
  await safe(() => updateDoc(doc(db, "interventions", $("actionEventId").value), { statut: "En cours" }));
  fermerActionModal();
});

async function planNextOccurrence(intv) {
  const freq = intv.frequence || "Ponctuel";
  if (freq === "Hypertherm") {
    const ht = hyperthermDB.find((h) => h.client === intv.client && h.machine === intv.machine);
    if (!ht) return;
    const cycleInfo = getNextHyperthermCycle(ht.dateInstallation, ht.shifts || 1, ht.modele);
    await createIntervention({ client: intv.client, machine: intv.machine, date: localDateStr(cycleInfo.dateObj), type: "Préventif", technicien: "Équipe A2CIM", statut: "Planifié", frequence: "Hypertherm" });
    await upsertKit(intv.client, intv.machine, cycleInfo.parts.map((p) => ({ ref: p.ref, nom: p.nom, qte: 1 })));
  } else if (freq !== "Ponctuel") {
    const months = { Mensuel: 1, Trimestriel: 3, Semestriel: 6, Annuel: 12 }[freq];
    if (!months) return;
    await createIntervention({ client: intv.client, machine: intv.machine, date: localDateStr(addMonths(parseLocal(intv.date), months)), type: intv.type, technicien: intv.technicien, statut: "Planifié", frequence: freq });
  }
}

$("btnSetTermine").addEventListener("click", async () => {
  const btn = $("btnSetTermine"); const orig = btn.innerHTML;
  const intv = allInterventions.find((i) => i.id === $("actionEventId").value);
  if (!intv || intv.statut === "Terminé") { fermerActionModal(); return; }
  btn.innerHTML = SPINNER + "Validation..."; btn.disabled = true;
  try {
    await updateDoc(doc(db, "interventions", intv.id), { statut: "Terminé" });
    await planNextOccurrence(intv);
  } catch (err) { console.error(err); toast("Erreur lors de la validation : " + (err.code || err.message), "error"); }
  finally { btn.innerHTML = orig; btn.disabled = false; fermerActionModal(); }
});

// ---------------------------------------------------------------------
// TABLEAU DE BORD (GROUPÉ, 3 COLONNES)
// ---------------------------------------------------------------------
onSnapshot(query(collection(db, "interventions"), orderBy("date", "asc")), (snapshot) => {
  const urgent = $("urgent-tasks-container"), upcoming = $("upcoming-tasks-container"), completed = $("completed-tasks-container");
  let urgentHTML = "", upcomingHTML = "", completedHTML = "";
  allInterventions = []; knownIds = new Set(); groupedInterventionsGlobal = {};
  let active = 0, retard = 0, enCours = 0, termine = 0;
  const todayStr = localDateStr();

  snapshot.forEach((docSnap) => {
    const data = docSnap.data(); data.id = docSnap.id;
    knownIds.add(docSnap.id);
    if (data.statut === "Archivé") return;
    allInterventions.push(data);

    const isRetard = data.date < todayStr && !data.multiJours;
    if (data.statut === "Terminé") termine++;
    else {
      active++;
      if (data.statut === "En retard" || isRetard) retard++;
      if (data.statut === "En cours") enCours++;
    }
    const dateAffichee = data.date ? parseLocal(data.date).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" }) : "";
    let config = statusConfig[data.statut] || statusConfig["Planifié"];
    if (isRetard && data.statut === "Planifié") config = statusConfig["En retard"];
    const lateNow = isRetard && data.statut !== "Terminé";
    const groupKey = data.multiJours ? `dossier_${data.id}` : `${data.client}_${data.date}_${data.type}_${lateNow ? "Retard" : data.statut}`;
    if (!groupedInterventionsGlobal[groupKey]) {
      groupedInterventionsGlobal[groupKey] = { client: data.client, dateAffichee, type: data.type, statut: isRetard && data.statut === "Planifié" ? "En retard" : data.statut, isRetard, config, machines: [], multi: !!data.multiJours, dossierId: data.id };
    }
    groupedInterventionsGlobal[groupKey].machines.push(data);
  });

  Object.keys(groupedInterventionsGlobal).forEach((key) => {
    const g = groupedInterventionsGlobal[key];
    const warn = g.isRetard && g.statut !== "Terminé" ? '<span class="text-red-500 font-bold text-xs"><i class="fa-solid fa-triangle-exclamation"></i></span>' : "";
    const card = `<div data-act="${g.multi ? "dossier" : "group"}" data-key="${esc(key)}" data-id="${esc(g.dossierId || "")}" class="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden flex items-center justify-between hover:shadow-md transition-shadow cursor-pointer"><div class="w-2 self-stretch border-l-4" style="background-color:${g.config.bg};border-color:${g.config.border};"></div><div class="p-4 flex-1 flex items-center justify-between"><div><div class="flex items-center gap-2 mb-1"><h3 class="font-bold text-slate-800 text-base uppercase">${esc(g.client)}</h3>${warn}</div><p class="text-sm text-slate-600 font-medium"><i class="fa-solid fa-microchip mr-1 text-slate-400"></i> ${g.multi ? "Dossier multi-jours · " + esc(g.machines[0].machine) : g.machines.length + " machine(s) " + (g.statut === "Terminé" ? "achevée(s)" : "prévue(s)")}</p><p class="text-xs text-slate-500 mt-1"><i class="fa-solid fa-calendar-day mr-1"></i> ${esc(g.dateAffichee)} &nbsp;|&nbsp; <i class="fa-solid fa-wrench mr-1"></i> ${esc(g.type)}</p></div><div class="px-3 py-1.5 rounded-lg text-xs font-bold uppercase" style="background-color:${g.config.bg};color:${g.config.text};border-color:${g.config.border};border-width:1px;">${esc(g.statut)}</div></div></div>`;
    if (g.statut === "Terminé") completedHTML += card;
    else if (g.type === "Curatif" || g.isRetard || g.statut === "En retard") urgentHTML += card;
    else upcomingHTML += card;
  });

  if (urgent) urgent.innerHTML = urgentHTML || '<p class="text-slate-400 text-sm italic py-2">Super ! Aucune urgence ni retard.</p>';
  if (upcoming) upcoming.innerHTML = upcomingHTML || '<p class="text-slate-400 text-sm italic py-2">Aucune maintenance préventive prévue.</p>';
  if (completed) completed.innerHTML = completedHTML || '<p class="text-slate-400 text-sm italic py-2">Aucune intervention terminée en attente de fiche.</p>';
  if ($("kpi-total")) $("kpi-total").textContent = active;
  if ($("kpi-retard")) $("kpi-retard").textContent = retard;
  if ($("kpi-encours")) $("kpi-encours").textContent = enCours;
  if ($("kpi-termine")) $("kpi-termine").textContent = termine;
  updateCalendarEvents();
}, onListenError("interventions"));

function ouvrirModalGroupe(groupKey) {
  const g = groupedInterventionsGlobal[groupKey]; if (!g) return;
  $("groupModalTitle").textContent = `Machines - ${g.client}`;
  $("groupModalSub").textContent = `${g.dateAffichee} | ${g.type}`;
  let html = '<div class="space-y-2 mb-4">' + g.machines.map((m) => m.statut === "Terminé"
    ? `<div class="flex justify-between items-center p-3 border border-slate-100 rounded-lg bg-green-50"><div><p class="font-bold text-slate-800">${esc(m.machine)}</p><p class="text-xs text-green-600 mt-1 font-bold"><i class="fa-solid fa-check mr-1"></i> Achevé par ${esc(m.technicien)}</p></div></div>`
    : `<div data-act="open-intv" data-id="${esc(m.id)}" class="flex justify-between items-center p-3 border border-slate-100 rounded-lg hover:bg-slate-50 cursor-pointer transition-colors"><div><p class="font-bold text-slate-800">${esc(m.machine)}</p><p class="text-xs text-slate-500 mt-1"><i class="fa-solid fa-user-gear mr-1"></i> ${esc(m.technicien)}</p></div><i class="fa-solid fa-chevron-right text-slate-300"></i></div>`
  ).join("") + "</div>";
  if (g.statut === "Terminé") {
    html += `<div class="mt-auto pt-4 border-t border-slate-200"><button id="btnRedigerFicheGroupe" data-act="fiche-globale" data-key="${esc(groupKey)}" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl shadow-md transition-transform transform hover:-translate-y-1"><i class="fa-solid fa-file-signature mr-2"></i> Rédiger la Fiche Globale (${g.machines.length} mach.)</button></div>`;
  }
  $("groupModalList").innerHTML = html;
  $("groupModal").classList.remove("hidden"); $("groupModal").classList.add("flex");
}
window.fermerModalGroupe = function () { $("groupModal").classList.add("hidden"); $("groupModal").classList.remove("flex"); };

// Préparation de la fiche : l'archivage n'a lieu qu'APRÈS l'impression (voir prepareAndPrint)
function redigerFicheGlobaleTerminee(groupKey) {
  const g = groupedInterventionsGlobal[groupKey]; if (!g) return;
  const allParts = {}; const machinesList = []; const allTechs = new Set();
  g.machines.forEach((m) => {
    machinesList.push(m.machine);
    if (m.technicien) String(m.technicien).split(", ").forEach((t) => allTechs.add(t));
    const kit = kitsDB[kitKey(m.client, m.machine)];
    if (kit && m.type === "Préventif") kit.pieces.forEach((p) => {
      if (!allParts[p.ref]) allParts[p.ref] = { nom: p.nom, qte: 0 };
      allParts[p.ref].qte += Number(p.qte) || 0;
    });
  });
  window.__pendingArchive = g.machines.map((m) => m.id);
  setEditMode(null);

  $("input_fisav").value = ""; $("input_reference").value = ""; $("input_deplacements").value = "";
  $("input_client").value = g.client;
  $("input_machine").value = `${g.machines.length} machine(s) (Voir détail)`;
  $("input_date").value = localDateStr();

  if (g.type === "Préventif") {
    $("input_forfait_ref").value = "PREV"; $("input_forfait_nom").value = "SAV-Préventif"; $("input_forfait_diag").value = "Maintenance Préventive Parc";
    let t = `Dans le cadre du contrat de maintenance préventive A2CIM, une intervention a été réalisée sur un parc de ${g.machines.length} équipement(s).\n\n`;
    t += `Machines concernées :\n- ${machinesList.join("\n- ")}\n\n`;
    t += "📌 CONTRÔLES EFFECTUÉS SUR CHAQUE MACHINE :\n- Nettoyage et dépoussiérage intégral de la source et console.\n- Vérification des tensions, des sécurités et connectiques.\n- Contrôle des pressions et purge des circuits.\n";
    const keys = Object.keys(allParts);
    if (keys.length > 0) {
      t += "\n⚙️ REMPLACEMENT GLOBAL DES CONSOMMABLES (Cumul du parc) :\n";
      keys.forEach((ref) => { t += `✓ ${allParts[ref].qte}x ${allParts[ref].nom} (Réf: ${ref})\n`; });
    }
    t += "\n✅ Résultat : Ensemble des équipements remis en production.";
    $("input_travaux").value = t;
  } else {
    $("input_forfait_ref").value = "DEPAN"; $("input_forfait_nom").value = "SAV-Depannage"; $("input_forfait_diag").value = "Intervention Curative Multi-machines";
    $("input_travaux").value = `Machines concernées : ${machinesList.join(", ")}\n\nDétail des travaux : `;
  }
  $("fiche-tech-list").innerHTML = [...allTechs].filter((t) => t && t !== "?").map(techRowHTML).join("");
  fermerModalGroupe();
  showView("fiches");
}

// ---------------------------------------------------------------------
// AJOUT D'INTERVENTION
// ---------------------------------------------------------------------
const addModal = $("addInterventionModal");
const openAddModal = () => { addModal.classList.remove("hidden"); addModal.classList.add("flex"); };
const closeAddModal = () => { addModal.classList.add("hidden"); addModal.classList.remove("flex"); };
if ($("addInterventionBtn")) $("addInterventionBtn").addEventListener("click", openAddModal);
if ($("closeModalBtn")) $("closeModalBtn").addEventListener("click", closeAddModal);
if ($("cancelModalBtn")) $("cancelModalBtn").addEventListener("click", closeAddModal);

function toggleMultiRow() {
  const row = $("multiJoursRow"); if (!row) return;
  const show = $("formType").value === "Curatif";
  row.classList.toggle("hidden", !show);
  if (!show) { $("formMultiJours").checked = false; $("formPanne").value = ""; }
}
if ($("formType")) $("formType").addEventListener("change", toggleMultiRow);

if ($("addInterventionForm")) {
  $("addInterventionForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("btnSubmit"); const orig = btn.innerHTML;
    const checked = document.querySelectorAll('input[name="tech"]:checked');
    if (checked.length === 0) return toast("Veuillez sélectionner au moins un technicien.", "error");
    const technicien = Array.from(checked).map((cb) => cb.value).join(", ");
    const client = $("formClient").value, machine = $("formMachine").value, date = $("formDate").value;
    const type = $("formType").value, frequence = $("formFrequence").value;
    if (!client || !machine || !date) return toast("Client, machine et date sont obligatoires.", "error");

    btn.innerHTML = SPINNER + "Création..."; btn.disabled = true;
    try {
      const base = { type, technicien, statut: "Planifié", frequence };
      const multi = type === "Curatif" && $("formMultiJours") && $("formMultiJours").checked;
      if (multi) {
        if (machine === "TOUTES_LES_MACHINES") { toast("Un dossier multi-jours concerne une seule machine.", "error"); return; }
        const created = await createIntervention({ client, machine, date, type, technicien, statut: "En cours", frequence: "Ponctuel", multiJours: true, panne: ($("formPanne").value || "").trim() });
        alert(created ? "📂 Dossier multi-jours ouvert. Cliquez dessus dans « Urgences » pour ajouter les passages." : "⚠️ Une intervention identique existe déjà (doublon évité).");
      } else if (machine === "TOUTES_LES_MACHINES") {
        const batch = writeBatch(db); let ajouts = 0, doublons = 0;
        for (const m of parcClientsDB[client].machines) {
          const id = recurrenceId(client, m, date, type);
          if (knownIds.has(id) || isDuplicate(client, m, date, type)) { doublons++; continue; }
          batch.set(doc(db, "interventions", id), { client, machine: m, date, ...base, timestamp: serverTimestamp() });
          ajouts++;
        }
        if (ajouts > 0) await batch.commit();
        alert(`${ajouts} intervention(s) planifiée(s) pour ${client} !` + (doublons ? `\n⚠️ ${doublons} doublon(s) ignoré(s).` : ""));
      } else {
        const created = await createIntervention({ client, machine, date, ...base });
        if (!created) alert("⚠️ Cette intervention existe déjà (doublon évité).");
      }
      e.target.reset(); closeAddModal(); toggleMultiRow();
    } catch (err) { console.error(err); toast("Erreur lors de la création : " + (err.code || err.message), "error"); }
    finally { btn.innerHTML = orig; btn.disabled = false; }
  });
}

// ---------------------------------------------------------------------
// NAVIGATION
// ---------------------------------------------------------------------
const navLinks = document.querySelectorAll(".nav-link");
const appViews = document.querySelectorAll(".app-view");
const addBtn = $("addInterventionBtn");
const viewsWithAddBtn = ["dashboard", "planning", "curatif"];

function showView(target) {
  if (!$(`view-${target}`)) return;
  appViews.forEach((v) => v.classList.add("hidden"));
  $(`view-${target}`).classList.remove("hidden");
  if (target === "planning" && fullCalendarInstance) setTimeout(() => fullCalendarInstance.render(), 100);
  if (addBtn) {
    if (viewsWithAddBtn.includes(target)) { addBtn.classList.remove("opacity-0", "pointer-events-none"); addBtn.classList.add("opacity-100"); }
    else { addBtn.classList.remove("opacity-100"); addBtn.classList.add("opacity-0", "pointer-events-none"); }
  }
  navLinks.forEach((l) => { l.classList.remove("bg-brand-800", "text-white"); l.classList.add("text-slate-400"); });
  document.querySelectorAll(`[data-view="${target}"]`).forEach((l) => { l.classList.add("bg-brand-800", "text-white"); l.classList.remove("text-slate-400"); });
}
navLinks.forEach((link) => link.addEventListener("click", (e) => { e.preventDefault(); showView(link.getAttribute("data-view")); }));

// ---------------------------------------------------------------------
// FICHE D'INTERVENTION (SAISIE, OCR, IMPRESSION)
// ---------------------------------------------------------------------
function techRowHTML(name = "", qty = 1, unit = "Heure(s)") {
  return `<div class="flex items-center gap-3 mb-2 tech-row"><input type="text" class="tech-name w-1/2 p-2 border border-slate-300 rounded-lg text-sm bg-white font-bold" placeholder="Nom" value="${esc(name)}"><input type="number" class="tech-qty-val w-1/4 p-2 border border-slate-300 rounded-lg text-sm bg-white" placeholder="Qté" value="${esc(qty)}" step="0.5" min="0"><select class="tech-qty-unit w-1/4 p-2 border border-slate-300 rounded-lg text-sm bg-white"><option value="Heure(s)"${unit === "Heure(s)" ? " selected" : ""}>Heure(s)</option><option value="Jour(s)"${unit === "Jour(s)" ? " selected" : ""}>Jour(s)</option></select><button type="button" data-act="rm-tech" class="text-red-500 hover:text-red-700 font-bold px-2">X</button></div>`;
}
// insertAdjacentHTML : ne perd plus les valeurs déjà saisies (l'ancien innerHTML += les effaçait)
window.addFicheTechnician = function () { $("fiche-tech-list").insertAdjacentHTML("beforeend", techRowHTML()); };

if ($("input_date_tirage")) {
  const n = new Date();
  $("input_date_tirage").value = localDateStr(n);
  $("input_heure_tirage").value = `${p2(n.getHours())}:${p2(n.getMinutes())}:${p2(n.getSeconds())}`;
}

window.processOCR = async function () {
  const fileInput = $("imageInput"), status = $("ocrStatus");
  if (!fileInput.files.length) return toast("Sélectionnez ou prenez une photo !", "error");
  const file = fileInput.files[0];
  if (!file.type.startsWith("image/") || file.size > 15 * 1024 * 1024) return toast("Image invalide ou trop volumineuse (15 Mo max).", "error");
  if (typeof Tesseract === "undefined") return toast("Module OCR indisponible (connexion requise).", "error");
  status.style.color = "#2563eb"; status.innerText = "Lecture de l'image en cours...";
  try {
    const result = await Tesseract.recognize(file, "fra");
    const text = result.data.text;
    const fisav = text.match(/\b\d{2}[A-Z]{2}\d+\b/g); if (fisav) $("input_fisav").value = fisav[0];
    const ref = text.match(/SAV\s+[A-Z]+/g); if (ref) $("input_reference").value = ref[0];
    status.style.color = "#16a34a"; status.innerText = "Analyse terminée ! Vérifiez les champs extraits.";
  } catch (err) { console.error(err); status.style.color = "#dc2626"; status.innerText = "Erreur OCR (connexion requise pour la première utilisation)."; }
};

window.sendWhatsApp = function () {
  const fisav = $("input_fisav").value || "N/A", client = $("input_client").value || "Client", machine = $("input_machine").value || "Machine";
  const message = `Bonjour, voici la fiche d'intervention A2CIM.\n\n*N° FISAV :* ${fisav}\n*Client :* ${client}\n*Machine :* ${machine}\n\n(Veuillez trouver le fichier PDF en pièce jointe).`;
  window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank", "noopener");
};

async function archivePending() {
  const ids = window.__pendingArchive || [];
  if (ids.length === 0) return;
  if (!confirm(`La fiche a bien été imprimée / enregistrée ?\n\nArchiver les ${ids.length} intervention(s) du tableau de bord ?`)) return;
  try {
    const batch = writeBatch(db);
    ids.forEach((id) => batch.update(doc(db, "interventions", id), { statut: "Archivé" }));
    await batch.commit();
    window.__pendingArchive = [];
    toast("Interventions archivées.", "success");
  } catch (err) { console.error(err); toast("Archivage échoué : " + (err.code || err.message), "error"); }
}

window.prepareAndPrint = async function () {
  const fisavRaw = $("input_fisav").value.trim(), clientRaw = $("input_client").value.trim();
  const machineRaw = $("input_machine").value.trim(), dateRaw = $("input_date").value;
  const missing = [];
  if (!fisavRaw) missing.push("N° FISAV"); if (!clientRaw) missing.push("Client");
  if (!machineRaw) missing.push("Machine"); if (!dateRaw) missing.push("Date d'intervention");
  if (missing.length > 0) return alert("Veuillez remplir :\n- " + missing.join("\n- "));

  const btn = $("btn-generate-main");
  const resetBtn = () => { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-print mr-2"></i> Sauvegarder & Imprimer le PDF'; };
  btn.disabled = true; btn.innerHTML = SPINNER + "Préparation PDF...";

  const fmt = (s) => { const d = parseLocal(s); return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${String(d.getFullYear()).slice(-2)}`; };
  const reference = $("input_reference").value, dateTirage = $("input_date_tirage").value, heureTirage = $("input_heure_tirage").value;
  const travaux = $("input_travaux").value;

  $("p_fisav").innerText = fisavRaw; $("p_bottom_fisav").innerText = fisavRaw; $("p_ref").innerText = reference;
  $("p_date").innerText = fmt(dateRaw);
  $("p_date_tirage").innerText = dateTirage ? fmt(dateTirage) : ""; $("p_heure_tirage").innerText = heureTirage;
  $("p_client").innerText = clientRaw; $("p_machine").innerText = machineRaw; $("p_ref_machine").innerText = machineRaw;
  $("p_travaux_content").innerHTML = esc(travaux).replace(/\n/g, "<br>");

  const refForfait = $("input_forfait_ref").value, nomForfait = $("input_forfait_nom").value, diagForfait = $("input_forfait_diag").value;
  let rows = `<tr><td>FHSAV-${esc(refForfait)}</td><td>Forfait Horaire ${esc(nomForfait)}<br><br><span style="padding-left:15px;">${esc(diagForfait)}</span></td><td></td><td style="text-align:right;">0,00</td><td style="text-align:right;">0,00</td></tr>`;
  const techNames = [], detailTechniciens = []; let totalQty = 0, currentUnit = "";
  document.querySelectorAll(".tech-row").forEach((row) => {
    const name = row.querySelector(".tech-name").value.trim().toUpperCase();
    const qty = parseFloat(row.querySelector(".tech-qty-val").value) || 0;
    const unit = row.querySelector(".tech-qty-unit").value;
    if (!name) return;
    techNames.push(name); detailTechniciens.push({ nom: name, quantite: qty, unite: unit }); totalQty += qty; currentUnit = unit;
    rows += `<tr><td style="padding-top:10px;">FHTEC-EM2</td><td style="padding-top:10px;">Heure Technicien ${esc(name)}</td><td style="padding-top:10px;text-align:center;">${qty} ${unit === "Heure(s)" ? "H" : "J"}</td><td style="padding-top:10px;text-align:right;">0,00</td><td style="padding-top:10px;text-align:right;">0,00</td></tr>`;
  });
  const nbDepl = parseInt($("input_deplacements").value, 10) || 0;
  if (nbDepl > 0) rows += `<tr><td style="padding-top:10px;"></td><td style="padding-top:10px;">Nombre de déplacements</td><td style="padding-top:10px;text-align:center;">${nbDepl}</td><td></td><td></td></tr>`;
  rows += '<tr><td style="height:30px;"></td><td></td><td></td><td></td><td></td></tr>';
  $("p_lignes_prestations").innerHTML = rows;
  const allTechs = techNames.join(", ");
  $("p_nom_tech").innerText = allTechs; $("p_realise_par").innerText = allTechs;
  const total = totalQty > 0 ? `${totalQty}${currentUnit === "Heure(s)" ? " H" : " J"}` : "0,00";
  $("p_somme_reporter").innerText = total;

  const payload = {
    numero_fisav: fisavRaw, reference_intervention: reference, client: clientRaw, machine: machineRaw,
    date_intervention: dateRaw, date_tirage: `${dateTirage} ${heureTirage}`,
    forfait_ref: refForfait, forfait_nom: nomForfait, forfait_diag: diagForfait, diagnostic: diagForfait,
    travaux_realises: travaux, techniciens_intervenants: detailTechniciens, total_temps: total, nb_deplacements: nbDepl
  };
  try {
    if (currentFicheId) {
      // Fiche déjà enregistrée : on la met à jour et on garde l'ancienne version dans "revisions"
      const prev = historiqueDB.find((h) => h.id === currentFicheId);
      const upd = { ...payload, modifie_le: serverTimestamp(), modifie_par: currentUser.email };
      if (prev) {
        upd.revisions = arrayUnion({
          date: new Date().toISOString(), par: currentUser.email,
          avant: { numero_fisav: prev.numero_fisav ?? null, travaux_realises: prev.travaux_realises ?? null, techniciens_intervenants: prev.techniciens_intervenants ?? [], total_temps: prev.total_temps ?? null }
        });
      }
      await withTimeout(updateDoc(doc(db, "historique_interventions", currentFicheId), upd));
    } else {
      // Nouvelle fiche : ID créé côté appareil (l'impression n'est pas bloquée hors-ligne)
      const newRef = doc(collection(db, "historique_interventions"));
      await withTimeout(setDoc(newRef, { ...payload, interventions_ids: [...(window.__pendingArchive || [])], uid: currentUser.uid, email: currentUser.email, timestamp_creation: serverTimestamp() }));
      setEditMode(newRef.id);
    }
  } catch (err) {
    console.error("Erreur historique :", err);
    if (!confirm("L'historique n'a pas pu être enregistré (" + (err.code || err.message) + ").\nImprimer quand même ?")) { resetBtn(); return; }
  }

  const originalTitle = document.title;
  document.title = `Fiche_${fisavRaw.replace(/[^a-zA-Z0-9]/g, "_")}_${clientRaw.replace(/[^a-zA-Z0-9]/g, "_")}`;
  window.addEventListener("afterprint", async () => {
    document.title = originalTitle; resetBtn();
    await archivePending();
  }, { once: true });
  setTimeout(() => window.print(), 300);
  setTimeout(resetBtn, 20000);
};

// ---------------------------------------------------------------------
// HISTORIQUE DES FICHES (consultation, correction, réimpression)
// ---------------------------------------------------------------------
onSnapshot(query(collection(db, "historique_interventions"), orderBy("timestamp_creation", "desc"), limit(300)), (snapshot) => {
  historiqueDB = [];
  snapshot.forEach((d) => historiqueDB.push({ ...d.data(), id: d.id }));
  renderHistorique();
}, onListenError("historique"));

function renderHistorique() {
  const c = $("historique-container"); if (!c) return;
  const q = historiqueFilter.trim().toLowerCase();
  const list = historiqueDB.filter((h) => !q || [h.numero_fisav, h.client, h.machine, h.reference_intervention].some((v) => String(v ?? "").toLowerCase().includes(q)));
  if ($("historique-count")) $("historique-count").textContent = `${list.length} fiche(s)`;
  if (list.length === 0) { c.innerHTML = '<p class="text-slate-400 text-sm italic py-4 text-center">Aucune fiche trouvée.</p>'; return; }
  c.innerHTML = list.map((h) => {
    const date = h.date_intervention ? parseLocal(h.date_intervention).toLocaleDateString("fr-FR") : "";
    const techs = (h.techniciens_intervenants || []).map((t) => t.nom).join(", ");
    const canEdit = isAdmin || h.uid === currentUser.uid;
    const badge = h.modifie_par ? '<span class="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-800 uppercase">Modifiée</span>' : "";
    const btn = canEdit ? `<button data-act="open-fiche" data-id="${esc(h.id)}" class="shrink-0 px-3 py-2 bg-brand-500 hover:bg-brand-600 text-white text-xs font-bold rounded-lg"><i class="fa-solid fa-pen-to-square mr-1"></i> Modifier</button>` : "";
    return `<div class="bg-white rounded-xl shadow-sm border border-slate-100 p-4 flex items-center justify-between gap-3"><div class="min-w-0"><div class="flex items-center gap-2 mb-1 flex-wrap"><span class="font-bold text-slate-800">${esc(h.numero_fisav)}</span>${badge}</div><p class="text-sm font-semibold text-brand-900 uppercase truncate">${esc(h.client)}</p><p class="text-xs text-slate-500 truncate"><i class="fa-solid fa-microchip mr-1"></i>${esc(h.machine)}</p><p class="text-xs text-slate-500 mt-1"><i class="fa-solid fa-calendar-day mr-1"></i>${esc(date)} &nbsp;|&nbsp; <i class="fa-solid fa-user-gear mr-1"></i>${esc(techs)} &nbsp;|&nbsp; ${esc(h.total_temps || "")}</p></div>${btn}</div>`;
  }).join("");
}

function setEditMode(id) {
  currentFicheId = id;
  const banner = $("ficheEditBanner"); if (!banner) return;
  if (id) {
    const h = historiqueDB.find((x) => x.id === id);
    $("ficheEditBannerText").textContent = (h ? `Fiche ${h.numero_fisav} enregistrée. ` : "Fiche enregistrée. ") + "Toute nouvelle impression remplace cette fiche (l'ancienne version reste conservée). Pour une autre fiche, cliquez sur « Nouvelle fiche ».";
    banner.classList.remove("hidden");
  } else { banner.classList.add("hidden"); }
}

function openFiche(id) {
  const h = historiqueDB.find((x) => x.id === id); if (!h) return;
  const diag = h.forfait_diag || h.diagnostic || "";
  const preventif = /pr[ée]ventive/i.test(diag);
  const [dT, hT] = String(h.date_tirage || "").split(" ");
  $("input_fisav").value = h.numero_fisav || ""; $("input_reference").value = h.reference_intervention || "";
  $("input_client").value = h.client || ""; $("input_machine").value = h.machine || "";
  $("input_date").value = h.date_intervention || localDateStr();
  $("input_date_tirage").value = dT || localDateStr(); $("input_heure_tirage").value = hT || "";
  $("input_forfait_ref").value = h.forfait_ref || (preventif ? "PREV" : "DEPAN");
  $("input_forfait_nom").value = h.forfait_nom || (preventif ? "SAV-Préventif" : "SAV-Depannage");
  $("input_forfait_diag").value = diag;
  $("input_travaux").value = h.travaux_realises || "";
  $("input_deplacements").value = h.nb_deplacements || "";
  $("fiche-tech-list").innerHTML = (h.techniciens_intervenants || []).map((t) => techRowHTML(t.nom, t.quantite, t.unite)).join("");
  window.__pendingArchive = [];
  setEditMode(id);
  showView("fiches");
}

function newFiche() {
  if (!confirm("Vider le formulaire et commencer une nouvelle fiche ?")) return;
  setEditMode(null); window.__pendingArchive = [];
  ["input_fisav", "input_reference", "input_client", "input_machine", "input_travaux", "input_forfait_diag", "input_deplacements"].forEach((id) => { $(id).value = ""; });
  $("input_forfait_ref").value = "DEPAN"; $("input_forfait_nom").value = "SAV-Depannage";
  $("input_date").value = localDateStr(); $("fiche-tech-list").innerHTML = "";
}

if ($("historiqueSearch")) $("historiqueSearch").addEventListener("input", (e) => { historiqueFilter = e.target.value; renderHistorique(); });

// ---------------------------------------------------------------------
// DOSSIER CURATIF MULTI-JOURS (journal de passages -> une seule fiche)
// Un passage = une ligne (date + technicien) : heures et travaux de ce technicien ce jour-là.
// Nombre de déplacements = nombre de jours distincts avec au moins un passage (modifiable sur la fiche).
// ---------------------------------------------------------------------
// <PURE>
const fmtDate = (s) => { const d = parseLocal(s); return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`; };

function dossierStats(passages) {
  const dates = [...new Set(passages.map((p) => p.date))].sort();
  const totals = {};
  passages.forEach((p) => {
    const k = `${p.tech}||${p.unite || "Heure(s)"}`;
    totals[k] = (totals[k] || 0) + (Number(p.qte) || 0);
  });
  return { dates, deplacements: dates.length, totals };
}

function buildDossierTravaux(intv, passages, mode) {
  const st = dossierStats(passages);
  let t = mode === "final" ? "" : "[FICHE D'ÉTAPE : intervention en cours]\n";
  t += "Intervention curative réalisée sur plusieurs jours.\n";
  if (intv.panne) t += `Motif : ${intv.panne}\n`;
  t += `Machine : ${intv.machine}\n\n📌 JOURNAL DES TRAVAUX :\n`;
  st.dates.forEach((date) => {
    const byText = new Map();
    passages.filter((p) => p.date === date).forEach((p) => {
      const k = String(p.travaux || "").trim();
      if (!byText.has(k)) byText.set(k, []);
      byText.get(k).push(p.tech);
    });
    byText.forEach((techs, text) => { t += `\n• ${fmtDate(date)} (${techs.join(", ")}) :\n${text}\n`; });
  });
  t += `\nNombre de déplacements : ${st.deplacements}`;
  return t;
}
// </PURE>

let dossierUnsub = null;
let dossierData = { id: null, passages: [] };

function closeDossier() {
  if (dossierUnsub) { dossierUnsub(); dossierUnsub = null; }
  dossierData = { id: null, passages: [] };
  ["passageForm", "dossierModal"].forEach((id) => { const el = $(id); if (el) el.remove(); });
}

function openDossier(id) {
  const intv = allInterventions.find((i) => i.id === id); if (!intv) return;
  closeDossier();
  dossierData = { id, passages: [] };
  const ov = document.createElement("div");
  ov.id = "dossierModal";
  ov.className = "fixed inset-0 bg-slate-900 bg-opacity-60 flex items-center justify-center z-[75] px-3 backdrop-blur-sm";
  ov.innerHTML = `<div class="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh]">
    <div class="px-5 py-4 border-b flex justify-between items-start bg-slate-50 rounded-t-2xl"><div class="min-w-0"><h3 class="text-lg font-bold text-slate-800"><i class="fa-solid fa-folder-open text-orange-500 mr-2"></i>Dossier multi-jours</h3><p class="text-sm text-brand-600 font-medium truncate">${esc(intv.client)} | ${esc(intv.machine)}</p>${intv.panne ? `<p class="text-xs text-slate-500 mt-1">${esc(intv.panne)}</p>` : ""}</div><button data-act="dossier-close" class="text-slate-400 hover:bg-slate-200 w-8 h-8 rounded-full shrink-0"><i class="fa-solid fa-xmark text-lg"></i></button></div>
    <div id="dossierBody" class="p-4 overflow-y-auto custom-scroll flex-1"></div>
    <div class="p-4 border-t bg-slate-50 rounded-b-2xl space-y-2">
      <button data-act="passage-add" data-id="${esc(id)}" class="w-full py-3 bg-brand-500 hover:bg-brand-600 text-white font-bold rounded-xl"><i class="fa-solid fa-plus mr-2"></i> Ajouter un passage</button>
      <div class="grid grid-cols-2 gap-2">
        <button data-act="dossier-fiche" data-id="${esc(id)}" data-mode="etape" class="py-2.5 bg-white border border-slate-300 text-slate-700 font-bold rounded-xl text-sm">Fiche d'étape</button>
        <button data-act="dossier-fiche" data-id="${esc(id)}" data-mode="final" class="py-2.5 bg-green-500 hover:bg-green-600 text-white font-bold rounded-xl text-sm">Clôturer + fiche finale</button>
      </div>
      <p class="text-[11px] text-slate-500">Fiche d'étape : le dossier reste ouvert. Fiche finale : le dossier est archivé après l'impression.</p>
      ${isAdmin ? `<button data-act="dossier-delete" data-id="${esc(id)}" class="w-full text-xs text-red-500 hover:text-red-700 font-medium">Supprimer ce dossier</button>` : ""}
    </div></div>`;
  document.body.appendChild(ov);
  dossierUnsub = onSnapshot(query(collection(db, "interventions", id, "passages"), orderBy("date", "asc")), (snap) => {
    dossierData = { id, passages: snap.docs.map((d) => ({ ...d.data(), id: d.id })) };
    renderDossierBody();
  }, onListenError("passages"));
}

function renderDossierBody() {
  const body = $("dossierBody"); if (!body) return;
  const ps = dossierData.passages, st = dossierStats(ps);
  const totals = Object.entries(st.totals).map(([k, v]) => { const [tech, unite] = k.split("||"); return `<span class="inline-block bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-slate-700">${esc(tech)} : ${esc(v)} ${unite === "Jour(s)" ? "j" : "h"}</span>`; }).join(" ");
  let html = `<div class="bg-brand-50 border border-brand-100 rounded-xl p-4 mb-4"><div class="flex flex-wrap gap-4 text-sm font-bold text-brand-900 mb-2"><span><i class="fa-solid fa-route mr-1"></i>${st.deplacements} déplacement(s)</span><span><i class="fa-solid fa-list-check mr-1"></i>${ps.length} entrée(s)</span></div><div class="flex flex-wrap gap-2">${totals || '<span class="text-xs text-slate-400 italic">Aucune heure saisie.</span>'}</div></div>`;
  if (ps.length === 0) html += '<p class="text-slate-400 text-sm italic text-center py-6">Aucun passage pour l\'instant. Cliquez sur « Ajouter un passage ».</p>';
  html += st.dates.map((date) => {
    const rows = ps.filter((p) => p.date === date).map((p) => {
      const mine = isAdmin || p.uid === currentUser.uid;
      const edit = `<button data-act="passage-edit" data-did="${esc(dossierData.id)}" data-id="${esc(p.id)}" class="text-slate-400 hover:text-brand-500 px-1"><i class="fa-solid fa-pen"></i></button>`;
      const del = mine ? `<button data-act="passage-del" data-did="${esc(dossierData.id)}" data-id="${esc(p.id)}" class="text-slate-400 hover:text-red-500 px-1"><i class="fa-solid fa-trash-can"></i></button>` : "";
      return `<div class="px-3 py-2 border-t border-slate-100 flex justify-between gap-2"><div class="min-w-0"><p class="text-sm font-bold text-slate-800">${esc(p.tech)} <span class="font-normal text-slate-500">· ${esc(p.qte)} ${p.unite === "Jour(s)" ? "j" : "h"}</span></p><p class="text-sm text-slate-600 whitespace-pre-line break-words">${esc(p.travaux)}</p></div><div class="shrink-0 flex gap-1">${edit}${del}</div></div>`;
    }).join("");
    return `<div class="border border-slate-100 rounded-xl mb-3 overflow-hidden"><div class="bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700"><i class="fa-solid fa-calendar-day mr-1 text-slate-400"></i>${fmtDate(date)}</div>${rows}</div>`;
  }).join("");
  body.innerHTML = html;
}

function openPassageForm(dossierId, passageId) {
  const editing = passageId ? dossierData.passages.find((p) => p.id === passageId) : null;
  const names = Array.from(document.querySelectorAll('input[name="tech"]')).map((cb) => cb.value);
  const field = "w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white";
  const techBlock = editing
    ? `<p class="text-sm font-bold text-slate-800">${esc(editing.tech)}</p>`
    : `<div class="grid grid-cols-2 gap-2 text-sm bg-slate-50 p-3 rounded-xl border border-slate-200">${names.map((n) => `<label class="flex items-center gap-2"><input type="checkbox" name="ptech" value="${esc(n)}" class="w-4 h-4 rounded border-slate-300"><span>${esc(n)}</span></label>`).join("")}</div>`;
  const ov = document.createElement("div");
  ov.id = "passageForm";
  ov.className = "fixed inset-0 bg-slate-900 bg-opacity-60 flex items-center justify-center z-[85] px-3";
  ov.innerHTML = `<form class="bg-white rounded-2xl shadow-2xl max-w-md w-full p-5 space-y-3 max-h-[92vh] overflow-y-auto"><h3 class="text-lg font-bold text-slate-800">${editing ? "Modifier le passage" : "Ajouter un passage"}</h3>
    <div><label class="block text-xs font-bold text-slate-600 mb-1">Date</label><input type="date" name="date" required value="${esc(editing ? editing.date : localDateStr())}" ${editing ? "readonly" : ""} class="${field}"></div>
    <div><label class="block text-xs font-bold text-slate-600 mb-1">${editing ? "Technicien" : "Technicien(s) présent(s) ce jour-là"}</label>${techBlock}</div>
    <div class="flex gap-2"><div class="w-1/2"><label class="block text-xs font-bold text-slate-600 mb-1">Temps passé (par technicien)</label><input type="number" name="qte" required min="0.5" step="0.5" value="${esc(editing ? editing.qte : 8)}" class="${field}"></div><div class="w-1/2"><label class="block text-xs font-bold text-slate-600 mb-1">Unité</label><select name="unite" class="${field}"><option value="Heure(s)"${editing && editing.unite === "Jour(s)" ? "" : " selected"}>Heure(s)</option><option value="Jour(s)"${editing && editing.unite === "Jour(s)" ? " selected" : ""}>Jour(s)</option></select></div></div>
    <div><label class="block text-xs font-bold text-slate-600 mb-1">Travaux réalisés ce jour-là</label><textarea name="travaux" required rows="5" class="${field}" placeholder="Ex : diagnostic du variateur, remplacement du câble…">${esc(editing ? editing.travaux : "")}</textarea></div>
    <div class="flex gap-2 pt-1"><button type="button" data-cancel class="flex-1 py-2.5 bg-slate-100 rounded-xl text-sm font-bold">Annuler</button><button type="submit" class="flex-1 py-2.5 bg-brand-500 text-white rounded-xl text-sm font-bold">Enregistrer</button></div></form>`;
  document.body.appendChild(ov);
  ov.querySelector("[data-cancel]").addEventListener("click", () => ov.remove());
  ov.querySelector("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const btn = e.target.querySelector('button[type="submit"]'); btn.disabled = true;
    const ok = await savePassage(dossierId, {
      date: fd.get("date"), techs: editing ? [editing.tech] : fd.getAll("ptech"),
      qte: parseFloat(fd.get("qte")), unite: fd.get("unite"), travaux: String(fd.get("travaux") || "").trim()
    });
    if (ok) ov.remove(); else btn.disabled = false;
  });
}

async function savePassage(dossierId, p) {
  if (!p.date) { toast("La date est obligatoire.", "error"); return false; }
  if (p.techs.length === 0) { toast("Cochez au moins un technicien.", "error"); return false; }
  if (!(p.qte > 0)) { toast("Indiquez un temps passé valide.", "error"); return false; }
  if (!p.travaux) { toast("Décrivez les travaux réalisés.", "error"); return false; }
  const existing = p.techs.filter((t) => dossierData.passages.some((x) => x.id === recurrenceId(p.date, t)));
  if (existing.length > 0 && !confirm(`Une saisie existe déjà ce jour-là pour : ${existing.join(", ")}.\nLa remplacer ?`)) return false;
  try {
    const batch = writeBatch(db);
    p.techs.forEach((t) => {
      batch.set(doc(db, "interventions", dossierId, "passages", recurrenceId(p.date, t)), {
        date: p.date, tech: t, qte: p.qte, unite: p.unite === "Jour(s)" ? "Jour(s)" : "Heure(s)", travaux: p.travaux,
        uid: currentUser.uid, email: currentUser.email, maj: serverTimestamp()
      });
    });
    await withTimeout(batch.commit());
    toast("Passage enregistré.", "success");
    return true;
  } catch (err) { console.error(err); toast("Enregistrement refusé : " + (err.code || err.message), "error"); return false; }
}

function supprimerPassage(dossierId, passageId) {
  if (!confirm("Supprimer cette saisie ?")) return;
  return safe(() => deleteDoc(doc(db, "interventions", dossierId, "passages", passageId)));
}

async function supprimerDossier(id) {
  if (!confirm("Supprimer définitivement ce dossier et tous ses passages ?")) return;
  try {
    const batch = writeBatch(db);
    dossierData.passages.forEach((p) => batch.delete(doc(db, "interventions", id, "passages", p.id)));
    batch.delete(doc(db, "interventions", id));
    await batch.commit();
    closeDossier();
    toast("Dossier supprimé.", "success");
  } catch (err) { console.error(err); toast("Suppression refusée : " + (err.code || err.message), "error"); }
}

// Remplit l'éditeur de fiche avec le journal : une seule fiche, toute l'équipe, heures cumulées, nb de déplacements.
function genererFicheDossier(id, mode) {
  const intv = allInterventions.find((i) => i.id === id); if (!intv) return;
  const ps = dossierData.id === id ? dossierData.passages : [];
  if (ps.length === 0) return toast("Ajoutez au moins un passage avant de générer la fiche.", "error");
  const st = dossierStats(ps);
  $("input_fisav").value = ""; $("input_reference").value = "";
  $("input_client").value = intv.client; $("input_machine").value = intv.machine;
  $("input_date").value = st.dates[st.dates.length - 1];
  $("input_forfait_ref").value = "DEPAN"; $("input_forfait_nom").value = "SAV-Depannage";
  $("input_forfait_diag").value = intv.panne || "Intervention curative sur plusieurs jours";
  $("input_travaux").value = buildDossierTravaux(intv, ps, mode);
  $("input_deplacements").value = st.deplacements;
  $("fiche-tech-list").innerHTML = Object.entries(st.totals).map(([k, v]) => { const [tech, unite] = k.split("||"); return techRowHTML(tech, v, unite); }).join("");
  window.__pendingArchive = mode === "final" ? [id] : [];
  setEditMode(null);
  closeDossier();
  showView("fiches");
  toast(mode === "final" ? "Fiche finale prête : renseignez le N° FISAV puis imprimez (le dossier sera archivé ensuite)." : "Fiche d'étape prête : renseignez le N° FISAV puis imprimez.", "success");
}

// ---------------------------------------------------------------------
// ÉCOUTEURS DÉLÉGUÉS (remplacent tous les onclick/onsubmit inline dynamiques)
// ---------------------------------------------------------------------
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (!el) return;
  const { act, client, machine, id, key, ref, nom } = el.dataset;
  switch (act) {
    case "kit": return window.ouvrirModalKit(client, machine);
    case "del-machine": return supprimerMachineParc(id, machine);
    case "del-client": return supprimerClientParc(id);
    case "del-ht": return supprimerHypertherm(id);
    case "group": return ouvrirModalGroupe(key);
    case "open-intv": window.fermerModalGroupe(); return ouvrirActionModal(id);
    case "fiche-globale": return redigerFicheGlobaleTerminee(key);
    case "rm-tech": return el.closest(".tech-row").remove();
    case "logout": return logout();
    case "open-fiche": return openFiche(id);
    case "new-fiche": return newFiche();
    case "edit-machine": return openMachineEditor(id, machine);
    case "dossier": return openDossier(id);
    case "dossier-close": return closeDossier();
    case "passage-add": return openPassageForm(id, null);
    case "passage-edit": return openPassageForm(el.dataset.did, id);
    case "passage-del": return supprimerPassage(el.dataset.did, id);
    case "dossier-fiche": return genererFicheDossier(id, el.dataset.mode);
    case "dossier-delete": return supprimerDossier(id);
    case "del-piece":
      tempKitPieces = tempKitPieces.filter((p) => !(p.ref === ref && p.nom === nom));
      return afficherPiecesKitTemp();
    case "copy-ht": {
      const ht = hyperthermDB.find((h) => h.id === id); if (!ht) return;
      const text = purchaseText(ht, getNextHyperthermCycle(ht.dateInstallation, ht.shifts || 1, ht.modele));
      return navigator.clipboard.writeText(text).then(() => toast("Liste copiée !", "success")).catch(() => toast("Copie impossible.", "error"));
    }
  }
});

document.addEventListener("submit", async (e) => {
  const form = e.target.closest("[data-machine-form]");
  if (!form) return;
  e.preventDefault();
  const v = (n) => form.querySelector(`[name="${n}"]`).value;
  const ok = await ajouterMachineParc(form.dataset.machineForm, { type: v("type"), repere: v("repere"), serie: v("serie") });
  if (ok) form.reset();
});

// ---------------------------------------------------------------------
// SERVICE WORKER
// ---------------------------------------------------------------------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch((err) => console.error("Erreur SW", err)));
}
