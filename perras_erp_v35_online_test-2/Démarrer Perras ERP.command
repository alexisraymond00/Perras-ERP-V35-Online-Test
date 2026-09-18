#!/bin/bash

# Lanceur macOS — Perras ERP
cd "$(dirname "$0")" || exit 1

clear
echo "========================================="
echo "        PERRAS ERP — DÉMARRAGE"
echo "========================================="
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node.js n'est pas installé ou n'est pas accessible."
  echo "Installe Node.js LTS, puis relance ce fichier."
  echo ""
  read -r -p "Appuie sur Entrée pour fermer..."
  exit 1
fi

# Ne crée jamais un nouveau .env si le vrai fichier existe déjà.
if [ ! -f "server/.env" ]; then
  echo "⚠️  Le fichier server/.env est absent."
  if [ -f "server/.env.example" ]; then
    echo "Une copie de .env.example va être créée comme server/.env."
    cp "server/.env.example" "server/.env"
    echo "✅ server/.env créé. Ouvre-le dans VS Code pour y remettre tes clés si nécessaire."
  fi
  echo ""
fi

# Ouvre Safari/navigateur après un court délai.
(sleep 2; open "http://localhost:8080") >/dev/null 2>&1 &

echo "🚀 Démarrage du serveur..."
echo "🌐 Le logiciel va s'ouvrir sur http://localhost:8080"
echo ""
echo "Pour arrêter le serveur : ferme cette fenêtre ou fais Control + C."
echo "-----------------------------------------"

node server/server.js
STATUS=$?

echo ""
echo "Le serveur s'est arrêté (code $STATUS)."
read -r -p "Appuie sur Entrée pour fermer..."
