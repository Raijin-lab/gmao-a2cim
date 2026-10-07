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

// --- DONNÉES GLOBALES ---
let allInterventions = [];
let parcClientsDB = {}; 
let fullCalendarInstance = null;
let currentClientFilter = "ALL";
let currentTypeFilter = "ALL"; 
let stockDB = []; 
let kitsDB = {};  
let tempKitPieces = [];
let groupedInterventionsGlobal = {}; 
let hyperthermDB = []; 

// --- GESTION DU CODE PIN ---
const CORRECT_PIN = "A2CIM2026";
if (document.getElementById('pinForm')) {
    document.getElementById('pinForm').addEventListener('submit', (e) => {
        e.preventDefault();
        if (document.getElementById('pinInput').value.trim() === CORRECT_PIN) {
            const lock = document.getElementById('lockScreen');
            lock.classList.add('opacity-0'); setTimeout(() => lock.remove(), 300);
        } else { document.getElementById('pinError').classList.remove('hidden'); }
    });
}

// ==========================================
// 1. MOTEUR DU STOCK CENTRAL (PDR)
// ==========================================
const qStock = query(collection(db, "stock"), orderBy("nom", "asc"));
onSnapshot(qStock, (snapshot) => {
    stockDB = [];
    const stockContainer = document.getElementById('stock-container');
    const selectPieceKit = document.getElementById('selectPieceKit');
    if(stockContainer) stockContainer.innerHTML = '';
    if(selectPieceKit) selectPieceKit.innerHTML = '<option value="" disabled selected>Choisir une pièce...</option>';
    
    if (snapshot.empty && stockContainer) { stockContainer.innerHTML = '<p class="text-slate-500 col-span-full">Aucune pièce en stock.</p>'; }

    snapshot.forEach(docSnap => {
        const data = docSnap.data(); data.id = docSnap.id; stockDB.push(data);
        if (selectPieceKit) selectPieceKit.innerHTML += `<option value="${data.id}">${data.ref} - ${data.nom} (Stock: ${data.qte})</option>`; 
        if (stockContainer) {
            const isAlert = data.qte <= data.alerte;
            const colorClass = isAlert ? 'text-red-600 bg-red-50 border-red-200' : 'text-slate-700 bg-white border-slate-100';
            const iconAlert = isAlert ? '<i class="fa-solid fa-triangle-exclamation text-red-500 absolute top-4 right-4"></i>' : '';
            
            stockContainer.innerHTML += `
            <div class="p-5 rounded-2xl shadow-sm border ${colorClass} flex flex-col relative transition-all">
                ${iconAlert}
                <div class="text-xs font-bold text-slate-400 mb-1 uppercase tracking-wider">${data.ref}</div>
                <h3 class="font-bold text-base mb-4 pr-6 leading-tight">${data.nom}</h3>
                <div class="mt-auto">
                    <div class="flex justify-between items-end mb-2">
                        <span class="text-3xl font-black ${isAlert ? 'text-red-600' : 'text-brand-600'}">${data.qte}</span>
                        <span class="text-[10px] text-slate-400 uppercase font-bold">Seuil: ${data.alerte}</span>
                    </div>
                    <div class="w-full bg-slate-100 rounded-full h-1.5 mb-4 overflow-hidden">
                        <div class="h-1.5 rounded-full ${isAlert ? 'bg-red-500' : 'bg-brand-500'}" style="width: ${Math.min((data.qte / (data.alerte * 3)) * 100, 100)}%"></div>
                    </div>
                    <div class="flex space-x-2">
                        <button onclick="ajusterStock('${data.id}', 1)" class="flex-1 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-sm font-bold"><i class="fa-solid fa-plus"></i></button>
                        <button onclick="ajusterStock('${data.id}', -1)" class="flex-1 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-sm font-bold"><i class="fa-solid fa-minus"></i></button>
                        <button onclick="supprimerStock('${data.id}')" class="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-500 rounded-lg"><i class="fa-solid fa-trash-can"></i></button>
                    </div>
                </div>
            </div>`;
        }
    });
});

