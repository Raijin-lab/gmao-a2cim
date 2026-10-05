import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, collection, addDoc, deleteDoc, updateDoc, doc, onSnapshot, query, orderBy, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

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

// Variables Globales pour stocker les données brutes
let allInterventions = [];
let fullCalendarInstance = null;
let currentClientFilter = "ALL";

// Config des statuts (Couleurs pour FullCalendar)
const statusConfig = {
    "En retard": { bg: "#fef2f2", border: "#ef4444", text: "#b91c1c", color: "#ef4444" },
    "En cours": { bg: "#fff7ed", border: "#f97316", text: "#c2410c", color: "#f97316" },
    "Planifié": { bg: "#eff6ff", border: "#3b82f6", text: "#1d4ed8", color: "#3b82f6" },
    "Terminé": { bg: "#f0fdf4", border: "#22c55e", text: "#15803d", color: "#22c55e" }
};

// --- INITIALISATION DE FULLCALENDAR ---
function initCalendar() {
    const calendarEl = document.getElementById('calendar');
    if (!calendarEl) return;
    
    // Si le calendrier existe déjà, on le détruit pour le recréer proprement
    if (fullCalendarInstance) {
        fullCalendarInstance.destroy();
    }

    fullCalendarInstance = new FullCalendar.Calendar(calendarEl, {
        initialView: window.innerWidth < 768 ? 'listMonth' : 'dayGridMonth',
        locale: 'fr',
        headerToolbar: {
            left: 'prev,next today',
            center: 'title',
            right: window.innerWidth < 768 ? '' : 'dayGridMonth,timeGridWeek,listMonth'
        },
        buttonText: { today: "Aujourd'hui", month: 'Mois', week: 'Semaine', list: 'Liste' },
        height: '100%',
        events: [], // Sera rempli par Firebase
        eventClick: function(info) {
            ouvrirActionModal(info.event);
        }
    });
    fullCalendarInstance.render();
}

// Mettre à jour les événements du calendrier
function updateCalendarEvents() {
    if (!fullCalendarInstance) return;
    
    // On efface les anciens événements
    fullCalendarInstance.removeAllEvents();
    
    // On ajoute les nouveaux (filtrés)
    allInterventions.forEach(data => {
        // Filtre client
        if (currentClientFilter !== "ALL" && data.client !== currentClientFilter) return;
        
        // On ne montre pas les "Terminés" sur le dashboard, mais on peut les laisser sur le calendrier pour historique
        // (Ici on les laisse sur le calendrier pour voir qu'on a bien fait le boulot)
        
        const eventConfig = statusConfig[data.statut] || statusConfig["Planifié"];
        
        fullCalendarInstance.addEvent({
            id: data.id,
            title: `${data.machine} (${data.type})`,
            start: data.date,
            backgroundColor: eventConfig.color,
            borderColor: eventConfig.color,
            extendedProps: {
                client: data.client,
                statut: data.statut,
                frequence: data.frequence || 'Ponctuel',
                type: data.type,
                machine: data.machine,
                technicien: data.technicien
            }
        });
    });
}

// Écouteur sur le filtre client
const clientFilterSelect = document.getElementById('calendarClientFilter');
if (clientFilterSelect) {
    clientFilterSelect.addEventListener('change', (e) => {
        currentClientFilter = e.target.value;
        updateCalendarEvents();
    });
}

// On initialise le calendrier au démarrage
document.addEventListener('DOMContentLoaded', initCalendar);


// --- MODAL ACTION SUR EVENEMENT ---
const actionModal = document.getElementById('eventActionModal');
const btnCloseAction = document.getElementById('btnCloseActionModal');
const btnSetEnCours = document.getElementById('btnSetEnCours');
const btnSetTermine = document.getElementById('btnSetTermine');
const btnDeleteEvent = document.getElementById('btnDeleteEvent');

