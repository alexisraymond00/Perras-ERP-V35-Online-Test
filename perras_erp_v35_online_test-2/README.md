# Perras ERP V34 — version complète

Cette archive contient le logiciel complet : interface, JavaScript, styles, serveur, catalogue serveur, documents README, logo et lanceur macOS.

## Démarrage
1. Décompresser le ZIP.
2. Ouvrir le dossier `Perras_ERP_V34_Complet`.
3. Double-cliquer sur `Démarrer Perras ERP.command`.
4. Si macOS bloque le fichier la première fois : clic droit > Ouvrir > Ouvrir.

## V34
La V34 reprend la V33 complète et conserve les correctifs validés :
- catalogue Produits permanent côté application/serveur;
- pagination Produits;
- Inventaire branché sur le même catalogue;
- import Winpriser;
- mise à jour des Prix Liste Winpriser par correspondance de description;
- compteur produits actifs, reconnus, ajustés et non reconnus;
- une seule catégorie produit : Catégorie fournisseur;
- ajout manuel de produits conservé.

Le fichier `server/.env.example` est inclus. Le vrai `server/.env` contenant vos clés privées n'est pas inclus dans l'archive modèle.
