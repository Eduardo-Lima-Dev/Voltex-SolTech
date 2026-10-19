#!/usr/bin/env bash
# Constrói a imagem Docker da API e a publica em um registro, para a Render baixar ("Existing image").
# Guia: docs/08-deploy/nuvem-gratuita.md
#
#   ./scripts/publicar-api.sh ghcr.io/SEU_USUARIO/voltex-api [etiqueta] [--so-construir]
#   ./scripts/publicar-api.sh docker.io/SEU_USUARIO/voltex-api [etiqueta] [--so-construir]
#
# Antes de publicar, entre no registro (`docker login ghcr.io` ou `docker login`). Use um repositório PRIVADO: a imagem
# leva o código compilado da API (nenhum segredo: eles entram como variáveis na Render).
# --so-construir  só constrói a imagem localmente, sem enviar.
set -euo pipefail
cd "$(dirname "$0")/.."

repo="${1:-}"; etiqueta="${2:-$(git rev-parse --short HEAD)}"; modo="${3:-}"
[[ "$etiqueta" == "--so-construir" ]] && { modo="--so-construir"; etiqueta="$(git rev-parse --short HEAD)"; }
[[ -n "$repo" ]] || { sed -n '2,12p' "$0"; exit 1; }

imagem="$repo:$etiqueta"
echo "Construindo $imagem …"
docker build -f apps/api/Dockerfile -t "$imagem" -t "$repo:latest" .
[[ "$modo" == "--so-construir" ]] && { echo "(--so-construir: nada foi enviado)"; exit 0; }

echo "Enviando $imagem …"
docker push "$imagem"
docker push "$repo:latest"
echo
echo "Pronto. Na Render use a imagem: $imagem"
