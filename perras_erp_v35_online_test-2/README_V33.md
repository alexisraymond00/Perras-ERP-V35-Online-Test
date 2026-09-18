# Perras ERP V33 — Mise à jour Winpriser par description

Cette version conserve la V32 et corrige la logique **Mise à jour prix Winpriser**.

## Règle de rattachement

Pour la mise à jour de prix seulement, le **code produit n'est pas utilisé**. Perras rattache un produit actif au fichier Winpriser à partir de sa **description**.

La comparaison normalise les majuscules/minuscules, accents, ponctuation et espaces. Elle reste une correspondance de description, sans rapprochement flou, afin d'éviter d'appliquer un prix à un mauvais produit.

## Analyse avant modification

Après avoir choisi le fichier Winpriser, Perras affiche avant toute modification :

- le nombre de produits actifs dans Perras;
- le nombre de produits reconnus par description;
- le nombre de produits dont le Prix Liste doit réellement être ajusté;
- le nombre de produits actifs non reconnus par Winpriser et donc non ajustés;
- le nombre de produits reconnus dont le prix est déjà identique;
- des exemples de produits actifs non reconnus.

Aucun prix n'est modifié pendant l'analyse. Il faut ensuite cliquer **Appliquer les ajustements de prix**.

## Données conservées

La mise à jour change le Prix Liste des produits reconnus qui ont un prix différent. Le stock, le stock minimum, la catégorie fournisseur et les produits ajoutés manuellement ne sont pas supprimés.

Si le catalogue du dossier V33 est vide au premier démarrage, le serveur essaie de récupérer automatiquement un catalogue présent dans un dossier V31 ou V32 voisin.
