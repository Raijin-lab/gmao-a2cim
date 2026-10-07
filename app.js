import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, collection, addDoc, deleteDoc, updateDoc, doc, onSnapshot, query, orderBy, serverTimestamp, arrayUnion, arrayRemove, increment } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyAvKqfjnjJ4a64QpK2Idt2ms32E0zALFJ4",
    authDomain: "gmao-a2cim.firebaseapp.com",
    projectId: "gmao-a2cim",
    storageBucket: "gmao-a2cim.firebasestorage.app",
    messagingSenderId: "687654110395",
    appId: "1:687654110395:web:5ce86666b10c3ad028d59e"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

let allInterventions = []; let parcClientsDB = {}; let fullCalendarInstance = null; let currentClientFilter = "ALL"; let currentTypeFilter = "ALL"; let stockDB = []; let kitsDB = {}; let tempKitPieces = []; let groupedInterventionsGlobal = {}; let hyperthermDB = [];

// ==========================================
// MOTEUR DU STOCK CENTRAL (PDR)
// ==========================================
const qStock = query(collection(db, "stock"), orderBy("nom", "asc"));
onSnapshot(qStock, (snapshot) => {
    stockDB = []; const stockContainer = document.getElementById('stock-container'); const selectPieceKit = document.getElementById('selectPieceKit');
    if(stockContainer) stockContainer.innerHTML = ''; if(selectPieceKit) selectPieceKit.innerHTML = '<option value="" disabled selected>Choisir une pièce...</option>';
    if (snapshot.empty && stockContainer) { stockContainer.innerHTML = '<p class="text-slate-500 col-span-full">Aucune pièce en stock.</p>'; }
    snapshot.forEach(docSnap => {
        const data = docSnap.data(); data.id = docSnap.id; stockDB.push(data);
        if (selectPieceKit) selectPieceKit.innerHTML += `<option value="${data.id}">${data.ref} - ${data.nom} (Stock: ${data.qte})</option>`; 
        if (stockContainer) {
            const isAlert = data.qte <= data.alerte; const colorClass = isAlert ? 'text-red-600 bg-red-50 border-red-200' : 'text-slate-700 bg-white border-slate-100'; const iconAlert = isAlert ? '<i class="fa-solid fa-triangle-exclamation text-red-500 absolute top-4 right-4"></i>' : '';
            stockContainer.innerHTML += `<div class="p-5 rounded-2xl shadow-sm border ${colorClass} flex flex-col relative transition-all">${iconAlert}<div class="text-xs font-bold text-slate-400 mb-1 uppercase tracking-wider">${data.ref}</div><h3 class="font-bold text-base mb-4 pr-6 leading-tight">${data.nom}</h3><div class="mt-auto"><div class="flex justify-between items-end mb-2"><span class="text-3xl font-black ${isAlert ? 'text-red-600' : 'text-brand-600'}">${data.qte}</span><span class="text-[10px] text-slate-400 uppercase font-bold">Seuil: ${data.alerte}</span></div><div class="w-full bg-slate-100 rounded-full h-1.5 mb-4 overflow-hidden"><div class="h-1.5 rounded-full ${isAlert ? 'bg-red-500' : 'bg-brand-500'}" style="width: ${Math.min((data.qte / (data.alerte * 3)) * 100, 100)}%"></div></div><div class="flex space-x-2"><button onclick="ajusterStock('${data.id}', 1)" class="flex-1 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-sm font-bold"><i class="fa-solid fa-plus"></i></button><button onclick="ajusterStock('${data.id}', -1)" class="flex-1 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-sm font-bold"><i class="fa-solid fa-minus"></i></button><button onclick="supprimerStock('${data.id}')" class="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-500 rounded-lg"><i class="fa-solid fa-trash-can"></i></button></div></div></div>`;
        }
    });
});

if (document.getElementById('formAddStock')) { document.getElementById('formAddStock').addEventListener('submit', async (e) => { e.preventDefault(); await addDoc(collection(db, "stock"), { ref: document.getElementById('newStockRef').value.trim(), nom: document.getElementById('newStockNom').value.trim(), qte: parseInt(document.getElementById('newStockQte').value), alerte: parseInt(document.getElementById('newStockAlerte').value) }); e.target.reset(); }); }
window.ajusterStock = async function(id, val) { await updateDoc(doc(db, "stock", id), { qte: increment(val) }); };
window.supprimerStock = async function(id) { if(confirm("Supprimer cette pièce du stock ?")) await deleteDoc(doc(db, "stock", id)); };

// ==========================================
// MOTEUR DES KITS PDR
// ==========================================
const qKits = query(collection(db, "kits"));
onSnapshot(qKits, (snapshot) => { kitsDB = {}; snapshot.forEach(docSnap => { const data = docSnap.data(); kitsDB[data.client + "_" + data.machine] = { id: docSnap.id, pieces: data.pieces }; }); });

window.ouvrirModalKit = function(client, machine) {
    document.getElementById('kitModalMachineName').textContent = `${client} | ${machine}`; document.getElementById('currentKitClient').value = client; document.getElementById('currentKitMachine').value = machine;
    const kitExistant = kitsDB[client + "_" + machine]; tempKitPieces = kitExistant ? [...kitExistant.pieces] : []; afficherPiecesKitTemp();
    document.getElementById('kitModal').classList.remove('hidden'); document.getElementById('kitModal').classList.add('flex');
}
window.fermerKitModal = function() { document.getElementById('kitModal').classList.add('hidden'); document.getElementById('kitModal').classList.remove('flex'); }
window.ajouterPieceAuKitTemp = function() {
    const idPiece = document.getElementById('selectPieceKit').value; const qte = parseInt(document.getElementById('qtePieceKit').value);
    if (!idPiece || qte < 1) return; const pieceDb = stockDB.find(p => p.id === idPiece); if (!pieceDb) return;
    const existingIndex = tempKitPieces.findIndex(p => p.idPiece === idPiece);
    if (existingIndex >= 0) { tempKitPieces[existingIndex].qte = qte; } else { tempKitPieces.push({ idPiece: idPiece, nom: pieceDb.nom, ref: pieceDb.ref, qte: qte }); }
    afficherPiecesKitTemp();
}
window.retirerPieceDuKitTemp = function(idPiece) { tempKitPieces = tempKitPieces.filter(p => p.idPiece !== idPiece); afficherPiecesKitTemp(); }
function afficherPiecesKitTemp() {
    const ul = document.getElementById('listePiecesKitTemp'); ul.innerHTML = '';
    if (tempKitPieces.length === 0) { ul.innerHTML = '<li class="text-sm text-slate-400 italic text-center py-2">Aucune pièce associée.</li>'; return; }
    tempKitPieces.forEach(p => { ul.innerHTML += `<li class="flex justify-between items-center bg-slate-50 border border-slate-100 p-2 rounded text-sm"><span><strong>${p.qte}x</strong> ${p.ref} - ${p.nom}</span><button onclick="retirerPieceDuKitTemp('${p.idPiece}')" class="text-red-500 hover:text-red-700"><i class="fa-solid fa-xmark"></i></button></li>`; });
}
window.sauvegarderKitFinal = async function() {
    const client = document.getElementById('currentKitClient').value; const machine = document.getElementById('currentKitMachine').value; const existingKit = kitsDB[client + "_" + machine];
    if (existingKit) { await updateDoc(doc(db, "kits", existingKit.id), { pieces: tempKitPieces }); } else { await addDoc(collection(db, "kits"), { client: client, machine: machine, pieces: tempKitPieces }); }
    alert("Le kit a été enregistré !"); fermerKitModal();
}

