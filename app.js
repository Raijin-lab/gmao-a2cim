import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, collection, addDoc, deleteDoc, updateDoc, doc, onSnapshot, query, orderBy, serverTimestamp, arrayUnion, arrayRemove } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

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
let currentTypeFilter = "ALL"; // Nouveau filtre Type

// --- GESTION DU CODE PIN ---
const CORRECT_PIN = "A2CIM2026";
if (document.getElementById('pinForm')) {
    document.getElementById('pinForm').addEventListener('submit', (e) => {
        e.preventDefault();
        if (document.getElementById('pinInput').value.trim() === CORRECT_PIN) {
            const lock = document.getElementById('lockScreen');
            lock.classList.add('opacity-0'); setTimeout(() => lock.remove(), 300);
        } else {
            document.getElementById('pinError').classList.remove('hidden');
        }
    });
}

// ==========================================
// MOTEUR PARC CLIENTS (SYNCHRO FIREBASE)
// ==========================================
const qClients = query(collection(db, "clients"), orderBy("nom", "asc"));

onSnapshot(qClients, (snapshot) => {
    const parcContainer = document.getElementById('parc-container');
    const formClientSelect = document.getElementById('formClient');
    const calendarFilter = document.getElementById('calendarClientFilter');
    
    if (parcContainer) parcContainer.innerHTML = '';
    
    const currentClientSelection = formClientSelect ? formClientSelect.value : "";
    const currentFilterSelection = calendarFilter ? calendarFilter.value : "ALL";

    if (formClientSelect) formClientSelect.innerHTML = '<option value="" disabled selected>Sélectionner...</option>';
    if (calendarFilter) calendarFilter.innerHTML = '<option value="ALL">Tous les clients</option>';
    
    parcClientsDB = {};

    if (snapshot.empty) {
        if (parcContainer) parcContainer.innerHTML = '<p class="text-slate-500 col-span-full">Aucun client. Ajoutez-en un au-dessus.</p>';
        return;
    }

    snapshot.forEach(docSnap => {
        const data = docSnap.data();
        const docId = docSnap.id;
        const machines = data.machines || [];
        
        parcClientsDB[data.nom] = { id: docId, machines: machines };

        if (formClientSelect) formClientSelect.innerHTML += `<option value="${data.nom}">${data.nom}</option>`;
        if (calendarFilter) calendarFilter.innerHTML += `<option value="${data.nom}">${data.nom}</option>`;

        let machinesListHTML = '';
        if (machines.length === 0) {
            machinesListHTML = '<p class="text-xs text-slate-400 italic mb-2">Aucune machine.</p>';
        } else {
            machines.forEach(m => {
                machinesListHTML += `
                <div class="flex items-center justify-between bg-slate-50 px-3 py-2 rounded-lg mb-2 border border-slate-100">
                    <span class="text-sm text-slate-700 font-medium"><i class="fa-solid fa-microchip text-slate-400 mr-2"></i>${m}</span>
                    <button onclick="supprimerMachineParc('${docId}', '${m}')" class="text-slate-300 hover:text-red-500"><i class="fa-solid fa-xmark"></i></button>
                </div>`;
            });
        }

        if (parcContainer) {
            parcContainer.innerHTML += `
            <div class="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden flex flex-col relative">
                <button onclick="supprimerClientParc('${docId}')" class="absolute top-4 right-4 text-slate-300 hover:text-red-500"><i class="fa-solid fa-trash-can"></i></button>
                <div class="p-5 border-b border-slate-100 bg-brand-50">
                    <h3 class="text-lg font-bold text-brand-900"><i class="fa-solid fa-building mr-2 text-brand-500"></i>${data.nom}</h3>
                </div>
                <div class="p-5 flex-1">
                    <div class="mb-4">${machinesListHTML}</div>
                    <form onsubmit="ajouterMachineParc(event, '${docId}')" class="flex gap-2">
                        <input type="text" id="machineInput_${docId}" placeholder="Nom machine..." required class="flex-1 px-3 py-1.5 text-sm border rounded-lg focus:ring-2 focus:ring-brand-500">
                        <button type="submit" class="bg-slate-800 text-white px-3 py-1.5 rounded-lg text-sm hover:bg-slate-700"><i class="fa-solid fa-plus"></i></button>
                    </form>
                </div>
            </div>`;
        }
    });

    if (formClientSelect && parcClientsDB[currentClientSelection]) formClientSelect.value = currentClientSelection;
    if (calendarFilter) calendarFilter.value = currentFilterSelection;
});