if (document.getElementById('formAddStock')) {
    document.getElementById('formAddStock').addEventListener('submit', async (e) => {
        e.preventDefault();
        await addDoc(collection(db, "stock"), { ref: document.getElementById('newStockRef').value.trim(), nom: document.getElementById('newStockNom').value.trim(), qte: parseInt(document.getElementById('newStockQte').value), alerte: parseInt(document.getElementById('newStockAlerte').value) });
        e.target.reset();
    });
}
window.ajusterStock = async function(id, val) { await updateDoc(doc(db, "stock", id), { qte: increment(val) }); };
window.supprimerStock = async function(id) { if(confirm("Supprimer cette pièce du stock ?")) await deleteDoc(doc(db, "stock", id)); };


// ==========================================
// 2. MOTEUR DES KITS PDR
// ==========================================
const qKits = query(collection(db, "kits"));
onSnapshot(qKits, (snapshot) => { kitsDB = {}; snapshot.forEach(docSnap => { const data = docSnap.data(); kitsDB[data.client + "_" + data.machine] = { id: docSnap.id, pieces: data.pieces }; }); });

window.ouvrirModalKit = function(client, machine) {
    document.getElementById('kitModalMachineName').textContent = `${client} | ${machine}`;
    document.getElementById('currentKitClient').value = client; document.getElementById('currentKitMachine').value = machine;
    const kitExistant = kitsDB[client + "_" + machine];
    tempKitPieces = kitExistant ? [...kitExistant.pieces] : [];
    afficherPiecesKitTemp();
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
    const client = document.getElementById('currentKitClient').value; const machine = document.getElementById('currentKitMachine').value;
    const existingKit = kitsDB[client + "_" + machine];
    if (existingKit) { await updateDoc(doc(db, "kits", existingKit.id), { pieces: tempKitPieces }); } else { await addDoc(collection(db, "kits"), { client: client, machine: machine, pieces: tempKitPieces }); }
    alert("Le kit a été enregistré !"); fermerKitModal();
}

