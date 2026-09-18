# Perras ERP V34.1 — Mise à jour Allpriser par DBF

## Principe

Le module Allpriser compare les descriptions des produits actifs de Perras ERP avec les descriptions Winpriser et propose uniquement les changements de **Prix Liste**.

Il ne modifie pas le code produit, la description ERP, les coûts, les rabais, les marges ou les prix vendants.

## Comment récupérer la nouvelle liste Winpriser

Après avoir effectué la mise à jour normale de Winpriser sur le PC Windows, les fichiers du catalogue sont déjà présents dans :

`C:\Winpriser20`

Pour Perras ERP, seulement trois fichiers sont requis :

- `Red__01.dbf`
- `Red__04.dbf`
- `Red__05.dbf`

Les exports Winpriser HTML 3.2, RTF, Word 6.0, Word 97 ou texte ne sont pas nécessaires.

### Option A — la plus simple sur le PC Winpriser

Dans Perras ERP :

1. Produits > Mise à jour Allpriser par description.
2. Dans **Importer une nouvelle liste Winpriser**, cliquez **Choisir le dossier Winpriser**.
3. Sélectionnez `C:\Winpriser20`.
4. Cliquez **Importer la nouvelle liste et analyser**.

Le navigateur sélectionne le dossier, mais Perras ERP ne téléverse que les trois DBF nécessaires.

### Option B — copier dans Documents

1. Ouvrir `C:\Winpriser20` dans l'Explorateur Windows.
2. Copier `Red__01.dbf`, `Red__04.dbf` et `Red__05.dbf`.
3. Les coller dans un dossier comme `Documents\Winpriser Update\2026-09-18`.
4. Dans Perras ERP, choisir ce dossier ou sélectionner directement les trois fichiers DBF.
5. Cliquer **Importer la nouvelle liste et analyser**.

### Mac / autre ordinateur

Copier les trois DBF depuis le PC Winpriser vers OneDrive, une clé USB ou Documents sur le Mac. Ensuite sélectionner le dossier ou les trois fichiers dans Perras ERP.

## Ce que le ERP fait automatiquement

- valide les trois DBF;
- crée une copie datée dans `Winpriser_Updates`;
- définit cette copie comme nouveau catalogue actif;
- lit environ 82 000 produits Winpriser;
- compare les descriptions normalisées avec le catalogue Perras;
- affiche seulement les Prix Liste différents;
- présélectionne les variations sous le seuil configuré;
- bloque les descriptions ambiguës;
- ne change le Prix Liste qu'après validation de l'utilisateur.
