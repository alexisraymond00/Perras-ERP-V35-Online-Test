# Perras ERP V34 — package complet

V34 est un package complet basé sur la V33 fonctionnelle. Aucun module n'a été retiré du dossier logiciel.

### Contenu
- `index.html` et `app.html`
- `assets/`
- `css/`
- `js/`
- `server/`
- `Démarrer Perras ERP.command`
- tous les README historiques présents dans la version précédente
- `README_V34.md`

### Produits / Winpriser
- Catalogue persistant dans `server/products_store.json`.
- Import complet Winpriser pour créer/mettre à jour le catalogue.
- Ajout manuel possible après l'import.
- Mise à jour de prix Winpriser rattachée par description normalisée.
- L'analyse affiche produits actifs, reconnus, prix à ajuster et non reconnus.
- Les produits non reconnus ne sont pas modifiés.
- Catégorie produit unique : Catégorie fournisseur.

### Inventaire
L'inventaire utilise le même catalogue serveur que Produits et ne doit pas charger l'ancien catalogue localStorage.