// ==========================================
// MOTEUR PARC CLIENTS
// ==========================================
const qClients = query(collection(db, "clients"), orderBy("nom", "asc"));
onSnapshot(qClients, (snapshot) => {
    const parcContainer = document.getElementById('parc-container'); const formClientSelect = document.getElementById('formClient'); const htClientSelect = document.getElementById('htClient'); const calendarFilter = document.getElementById('calendarClientFilter');
    if (parcContainer) parcContainer.innerHTML = ''; const currentClientSelection = formClientSelect ? formClientSelect.value : "";
    if (formClientSelect) formClientSelect.innerHTML = '<option value="" disabled selected>Sélectionner...</option>'; if (htClientSelect) htClientSelect.innerHTML = '<option value="" disabled selected>Client...</option>'; if (calendarFilter) calendarFilter.innerHTML = '<option value="ALL">Tous les clients</option>';
    parcClientsDB = {};

    snapshot.forEach(docSnap => {
        const data = docSnap.data(); const docId = docSnap.id; const machines = data.machines || [];
        parcClientsDB[data.nom] = { id: docId, machines: machines };
        if (formClientSelect) formClientSelect.innerHTML += `<option value="${data.nom}">${data.nom}</option>`; if (htClientSelect) htClientSelect.innerHTML += `<option value="${data.nom}">${data.nom}</option>`; if (calendarFilter) calendarFilter.innerHTML += `<option value="${data.nom}">${data.nom}</option>`;

        let machinesListHTML = '';
        if (machines.length === 0) { machinesListHTML = '<p class="text-xs text-slate-400 italic mb-2">Aucune machine.</p>'; } 
        else {
            machines.forEach(m => {
                const hasKit = kitsDB[data.nom + "_" + m] && kitsDB[data.nom + "_" + m].pieces.length > 0; const iconColor = hasKit ? "text-brand-500" : "text-slate-300";
                machinesListHTML += `<div class="flex items-center justify-between bg-slate-50 px-3 py-2 rounded-lg mb-2 border border-slate-100"><span class="text-sm text-slate-700 font-medium truncate flex-1"><i class="fa-solid fa-microchip text-slate-400 mr-2"></i>${m}</span><div class="flex items-center space-x-2 shrink-0"><button onclick="ouvrirModalKit('${data.nom}', '${m}')" class="px-2 py-1 bg-white border border-slate-200 rounded hover:bg-slate-100"><i class="fa-solid fa-boxes-stacked ${iconColor}"></i></button><button onclick="supprimerMachineParc('${docId}', '${m}')" class="text-slate-300 hover:text-red-500 px-1"><i class="fa-solid fa-xmark"></i></button></div></div>`;
            });
        }
        if (parcContainer) { parcContainer.innerHTML += `<div class="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden flex flex-col relative h-full"><button onclick="supprimerClientParc('${docId}')" class="absolute top-4 right-4 text-slate-300 hover:text-red-500"><i class="fa-solid fa-trash-can"></i></button><div class="p-5 border-b border-slate-100 bg-brand-50"><h3 class="text-lg font-bold text-brand-900"><i class="fa-solid fa-building mr-2 text-brand-500"></i>${data.nom}</h3></div><div class="p-5 flex-1 flex flex-col"><div class="mb-4 max-h-[200px] overflow-y-auto custom-scroll pr-2">${machinesListHTML}</div><form onsubmit="ajouterMachineParc(event, '${docId}')" class="flex gap-2 mt-auto"><input type="text" id="machineInput_${docId}" placeholder="Nom machine..." required class="flex-1 px-3 py-1.5 text-sm border rounded-lg focus:ring-2 focus:ring-brand-500"><button type="submit" class="bg-slate-800 text-white px-3 py-1.5 rounded-lg text-sm hover:bg-slate-700"><i class="fa-solid fa-plus"></i></button></form></div></div>`; }
    });
    if (formClientSelect && parcClientsDB[currentClientSelection]) formClientSelect.value = currentClientSelection;
});

function syncMachinesDropdown(clientSelectId, machineSelectId, allowAll = false) {
    const clientSelect = document.getElementById(clientSelectId); const machineSelect = document.getElementById(machineSelectId);
    if (clientSelect && machineSelect) {
        clientSelect.addEventListener('change', (e) => {
            const nomClient = e.target.value; machineSelect.innerHTML = '<option value="" disabled selected>Machine...</option>';
            if (parcClientsDB[nomClient]) {
                if (allowAll && parcClientsDB[nomClient].machines.length > 0) { machineSelect.innerHTML += `<option value="TOUTES_LES_MACHINES" class="font-bold text-brand-600">🌟 Toutes les machines (${parcClientsDB[nomClient].machines.length})</option>`; }
                parcClientsDB[nomClient].machines.forEach(m => { machineSelect.innerHTML += `<option value="${m}">${m}</option>`; });
            }
        });
    }
}
syncMachinesDropdown('formClient', 'formMachine', true); syncMachinesDropdown('htClient', 'htMachine', false);
window.ajouterMachineParc = async function(e, docId) { e.preventDefault(); const input = document.getElementById(`machineInput_${docId}`); if (!input.value.trim()) return; await updateDoc(doc(db, "clients", docId), { machines: arrayUnion(input.value.trim()) }); input.value = ''; };
window.supprimerMachineParc = async function(docId, nomMachine) { if (confirm(`Supprimer la machine "${nomMachine}" ?`)) await updateDoc(doc(db, "clients", docId), { machines: arrayRemove(nomMachine) }); };
window.supprimerClientParc = async function(docId) { if (confirm(`Attention : supprimer ce client ?`)) await deleteDoc(doc(db, "clients", docId)); };
if (document.getElementById('formAddClient')) { document.getElementById('formAddClient').addEventListener('submit', async (e) => { e.preventDefault(); const input = document.getElementById('newClientName'); if (!input.value.trim()) return; await addDoc(collection(db, "clients"), { nom: input.value.trim(), machines: [] }); input.value = ''; }); }


