# Perras ERP V34 — Allpriser direct par description

Cette version conserve la V34 et ajoute une mise à jour Allpriser directe, sans export Excel pour la mise à jour des prix.

## Fonctionnement

Dans **Produits**, cliquer sur **Prix Allpriser par description**.

Le ERP :
1. lit directement les fichiers Winpriser `Red__01.dbf`, `Red__04.dbf` et `Red__05.dbf`;
2. normalise la description du produit ERP et la description Winpriser;
3. rapproche uniquement les descriptions correspondantes;
4. affiche uniquement les Prix Liste différents avec ancien prix, nouveau prix, écart et variation;
5. présélectionne les variations sous le seuil de contrôle (30 % par défaut);
6. bloque les descriptions ambiguës ou non trouvées;
7. modifie uniquement le **Prix Liste** lors de l'application.

Le code produit, la description ERP, le stock et les autres champs ne sont pas modifiés par cette mise à jour.

## Dossier Winpriser

Ordre de détection :
- chemin configuré / `WINPRISER_PATH`;
- `C:\Winpriser20` sur Windows;
- dossier `Winpriser20` inclus à côté du ERP (copie de secours/test).

Le chemin peut aussi être modifié directement dans la fenêtre Allpriser.

## Démarrage

### macOS
Double-cliquer `Démarrer Perras ERP.command`.

### Windows
Double-cliquer `DEMARRER_PERRAS_ERP.bat`.

Puis ouvrir `http://localhost:8080`.