// ==========================================
// MOTEUR PARC CLIENTS
// ==========================================
const qClients = query(collection(db, "clients"), orderBy("nom", "asc"));
onSnapshot(qClients, (snapshot) => {
    const parcContainer = document.getElementById('parc-container');
    const formClientSelect = document.getElementById('formClient');
    const htClientSelect = document.getElementById('htClient');
    const calendarFilter = document.getElementById('calendarClientFilter');
    
    if (parcContainer) parcContainer.innerHTML = '';
    const currentClientSelection = formClientSelect ? formClientSelect.value : "";
    if (formClientSelect) formClientSelect.innerHTML = '<option value="" disabled selected>Sélectionner...</option>';
    if (htClientSelect) htClientSelect.innerHTML = '<option value="" disabled selected>Client...</option>';
    if (calendarFilter) calendarFilter.innerHTML = '<option value="ALL">Tous les clients</option>';
    parcClientsDB = {};

    snapshot.forEach(docSnap => {
        const data = docSnap.data(); const docId = docSnap.id; const machines = data.machines || [];
        parcClientsDB[data.nom] = { id: docId, machines: machines };
        if (formClientSelect) formClientSelect.innerHTML += `<option value="${data.nom}">${data.nom}</option>`;
        if (htClientSelect) htClientSelect.innerHTML += `<option value="${data.nom}">${data.nom}</option>`;
        if (calendarFilter) calendarFilter.innerHTML += `<option value="${data.nom}">${data.nom}</option>`;

        let machinesListHTML = '';
        if (machines.length === 0) { machinesListHTML = '<p class="text-xs text-slate-400 italic mb-2">Aucune machine.</p>'; } 
        else {
            machines.forEach(m => {
                const hasKit = kitsDB[data.nom + "_" + m] && kitsDB[data.nom + "_" + m].pieces.length > 0;
                const iconColor = hasKit ? "text-brand-500" : "text-slate-300";
                machinesListHTML += `
                <div class="flex items-center justify-between bg-slate-50 px-3 py-2 rounded-lg mb-2 border border-slate-100">
                    <span class="text-sm text-slate-700 font-medium truncate flex-1"><i class="fa-solid fa-microchip text-slate-400 mr-2"></i>${m}</span>
                    <div class="flex items-center space-x-2 shrink-0">
                        <button onclick="ouvrirModalKit('${data.nom}', '${m}')" class="px-2 py-1 bg-white border border-slate-200 rounded hover:bg-slate-100"><i class="fa-solid fa-boxes-stacked ${iconColor}"></i></button>
                        <button onclick="supprimerMachineParc('${docId}', '${m}')" class="text-slate-300 hover:text-red-500 px-1"><i class="fa-solid fa-xmark"></i></button>
                    </div>
                </div>`;
            });
        }
        if (parcContainer) {
            parcContainer.innerHTML += `
            <div class="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden flex flex-col relative h-full">
                <button onclick="supprimerClientParc('${docId}')" class="absolute top-4 right-4 text-slate-300 hover:text-red-500"><i class="fa-solid fa-trash-can"></i></button>
                <div class="p-5 border-b border-slate-100 bg-brand-50"><h3 class="text-lg font-bold text-brand-900"><i class="fa-solid fa-building mr-2 text-brand-500"></i>${data.nom}</h3></div>
                <div class="p-5 flex-1 flex flex-col">
                    <div class="mb-4 max-h-[200px] overflow-y-auto custom-scroll pr-2">${machinesListHTML}</div>
                    <form onsubmit="ajouterMachineParc(event, '${docId}')" class="flex gap-2 mt-auto">
                        <input type="text" id="machineInput_${docId}" placeholder="Nom machine..." required class="flex-1 px-3 py-1.5 text-sm border rounded-lg focus:ring-2 focus:ring-brand-500">
                        <button type="submit" class="bg-slate-800 text-white px-3 py-1.5 rounded-lg text-sm hover:bg-slate-700"><i class="fa-solid fa-plus"></i></button>
                    </form>
                </div>
            </div>`;
        }
    });
    if (formClientSelect && parcClientsDB[currentClientSelection]) formClientSelect.value = currentClientSelection;
});

function syncMachinesDropdown(clientSelectId, machineSelectId, allowAll = false) {
    const clientSelect = document.getElementById(clientSelectId); const machineSelect = document.getElementById(machineSelectId);
    if (clientSelect && machineSelect) {
        clientSelect.addEventListener('change', (e) => {
            const nomClient = e.target.value;
            machineSelect.innerHTML = '<option value="" disabled selected>Machine...</option>';
            if (parcClientsDB[nomClient]) {
                if (allowAll && parcClientsDB[nomClient].machines.length > 0) {
                    machineSelect.innerHTML += `<option value="TOUTES_LES_MACHINES" class="font-bold text-brand-600">🌟 Toutes les machines (${parcClientsDB[nomClient].machines.length})</option>`;
                }
                parcClientsDB[nomClient].machines.forEach(m => { machineSelect.innerHTML += `<option value="${m}">${m}</option>`; });
            }
        });
    }
}
syncMachinesDropdown('formClient', 'formMachine', true);
syncMachinesDropdown('htClient', 'htMachine', false);

window.ajouterMachineParc = async function(e, docId) { e.preventDefault(); const input = document.getElementById(`machineInput_${docId}`); if (!input.value.trim()) return; await updateDoc(doc(db, "clients", docId), { machines: arrayUnion(input.value.trim()) }); input.value = ''; };
window.supprimerMachineParc = async function(docId, nomMachine) { if (confirm(`Supprimer la machine "${nomMachine}" ?`)) await updateDoc(doc(db, "clients", docId), { machines: arrayRemove(nomMachine) }); };
window.supprimerClientParc = async function(docId) { if (confirm(`Attention : supprimer ce client ?`)) await deleteDoc(doc(db, "clients", docId)); };
if (document.getElementById('formAddClient')) { document.getElementById('formAddClient').addEventListener('submit', async (e) => { e.preventDefault(); const input = document.getElementById('newClientName'); if (!input.value.trim()) return; await addDoc(collection(db, "clients"), { nom: input.value.trim(), machines: [] }); input.value = ''; }); }