// ==========================================
// 3. LE CERVEAU TEMPOREL HYPERTHERM
// ==========================================
const HT_RULES = {
    "6M": { days: 182, parts: [{ ref: "027664", nom: "Filtre à air principal" }, { ref: "028872", nom: "Coolant 70/30 (Liquide refroidissement)" }, { ref: "027665", nom: "Filtre liquide de refroidissement" }, { ref: "428383", nom: "Kit d'entretien torche" }] },
    "12M": { days: 365, parts: [{ ref: "003149", nom: "Relais arc pilote" }, { ref: "003150", nom: "Contacteur principal" }, { ref: "428144", nom: "Corps de torche (Main body)" }] },
    "24M": { days: 730, parts: [{ ref: "428384", nom: "Kit pompe à eau (Coolant pump kit)" }, { ref: "428385", nom: "Faisceaux de torche (Torch leads)" }] },
    "36M": { days: 1095, parts: [{ ref: "027666", nom: "Ventilateurs de refroidissement" }, { ref: "027667", nom: "Moteur de pompe hydraulique" }] }
};

// Fonction mathématique pour calculer la PROCHAINE vraie date (ignorer le passé)
function getNextHyperthermCycle(instDateStr, shifts) {
    const today = new Date(); today.setHours(0,0,0,0);
    const instDate = new Date(instDateStr); instDate.setHours(0,0,0,0);
    
    // Si la machine est installée dans le futur, on prend 6 mois après son installation
    if (instDate > today) {
        let nextDateObj = new Date(instDate); nextDateObj.setDate(nextDateObj.getDate() + Math.round(182 / shifts));
        return { cycleType: "6M", dateObj: nextDateObj, parts: HT_RULES["6M"].parts };
    }

    let diffTime = today.getTime() - instDate.getTime();
    let diffDays = Math.ceil(diffTime / (1000 * 3600 * 24));
    let effectiveAgeDays = diffDays * shifts;
    
    // Trouver le prochain palier multiple de 182 jours
    let nextMilestone = Math.ceil(effectiveAgeDays / 182) * 182;
    if (nextMilestone === 0 || (nextMilestone/shifts) <= diffDays) { nextMilestone += 182; }

    let cycleType = "6M";
    if (nextMilestone % 1095 === 0) cycleType = "36M";
    else if (nextMilestone % 730 === 0) cycleType = "24M";
    else if (nextMilestone % 365 === 0) cycleType = "12M";

    const nextDateObj = new Date(instDate);
    nextDateObj.setDate(nextDateObj.getDate() + Math.round(nextMilestone / shifts));
    
    return { cycleType: cycleType, dateObj: nextDateObj, parts: HT_RULES[cycleType].parts };
}

const qHT = query(collection(db, "hypertherm"));
onSnapshot(qHT, (snapshot) => {
    hyperthermDB = []; const container = document.getElementById('hypertherm-container'); if(container) container.innerHTML = '';
    if (snapshot.empty && container) { container.innerHTML = '<p class="text-slate-500 italic">Aucun générateur Hypertherm enregistré.</p>'; return; }
    snapshot.forEach(docSnap => { const data = docSnap.data(); data.id = docSnap.id; hyperthermDB.push(data); });
    hyperthermDB.sort((a, b) => new Date(a.dateInstallation) - new Date(b.dateInstallation));

    hyperthermDB.forEach(data => {
        if (container) {
            const cycleInfo = getNextHyperthermCycle(data.dateInstallation, data.shifts || 1);
            const instDateStr = new Date(data.dateInstallation).toLocaleDateString('fr-FR');
            const nextDateStr = cycleInfo.dateObj.toLocaleDateString('fr-FR');
            
            let partsHTML = '<ul class="mt-3 space-y-2">'; let textToCopy = `Demande PDR - Préventif Hypertherm A2CIM\nClient: ${data.client}\nMachine: ${data.machine} (${data.modele})\nIntervention: ${cycleInfo.cycleType}\n\nPièces à commander :\n`;
            cycleInfo.parts.forEach(p => { partsHTML += `<li class="flex justify-between items-center text-xs border-b border-amber-200/50 pb-1.5"><span class="text-slate-700 font-medium">${p.nom}</span><span class="font-mono font-bold text-amber-700 bg-amber-100/50 px-2 py-0.5 rounded border border-amber-200">Réf: ${p.ref}</span></li>`; textToCopy += `- [Réf: ${p.ref}] ${p.nom}\n`; }); partsHTML += '</ul>';
            const safeText = encodeURIComponent(textToCopy);

            container.innerHTML += `<div class="bg-white rounded-2xl shadow-sm border border-slate-100 p-5 relative overflow-hidden"><button onclick="supprimerHypertherm('${data.id}')" class="absolute top-4 right-4 text-slate-300 hover:text-red-500"><i class="fa-solid fa-trash-can"></i></button><div class="flex items-center gap-3 mb-4"><div class="w-12 h-12 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-500 text-2xl shadow-inner"><i class="fa-solid fa-bolt"></i></div><div><h3 class="font-bold text-lg text-slate-800 uppercase">${data.client} <span class="text-slate-400 font-normal mx-1">|</span> ${data.machine}</h3><p class="text-sm text-slate-500 font-medium">${data.modele} &nbsp;&bull;&nbsp; <span class="text-slate-400">Installé le ${instDateStr} (${data.shifts} Poste${data.shifts>1?'s':''})</span></p></div></div><div class="bg-amber-50/50 border border-amber-100 rounded-xl p-4 mt-2"><div class="flex items-center justify-between mb-3"><span class="text-xs font-bold uppercase tracking-wider text-slate-500">Prochaine Échéance : ${cycleInfo.cycleType}</span><span class="text-[10px] font-bold px-2 py-1 rounded uppercase tracking-wider bg-amber-100 text-amber-800"><i class="fa-solid fa-calendar-day mr-1"></i> ${nextDateStr}</span></div><div class="flex justify-between items-center mb-1"><p class="text-amber-900 font-bold text-xs uppercase tracking-wider"><i class="fa-solid fa-boxes-stacked mr-1 text-amber-500"></i> Liste d'achat</p><button onclick="navigator.clipboard.writeText(decodeURIComponent('${safeText}')).then(()=>alert('✅ Liste copiée !'))" class="text-[10px] bg-amber-200 hover:bg-amber-300 text-amber-900 px-2 py-1.5 rounded-lg font-bold transition-colors shadow-sm"><i class="fa-solid fa-copy mr-1"></i> Copier</button></div>${partsHTML}</div></div>`;
        }
    });
});

