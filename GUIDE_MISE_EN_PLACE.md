# GMAO A2CIM : mise en place pas à pas (≈ 1 heure)

Projet Firebase : `gmao-a2cim`. Console : https://console.firebase.google.com

**Ordre important** : comptes → code → test → règles. Si tu publies les règles avant d'avoir créé les comptes, tout le monde (toi compris) est bloqué.

Idéal : faire ça avant l'arrivée des techniciens, ou à un moment où personne n'utilise l'app.

---

## Étape 0 : Sauvegarde (5 min)

1. Copie ton dossier actuel du site dans un dossier `ancien-v38` (ou un zip). C'est ton retour arrière.
2. Dans Firebase > Firestore Database > Rules : note ou copie les règles actuelles.

---

## Étape 1 : Activer l'authentification (5 min)

1. Console > **Authentication** > *Commencer* (si jamais ouvert).
2. Onglet **Sign-in method** > **E-mail/Mot de passe** > Activer (laisser « lien par e-mail » désactivé) > Enregistrer.
3. Onglet **Users** > **Ajouter un utilisateur** :
   - Ton compte en premier (email + mot de passe long, 12 caractères minimum).
   - Puis un compte par technicien (NABIL, MEHDI, BELKADI, ABDELOUAHED, O. LAFNISHA, ZOUHAIR si chacun doit se connecter).
4. Pour chaque compte, **copie l'UID** (colonne « Identifiant de l'utilisateur »). Tu en as besoin à l'étape suivante.

Un compte par personne : pas de compte partagé, sinon tu ne sais plus qui a fait quoi (l'historique enregistre l'email).

---

## Étape 2 : Créer les profils et rôles (10 min)

1. Console > **Firestore Database** > **Données** > **Démarrer une collection** (ou *Ajouter une collection*).
2. ID de collection : `users`
3. Pour chaque compte :
   - **ID du document** : colle l'UID exact (pas d'ID automatique).
   - Champ `role` (type *string*) = `admin` pour toi / le chef, `tech` pour les techniciens.
4. Vérifie 2 fois chaque UID : une erreur d'un caractère = « Compte non autorisé » à la connexion.

---

## Étape 3 : Déployer le nouveau code (10 min)

Dans le dossier de ton site, remplace ou ajoute :

| Fichier | Action |
|---|---|
| `index.html` | remplacer |
| `app.js` | remplacer |
| `firebase-init.js` | **nouveau** |
| `sw.js` | remplacer |
| `manifest.json` | remplacer |
| `style.css` | inchangé |
| `icon-192.png`, `icon-512.png` | doivent être présents à côté |

`firestore.rules` n'est pas à déployer sur le site : il se colle dans la console (étape 5).

Publie (GitHub Pages ou ton hébergement habituel), attends 1 à 2 minutes.

---

## Étape 4 : Premier test, règles encore ouvertes (10 min)

1. Ouvre le site sur ordinateur, **Ctrl+Maj+R** (rechargement forcé).
2. Tu dois voir l'écran de connexion. Connecte-toi avec ton compte admin.
3. Si la page est blanche : ouvre la console du navigateur (F12 > Console) et note l'erreur rouge.
4. Vérifie :
   - le tableau de bord s'affiche avec tes données ;
   - en bas de la barre latérale : ton email + « Admin » + Déconnexion ;
   - **Rester connecté** : ferme l'onglet, rouvre le site : tu dois être déjà connecté.
5. F12 > **Application** > **Service Workers** : tu dois voir `sw.js` actif ; > **Cache Storage** : `gmao-shell-v36`.

---

## Étape 5 : Publier les règles Firestore (5 min)

1. Console > Firestore Database > onglet **Règles**.
2. Efface tout, colle le contenu de `firestore.rules`, clique **Publier**.
3. Sans fermer la console : recharge le site (connecté en admin) : les données doivent toujours s'afficher.

Si tout est bloqué (« Missing or insufficient permissions ») : le profil `users/<UID>` est absent ou l'UID est faux (étape 2). L'onglet Règles garde un **historique** : tu peux restaurer l'ancienne version en un clic.