// ==========================================
// 3. EXPERTISE HYPERTHERM AVEC RÉFÉRENCES
// ==========================================
// NOUVEAU: Structure avec Références des Pièces Hypertherm
const HT_RULES = {
    "6M": { 
        days: 182, 
        parts: [
            { ref: "027664", nom: "Filtre à air principal" },
            { ref: "028872", nom: "Coolant 70/30 (Liquide refroidissement)" },
            { ref: "027665", nom: "Filtre liquide de refroidissement" },
            { ref: "428383", nom: "Kit d'entretien torche" }
        ] 
    },
    "12M": { 
        days: 365, 
        parts: [
            { ref: "003149", nom: "Relais arc pilote" },
            { ref: "003150", nom: "Contacteur principal" },
            { ref: "428144", nom: "Corps de torche (Main body)" }
        ] 
    },
    "24M": { 
        days: 730, 
        parts: [
            { ref: "428384", nom: "Kit pompe à eau (Coolant pump kit)" },
            { ref: "428385", nom: "Faisceaux de torche (Torch leads)" }
        ] 
    },
    "36M": { 
        days: 1095, 
        parts: [
            { ref: "027666", nom: "Ventilateurs de refroidissement" },
            { ref: "027667", nom: "Moteur de pompe hydraulique" }
        ] 
    }
};

