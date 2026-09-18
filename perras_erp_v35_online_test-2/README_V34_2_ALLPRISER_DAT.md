# Perras ERP V34.2 — Mise à jour Allpriser avec REDBOOK.DAT

## Méthode recommandée

1. Faites la mise à jour de prix normalement dans Winpriser.
2. Récupérez le fichier `REDBOOK.DAT` de la nouvelle liste.
3. Si le ERP est sur un autre ordinateur, copiez `REDBOOK.DAT` dans Documents, OneDrive, une clé USB, etc.
4. Ouvrez **Produits → Prix Allpriser par description**.
5. Dans **Mettre à jour la liste Winpriser**, choisissez le nouveau `REDBOOK.DAT`.
6. Cliquez **Importer REDBOOK.DAT et analyser**.
7. Le ERP conserve une copie datée dans `Winpriser_Updates`, rend ce fichier actif et compare les descriptions.
8. Vérifiez les changements proposés puis cliquez **Appliquer les prix sélectionnés**.

## Ce que le module modifie

Le module modifie uniquement **Prix Liste**. Il ne change pas le code produit, la description ERP, le coûtant, le prix Perras, le fournisseur ou les quantités.

## Comparaison

La correspondance se fait par **description normalisée** (majuscules/minuscules, accents, ponctuation et espaces sont neutralisés). Une description ambiguë avec plusieurs prix Winpriser différents est bloquée pour éviter une mauvaise mise à jour.

## Ancienne méthode DBF

L'import des trois fichiers `Red__01.dbf`, `Red__04.dbf` et `Red__05.dbf` reste disponible dans la section **Ancienne méthode DBF (secours)**.
