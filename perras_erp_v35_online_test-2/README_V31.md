# Perras ERP V31 — Produits + Import Winpriser permanent

Cette version corrige **seulement la partie Produits / Import Winpriser** avant de migrer les autres modules.

## Fonctionnement validé

- Le catalogue Produits n'est plus chargé au complet dans Safari.
- Le catalogue permanent est enregistré dans `server/products_store.json` pour le prototype local.
- En mise en ligne, cette même logique sera branchée à la base de données permanente.
- Produits : **48 résultats par page**.
- Recherche par code, description ou catégorie côté serveur.
- Admin peut ajouter / modifier / rendre inactif un produit.
- Bureau / Tech peuvent consulter le catalogue, le fournisseur, le Prix Liste et le Prix Perras, sans voir le coûtant.
- Le coûtant interne est affiché uniquement à Admin.

## Import Winpriser

Dans **Produits**, Admin clique **Importer Winpriser**.

1. Choisir le fichier `.xlsx`, `.xls` ou `.csv`.
2. Le logiciel détecte les colonnes et permet de les associer manuellement :
   - Code produit (obligatoire)
   - Description
   - Prix Liste (obligatoire)
   - Catégorie
   - Quantité entrepôt (optionnelle)
   - Stock minimum (optionnel)
3. Vérifier l'aperçu.
4. Cliquer Importer.

Le premier import crée le catalogue. Les imports suivants mettent à jour les produits par **code produit** et **ne suppriment pas** les produits ajoutés manuellement.

Les champs manuels déjà présents (stock, minimum, etc.) sont conservés si la colonne n'est pas incluse dans le nouvel import.

## Test de performance effectué

Le catalogue serveur a été testé avec **22 000 produits** :

- import en lots de 400;
- page de 48 produits;
- recherche serveur sans charger les 22 000 lignes dans le navigateur;
- réimport d'un produit en conservant son stock / minimum existants.

Les données synthétiques de test ne sont pas incluses dans le ZIP : `products_store.json` est livré vide pour votre vrai premier import Winpriser.

## Important

Cette V31 migre volontairement **Produits + Import** seulement. Inventaire, Commandes, BT/Factures et autres recherches utilisant le catalogue seront branchés à cette source permanente à l'étape suivante, après validation de Produits.

## Démarrage

Recopier votre fichier `server/.env` actuel dans cette version, puis double-cliquer :

`Démarrer Perras ERP.command`

Ouvrir **Produits** puis faire le premier import Winpriser.
