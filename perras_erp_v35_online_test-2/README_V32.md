# Perras ERP V32 — Inventaire + Winpriser

Cette version reste basée sur la V31. Elle corrige seulement la partie **Produits / Inventaire / import Winpriser**.

## Inventaire corrigé

- Inventaire utilise maintenant le **même catalogue permanent** que Produits.
- Aucun chargement complet des ~22 000 produits dans le navigateur.
- Entrepôt : recherche côté catalogue + **100 lignes par page**.
- Filtres Stock bas / Rupture utilisent le catalogue permanent.
- Ajustement du stock entrepôt modifie directement le produit permanent.
- Les onglets camions ne chargent que les produits réellement présents dans le camion.

## Produits

- **48 produits par page**.
- Recherche par code, description ou catégorie fournisseur.
- Il n’y a plus deux catégories produit : la seule catégorie est **Catégorie fournisseur**.
- Admin peut toujours ajouter/modifier un produit manuellement.

## Winpriser

Deux actions sont disponibles dans Produits :

1. **Importer Winpriser** : premier import / mise à jour complète du catalogue par code.
2. **Mise à jour prix Winpriser** : met à jour seulement le Prix Liste par code.

La mise à jour des prix ne supprime pas :

- la description;
- la catégorie fournisseur;
- le stock / minimum;
- les produits ajoutés manuellement.

Les prix coûtants et Perras existants sont redimensionnés avec le nouveau Prix Liste, puisque les règles sont basées sur un pourcentage du Prix Liste.

## Passage depuis V31

Si le dossier V31 est encore à côté du dossier V32 et que le catalogue V32 est vide, V32 tente de récupérer automatiquement le `products_store.json` de V31 au premier démarrage.

Gardez quand même votre dossier V31 comme sauvegarde jusqu’à validation.

Pour conserver Twilio / Nexus / Google, copiez aussi votre fichier `server/.env` actuel dans `server/.env` de V32.
