# Perras ERP V35 Online Test

Cette version transforme la V34.2 en pilote multiutilisateur en ligne.

## Ce qui est centralisé

- comptes et sessions serveur;
- clients, appels, tâches, formulaires, soumissions, camions et données opérationnelles;
- catalogue Produits serveur;
- REDBOOK.DAT Allpriser (stocké dans PostgreSQL sur Render pour survivre aux redéploiements);
- synchronisation automatique des collections entre navigateurs.

Les collections opérationnelles utilisent un modèle simple « dernière écriture gagnante » par collection pour ce pilote. Avant un déploiement de production à grande échelle, les modules les plus actifs devront être migrés vers des tables transactionnelles dédiées.

## 5 comptes

Identifiants :

- `admin1` — Admin
- `admin2` — Admin
- `bureau1` — Bureau
- `bureau2` — Bureau
- `tech1` — Technicien

Les mots de passe sont fournis au déploiement Render par les variables `PERRAS_*_PASSWORD`. En local seulement, si aucune variable n'est définie, les mots de passe de démonstration sont ceux du `.env.example`.

## Test local

1. Installer Node.js 20+.
2. Ouvrir un terminal dans ce dossier.
3. `npm install`
4. `npm start`
5. Ouvrir `http://localhost:8080`

Sans `DATABASE_URL`, le logiciel utilise `server/online_store.json` comme stockage de test local.

## Déploiement Render

1. Créer un dépôt GitHub privé et y téléverser le contenu de ce dossier.
2. Dans Render : **New → Blueprint**.
3. Sélectionner le dépôt GitHub.
4. Render détecte `render.yaml` et crée :
   - le Web Service `perras-erp-v35-test`;
   - PostgreSQL `perras-erp-v35-db`.
5. Render demandera les 5 mots de passe `PERRAS_*_PASSWORD`. Utiliser des mots de passe uniques.
6. Lancer le Blueprint.
7. Quand le déploiement est vert, ouvrir l'URL `https://...onrender.com`.

## Allpriser

Seul un Admin peut ouvrir la mise à jour Allpriser. Téléverser le nouveau `REDBOOK.DAT`. Le fichier est sauvegardé en PostgreSQL, restauré automatiquement après un redéploiement, puis comparé aux produits ERP par description. Seul le Prix Liste sélectionné est modifié.

## PWA / téléphone

Sur iPhone : Safari → Partager → Ajouter à l'écran d'accueil.
Sur Android : Chrome → Installer l'application / Ajouter à l'écran d'accueil.

## Sécurité

Ne jamais publier `server/.env`, les jetons Google, les clés OpenAI ou les mots de passe. Le ZIP V35 fourni ne contient pas les secrets de la V34 locale.
