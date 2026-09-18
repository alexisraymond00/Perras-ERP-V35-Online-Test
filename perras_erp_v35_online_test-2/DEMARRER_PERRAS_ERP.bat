@echo off
cd /d "%~dp0"
title Perras ERP V34
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js n'est pas installe ou n'est pas accessible.
  echo Installe Node.js LTS puis relance ce fichier.
  pause
  exit /b 1
)
start "" http://localhost:8080
node server\server.js
pause
