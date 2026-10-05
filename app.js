import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, collection, addDoc, deleteDoc, doc, onSnapshot, query, orderBy, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// --- CONFIGURATION FIREBASE ---
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

// --- NAVIGATION ENTRE LES VUES ---
const navLinks = document.querySelectorAll('.nav-link');
const appViews = document.querySelectorAll('.app-view');

navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        const targetView = link.getAttribute('data-view');

        appViews.forEach(view => view.classList.add('hidden'));
        document.getElementById(`view-${targetView}`).classList.remove('hidden');

        navLinks.forEach(l => {
            l.classList.remove('bg-brand-800', 'text-white');
            l.classList.add('text-slate-400');
        });
        
        document.querySelectorAll(`[data-view="${targetView}"]`).forEach(activeL => {
            activeL.classList.add('bg-brand-800', 'text-white');
            activeL.classList.remove('text-slate-400');
        });
    });
});

// --- GESTION DU MODAL D'AJOUT ---
const modal = document.getElementById('addInterventionModal');
const addBtn = document.getElementById('addInterventionBtn');
const closeBtn = document.getElementById('closeModalBtn');
const cancelBtn = document.getElementById('cancelModalBtn');

function openModal() {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeModal() {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

addBtn.addEventListener('click', openModal);
closeBtn.addEventListener('click', closeModal);
cancelBtn.addEventListener('click', closeModal);

const statusConfig = {
    "En retard": { border: "border-red-500", bg: "bg-red-50", text: "text-red-700", icon: "fa-triangle-exclamation" },
    "En cours": { border: "border-orange-400", bg: "bg-orange-50", text: "text-orange-700", icon: "fa-spinner" },
    "Planifié": { border: "border-blue-400", bg: "bg-blue-50", text: "text-blue-700", icon: "fa-clock" }
};

// --- AJOUTER UNE INTERVENTION ---
document.getElementById('addInterventionForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btnSubmit = document.getElementById('btnSubmit');
    btnSubmit.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Enregistrement...';
    
    try {
        await addDoc(collection(db, "interventions"), {
            client: document.getElementById('formClient').value,
            machine: document.getElementById('formMachine').value,
            date: document.getElementById('formDate').value,
            type: document.getElementById('formType').value,
            technicien: document.getElementById('formTech').value,
            statut: "Planifié",
            timestamp: serverTimestamp()
        });
        
        document.getElementById('addInterventionForm').reset();
        closeModal();
        btnSubmit.innerHTML = '<i class="fa-solid fa-save mr-2"></i> Enregistrer';
    } catch (error) {
        console.error("Erreur Firebase:", error);
        alert("Erreur d'enregistrement.");
        btnSubmit.innerHTML = '<i class="fa-solid fa-save mr-2"></i> Enregistrer';
    }
});

// --- SUPPRIMER UNE INTERVENTION ---
window.supprimerIntervention = async function(id) {
    if (confirm("Voulez-vous vraiment supprimer cette intervention ?")) {
        try {
            await deleteDoc(doc(db, "interventions", id));
        } catch (error) {
            console.error("Erreur lors de la suppression : ", error);
            alert("Erreur lors de la suppression de l'intervention.");
        }
    }
};

// --- SYNCHRONISATION EN TEMPS RÉEL ET AFFICHAGE AVEC BOUTON SUPPRIMER ---
const q = query(collection(db, "interventions"), orderBy("date", "asc"));
onSnapshot(q, (snapshot) => {
    const container = document.getElementById('tasks-container');
    const planningContainer = document.getElementById('planning-container');
    
    container.innerHTML = '';
    planningContainer.innerHTML = '';
    
    let totalCount = snapshot.size;
    let planifieCount = 0;
    let retardCount = 0;
    let enCoursCount = 0;

    if(snapshot.empty) {
        container.innerHTML = '<p class="text-center text-slate-500 py-4">Aucune intervention planifiée.</p>';
        planningContainer.innerHTML = '<p class="text-center text-slate-500 py-4">Aucune intervention dans le planning.</p>';
        updateKPIs(0, 0, 0);
        return;
    }
    
    snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        const docId = docSnap.id; // ID unique du document dans Firebase

        if (data.statut === "Planifié") planifieCount++;
        if (data.statut === "En retard") retardCount++;
        if (data.statut === "En cours") enCoursCount++;

        let dateAffichee = data.date;
        if(data.date) {
            const dateObj = new Date(data.date);
            dateAffichee = dateObj.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
        }

        const config = statusConfig[data.statut] || statusConfig["Planifié"];
        const initialTech = data.technicien ? data.technicien.charAt(0).toUpperCase() : '?';
        
        const cardHTML = `
            <div class="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden flex items-center justify-between hover:shadow-md transition-shadow">
                <div class="flex items-center flex-1">
                    <div class="w-2 self-stretch ${config.bg} ${config.border} border-l-4"></div>
                    <div class="p-4 flex-1 flex flex-col sm:flex-row sm:items-center justify-between">
                        <div class="mb-3 sm:mb-0">
                            <div class="flex items-center space-x-2 mb-1">
                                <span class="text-xs font-bold text-slate-500 uppercase">${data.client}</span>
                                <span class="w-1 h-1 rounded-full bg-slate-300"></span>
                                <span class="text-xs text-slate-500">${dateAffichee}</span>
                            </div>
                            <h3 class="font-bold text-slate-800 text-sm md:text-base">${data.machine}</h3>
                            <p class="text-xs text-slate-500 mt-1"><i class="fa-solid fa-wrench mr-1"></i> ${data.type}</p>
                        </div>
                        <div class="flex items-center space-x-4">
                            <div class="flex items-center space-x-2">
                                <div class="w-6 h-6 rounded-full bg-slate-200 flex items-center justify-center text-[10px] font-bold text-slate-600">${initialTech}</div>
                                <span class="text-xs font-medium text-slate-600 hidden md:inline-block">${data.technicien}</span>
                            </div>
                            <div class="px-2.5 py-1 rounded-md flex items-center space-x-1 ${config.bg} ${config.text} border ${config.border} border-opacity-20 text-[10px] font-bold uppercase tracking-wider">
                                <i class="fa-solid ${config.icon}"></i> <span>${data.statut}</span>
                            </div>
                        </div>
                    </div>
                </div>
                <!-- Bouton Supprimer -->
                <button onclick="supprimerIntervention('${docId}')" class="p-4 text-slate-300 hover:text-red-500 transition-colors" title="Supprimer">
                    <i class="fa-solid fa-trash-can text-base"></i>
                </button>
            </div>
        `;

        container.innerHTML += cardHTML;
        planningContainer.innerHTML += cardHTML;
    });

    updateKPIs(totalCount, retardCount, enCoursCount);
});

function updateKPIs(total, retard, enCours) {
    document.getElementById('kpi-total').textContent = total;
    document.getElementById('kpi-retard').textContent = retard;
    document.getElementById('kpi-encours').textContent = enCours;
    document.getElementById('kpi-taux').textContent = total > 0 ? "100%" : "0%";
}

// --- SERVICE WORKER ---
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => reg.update())
            .catch(err => console.error('Erreur Service Worker', err));
    });
}
