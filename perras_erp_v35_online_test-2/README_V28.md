# Perras ERP V28 — Correctif performance sans changer la V25

Cette version garde les écrans et fonctions de la V25/V27, mais corrige le blocage causé par le catalogue de ~22 000 produits.

## Correctifs
- Le Tableau de bord ne charge plus `perras_products` au démarrage.
- Les statistiques d'inventaire du tableau de bord utilisent un petit cache agrégé.
- Produits reste paginé à 48 produits par page.
- Inventaire reste paginé à 100 lignes par page.
- Le menu Commandes ne charge plus les 22 000 produits tant que l'onglet « Produits à commander » n'est pas ouvert.
- Correction d'une erreur JavaScript qui pouvait se produire après l'ouverture de Produits (ancien champ de recherche supprimé).
- Les valeurs coût/vente et le graphique par catégorie du tableau de bord sont recalculés dans le cache lors de la première ouverture de Produits/Inventaire ou à la prochaine modification/import du catalogue.

## Démarrage
Double-cliquer sur `Démarrer Perras ERP.command`.

Si vous utilisez déjà Twilio / Nexus / Google, recopiez votre fichier `server/.env` actuel dans le dossier `server/` de cette version. Ne partagez jamais ce fichier.