const formClientSelect = document.getElementById('formClient');
const formMachineSelect = document.getElementById('formMachine');

if (formClientSelect && formMachineSelect) {
    formClientSelect.addEventListener('change', (e) => {
        const nomClient = e.target.value;
        formMachineSelect.innerHTML = '<option value="" disabled selected>Sélectionner machine...</option>';
        if (parcClientsDB[nomClient]) {
            parcClientsDB[nomClient].machines.forEach(m => {
                formMachineSelect.innerHTML += `<option value="${m}">${m}</option>`;
            });
        }
    });
}

// Fonctions CRUD du Parc
window.ajouterMachineParc = async function(e, docId) {
    e.preventDefault();
    const input = document.getElementById(`machineInput_${docId}`);
    const nomMachine = input.value.trim();
    if (!nomMachine) return;
    await updateDoc(doc(db, "clients", docId), { machines: arrayUnion(nomMachine) });
    input.value = '';
};
window.supprimerMachineParc = async function(docId, nomMachine) {
    if (confirm(`Supprimer la machine "${nomMachine}" ?`)) await updateDoc(doc(db, "clients", docId), { machines: arrayRemove(nomMachine) });
};
window.supprimerClientParc = async function(docId) {
    if (confirm(`Attention : supprimer ce client et toute sa liste de machines ?`)) await deleteDoc(doc(db, "clients", docId));
};
if (document.getElementById('formAddClient')) {
    document.getElementById('formAddClient').addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = document.getElementById('newClientName');
        const nom = input.value.trim();
        if (!nom) return;
        await addDoc(collection(db, "clients"), { nom: nom, machines: [] });
        input.value = '';
    });
}
// ==========================================


// --- CONFIG STATUTS ---
const statusConfig = {
    "En retard": { bg: "#fef2f2", border: "#ef4444", text: "#b91c1c", color: "#ef4444" },
    "En cours": { bg: "#fff7ed", border: "#f97316", text: "#c2410c", color: "#f97316" },
    "Planifié": { bg: "#eff6ff", border: "#3b82f6", text: "#1d4ed8", color: "#3b82f6" },
    "Terminé": { bg: "#f0fdf4", border: "#22c55e", text: "#15803d", color: "#22c55e" }
};

// --- CALENDRIER GLOBAL ---
function initCalendar() {
    const calendarEl = document.getElementById('calendar');
    if (!calendarEl) return;
    if (fullCalendarInstance) fullCalendarInstance.destroy();

    fullCalendarInstance = new FullCalendar.Calendar(calendarEl, {
        initialView: window.innerWidth < 768 ? 'listMonth' : 'dayGridMonth',
        locale: 'fr',
        headerToolbar: { left: 'prev,next today', center: 'title', right: window.innerWidth < 768 ? '' : 'dayGridMonth,timeGridWeek,listMonth' },
        buttonText: { today: "Aujourd'hui", month: 'Mois', week: 'Semaine', list: 'Liste' },
        height: '100%',
        events: [],
        eventClick: function(info) { ouvrirActionModal(info.event); }
    });
    fullCalendarInstance.render();
}

function updateCalendarEvents() {
    if (!fullCalendarInstance) return;
    fullCalendarInstance.removeAllEvents();
    
    allInterventions.forEach(data => {
        // FILTRES (On affiche TOUT, sauf si l'utilisateur filtre exprès)
        if (currentClientFilter !== "ALL" && data.client !== currentClientFilter) return;
        if (currentTypeFilter !== "ALL" && data.type !== currentTypeFilter) return;
        
        // COULEURS ET TITRES
        let eventColor = statusConfig[data.statut]?.color || "#3b82f6"; // Par défaut, bleu
        // Si c'est une urgence curative qui n'est pas encore terminée, on la force en rouge vif
        if (data.statut === "Planifié" && data.type === "Curatif") eventColor = "#dc2626";
        
        // Icône visuelle dans le calendrier
        let eventTitle = data.type === "Curatif" ? `🚨 ${data.machine}` : `🔧 ${data.machine}`;

        fullCalendarInstance.addEvent({
            id: data.id, 
            title: eventTitle, 
            start: data.date,
            backgroundColor: eventColor, 
            borderColor: eventColor,
            extendedProps: { client: data.client, statut: data.statut, frequence: data.frequence || 'Ponctuel', type: data.type, machine: data.machine, technicien: data.technicien }
        });
    });
}

