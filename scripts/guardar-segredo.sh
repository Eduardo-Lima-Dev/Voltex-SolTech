#!/usr/bin/env bash
# Guarda um token/chave num arquivo só seu (permissão 600) FORA do repositório, sem aparecer na tela, no histórico do
# terminal nem em conversa. As ferramentas de deploy leem de lá.
#
#   ./scripts/guardar-segredo.sh supabase     # token de acesso do Supabase
#   ./scripts/guardar-segredo.sh render       # chave de API da Render
#   ./scripts/guardar-segredo.sh upstash-email / upstash-chave   (se for usar a API do Upstash)
set -euo pipefail
nome="${1:-}"
[[ "$nome" =~ ^[a-z0-9-]+$ ]] || { sed -n '2,8p' "$0"; exit 1; }
dir="$HOME/.voltex-deploy"
mkdir -p "$dir" && chmod 700 "$dir"
read -r -s -p "Cole o valor de '$nome' (não aparece na tela) e aperte Enter: " valor
echo
[[ -n "$valor" ]] || { echo "Nada foi colado." >&2; exit 1; }
umask 177
printf '%s' "$valor" > "$dir/$nome"
chmod 600 "$dir/$nome"
echo "Guardado em $dir/$nome (só você lê)."