if (document.getElementById('formAddHypertherm')) {
    document.getElementById('formAddHypertherm').addEventListener('submit', async (e) => {
        e.preventDefault(); const btnSubmit = e.target.querySelector('button[type="submit"]'); const origTxt = btnSubmit.innerHTML;
        btnSubmit.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>'; btnSubmit.disabled = true;
        try {
            const client = document.getElementById('htClient').value; const machine = document.getElementById('htMachine').value;
            const modele = document.getElementById('htModel').value; const dateInst = document.getElementById('htDateInst').value; const shifts = parseInt(document.getElementById('htShifts').value);
            if (!client || !machine) { alert("Sélectionnez un client et une machine."); return; }
            
            // 1. Sauvegarde l'entité
            await addDoc(collection(db, "hypertherm"), { client: client, machine: machine, modele: modele, dateInstallation: dateInst, shifts: shifts, timestamp: serverTimestamp() });
            
            // 2. Synchronisation Automatique du Calendrier (On calcule la PROCHAINE date)
            const cycleInfo = getNextHyperthermCycle(dateInst, shifts);
            
            // 3. Création automatique de l'intervention avec le tag "Hypertherm"
            await addDoc(collection(db, "interventions"), { client: client, machine: machine, date: cycleInfo.dateObj.toISOString().split('T')[0], type: "Préventif", technicien: "Équipe A2CIM", statut: "Planifié", frequence: "Hypertherm", timestamp: serverTimestamp() });
            
            // 4. Création automatique du Kit PDR
            let newKit = []; cycleInfo.parts.forEach(p => { const pStock = stockDB.find(s => s.ref === p.ref); if(pStock) newKit.push({ idPiece: pStock.id, nom: pStock.nom, ref: pStock.ref, qte: 1 }); });
            const existingKit = kitsDB[client + "_" + machine];
            if (existingKit) { await updateDoc(doc(db, "kits", existingKit.id), { pieces: newKit }); } else { await addDoc(collection(db, "kits"), { client: client, machine: machine, pieces: newKit }); }
            
            e.target.reset(); document.getElementById('htMachine').innerHTML = '<option value="" disabled selected>Machine...</option>';
            alert(`✅ ${modele} surveillé pour ${client}.\nL'intervention préventive ${cycleInfo.cycleType} a été ajoutée au calendrier pour le ${cycleInfo.dateObj.toLocaleDateString('fr-FR')} !`);
        } catch(error) { console.error(error); alert("Erreur : " + error.message); } finally { btnSubmit.innerHTML = origTxt; btnSubmit.disabled = false; }
    });
}
window.supprimerHypertherm = async function(id) { if (confirm("Arrêter la surveillance de ce générateur Hypertherm ?")) await deleteDoc(doc(db, "hypertherm", id)); };


// ==========================================
// CONFIG STATUTS & CALENDRIER INTELLIGENT
// ==========================================
const statusConfig = { "En retard": { bg: "#fef2f2", border: "#ef4444", text: "#b91c1c", color: "#ef4444" }, "En cours": { bg: "#fff7ed", border: "#f97316", text: "#c2410c", color: "#f97316" }, "Planifié": { bg: "#eff6ff", border: "#3b82f6", text: "#1d4ed8", color: "#3b82f6" }, "Terminé": { bg: "#f0fdf4", border: "#22c55e", text: "#15803d", color: "#22c55e" } };

function initCalendar() {
    const calendarEl = document.getElementById('calendar'); if (!calendarEl) return; if (fullCalendarInstance) fullCalendarInstance.destroy();
    fullCalendarInstance = new FullCalendar.Calendar(calendarEl, {
        initialView: window.innerWidth < 768 ? 'listMonth' : 'dayGridMonth', locale: 'fr', weekNumbers: true, weekText: 'S', dayMaxEvents: 2, moreLinkClick: 'listDay',    
        headerToolbar: { left: 'prev,next today', center: 'title', right: window.innerWidth < 768 ? '' : 'dayGridMonth,listDay' },
        buttonText: { today: "Aujourd'hui", month: 'Mois', list: 'Jour' }, height: '100%', events: [],
        eventClick: function(info) { ouvrirActionModal(info.event); }, dateClick: function(info) { fullCalendarInstance.changeView('listDay', info.dateStr); }
    });
    fullCalendarInstance.render();
}
function updateCalendarEvents() {
    if (!fullCalendarInstance) return; fullCalendarInstance.removeAllEvents();
    const todayStr = new Date().toISOString().split('T')[0]; const preventifDates = new Set();
    allInterventions.forEach(data => {
        if (currentClientFilter !== "ALL" && data.client !== currentClientFilter) return; if (currentTypeFilter !== "ALL" && data.type !== currentTypeFilter) return;
        let eventColor = statusConfig[data.statut]?.color || "#3b82f6";
        if (data.statut !== "Terminé" && data.date < todayStr) eventColor = "#ef4444"; else if (data.statut === "Planifié" && data.type === "Curatif") eventColor = "#ef4444"; 
        if (data.type === "Préventif") preventifDates.add(data.date);
        let eventTitle = data.type === "Curatif" ? `🚨 ${data.client} - ${data.machine}` : `🔧 ${data.client} - ${data.machine}`;
        fullCalendarInstance.addEvent({ id: data.id, title: eventTitle, start: data.date, backgroundColor: eventColor, borderColor: eventColor, extendedProps: { client: data.client, statut: data.statut, frequence: data.frequence || 'Ponctuel', type: data.type, machine: data.machine, technicien: data.technicien } });
    });
    preventifDates.forEach(dateStr => { fullCalendarInstance.addEvent({ start: dateStr, display: 'background', backgroundColor: '#f1f5f9' }); });
}
const clientFilterSelect = document.getElementById('calendarClientFilter'); if (clientFilterSelect) clientFilterSelect.addEventListener('change', (e) => { currentClientFilter = e.target.value; updateCalendarEvents(); });
const typeFilterSelect = document.getElementById('calendarTypeFilter'); if (typeFilterSelect) typeFilterSelect.addEventListener('change', (e) => { currentTypeFilter = e.target.value; updateCalendarEvents(); });
document.addEventListener('DOMContentLoaded', initCalendar);

// ==========================================
// MODAL D'ACTION (NOUVEAU BOUTON FICHE)
// ==========================================
const actionModal = document.getElementById('eventActionModal');

