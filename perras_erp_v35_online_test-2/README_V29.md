# Perras ERP V29 — correction des gels du catalogue

Cette version repart de la V25/V28 sans changer le visuel ni les modules validés.

## Correction principale

Le catalogue Produits n'est plus JSON.parse sur le fil principal de Safari lorsqu'on clique sur un menu.
Il est lu par un Web Worker (`js/catalog-worker.js`) uniquement lorsqu'un écran qui a réellement besoin du catalogue est ouvert.

Pendant le chargement, l'écran affiche une carte « Chargement du catalogue » et les autres menus restent utilisables.
Une fois chargé, le catalogue reste en mémoire pour la session et les changements de menus sont immédiats.

## Écrans concernés

- Produits : pagination 48 par page + recherche.
- Inventaire : pagination 100 par page + recherche.
- Commandes : les onglets Bons ouverts / À recevoir / Tous les bons n'attendent pas le catalogue. Le catalogue ne charge que dans Produits à commander.
- Mon camion / Demander un produit : chargement asynchrone si nécessaire.
- Outils entreprise : ne charge jamais le catalogue et doit ouvrir immédiatement.
- Tableau de bord : utilise seulement le cache léger de statistiques produits.

## Données existantes

La clé `perras_products` déjà importée n'est pas supprimée. Le Worker la lit sans bloquer l'interface et normalise uniquement les champs utiles au logiciel en mémoire.

## Démarrage

Double-cliquer sur `Démarrer Perras ERP.command`.

Conserver/copier votre `server/.env` actuel dans `server/.env` pour Twilio, Nexus et Google.