const qHT = query(collection(db, "hypertherm"));
onSnapshot(qHT, (snapshot) => {
    hyperthermDB = [];
    const container = document.getElementById('hypertherm-container');
    if(container) container.innerHTML = '';
    
    if (snapshot.empty && container) {
        container.innerHTML = '<p class="text-slate-500 italic">Aucun générateur Hypertherm enregistré.</p>'; return;
    }

    snapshot.forEach(docSnap => {
        const data = docSnap.data(); data.id = docSnap.id; hyperthermDB.push(data);
    });

    hyperthermDB.sort((a, b) => new Date(a.dateInstallation) - new Date(b.dateInstallation));

    const now = new Date();
    hyperthermDB.forEach(data => {
        if (container) {
            const instDate = new Date(data.dateInstallation);
            const shifts = data.shifts || 1;
            
            const datesEcheances = [
                { nom: "6 Mois", daysRaw: HT_RULES["6M"].days, parts: HT_RULES["6M"].parts },
                { nom: "1 An", daysRaw: HT_RULES["12M"].days, parts: HT_RULES["12M"].parts },
                { nom: "2 Ans", daysRaw: HT_RULES["24M"].days, parts: HT_RULES["24M"].parts },
                { nom: "3 Ans", daysRaw: HT_RULES["36M"].days, parts: HT_RULES["36M"].parts }
            ].map(rule => {
                const echeanceDate = new Date(instDate); echeanceDate.setDate(echeanceDate.getDate() + (rule.daysRaw / shifts));
                return { ...rule, date: echeanceDate };
            });

            let prochaineEcheance = datesEcheances.find(e => e.date > now) || datesEcheances[datesEcheances.length - 1];
            let estEnRetard = prochaineEcheance.date < now;
            
            const couleurBadge = estEnRetard ? 'bg-red-500 text-white' : 'bg-amber-100 text-amber-800';
            const iconBadge = estEnRetard ? '<i class="fa-solid fa-triangle-exclamation mr-1"></i> Retard' : '<i class="fa-solid fa-clock mr-1"></i> À venir';

            let timelineHTML = `<div class="grid grid-cols-2 md:grid-cols-4 gap-2 mt-4">`;
            datesEcheances.forEach(ech => {
                const dateStr = ech.date.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' });
                const isPassed = ech.date < now; const isNext = ech.nom === prochaineEcheance.nom;
                const bgC = isPassed ? "bg-slate-100 border-slate-200" : (isNext ? "bg-amber-50 border-amber-300 shadow-md" : "bg-white border-slate-200");
                const txtC = isPassed ? "text-slate-400" : (isNext ? "text-amber-800 font-bold" : "text-slate-600");
                timelineHTML += `<div class="border rounded-xl p-3 text-center ${bgC}"><p class="text-xs uppercase tracking-wide mb-1 ${txtC}">${ech.nom}</p><p class="text-sm font-bold ${txtC}">${dateStr}</p></div>`;
            });
            timelineHTML += `</div>`;

            // Construction de la liste des pièces et du texte à copier
            let partsHTML = '<ul class="mt-3 space-y-2">';
            let textToCopy = `Demande PDR - Préventif Hypertherm A2CIM\nClient: ${data.client}\nMachine: ${data.machine} (${data.modele})\nIntervention: ${prochaineEcheance.nom}\n\nPièces à commander :\n`;
            
            prochaineEcheance.parts.forEach(p => {
                partsHTML += `<li class="flex justify-between items-center text-xs border-b border-amber-200/50 pb-1.5"><span class="text-slate-700 font-medium">${p.nom}</span><span class="font-mono font-bold text-amber-700 bg-amber-100/50 px-2 py-0.5 rounded border border-amber-200">Réf: ${p.ref}</span></li>`;
                textToCopy += `- [Réf: ${p.ref}] ${p.nom}\n`;
            });
            partsHTML += '</ul>';

            const safeText = encodeURIComponent(textToCopy);

            container.innerHTML += `
            <div class="bg-white rounded-2xl shadow-sm border border-slate-100 p-5 relative overflow-hidden">
                <button onclick="supprimerHypertherm('${data.id}')" class="absolute top-4 right-4 text-slate-300 hover:text-red-500"><i class="fa-solid fa-trash-can"></i></button>
                <div class="flex items-center gap-3 mb-4">
                    <div class="w-12 h-12 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-500 text-2xl shadow-inner"><i class="fa-solid fa-bolt"></i></div>
                    <div><h3 class="font-bold text-lg text-slate-800 uppercase">${data.client} <span class="text-slate-400 font-normal mx-1">|</span> ${data.machine}</h3><p class="text-sm text-slate-500 font-medium">${data.modele} &nbsp;&bull;&nbsp; <span class="text-slate-400">Installé le ${instDate.toLocaleDateString('fr-FR')} (${data.shifts} Poste${data.shifts>1?'s':''})</span></p></div>
                </div>
                
                <div class="bg-amber-50/50 border border-amber-100 rounded-xl p-4 mt-2">
                    <div class="flex items-center justify-between mb-3">
                        <span class="text-xs font-bold uppercase tracking-wider text-slate-500">Prochaine Intervention : ${prochaineEcheance.nom}</span>
                        <span class="text-[10px] font-bold px-2 py-1 rounded uppercase tracking-wider ${couleurBadge}">${iconBadge}</span>
                    </div>
                    
                    <div class="flex justify-between items-center mb-1">
                        <p class="text-amber-900 font-bold text-xs uppercase tracking-wider"><i class="fa-solid fa-boxes-stacked mr-1 text-amber-500"></i> Liste d'achat</p>
                        <button onclick="navigator.clipboard.writeText(decodeURIComponent('${safeText}')).then(()=>alert('✅ Liste copiée pour le service Achat !'))" class="text-[10px] bg-amber-200 hover:bg-amber-300 text-amber-900 px-2 py-1.5 rounded-lg font-bold transition-colors shadow-sm"><i class="fa-solid fa-copy mr-1"></i> Copier</button>
                    </div>
                    ${partsHTML}
                </div>
                
                ${timelineHTML}
            </div>`;
        }
    });
});