window.ouvrirActionModal = function(eventOrId) {
    let id, props, title, dateVal;
    if (typeof eventOrId === 'string') {
        const intData = allInterventions.find(i => i.id === eventOrId); if(!intData) return;
        id = intData.id; props = { client: intData.client, machine: intData.machine, statut: intData.statut, frequence: intData.frequence || 'Ponctuel', type: intData.type }; title = intData.machine;
    } else { if(eventOrId.display === 'background') return; id = eventOrId.id; props = eventOrId.extendedProps; title = props.machine; }

    const exactData = allInterventions.find(i => i.id === id); if(exactData) dateVal = exactData.date;
    document.getElementById('actionModalTitle').textContent = title; document.getElementById('actionModalSub').textContent = `${props.client} | ${props.frequence}`;
    document.getElementById('actionEventId').value = id; document.getElementById('actionEventDate').value = dateVal || ""; document.getElementById('actionEventClient').value = props.client; document.getElementById('actionEventType').value = props.type;
    
    // GESTION DES BOUTONS SELON STATUT
    document.getElementById('btnSetEnCours').style.display = (props.statut === "Planifié") ? "block" : "none"; 
    document.getElementById('btnSetTermine').style.display = (props.statut !== "Terminé") ? "block" : "none";
    document.getElementById('deleteOptionsDiv').style.display = (props.statut !== "Terminé") ? "block" : "none";
    
    // NOUVEAU BOUTON : Si Terminé, on montre "Voir Fiche" et on cache le reste
    const btnVoirFiche = document.getElementById('btnVoirFiche');
    if (props.statut === "Terminé") { btnVoirFiche.style.display = "block"; } else { btnVoirFiche.style.display = "none"; }
    
    const encartPDR = document.getElementById('actionModalPDR'); const ulPDR = document.getElementById('actionModalPDRList'); ulPDR.innerHTML = '';
    const theKit = kitsDB[props.client + "_" + props.machine];
    if (props.type === "Préventif" && theKit && theKit.pieces.length > 0) {
        theKit.pieces.forEach(p => { ulPDR.innerHTML += `<li><span class="font-black bg-white text-brand-700 px-2 py-0.5 rounded mr-2 border border-brand-100">${p.qte}x</span> ${p.ref} - ${p.nom}</li>`; });
        encartPDR.classList.remove('hidden');
    } else { encartPDR.classList.add('hidden'); }
    actionModal.classList.remove('hidden'); actionModal.classList.add('flex');
}
function fermerActionModal() { actionModal.classList.add('hidden'); actionModal.classList.remove('flex'); }
document.getElementById('btnCloseActionModal').addEventListener('click', fermerActionModal);
document.getElementById('btnDeleteEvent').addEventListener('click', async () => { if (confirm("Supprimer l'intervention pour cette machine uniquement ?")) { await deleteDoc(doc(db, "interventions", document.getElementById('actionEventId').value)); fermerActionModal(); } });
document.getElementById('btnDeleteGroup').addEventListener('click', async () => {
    const client = document.getElementById('actionEventClient').value; const date = document.getElementById('actionEventDate').value; const type = document.getElementById('actionEventType').value;
    if (!client || !date) return;
    if (confirm(`⚠️ DANGER : Voulez-vous vraiment supprimer ABSOLUMENT TOUTES les interventions de ${client} prévues le ${date} ?`)) {
        const btnDeleteGroup = document.getElementById('btnDeleteGroup'); const originalHtml = btnDeleteGroup.innerHTML; btnDeleteGroup.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Nettoyage...'; btnDeleteGroup.disabled = true;
        try { const toDelete = allInterventions.filter(i => i.client === client && i.date === date && i.type === type); for (const intv of toDelete) { await deleteDoc(doc(db, "interventions", intv.id)); } } catch (err) { console.error(err); alert("Erreur."); } finally { btnDeleteGroup.innerHTML = originalHtml; btnDeleteGroup.disabled = false; fermerActionModal(); }
    }
});
document.getElementById('btnSetEnCours').addEventListener('click', async () => { await updateDoc(doc(db, "interventions", document.getElementById('actionEventId').value), { statut: "En cours" }); fermerActionModal(); });

// ==========================================
// LOGIQUE DE PRÉ-REMPLISSAGE DE FICHE
// ==========================================
function preRemplirFiche(interventionData, isNouvelleFin) {
    const theKit = kitsDB[interventionData.client + "_" + interventionData.machine];
    document.getElementById('input_client').value = interventionData.client;
    document.getElementById('input_machine').value = interventionData.machine;
    document.getElementById('input_date').value = interventionData.date; // Met la date de l'intervention
    
    if (interventionData.type === "Préventif") {
        document.getElementById('input_forfait_ref').value = "PREV";
        document.getElementById('input_forfait_nom').value = "SAV-Préventif";
        document.getElementById('input_forfait_diag').value = "Maintenance Préventive " + interventionData.machine;
        
        let texteTravaux = `Maintenance préventive effectuée sur ${interventionData.machine}.\n`;
        if (theKit && theKit.pieces.length > 0) {
            texteTravaux += "\nRemplacement des consommables / PDR :\n";
            theKit.pieces.forEach(p => { texteTravaux += `- ${p.qte}x [${p.ref}] ${p.nom}\n`; });
        }
        document.getElementById('input_travaux').value = texteTravaux;
    } else {
        document.getElementById('input_forfait_ref').value = "DEPAN";
        document.getElementById('input_forfait_nom').value = "SAV-Depannage";
        document.getElementById('input_forfait_diag').value = "Diagnostic " + interventionData.machine;
        document.getElementById('input_travaux').value = ""; 
    }

    const techListContainer = document.getElementById('fiche-tech-list');
    techListContainer.innerHTML = '';
    const techs = interventionData.technicien ? interventionData.technicien.split(', ') : [];
    techs.forEach(t => {
        if(t && t.trim() !== '?') {
            techListContainer.innerHTML += `<div class="flex items-center gap-3 mb-2 tech-row"><input type="text" class="tech-name w-1/2 p-2 border border-slate-300 rounded-lg text-sm bg-white font-bold" value="${t}"><input type="number" class="tech-qty-val w-1/4 p-2 border border-slate-300 rounded-lg text-sm bg-white" placeholder="Qté" value="1" step="0.5"><select class="tech-qty-unit w-1/4 p-2 border border-slate-300 rounded-lg text-sm bg-white"><option value="Heure(s)">Heure(s)</option><option value="Jour(s)">Jour(s)</option></select><button type="button" class="text-red-500 hover:text-red-700 font-bold px-2" onclick="this.parentElement.remove()">X</button></div>`;
        }
    });

    fermerActionModal();
    document.querySelector('a[data-view="fiches"]').click();
}

// 1. Bouton "Voir la Fiche" (Pour les archives Terminées - SANS décrémenter le stock)
document.getElementById('btnVoirFiche').addEventListener('click', () => {
    const id = document.getElementById('actionEventId').value; const interventionData = allInterventions.find(i => i.id === id);
    if (interventionData) preRemplirFiche(interventionData, false);
});

