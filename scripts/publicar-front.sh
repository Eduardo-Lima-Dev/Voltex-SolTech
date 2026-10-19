#!/usr/bin/env bash
# Compila a aplicação (web) ou o site e publica na Vercel SEM passar pelo GitHub (envia a pasta compilada).
# Guia: docs/08-deploy/nuvem-gratuita.md
#
#   ./scripts/publicar-front.sh app  <host-da-api>  [--so-preparar]
#   ./scripts/publicar-front.sh site <host-da-api>  [--so-preparar]
#
# <host-da-api>   endereço da API na Render, SEM https:// (ex.: voltex-api.onrender.com)
# Variáveis lidas do ambiente:
#   APP_URL         (site) endereço público da aplicação, ex.: https://voltex-app.vercel.app   (botão "Entrar")
#   SITE_URL        (app)  endereço público do site, ex.: https://voltex-site.vercel.app       ("Voltar ao site")
#   LEAD_KEY        (site) chave de captação de leads (CRM → Leads → "Receber contatos do seu site")
#   VERCEL_TOKEN    (opcional) token da Vercel, no lugar do login interativo (`npx vercel login`)
# --so-preparar    compila e monta a pasta (.deploy/...), mas NÃO envia nada: para conferir antes.
set -euo pipefail
cd "$(dirname "$0")/.."

alvo="${1:-}"; api_host="${2:-}"; modo="${3:-}"
[[ "$alvo" == "app" || "$alvo" == "site" ]] || { sed -n '2,15p' "$0"; exit 1; }
[[ -n "$api_host" && "$api_host" != http* ]] || { echo "Erro: informe o host da API sem https:// (ex.: voltex-api.onrender.com)." >&2; exit 1; }

pasta=".deploy/voltex-$alvo"
rm -rf "$pasta" && mkdir -p "$pasta"

if [[ "$alvo" == "app" ]]; then
  VITE_API_URL=/api/v1 VITE_SITE_URL="${SITE_URL:-}" pnpm --filter @voltex/web build
  cp -r apps/web/dist/. "$pasta/"
  sed "s|__API_HOST__|$api_host|g" deploy/nuvem/vercel-app.json.template > "$pasta/vercel.json"
else
  VITE_APP_URL="${APP_URL:?defina APP_URL (endereço público da aplicação)}" VITE_LEAD_KEY="${LEAD_KEY:-}" \
    pnpm --filter @voltex/site build
  cp -r apps/site/dist/. "$pasta/"
  sed "s|__API_HOST__|$api_host|g" deploy/nuvem/vercel-site.json.template > "$pasta/vercel.json"
fi
# Mapas de origem expõem o código-fonte: não vão para o ar.
find "$pasta" -name '*.map' -delete

echo "Pasta pronta em $pasta ($(du -sh "$pasta" | cut -f1))."
[[ "$modo" == "--so-preparar" ]] && { echo "(--so-preparar: nada foi enviado)"; exit 0; }

echo "Enviando para a Vercel (produção)…"
cd "$pasta"
npx --yes vercel@latest deploy --prod --yes ${VERCEL_TOKEN:+--token "$VERCEL_TOKEN"}