// Écouteurs de filtres Calendrier
const clientFilterSelect = document.getElementById('calendarClientFilter');
if (clientFilterSelect) {
    clientFilterSelect.addEventListener('change', (e) => { currentClientFilter = e.target.value; updateCalendarEvents(); });
}
const typeFilterSelect = document.getElementById('calendarTypeFilter');
if (typeFilterSelect) {
    typeFilterSelect.addEventListener('change', (e) => { currentTypeFilter = e.target.value; updateCalendarEvents(); });
}

document.addEventListener('DOMContentLoaded', initCalendar);

// --- MODAL ACTION (CALENDRIER) ---
const actionModal = document.getElementById('eventActionModal');
function ouvrirActionModal(event) {
    const props = event.extendedProps;
    document.getElementById('actionModalTitle').textContent = event.title;
    document.getElementById('actionModalSub').textContent = `${props.client} | ${props.frequence}`;
    document.getElementById('actionEventId').value = event.id;
    document.getElementById('btnSetEnCours').style.display = (props.statut === "Planifié") ? "block" : "none";
    document.getElementById('btnSetTermine').style.display = (props.statut !== "Terminé") ? "block" : "none";
    actionModal.classList.remove('hidden'); actionModal.classList.add('flex');
}
function fermerActionModal() { actionModal.classList.add('hidden'); actionModal.classList.remove('flex'); }

document.getElementById('btnCloseActionModal').addEventListener('click', fermerActionModal);
document.getElementById('btnDeleteEvent').addEventListener('click', async () => {
    const id = document.getElementById('actionEventId').value;
    if (confirm("Supprimer l'intervention ?")) { await deleteDoc(doc(db, "interventions", id)); fermerActionModal(); }
});
document.getElementById('btnSetEnCours').addEventListener('click', async () => {
    const id = document.getElementById('actionEventId').value;
    await updateDoc(doc(db, "interventions", id), { statut: "En cours" }); fermerActionModal();
});

// --- MOTEUR RÉCURRENCE CONTRAT ---
function calculerProchaineDate(dateInitiale, frequence) {
    const dateObj = new Date(dateInitiale);
    if (frequence === "Mensuel") dateObj.setMonth(dateObj.getMonth() + 1);
    else if (frequence === "Trimestriel") dateObj.setMonth(dateObj.getMonth() + 3);
    else if (frequence === "Semestriel") dateObj.setMonth(dateObj.getMonth() + 6);
    else if (frequence === "Annuel") dateObj.setFullYear(dateObj.getFullYear() + 1);
    return dateObj.toISOString().split('T')[0];
}

document.getElementById('btnSetTermine').addEventListener('click', async () => {
    const id = document.getElementById('actionEventId').value;
    const interventionData = allInterventions.find(i => i.id === id);
    if (!interventionData) return fermerActionModal();

    await updateDoc(doc(db, "interventions", id), { statut: "Terminé" });

    const freq = interventionData.frequence || "Ponctuel";
    if (freq !== "Ponctuel") {
        const nouvelleDateStr = calculerProchaineDate(interventionData.date, freq);
        
        await addDoc(collection(db, "interventions"), {
            client: interventionData.client, 
            machine: interventionData.machine,
            date: nouvelleDateStr, 
            type: interventionData.type,
            technicien: interventionData.technicien, 
            statut: "Planifié", 
            frequence: freq,
            timestamp: serverTimestamp()
        });
        alert(`La prochaine maintenance (${freq}) a été programmée pour le ${nouvelleDateStr}.`);
    }
    fermerActionModal();
});

