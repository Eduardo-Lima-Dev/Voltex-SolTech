#!/usr/bin/env bash
# Cria a PRIMEIRA empresa e o proprietário no banco da nuvem (Supabase), perguntando os dados no terminal.
# A senha não aparece na tela nem fica no histórico. Usa a imagem da API (a mesma que roda na Render) e os segredos de
# ~/.voltex-deploy. Guia: docs/08-deploy/nuvem-gratuita.md
set -euo pipefail
dir="$HOME/.voltex-deploy"
for f in supabase-db-url data-encryption-key; do [[ -f "$dir/$f" ]] || { echo "Falta $dir/$f" >&2; exit 1; }; done
imagem="${1:-ghcr.io/eduardo-lima-dev/voltex-api:latest}"

read -r -p "Nome da empresa: " tenant
read -r -p "Nome do proprietário: " nome
read -r -p "E-mail do proprietário: " email
read -r -s -p "Senha (12+ caracteres, com letras e números): " senha
echo
docker run --rm \
  -e NODE_ENV=production \
  -e DATABASE_URL="$(cat "$dir/supabase-db-url")" \
  -e DATA_ENCRYPTION_KEY="$(cat "$dir/data-encryption-key")" \
  -e TENANT_NAME="$tenant" -e OWNER_NAME="$nome" -e OWNER_EMAIL="$email" -e OWNER_PASSWORD="$senha" \
  "$imagem" node dist/cli/create-owner.js