if (document.getElementById('formAddHypertherm')) {
    document.getElementById('formAddHypertherm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btnSubmit = e.target.querySelector('button[type="submit"]'); const origTxt = btnSubmit.innerHTML;
        btnSubmit.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>'; btnSubmit.disabled = true;
        try {
            const client = document.getElementById('htClient').value; const machine = document.getElementById('htMachine').value;
            const modele = document.getElementById('htModel').value; const dateInst = document.getElementById('htDateInst').value;
            const shifts = parseInt(document.getElementById('htShifts').value);
            if (!client || !machine) { alert("Sélectionnez un client et une machine."); return; }
            await addDoc(collection(db, "hypertherm"), { client: client, machine: machine, modele: modele, dateInstallation: dateInst, shifts: shifts, timestamp: serverTimestamp() });
            e.target.reset(); document.getElementById('htMachine').innerHTML = '<option value="" disabled selected>Machine...</option>';
            alert(`Le générateur ${modele} est maintenant surveillé pour ${client}.`);
        } catch(error) { console.error(error); alert("Erreur d'association : " + error.message); } finally { btnSubmit.innerHTML = origTxt; btnSubmit.disabled = false; }
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
        initialView: window.innerWidth < 768 ? 'listMonth' : 'dayGridMonth', locale: 'fr',
        weekNumbers: true, weekText: 'S', dayMaxEvents: 2, moreLinkClick: 'listDay',    
        headerToolbar: { left: 'prev,next today', center: 'title', right: window.innerWidth < 768 ? '' : 'dayGridMonth,listDay' },
        buttonText: { today: "Aujourd'hui", month: 'Mois', list: 'Jour' }, height: '100%', events: [],
        eventClick: function(info) { ouvrirActionModal(info.event); },
        dateClick: function(info) { fullCalendarInstance.changeView('listDay', info.dateStr); }
    });
    fullCalendarInstance.render();
}