// --- SYNCHRONISATION INTERVENTIONS ---
const q = query(collection(db, "interventions"), orderBy("date", "asc"));
onSnapshot(q, (snapshot) => {
    const dashboardContainer = document.getElementById('tasks-container');
    const curatifContainer = document.getElementById('curatif-container');
    
    if (dashboardContainer) dashboardContainer.innerHTML = '';
    if (curatifContainer) curatifContainer.innerHTML = '';
    
    allInterventions = [];
    let activeTotalCount = 0; let retardCount = 0; let enCoursCount = 0;

    snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        data.id = docSnap.id;
        allInterventions.push(data);

        if (data.statut === "Terminé") return;
        activeTotalCount++;
        if (data.statut === "En retard") retardCount++;
        if (data.statut === "En cours") enCoursCount++;

        const dateAffichee = data.date ? new Date(data.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
        const config = statusConfig[data.statut] || statusConfig["Planifié"];
        const initialTech = data.technicien ? data.technicien.charAt(0).toUpperCase() : '?';
        const badgeFrequence = data.frequence && data.frequence !== "Ponctuel" ? `<span class="ml-2 text-[9px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded border border-slate-200"><i class="fa-solid fa-rotate mr-1"></i>${data.frequence}</span>` : '';
        const badgeCuratif = data.type === "Curatif" ? `<span class="ml-2 text-[9px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded border border-red-200 font-bold">URGENCE</span>` : '';
        
        const cardHTML = `
            <div class="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden flex items-center justify-between hover:shadow-md transition-shadow">
                <div class="flex items-center flex-1">
                    <div class="w-2 self-stretch border-l-4" style="background-color: ${config.bg}; border-color: ${config.border};"></div>
                    <div class="p-4 flex-1 flex flex-col sm:flex-row sm:items-center justify-between">
                        <div class="mb-3 sm:mb-0">
                            <div class="flex items-center flex-wrap gap-1 mb-1">
                                <span class="text-xs font-bold text-slate-500 uppercase">${data.client}</span>
                                <span class="w-1 h-1 rounded-full bg-slate-300 mx-1"></span>
                                <span class="text-xs text-slate-500 font-medium">${dateAffichee}</span>
                                ${badgeFrequence} ${badgeCuratif}
                            </div>
                            <h3 class="font-bold text-slate-800 text-sm md:text-base">${data.machine}</h3>
                            <p class="text-xs text-slate-500 mt-1"><i class="fa-solid fa-wrench mr-1"></i> ${data.type}</p>
                        </div>
                        <div class="flex items-center space-x-4">
                            <div class="w-6 h-6 rounded-full bg-slate-200 flex items-center justify-center text-[10px] font-bold text-slate-600">${initialTech}</div>
                            <div class="px-2.5 py-1 rounded-md flex items-center space-x-1 text-[10px] font-bold uppercase tracking-wider border border-opacity-20" style="background-color: ${config.bg}; color: ${config.text}; border-color: ${config.border};">
                                <span>${data.statut}</span>
                            </div>
                        </div>
                    </div>
                </div>
                <button onclick="supprimerInterventionList('${data.id}')" class="p-4 text-slate-300 hover:text-red-500 transition-colors"><i class="fa-solid fa-trash-can text-base"></i></button>
            </div>
        `;

        if (dashboardContainer) dashboardContainer.innerHTML += cardHTML;
        if (data.type === "Curatif" && curatifContainer) curatifContainer.innerHTML += cardHTML;
    });

    if (document.getElementById('kpi-total')) document.getElementById('kpi-total').textContent = activeTotalCount;
    if (document.getElementById('kpi-retard')) document.getElementById('kpi-retard').textContent = retardCount;
    if (document.getElementById('kpi-encours')) document.getElementById('kpi-encours').textContent = enCoursCount;
    if (document.getElementById('kpi-taux')) document.getElementById('kpi-taux').textContent = activeTotalCount > 0 ? "100%" : "0%";
    
    updateCalendarEvents();
});

// --- AJOUT INTERVENTION ---
const modal = document.getElementById('addInterventionModal');
const formType = document.getElementById('formType');
const freqContainer = document.getElementById('frequenceContainer');

if(formType && freqContainer) {
    formType.addEventListener('change', (e) => {
        if(e.target.value === 'Curatif') {
            freqContainer.style.display = 'none'; document.getElementById('formFrequence').value = 'Ponctuel';
        } else { freqContainer.style.display = 'block'; }
    });
}

