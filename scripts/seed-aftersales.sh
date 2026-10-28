#!/bin/bash
# Script para popular dados de teste da Fase 11E (pós-venda)
#
# Uso:
#   ./scripts/seed-aftersales.sh sol-do-nordeste
#   TENANT_SLUG=sol-do-nordeste ./scripts/seed-aftersales.sh
#

set -e

if [ -z "$1" ] && [ -z "$TENANT_SLUG" ]; then
  echo "❌ Uso: ./scripts/seed-aftersales.sh <slug-da-empresa>"
  echo "   ou: TENANT_SLUG=<slug> ./scripts/seed-aftersales.sh"
  exit 1
fi

SLUG="${1:-$TENANT_SLUG}"

echo "📦 Populando dados de teste de pós-venda para: $SLUG"
echo ""

cd apps/api

if [ ! -d "dist" ]; then
  echo "🔨 Compilando API..."
  pnpm build
fi

export TENANT_SLUG="$SLUG"
echo "🌱 Executando seed..."
node dist/cli/seed-aftersales-test-data.js

echo ""
echo "✅ Pronto! Dados de teste criados."