function ouvrirActionModal(event) {
    const props = event.extendedProps;
    document.getElementById('actionModalTitle').textContent = event.title;
    document.getElementById('actionModalSub').textContent = `${props.client} | ${props.frequence}`;
    document.getElementById('actionEventId').value = event.id;
    document.getElementById('actionEventFrequence').value = props.frequence;
    
    // Cache les boutons inutiles selon le statut actuel
    btnSetEnCours.style.display = (props.statut === "Planifié") ? "flex" : "none";
    btnSetTermine.style.display = (props.statut !== "Terminé") ? "flex" : "none";

    actionModal.classList.remove('hidden');
    actionModal.classList.add('flex');
}

function fermerActionModal() {
    actionModal.classList.add('hidden');
    actionModal.classList.remove('flex');
}

if (btnCloseAction) btnCloseAction.addEventListener('click', fermerActionModal);

// Supprimer depuis le calendrier
if (btnDeleteEvent) {
    btnDeleteEvent.addEventListener('click', async () => {
        const id = document.getElementById('actionEventId').value;
        if (confirm("Voulez-vous vraiment supprimer cette intervention du calendrier ?")) {
            await deleteDoc(doc(db, "interventions", id));
            fermerActionModal();
        }
    });
}

// Passer en cours
if (btnSetEnCours) {
    btnSetEnCours.addEventListener('click', async () => {
        const id = document.getElementById('actionEventId').value;
        await updateDoc(doc(db, "interventions", id), { statut: "En cours" });
        fermerActionModal();
    });
}

// --- LE MOTEUR INTELLIGENT DE RÉCURRENCE ---
function calculerProchaineDate(dateInitiale, frequence) {
    const dateObj = new Date(dateInitiale);
    if (frequence === "Mensuel") dateObj.setMonth(dateObj.getMonth() + 1);
    else if (frequence === "Trimestriel") dateObj.setMonth(dateObj.getMonth() + 3);
    else if (frequence === "Semestriel") dateObj.setMonth(dateObj.getMonth() + 6);
    else if (frequence === "Annuel") dateObj.setFullYear(dateObj.getFullYear() + 1);
    
    return dateObj.toISOString().split('T')[0]; // Format YYYY-MM-DD
}

if (btnSetTermine) {
    btnSetTermine.addEventListener('click', async () => {
        const id = document.getElementById('actionEventId').value;
        
        // 1. On récupère les données exactes de l'intervention actuelle dans notre tableau global
        const interventionData = allInterventions.find(i => i.id === id);
        
        if (!interventionData) return fermerActionModal();

        // 2. On met à jour le statut de l'intervention actuelle à "Terminé"
        btnSetTermine.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Traitement...';
        await updateDoc(doc(db, "interventions", id), { statut: "Terminé" });

        // 3. LA MAGIE DE LA RÉCURRENCE : On vérifie si c'est un contrat
        const freq = interventionData.frequence || "Ponctuel";
        if (freq !== "Ponctuel") {
            const nouvelleDateStr = calculerProchaineDate(interventionData.date, freq);
            
            // Création automatique de la prochaine intervention du contrat
            await addDoc(collection(db, "interventions"), {
                client: interventionData.client,
                machine: interventionData.machine,
                date: nouvelleDateStr,
                type: interventionData.type,
                technicien: interventionData.technicien,
                frequence: freq,
                statut: "Planifié", // La nouvelle sera en statut Planifié
                timestamp: serverTimestamp()
            });
            
            alert(`Succès ! L'intervention est terminée.\nUne nouvelle intervention automatique a été générée pour le contrat ${freq} au ${nouvelleDateStr}.`);
        } else {
            alert(`Intervention ponctuelle terminée avec succès !`);
        }
        
        btnSetTermine.innerHTML = `<span class="relative z-10"><i class="fa-solid fa-check-double mr-2"></i> Terminer l'intervention</span><div class="absolute inset-0 bg-green-400 opacity-0 group-hover:opacity-20 transition-opacity"></div>`;
        fermerActionModal();
    });
}