function updateCalendarEvents() {
    if (!fullCalendarInstance) return; fullCalendarInstance.removeAllEvents();
    const todayStr = new Date().toISOString().split('T')[0]; const preventifDates = new Set();
    
    allInterventions.forEach(data => {
        if (currentClientFilter !== "ALL" && data.client !== currentClientFilter) return;
        if (currentTypeFilter !== "ALL" && data.type !== currentTypeFilter) return;
        
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
// MODAL D'ACTION ET SUPPRESSION RADICALE
// ==========================================
const actionModal = document.getElementById('eventActionModal');

window.ouvrirActionModal = function(eventOrId) {
    let id, props, title, dateVal;
    if (typeof eventOrId === 'string') {
        const intData = allInterventions.find(i => i.id === eventOrId); if(!intData) return;
        id = intData.id; props = { client: intData.client, machine: intData.machine, statut: intData.statut, frequence: intData.frequence || 'Ponctuel', type: intData.type }; title = intData.machine;
    } else { 
        if(eventOrId.display === 'background') return;
        id = eventOrId.id; props = eventOrId.extendedProps; title = props.machine; 
    }

    const exactData = allInterventions.find(i => i.id === id); if(exactData) dateVal = exactData.date;

    document.getElementById('actionModalTitle').textContent = title; document.getElementById('actionModalSub').textContent = `${props.client} | ${props.frequence}`;
    document.getElementById('actionEventId').value = id; document.getElementById('actionEventDate').value = dateVal || ""; document.getElementById('actionEventClient').value = props.client; document.getElementById('actionEventType').value = props.type;
    
    document.getElementById('btnSetEnCours').style.display = (props.statut === "Planifié") ? "block" : "none"; document.getElementById('btnSetTermine').style.display = (props.statut !== "Terminé") ? "block" : "none";
    
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
        const btnDeleteGroup = document.getElementById('btnDeleteGroup'); const originalHtml = btnDeleteGroup.innerHTML;
        btnDeleteGroup.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Nettoyage...'; btnDeleteGroup.disabled = true;
        try { const toDelete = allInterventions.filter(i => i.client === client && i.date === date && i.type === type); for (const intv of toDelete) { await deleteDoc(doc(db, "interventions", intv.id)); }
        } catch (err) { console.error(err); alert("Erreur."); } finally { btnDeleteGroup.innerHTML = originalHtml; btnDeleteGroup.disabled = false; fermerActionModal(); }
    }
});

document.getElementById('btnSetEnCours').addEventListener('click', async () => { await updateDoc(doc(db, "interventions", document.getElementById('actionEventId').value), { statut: "En cours" }); fermerActionModal(); });

document.getElementById('btnSetTermine').addEventListener('click', async () => {
    const btnTermine = document.getElementById('btnSetTermine'); const originalContent = btnTermine.innerHTML;
    btnTermine.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Traitement...'; btnTermine.disabled = true;
    const id = document.getElementById('actionEventId').value; const interventionData = allInterventions.find(i => i.id === id);
    if (!interventionData) { fermerActionModal(); return; }
    try {
        let alertMessage = ""; const theKit = kitsDB[interventionData.client + "_" + interventionData.machine];
        if (interventionData.type === "Préventif" && theKit && theKit.pieces.length > 0) {
            for (const p of theKit.pieces) { await updateDoc(doc(db, "stock", p.idPiece), { qte: increment(-p.qte) }); }
            alertMessage = "\n\n📦 Les pièces ont été déduites du stock central de l'atelier !";
        }
        await updateDoc(doc(db, "interventions", id), { statut: "Terminé" });
        const freq = interventionData.frequence || "Ponctuel";
        if (freq !== "Ponctuel") {
            const dateObj = new Date(interventionData.date);
            if (freq === "Mensuel") dateObj.setMonth(dateObj.getMonth() + 1); else if (freq === "Trimestriel") dateObj.setMonth(dateObj.getMonth() + 3); else if (freq === "Semestriel") dateObj.setMonth(dateObj.getMonth() + 6); else if (freq === "Annuel") dateObj.setFullYear(dateObj.getFullYear() + 1);
            const nouvelleDateStr = dateObj.toISOString().split('T')[0];
            await addDoc(collection(db, "interventions"), { client: interventionData.client, machine: interventionData.machine, date: nouvelleDateStr, type: interventionData.type, technicien: interventionData.technicien, statut: "Planifié", frequence: freq, timestamp: serverTimestamp() });
            alert(`Intervention clôturée. Prochaine maintenance prévue le ${nouvelleDateStr}.` + alertMessage);
        } else { alert("Intervention clôturée avec succès." + alertMessage); }
    } catch (e) { console.error(e); alert("Une erreur s'est produite."); } finally { btnTermine.innerHTML = originalContent; btnTermine.disabled = false; fermerActionModal(); }
});


// ==========================================
// SYNCHRO & TABLEAU DE BORD (GROUPÉ PAR CLIENT)
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
        const cardHTML = `
            <div class="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden flex items-center justify-between hover:shadow-md transition-shadow cursor-pointer" onclick="ouvrirModalGroupe('${key}')">
                <div class="w-2 self-stretch border-l-4" style="background-color: ${group.config.bg}; border-color: ${group.config.border};"></div>
                <div class="p-4 flex-1 flex items-center justify-between">
                    <div>
                        <div class="flex items-center gap-2 mb-1"><h3 class="font-bold text-slate-800 text-base uppercase">${group.client}</h3>${group.isRetard ? '<span class="text-red-500 font-bold text-xs"><i class="fa-solid fa-triangle-exclamation"></i></span>' : ''}</div>
                        <p class="text-sm text-slate-600 font-medium"><i class="fa-solid fa-microchip mr-1 text-slate-400"></i> ${group.machines.length} machine(s) prévue(s)</p>
                        <p class="text-xs text-slate-500 mt-1"><i class="fa-solid fa-calendar-day mr-1"></i> ${group.dateAffichee} &nbsp;|&nbsp; <i class="fa-solid fa-wrench mr-1"></i> ${group.type}</p>
                    </div>
                    <div class="px-3 py-1.5 rounded-lg text-xs font-bold uppercase" style="background-color: ${group.config.bg}; color: ${group.config.text}; border-color: ${group.config.border}; border-width: 1px;">${group.statut}</div>
                </div>
            </div>`;
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

// PWA
if ('serviceWorker' in navigator) { window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(err => console.error('Erreur SW', err)); }); }