---

## Étape 6 : Tests complets (15 min)

**Avec le compte admin**
- [ ] Ajouter une intervention (une machine, puis « Toutes les machines »)
- [ ] La même intervention une 2ᵉ fois : message « doublon évité »
- [ ] Ouvrir une intervention > Passer « En cours » > Valider : la suivante se crée si récurrente (une seule fois)
- [ ] Rédiger une fiche globale > Imprimer : l'app te demande ensuite si tu veux archiver
- [ ] Ajouter un client, une machine, une nomenclature
- [ ] Expertise HT : associer un générateur, vérifier la date et le type d'échéance affichés

**Avec un compte technicien** (navigation privée ou autre navigateur)
- [ ] Connexion OK
- [ ] Pas de boutons de suppression ni de formulaire d'ajout client / Hypertherm
- [ ] Peut passer une intervention « En cours » et la valider
- [ ] Peut ajouter une intervention

**Hors-ligne**
- [ ] Sur le téléphone : ouvre l'app connecté, passe en mode avion, rouvre l'app : elle s'affiche avec les dernières données
- [ ] Fais une modification, remets le réseau : elle se synchronise

**Sécurité**
- [ ] Mauvais mot de passe : message d'erreur, pas de blocage
- [ ] Déconnexion : retour à l'écran de connexion

---

## Étape 7 : Verrouiller la clé API (10 min)

1. https://console.cloud.google.com > projet `gmao-a2cim` > **APIs et services** > **Identifiants**.
2. Ouvre la **clé de navigateur** créée automatiquement par Firebase (« Browser key »).
3. **Restrictions relatives aux applications** > *Sites Web* > ajoute l'adresse de ton site (ex. `https://ton-site.github.io/*`). Ajoute `http://localhost:*` seulement si tu testes en local.
4. Enregistre, attends quelques minutes, retest de la connexion.
5. Ne touche pas aux restrictions d'API dans un premier temps (risque de casser Firestore ou l'authentification).

---

## Plus tard (pas demain) : App Check

1. https://www.google.com/recaptcha/admin > créer une clé **reCAPTCHA v3** pour ton domaine.
2. Console > **App Check** > Applications > enregistrer l'app web avec cette clé.
3. Colle la clé dans `RECAPTCHA_SITE_KEY` de `firebase-init.js`.
4. Laisse tourner quelques jours en observant les métriques, puis active **Appliquer (Enforce)** pour Firestore.

---

## Dépannage rapide

| Symptôme | Cause probable |
|---|---|
| « Compte non autorisé » | profil `users/<UID>` absent ou UID faux |
| « Missing or insufficient permissions » | idem, ou règles publiées avant la création du profil |
| Page blanche | erreur JS : F12 > Console. Souvent un fichier manquant (`firebase-init.js`) |
| Ancienne version qui s'affiche | rechargement forcé (Ctrl+Maj+R) ; sur mobile, ferme et rouvre l'app deux fois |
| Écran de connexion absent | `index.html` pas remplacé ou en cache |
| Une modification est refusée sur une vieille intervention | le champ `statut` ou `type` de ce document a une valeur hors liste (Planifié, En cours, Terminé, En retard, Archivé / Préventif, Curatif) |
| Pas de bouton supprimer | normal pour un compte `tech` |

## À savoir

- Les dates d'échéance Hypertherm sont maintenant calculées par semestres (6, 12, 24, 36 mois). L'ancien calcul ne détectait jamais 12/24/36 mois. Les interventions déjà planifiées gardent leur date ; seules les prochaines utilisent le nouveau calcul. La carte « Prochaine échéance » de l'onglet HT peut donc changer : contrôle-la sur une machine que tu connais.
- Le mot de passe d'un technicien perdu : Authentication > Users > menu du compte > *Réinitialiser le mot de passe*.
- Pour retirer l'accès à quelqu'un : supprime ou désactive son compte dans Authentication, et supprime son document `users/<UID>`.