// 2. Bouton "Valider et Créer Fiche" (Pour clôturer - AVEC décrémentation stock et récurrence)
document.getElementById('btnSetTermine').addEventListener('click', async () => {
    const btnTermine = document.getElementById('btnSetTermine'); const originalContent = btnTermine.innerHTML;
    btnTermine.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Auto-Génération...'; btnTermine.disabled = true;
    const id = document.getElementById('actionEventId').value; const interventionData = allInterventions.find(i => i.id === id);
    if (!interventionData) { fermerActionModal(); return; }

    try {
        const theKit = kitsDB[interventionData.client + "_" + interventionData.machine];
        if (interventionData.type === "Préventif" && theKit && theKit.pieces.length > 0) {
            for (const p of theKit.pieces) { await updateDoc(doc(db, "stock", p.idPiece), { qte: increment(-p.qte) }); }
        }

        await updateDoc(doc(db, "interventions", id), { statut: "Terminé" });

        const freq = interventionData.frequence || "Ponctuel";
        if (freq === "Hypertherm") {
            // RECALCUL INFINI HYPERTHERM
            const htMachine = hyperthermDB.find(h => h.client === interventionData.client && h.machine === interventionData.machine);
            if(htMachine) {
                const cycleInfo = getNextHyperthermCycle(htMachine.dateInstallation, htMachine.shifts || 1);
                await addDoc(collection(db, "interventions"), { client: interventionData.client, machine: interventionData.machine, date: cycleInfo.dateObj.toISOString().split('T')[0], type: "Préventif", technicien: "Équipe A2CIM", statut: "Planifié", frequence: "Hypertherm", timestamp: serverTimestamp() });
                
                // Maj du kit PDR auto
                let newKit = []; cycleInfo.parts.forEach(p => { const pStock = stockDB.find(s => s.ref === p.ref); if(pStock) newKit.push({ idPiece: pStock.id, nom: pStock.nom, ref: pStock.ref, qte: 1 }); });
                if (theKit) { await updateDoc(doc(db, "kits", theKit.id), { pieces: newKit }); } else { await addDoc(collection(db, "kits"), { client: htMachine.client, machine: htMachine.machine, pieces: newKit }); }
            }
        } else if (freq !== "Ponctuel") {
            // RÉCURRENCE NORMALE
            const dateObj = new Date(interventionData.date);
            if (freq === "Mensuel") dateObj.setMonth(dateObj.getMonth() + 1); else if (freq === "Trimestriel") dateObj.setMonth(dateObj.getMonth() + 3); else if (freq === "Semestriel") dateObj.setMonth(dateObj.getMonth() + 6); else if (freq === "Annuel") dateObj.setFullYear(dateObj.getFullYear() + 1);
            await addDoc(collection(db, "interventions"), { client: interventionData.client, machine: interventionData.machine, date: dateObj.toISOString().split('T')[0], type: interventionData.type, technicien: interventionData.technicien, statut: "Planifié", frequence: freq, timestamp: serverTimestamp() });
        }

        preRemplirFiche(interventionData, true);

    } catch (e) { console.error(e); alert("Erreur lors de la validation."); } 
    finally { btnTermine.innerHTML = originalContent; btnTermine.disabled = false; }
});

// ==========================================
// SYNCHRO TABLEAU DE BORD (GROUPÉ)
// ==========================================
const q = query(collection(db, "interventions"), orderBy("date", "asc"));
onSnapshot(q, (snapshot) => {
    const urgentContainer = document.getElementById('urgent-tasks-container'); const upcomingContainer = document.getElementById('upcoming-tasks-container'); const curatifContainer = document.getElementById('curatif-container');
    if (urgentContainer) urgentContainer.innerHTML = ''; if (upcomingContainer) upcomingContainer.innerHTML = ''; if (curatifContainer) curatifContainer.innerHTML = '';
    
    allInterventions = []; groupedInterventionsGlobal = {}; 
    let activeTotalCount = 0; let retardCount = 0; let enCoursCount = 0; const todayStr = new Date().toISOString().split('T')[0];

    snapshot.forEach((docSnap) => {
        const data = docSnap.data(); data.id = docSnap.id; allInterventions.push(data);
        if (data.statut === "Terminé") return;
        activeTotalCount++; const isRetard = data.date < todayStr;
        if (data.statut === "En retard" || isRetard) retardCount++; if (data.statut === "En cours") enCoursCount++;
        const dateAffichee = data.date ? new Date(data.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
        let currentConfig = statusConfig[data.statut] || statusConfig["Planifié"];
        if (isRetard && data.statut === "Planifié") currentConfig = statusConfig["En retard"];
        const groupKey = `${data.client}_${data.date}_${data.type}_${isRetard ? 'Retard' : data.statut}`;
        if (!groupedInterventionsGlobal[groupKey]) { groupedInterventionsGlobal[groupKey] = { client: data.client, dateAffichee: dateAffichee, type: data.type, statut: (isRetard && data.statut === "Planifié") ? "En retard" : data.statut, isRetard: isRetard, config: currentConfig, machines: [] }; }
        groupedInterventionsGlobal[groupKey].machines.push(data);
    });

    Object.keys(groupedInterventionsGlobal).forEach(key => {
        const group = groupedInterventionsGlobal[key];
        const cardHTML = `<div class="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden flex items-center justify-between hover:shadow-md transition-shadow cursor-pointer" onclick="ouvrirModalGroupe('${key}')"><div class="w-2 self-stretch border-l-4" style="background-color: ${group.config.bg}; border-color: ${group.config.border};"></div><div class="p-4 flex-1 flex items-center justify-between"><div><div class="flex items-center gap-2 mb-1"><h3 class="font-bold text-slate-800 text-base uppercase">${group.client}</h3>${group.isRetard ? '<span class="text-red-500 font-bold text-xs"><i class="fa-solid fa-triangle-exclamation"></i></span>' : ''}</div><p class="text-sm text-slate-600 font-medium"><i class="fa-solid fa-microchip mr-1 text-slate-400"></i> ${group.machines.length} machine(s) prévue(s)</p><p class="text-xs text-slate-500 mt-1"><i class="fa-solid fa-calendar-day mr-1"></i> ${group.dateAffichee} &nbsp;|&nbsp; <i class="fa-solid fa-wrench mr-1"></i> ${group.type}</p></div><div class="px-3 py-1.5 rounded-lg text-xs font-bold uppercase" style="background-color: ${group.config.bg}; color: ${group.config.text}; border-color: ${group.config.border}; border-width: 1px;">${group.statut}</div></div></div>`;
        if (group.type === "Curatif" || group.isRetard || group.statut === "En retard") { if (urgentContainer) urgentContainer.innerHTML += cardHTML; } else { if (upcomingContainer) upcomingContainer.innerHTML += cardHTML; }
        if (group.type === "Curatif" && curatifContainer) curatifContainer.innerHTML += cardHTML;
    });

    if (urgentContainer && urgentContainer.innerHTML === '') urgentContainer.innerHTML = '<p class="text-slate-400 text-sm italic py-2">Super ! Aucune urgence ni retard.</p>';
    if (upcomingContainer && upcomingContainer.innerHTML === '') upcomingContainer.innerHTML = '<p class="text-slate-400 text-sm italic py-2">Aucune maintenance préventive prévue pour le moment.</p>';
    if (document.getElementById('kpi-total')) document.getElementById('kpi-total').textContent = activeTotalCount;
    if (document.getElementById('kpi-retard')) document.getElementById('kpi-retard').textContent = retardCount;
    if (document.getElementById('kpi-encours')) document.getElementById('kpi-encours').textContent = enCoursCount;
    if (document.getElementById('kpi-taux')) document.getElementById('kpi-taux').textContent = activeTotalCount > 0 ? "100%" : "0%";
    
    updateCalendarEvents();
});

window.ouvrirModalGroupe = function(groupKey) {
    const group = groupedInterventionsGlobal[groupKey]; if (!group) return;
    document.getElementById('groupModalTitle').textContent = `Machines - ${group.client}`; document.getElementById('groupModalSub').textContent = `${group.dateAffichee} | ${group.type}`;
    const listContainer = document.getElementById('groupModalList'); listContainer.innerHTML = '';
    group.machines.forEach(m => { listContainer.innerHTML += `<div class="flex justify-between items-center p-3 border-b border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors" onclick="fermerModalGroupe(); ouvrirActionModal('${m.id}')"><div><p class="font-bold text-slate-800">${m.machine}</p><p class="text-xs text-slate-500 mt-1"><i class="fa-solid fa-user-gear mr-1"></i> ${m.technicien}</p></div><i class="fa-solid fa-chevron-right text-slate-300"></i></div>`; });
    document.getElementById('groupModal').classList.remove('hidden'); document.getElementById('groupModal').classList.add('flex');
}
window.fermerModalGroupe = function() { document.getElementById('groupModal').classList.add('hidden'); document.getElementById('groupModal').classList.remove('flex'); }

// --- AJOUT INTERVENTION (BOUCLIER ANTI-DOUBLONS) ---
const modal = document.getElementById('addInterventionModal');
function openModal() { if (modal) { modal.classList.remove('hidden'); modal.classList.add('flex'); } }
function closeModal() { if (modal) { modal.classList.add('hidden'); modal.classList.remove('flex'); } }
if(document.getElementById('addInterventionBtn')) document.getElementById('addInterventionBtn').addEventListener('click', openModal);
if(document.getElementById('closeModalBtn')) document.getElementById('closeModalBtn').addEventListener('click', closeModal);
if(document.getElementById('cancelModalBtn')) document.getElementById('cancelModalBtn').addEventListener('click', closeModal);

if(document.getElementById('addInterventionForm')) {
    document.getElementById('addInterventionForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btnSubmit = document.getElementById('btnSubmit'); const originalText = btnSubmit.innerHTML;
        const techCheckboxes = document.querySelectorAll('input[name="tech"]:checked');
        if (techCheckboxes.length === 0) { alert("⚠️ Veuillez sélectionner au moins un technicien."); return; }
        const techVal = Array.from(techCheckboxes).map(cb => cb.value).join(', ');
        btnSubmit.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Création...'; btnSubmit.disabled = true;

        const clientVal = document.getElementById('formClient').value; const machineVal = document.getElementById('formMachine').value; const dateVal = document.getElementById('formDate').value; const typeVal = document.getElementById('formType').value; const freqVal = document.getElementById('formFrequence').value;

        function isDuplicate(c, m, d, t) { return allInterventions.some(i => i.client === c && i.machine === m && i.date === d && i.type === t && i.statut === "Planifié"); }

        try {
            if (machineVal === "TOUTES_LES_MACHINES") {
                const machinesDuClient = parcClientsDB[clientVal].machines; let ajouts = 0; let doublons = 0;
                for (const m of machinesDuClient) {
                    if (isDuplicate(clientVal, m, dateVal, typeVal)) { doublons++; } else { await addDoc(collection(db, "interventions"), { client: clientVal, machine: m, date: dateVal, type: typeVal, technicien: techVal, statut: "Planifié", frequence: freqVal, timestamp: serverTimestamp() }); ajouts++; }
                }
                let alertMsg = `${ajouts} interventions planifiées pour ${clientVal} !`;
                if (doublons > 0) alertMsg += `\n⚠️ ${doublons} doublon(s) ignoré(s).`; alert(alertMsg);
            } else {
                if (isDuplicate(clientVal, machineVal, dateVal, typeVal)) { alert("⚠️ Cette intervention est déjà planifiée ! (Doublon évité)"); } 
                else { await addDoc(collection(db, "interventions"), { client: clientVal, machine: machineVal, date: dateVal, type: typeVal, technicien: techVal, statut: "Planifié", frequence: freqVal, timestamp: serverTimestamp() }); }
            }
            e.target.reset(); closeModal();
        } catch(err) { console.error(err); alert("Erreur lors de la création"); } finally { btnSubmit.innerHTML = originalText; btnSubmit.disabled = false; }
    });
}