// --- SYNCHRONISATION PRINCIPALE FIREBASE ---
const q = query(collection(db, "interventions"), orderBy("date", "asc"));
onSnapshot(q, (snapshot) => {
    const dashboardContainer = document.getElementById('tasks-container');
    const curatifContainer = document.getElementById('curatif-container');
    
    if (dashboardContainer) dashboardContainer.innerHTML = '';
    if (curatifContainer) curatifContainer.innerHTML = '';
    
    // On vide le tableau global
    allInterventions = [];
    
    let activeTotalCount = 0; // On ne compte pas les "Terminés" dans les KPIs "À faire"
    let retardCount = 0;
    let enCoursCount = 0;

    snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        data.id = docSnap.id;
        allInterventions.push(data); // On sauvegarde tout pour le calendrier

        // Pour la liste Dashboard et Curatif, on exclut les Terminé pour garder la liste propre
        if (data.statut === "Terminé") return;

        activeTotalCount++;
        if (data.statut === "En retard") retardCount++;
        if (data.statut === "En cours") enCoursCount++;

        let dateAffichee = data.date;
        if(data.date) {
            const dateObj = new Date(data.date);
            dateAffichee = dateObj.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
        }

        // --- GÉNÉRATION HTML DES CARTES ---
        const config = statusConfig[data.statut] || statusConfig["Planifié"];
        const initialTech = data.technicien ? data.technicien.charAt(0).toUpperCase() : '?';
        const badgeFrequence = data.frequence && data.frequence !== "Ponctuel" ? `<span class="ml-2 text-[9px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded border border-slate-200"><i class="fa-solid fa-rotate mr-1"></i>${data.frequence}</span>` : '';
        
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
                                ${badgeFrequence}
                            </div>
                            <h3 class="font-bold text-slate-800 text-sm md:text-base">${data.machine}</h3>
                            <p class="text-xs text-slate-500 mt-1"><i class="fa-solid fa-wrench mr-1"></i> ${data.type}</p>
                        </div>
                        <div class="flex items-center space-x-4">
                            <div class="flex items-center space-x-2">
                                <div class="w-6 h-6 rounded-full bg-slate-200 flex items-center justify-center text-[10px] font-bold text-slate-600">${initialTech}</div>
                            </div>
                            <div class="px-2.5 py-1 rounded-md flex items-center space-x-1 text-[10px] font-bold uppercase tracking-wider border border-opacity-20" style="background-color: ${config.bg}; color: ${config.text}; border-color: ${config.border};">
                                <span>${data.statut}</span>
                            </div>
                        </div>
                    </div>
                </div>
                <button onclick="supprimerInterventionList('${data.id}')" class="p-4 text-slate-300 hover:text-red-500 transition-colors">
                    <i class="fa-solid fa-trash-can text-base"></i>
                </button>
            </div>
        `;

        if (dashboardContainer) dashboardContainer.innerHTML += cardHTML;
        if (data.type === "Curatif" && curatifContainer) {
            curatifContainer.innerHTML += cardHTML;
        }
    });

    if (activeTotalCount === 0 && dashboardContainer) dashboardContainer.innerHTML = '<p class="text-center text-slate-500 py-4">Aucune intervention active (Toutes terminées ou vide).</p>';
    if (curatifContainer && curatifContainer.innerHTML === '') curatifContainer.innerHTML = '<p class="text-center text-slate-500 py-4">Aucune intervention curative active.</p>';

    updateKPIs(activeTotalCount, retardCount, enCoursCount);
    
    // On déclenche la mise à jour du FullCalendar
    updateCalendarEvents();
});

// --- AJOUTER UNE INTERVENTION ---
const addForm = document.getElementById('addInterventionForm');
if (addForm) {
    addForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btnSubmit = document.getElementById('btnSubmit');
        if (btnSubmit) btnSubmit.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Enregistrement...';
        
        try {
            await addDoc(collection(db, "interventions"), {
                client: document.getElementById('formClient').value,
                machine: document.getElementById('formMachine').value,
                date: document.getElementById('formDate').value,
                type: document.getElementById('formType').value,
                technicien: document.getElementById('formTech').value,
                frequence: document.getElementById('formFrequence').value,
                statut: "Planifié",
                timestamp: serverTimestamp()
            });
            
            addForm.reset();
            closeModal();
            if (btnSubmit) btnSubmit.innerHTML = '<i class="fa-solid fa-save mr-2"></i> Enregistrer';
        } catch (error) {
            console.error("Erreur Firebase:", error);
            alert("Erreur d'enregistrement.");
        }
    });
}

// Fonction de suppression depuis la liste
window.supprimerInterventionList = async function(id) {
    if (confirm("Voulez-vous vraiment supprimer cette intervention ?")) {
        await deleteDoc(doc(db, "interventions", id));
    }
};


// --- LE RESTE DU CODE (PIN, Nav, KPIs, Docs) RESTE INCHANGÉ ---
function updateKPIs(total, retard, enCours) {
    if (document.getElementById('kpi-total')) document.getElementById('kpi-total').textContent = total;
    if (document.getElementById('kpi-retard')) document.getElementById('kpi-retard').textContent = retard;
    if (document.getElementById('kpi-encours')) document.getElementById('kpi-encours').textContent = enCours;
    if (document.getElementById('kpi-taux')) document.getElementById('kpi-taux').textContent = total > 0 ? "100%" : "0%";
}

// Navigation
const navLinks = document.querySelectorAll('.nav-link');
const appViews = document.querySelectorAll('.app-view');
navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        const targetView = link.getAttribute('data-view');
        appViews.forEach(view => view.classList.add('hidden'));
        const targetElement = document.getElementById(`view-${targetView}`);
        if (targetElement) {
            targetElement.classList.remove('hidden');
            // TRÈS IMPORTANT : FullCalendar a besoin d'un resize quand son conteneur devient visible
            if (targetView === 'planning' && fullCalendarInstance) {
                setTimeout(() => { fullCalendarInstance.render(); }, 100);
            }
        }
        navLinks.forEach(l => { l.classList.remove('bg-brand-800', 'text-white'); l.classList.add('text-slate-400'); });
        document.querySelectorAll(`[data-view="${targetView}"]`).forEach(activeL => { activeL.classList.add('bg-brand-800', 'text-white'); activeL.classList.remove('text-slate-400'); });
    });
});

// Modal Ajout
const modal = document.getElementById('addInterventionModal');
function openModal() { if (modal) { modal.classList.remove('hidden'); modal.classList.add('flex'); } }
function closeModal() { if (modal) { modal.classList.add('hidden'); modal.classList.remove('flex'); } }
if (document.getElementById('addInterventionBtn')) document.getElementById('addInterventionBtn').addEventListener('click', openModal);
if (document.getElementById('closeModalBtn')) document.getElementById('closeModalBtn').addEventListener('click', closeModal);
if (document.getElementById('cancelModalBtn')) document.getElementById('cancelModalBtn').addEventListener('click', closeModal);

// Base Doc
const providerDocs = {
    "hypertherm": [{ name: "Manuel XPR170", file: "XPR170_MANUAL_EN.pdf" }, { name: "Schéma Électrique", file: "schema-electrique.pdf" }],
    "messer": []
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

// PIN Code
if (document.getElementById('pinForm')) {
    document.getElementById('pinForm').addEventListener('submit', (e) => {
        e.preventDefault();
        if (document.getElementById('pinInput').value.trim() === "A2CIM2026") {
            const lock = document.getElementById('lockScreen');
            lock.classList.add('opacity-0'); setTimeout(() => lock.remove(), 300);
        } else {
            document.getElementById('pinError').classList.remove('hidden');
            document.getElementById('pinInput').value = '';
        }
    });
}
