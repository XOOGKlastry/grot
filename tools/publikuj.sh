#!/usr/bin/env bash
# Wypycha repozytorium na GitHub i przypomina o wlaczeniu Pages.
# Uzycie:  bash tools/publikuj.sh TWOJA-NAZWA mapa-sprzedazy
set -e

UZYTKOWNIK="${1:?Podaj nazwe uzytkownika GitHub}"
REPO="${2:-mapa-sprzedazy}"

node --check app.js
node tools/test.js

git init -q
git add .
git commit -q -m "Mapa sprzedazy z trasowaniem" || echo "Brak zmian do zapisania."
git branch -M main
git remote remove origin 2>/dev/null || true
git remote add origin "https://github.com/${UZYTKOWNIK}/${REPO}.git"
git push -u origin main

cat <<MSG

Gotowe. Zostal jeden krok w przegladarce:

  https://github.com/${UZYTKOWNIK}/${REPO}/settings/pages
  Source: Deploy from a branch  ->  main  ->  / (root)  ->  Save

Po kilku minutach strona bedzie pod:
  https://${UZYTKOWNIK}.github.io/${REPO}/

MSG
