# Déployer Perras ERP V35 Online Test sur Render

## 1. GitHub privé

Créez un dépôt GitHub **privé** nommé par exemple `perras-erp-v35-test`.
Déposez **le contenu du dossier V35**, pas le ZIP lui-même, à la racine du dépôt.

Vérifiez que ces fichiers sont à la racine :

- `package.json`
- `render.yaml`
- `index.html`
- `app.html`
- dossiers `server`, `js`, `css`, `assets`

Ne téléversez jamais `server/.env`.

## 2. Render Blueprint

Dans Render :

1. **New → Blueprint**
2. Connectez GitHub si nécessaire.
3. Sélectionnez le dépôt `perras-erp-v35-test`.
4. Render lit automatiquement `render.yaml`.
5. Le Blueprint crée :
   - `perras-erp-v35-test` (Web Service Node)
   - `perras-erp-v35-db` (PostgreSQL)

## 3. Mots de passe demandés par Render

Render vous demandera les cinq variables suivantes. Choisissez des mots de passe forts :

- `PERRAS_ADMIN1_PASSWORD`
- `PERRAS_ADMIN2_PASSWORD`
- `PERRAS_BUREAU1_PASSWORD`
- `PERRAS_BUREAU2_PASSWORD`
- `PERRAS_TECH1_PASSWORD`

Identifiants correspondants : `admin1`, `admin2`, `bureau1`, `bureau2`, `tech1`.

## 4. Attendre le déploiement

Quand le Web Service devient **Live**, ouvrez son URL Render. La page de connexion V35 Online doit apparaître.

## 5. Test multiutilisateur

- Connectez Admin 1 sur un ordinateur.
- Connectez Bureau 1 dans une fenêtre privée ou un autre appareil.
- Connectez Tech 1 sur un téléphone.
- Créez/modifiez un appel de service et vérifiez qu'il se synchronise sur les autres appareils après quelques secondes.

## 6. Allpriser

Connectez-vous comme Admin : **Produits → Prix Allpriser par description**.
Téléversez un nouveau `REDBOOK.DAT`. Le fichier est conservé dans PostgreSQL et restauré automatiquement après un redéploiement.

## 7. Ajouter l'app sur téléphone

- iPhone : Safari → Partager → **Ajouter à l'écran d'accueil**.
- Android : Chrome → menu → **Installer l'application** / **Ajouter à l'écran d'accueil**.

## Important — version pilote

V35 Online Test centralise les données pour permettre les essais terrain. Certaines collections utilisent encore une synchronisation « dernière écriture gagnante ». Après le pilote, les modules très transactionnels (appels, punch, temps, inventaire) devront être déplacés vers des tables dédiées avec contrôle de concurrence avant une utilisation de production complète.