// Navigation & Bouton contextuel
const navLinks = document.querySelectorAll('.nav-link'); const appViews = document.querySelectorAll('.app-view'); const addBtn = document.getElementById('addInterventionBtn'); const allowedViewsForAddBtn = ['dashboard', 'planning', 'curatif'];
navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault(); const targetView = link.getAttribute('data-view');
        appViews.forEach(view => view.classList.add('hidden')); document.getElementById(`view-${targetView}`).classList.remove('hidden');
        if (targetView === 'planning' && fullCalendarInstance) setTimeout(() => { fullCalendarInstance.render(); }, 100);
        if (addBtn) { if (allowedViewsForAddBtn.includes(targetView)) { addBtn.classList.remove('opacity-0', 'pointer-events-none'); addBtn.classList.add('opacity-100'); } else { addBtn.classList.remove('opacity-100'); addBtn.classList.add('opacity-0', 'pointer-events-none'); } }
        navLinks.forEach(l => { l.classList.remove('bg-brand-800', 'text-white'); l.classList.add('text-slate-400'); }); document.querySelectorAll(`[data-view="${targetView}"]`).forEach(activeL => { activeL.classList.add('bg-brand-800', 'text-white'); activeL.classList.remove('text-slate-400'); });
    });
});

// ==========================================
// GESTION NATIVE DE LA FICHE D'INTERVENTION
// ==========================================
function escapeHtml(str) { if (!str) return ""; return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); }
let pad = (n) => n < 10 ? '0' + n : n; let now = new Date();
if(document.getElementById('input_date_tirage')) { document.getElementById('input_date_tirage').valueAsDate = now; document.getElementById('input_heure_tirage').value = pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds()); }

window.addFicheTechnician = function() {
    document.getElementById('fiche-tech-list').innerHTML += `<div class="flex items-center gap-3 mb-2 tech-row"><input type="text" class="tech-name w-1/2 p-2 border border-slate-300 rounded-lg text-sm bg-white font-bold" placeholder="Nom"><input type="number" class="tech-qty-val w-1/4 p-2 border border-slate-300 rounded-lg text-sm bg-white" placeholder="Qté" value="1" step="0.5"><select class="tech-qty-unit w-1/4 p-2 border border-slate-300 rounded-lg text-sm bg-white"><option value="Heure(s)">Heure(s)</option><option value="Jour(s)">Jour(s)</option></select><button type="button" class="text-red-500 hover:text-red-700 font-bold px-2" onclick="this.parentElement.remove()">X</button></div>`;
};