function openModal() { 
    if (modal) { 
        const activeView = Array.from(document.querySelectorAll('.app-view')).find(v => !v.classList.contains('hidden'))?.id;
        if (activeView === 'view-curatif') {
            formType.value = "Curatif"; freqContainer.style.display = "none"; document.getElementById('formFrequence').value = "Ponctuel";
        } else {
            formType.value = "Préventif"; freqContainer.style.display = "block";
        }
        modal.classList.remove('hidden'); modal.classList.add('flex'); 
    } 
}
function closeModal() { if (modal) { modal.classList.add('hidden'); modal.classList.remove('flex'); } }
if(document.getElementById('addInterventionBtn')) document.getElementById('addInterventionBtn').addEventListener('click', openModal);
if(document.getElementById('closeModalBtn')) document.getElementById('closeModalBtn').addEventListener('click', closeModal);
if(document.getElementById('cancelModalBtn')) document.getElementById('cancelModalBtn').addEventListener('click', closeModal);

if(document.getElementById('addInterventionForm')) {
    document.getElementById('addInterventionForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        await addDoc(collection(db, "interventions"), {
            client: document.getElementById('formClient').value,
            machine: document.getElementById('formMachine').value,
            date: document.getElementById('formDate').value,
            type: formType.value, 
            technicien: document.getElementById('formTech').value,
            statut: "Planifié", 
            frequence: document.getElementById('formFrequence').value,
            timestamp: serverTimestamp()
        });
        e.target.reset();
        document.getElementById('formMachine').innerHTML = '<option value="" disabled selected>Choisir un client d\'abord</option>';
        closeModal();
    });
}

window.supprimerInterventionList = async function(id) { if (confirm("Voulez-vous vraiment supprimer ?")) await deleteDoc(doc(db, "interventions", id)); };

// Navigation
const navLinks = document.querySelectorAll('.nav-link');
const appViews = document.querySelectorAll('.app-view');
navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        const targetView = link.getAttribute('data-view');
        appViews.forEach(view => view.classList.add('hidden'));
        document.getElementById(`view-${targetView}`).classList.remove('hidden');
        if (targetView === 'planning' && fullCalendarInstance) setTimeout(() => { fullCalendarInstance.render(); }, 100);
        navLinks.forEach(l => { l.classList.remove('bg-brand-800', 'text-white'); l.classList.add('text-slate-400'); });
        document.querySelectorAll(`[data-view="${targetView}"]`).forEach(activeL => { activeL.classList.add('bg-brand-800', 'text-white'); activeL.classList.remove('text-slate-400'); });
    });
});

// Docs (Base PDF - Restaurée Intégralement)
const providerDocs = {
    "hypertherm": [{ name: "Manuel XPR170", file: "XPR170_MANUAL_EN.pdf" }, { name: "Schéma Électrique", file: "schema-electrique.pdf" }, { name: "MAXPRO200", file: "MAXPRO200 Instruction Manual .pdf" }],
    "beckhoff": [],
    "cybelec": [],
    "messer": [],
    "soprolec": [],
    "fiessler": [],
    "gullco": [],
    "sturmer": [],
    "euroboor": [],
    "behringer": [],
    "picot": [],
    "dimeco": [],
    "cesurbend": [],
    "baisheng": [],
    "ermaksan": [],
    "vernet": []
};

const docsModal = document.getElementById('docsModal');
if (document.getElementById('closeDocsModal')) document.getElementById('closeDocsModal').addEventListener('click', () => { docsModal.classList.add('hidden'); });
document.querySelectorAll('.doc-folder').forEach(folder => {
    folder.addEventListener('click', () => {
        const folderName = folder.getAttribute('data-folder');
        const files = providerDocs[folderName] || [];
        if (files.length === 0) return alert(`Aucun document PDF.`);
        document.getElementById('docsModalTitle').textContent = `Documents - ${folderName.toUpperCase()}`;
        const container = document.getElementById('docsListContainer');
        container.innerHTML = '';
        files.forEach(docObj => {
            container.innerHTML += `<a href="docs/${folderName}/${docObj.file}" target="_blank" class="flex p-3 mb-2 bg-slate-50 border rounded-xl">${docObj.name}</a>`;
        });
        docsModal.classList.remove('hidden'); docsModal.classList.add('flex');
    });
});

// --- ENREGISTREMENT DU SERVICE WORKER (PWA) ---
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => reg.update())
            .catch(err => console.error('Erreur Service Worker', err));
    });
}