window.processOCR = async function() {
    const fileInput = document.getElementById('imageInput'); const statusDiv = document.getElementById('ocrStatus');
    if (!fileInput.files.length) { alert("Sélectionnez ou prenez une photo !"); return; }
    statusDiv.style.color = "#2563eb"; statusDiv.innerText = "Lecture de l'image en cours...";
    try {
        const result = await Tesseract.recognize(fileInput.files[0], 'fra'); const texteExtrait = result.data.text;
        const matchFisav = texteExtrait.match(/\b\d{2}[A-Z]{2}\d+\b/g); if (matchFisav) document.getElementById('input_fisav').value = matchFisav[0];
        const matchRef = texteExtrait.match(/SAV\s+[A-Z]+/g); if (matchRef) document.getElementById('input_reference').value = matchRef[0];
        statusDiv.style.color = "#16a34a"; statusDiv.innerText = "Analyse terminée !";
    } catch (error) { statusDiv.style.color = "#dc2626"; statusDiv.innerText = "Erreur OCR."; }
};

window.sendWhatsApp = function() {
    let fisav = document.getElementById('input_fisav').value || "N/A"; let client = document.getElementById('input_client').value || "Client"; let machine = document.getElementById('input_machine').value || "Machine";
    let message = `Bonjour, voici la fiche d'intervention A2CIM.\n\n*N° FISAV :* ${fisav}\n*Client :* ${client}\n*Machine :* ${machine}\n\n(Veuillez trouver le fichier PDF en pièce jointe).`;
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank');
};

window.prepareAndPrint = function() {
    const fisavCheck = document.getElementById('input_fisav').value.trim(); const clientCheck = document.getElementById('input_client').value.trim(); const machineCheck = document.getElementById('input_machine').value.trim(); const dateCheck = document.getElementById('input_date').value;
    const champsManquants = [];
    if (!fisavCheck) champsManquants.push("N° FISAV"); if (!clientCheck) champsManquants.push("Client"); if (!machineCheck) champsManquants.push("Machine"); if (!dateCheck) champsManquants.push("Date d'intervention");
    if (champsManquants.length > 0) { alert("Veuillez remplir :\n- " + champsManquants.join("\n- ")); return; }

    const btnGenerer = document.getElementById('btn-generate-main'); btnGenerer.disabled = true; btnGenerer.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Préparation PDF...';

    let fisav = document.getElementById('input_fisav').value; document.getElementById('p_fisav').innerText = fisav; document.getElementById('p_bottom_fisav').innerText = fisav;
    let reference = document.getElementById('input_reference').value; document.getElementById('p_ref').innerText = reference;
    let dateVal = document.getElementById('input_date').value; if(dateVal) { let d = new Date(dateVal); document.getElementById('p_date').innerText = pad(d.getDate()) + '/' + pad(d.getMonth()+1) + '/' + d.getFullYear().toString().slice(-2); }
    let dateTirageVal = document.getElementById('input_date_tirage').value; if(dateTirageVal) { let dt = new Date(dateTirageVal); document.getElementById('p_date_tirage').innerText = pad(dt.getDate()) + '/' + pad(dt.getMonth()+1) + '/' + dt.getFullYear().toString().slice(-2); }
    let heureTirage = document.getElementById('input_heure_tirage').value; document.getElementById('p_heure_tirage').innerText = heureTirage;
    let client = document.getElementById('input_client').value; document.getElementById('p_client').innerText = client;
    let machine = document.getElementById('input_machine').value; document.getElementById('p_machine').innerText = machine; document.getElementById('p_ref_machine').innerText = machine;
    let travauxBruts = document.getElementById('input_travaux').value; document.getElementById('p_travaux_content').innerHTML = escapeHtml(travauxBruts).replace(/\n/g, '<br>');
    
    let tbody = document.getElementById('p_lignes_prestations'); tbody.innerHTML = '';
    let refForfait = document.getElementById('input_forfait_ref').value; let nomForfait = document.getElementById('input_forfait_nom').value; let diagForfait = document.getElementById('input_forfait_diag').value;
    tbody.innerHTML += `<tr><td>FHSAV-${escapeHtml(refForfait)}</td><td>Forfait Horaire ${escapeHtml(nomForfait)}<br><br><span style="padding-left:15px;">${escapeHtml(diagForfait)}</span></td><td></td><td style="text-align: right;">0,00</td><td style="text-align: right;">0,00</td></tr>`;
    
    let techNames = []; let detailTechniciens = []; let totalQty = 0; let currentUnit = "";
    document.querySelectorAll('.tech-row').forEach((row) => {
        let name = row.querySelector('.tech-name').value.toUpperCase(); let qtyVal = parseFloat(row.querySelector('.tech-qty-val').value) || 0; let unit = row.querySelector('.tech-qty-unit').value;
        if (name.trim() !== '') {
            techNames.push(name); detailTechniciens.push({ nom: name, quantite: qtyVal, unite: unit }); totalQty += qtyVal; currentUnit = unit;
            tbody.innerHTML += `<tr><td style="padding-top: 10px;">FHTEC-EM2</td><td style="padding-top: 10px;">Heure Technicien ${escapeHtml(name)}</td><td style="padding-top: 10px; text-align: center;">${qtyVal} ${unit === 'Heure(s)' ? 'H' : 'J'}</td><td style="padding-top: 10px; text-align: right;">0,00</td><td style="padding-top: 10px; text-align: right;">0,00</td></tr>`;
        }
    });
    tbody.innerHTML += `<tr><td style="height: 30px;"></td><td></td><td></td><td></td><td></td></tr>`;
    let allTechs = techNames.join(', '); document.getElementById('p_nom_tech').innerText = allTechs; document.getElementById('p_realise_par').innerText = allTechs;
    let totalFormatte = totalQty > 0 ? (totalQty + (currentUnit === 'Heure(s)' ? ' H' : ' J')) : '0,00'; document.getElementById('p_somme_reporter').innerText = totalFormatte;

    const historiqueData = {
        numero_fisav: fisav, reference_intervention: reference, client: client, machine: machine,
        date_intervention: dateVal, date_tirage: dateTirageVal + " " + heureTirage, diagnostic: diagForfait,
        travaux_realises: travauxBruts, techniciens_intervenants: detailTechniciens, total_temps: totalFormatte, 
        timestamp_creation: serverTimestamp()
    };
    addDoc(collection(db, "historique_interventions"), historiqueData).catch((error) => console.error("Erreur sync :", error));

    const originalTitle = document.title; const fisavNom = fisavCheck.replace(/[^a-zA-Z0-9]/g, '_'); const clientNom = clientCheck.replace(/[^a-zA-Z0-9]/g, '_'); document.title = `Fiche_${fisavNom}_${clientNom}`;

    setTimeout(() => {
        window.print(); document.title = originalTitle;
        setTimeout(() => { btnGenerer.disabled = false; btnGenerer.innerHTML = '<i class="fa-solid fa-print mr-2"></i> Sauvegarder & Imprimer le PDF'; }, 1000);
    }, 500);
};

// PWA
if ('serviceWorker' in navigator) { window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(err => console.error('Erreur SW', err)); }); }