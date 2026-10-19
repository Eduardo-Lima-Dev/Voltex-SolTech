#!/usr/bin/env bash
# Atalhos para operar o SERVIDOR DE TESTE (notebook em casa). Guia: docs/08-deploy/servidor-de-teste.md
#
#   ./scripts/servidor-teste.sh preparar              cria o .env.servidor com segredos aleatórios
#   ./scripts/servidor-teste.sh subir                 compila e liga tudo (liga o túnel se houver token)
#   ./scripts/servidor-teste.sh parar                 desliga tudo (os dados ficam guardados)
#   ./scripts/servidor-teste.sh status                mostra o que está rodando e se a API responde
#   ./scripts/servidor-teste.sh logs [serviço]        acompanha os registros (api, web, site, tunel...)
#   ./scripts/servidor-teste.sh criar-dono            cria a primeira empresa e o proprietário
#   ./scripts/servidor-teste.sh atualizar             baixa a versão nova do código e reaplica
#   ./scripts/servidor-teste.sh backup                copia o banco e os arquivos para BACKUP_DIR
#   ./scripts/servidor-teste.sh restaurar <arquivo>   devolve um backup do banco (apaga os dados atuais!)
set -euo pipefail

cd "$(dirname "$0")/.."
ENV_FILE=".env.servidor"
COMPOSE=(docker compose --project-directory . --env-file "$ENV_FILE" -f docker/compose.prod.yml -f docker/compose.servidor-teste.yml)

erro() { echo "Erro: $*" >&2; exit 1; }
precisa_env() { [[ -f "$ENV_FILE" ]] || erro "não existe $ENV_FILE. Rode primeiro: ./scripts/servidor-teste.sh preparar"; }
valor() { grep -E "^$1=" "$ENV_FILE" | head -n1 | cut -d= -f2-; }
com_tunel() { [[ -n "$(valor CLOUDFLARE_TUNNEL_TOKEN)" ]] && echo "--profile tunel" || true; }

cmd_preparar() {
  [[ -f "$ENV_FILE" ]] && erro "$ENV_FILE já existe (não vou sobrescrever). Apague-o se quiser recomeçar."
  command -v openssl >/dev/null || erro "instale o openssl (pacman -S openssl)."
  cp docker/servidor-teste.env.example "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  # Hexadecimal nas senhas do banco e do armazenamento: caracteres como "/" e "+" quebrariam a URL de conexão.
  sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 24)|" "$ENV_FILE"
  sed -i "s|^S3_ACCESS_KEY=.*|S3_ACCESS_KEY=$(openssl rand -hex 10)|" "$ENV_FILE"
  sed -i "s|^S3_SECRET_KEY=.*|S3_SECRET_KEY=$(openssl rand -hex 24)|" "$ENV_FILE"
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -base64 48 | tr -d '\n')|" "$ENV_FILE"
  sed -i "s|^JWT_REFRESH_SECRET=.*|JWT_REFRESH_SECRET=$(openssl rand -base64 48 | tr -d '\n')|" "$ENV_FILE"
  sed -i "s|^DATA_ENCRYPTION_KEY=.*|DATA_ENCRYPTION_KEY=$(openssl rand -base64 32 | tr -d '\n')|" "$ENV_FILE"
  echo "Criado $ENV_FILE (permissão 600) com segredos aleatórios."
  echo
  echo "AGORA:"
  echo "  1. Abra o arquivo e ajuste WEB_URL e SITE_URL para os seus endereços."
  echo "  2. COPIE a linha DATA_ENCRYPTION_KEY para um gerenciador de senhas, FORA deste notebook."
  echo "  3. Depois rode: ./scripts/servidor-teste.sh subir"
}

cmd_subir() {
  precisa_env
  [[ "$(valor WEB_URL)" == *suaempresa* ]] && erro "ajuste WEB_URL (e SITE_URL) no $ENV_FILE antes de subir."
  # shellcheck disable=SC2046
  "${COMPOSE[@]}" $(com_tunel) up -d --build --wait
  echo "Pronto. Confira com: ./scripts/servidor-teste.sh status"
}

cmd_parar() { precisa_env; "${COMPOSE[@]}" --profile tunel down; }

cmd_status() {
  precisa_env
  "${COMPOSE[@]}" --profile tunel ps
  echo
  if curl -fsS "http://127.0.0.1:$(valor WEB_PORT)/api/v1/health" >/dev/null; then
    echo "API: respondendo."
  else
    echo "API: NÃO está respondendo (veja: ./scripts/servidor-teste.sh logs api)."
  fi
}

cmd_logs() { precisa_env; "${COMPOSE[@]}" --profile tunel logs -f --tail=100 "$@"; }

cmd_criar_dono() {
  precisa_env
  read -r -p "Nome da empresa: " tenant
  read -r -p "Nome do proprietário: " nome
  read -r -p "E-mail do proprietário: " email
  read -r -s -p "Senha (12+ caracteres, com letras e números): " senha
  echo
  "${COMPOSE[@]}" run --rm \
    -e TENANT_NAME="$tenant" -e OWNER_NAME="$nome" -e OWNER_EMAIL="$email" -e OWNER_PASSWORD="$senha" \
    api node dist/cli/create-owner.js
}

cmd_atualizar() {
  precisa_env
  # Sempre faça um backup antes: a atualização pode aplicar mudanças no banco.
  cmd_backup
  git pull --ff-only || echo "(sem git pull: se você copiou o código por outro meio, atualize os arquivos e rode 'subir')"
  cmd_subir
}

cmd_backup() {
  precisa_env
  local dir keep stamp
  dir="$(valor BACKUP_DIR)"; keep="$(valor BACKUP_KEEP_DAYS)"; stamp="$(date +%Y%m%d-%H%M%S)"
  dir="${dir:-/var/backups/voltex}"; keep="${keep:-14}"
  mkdir -p "$dir"
  local user db proj
  user="$(valor POSTGRES_USER)"; db="$(valor POSTGRES_DB)"; proj="voltex"
  # Banco: formato "custom" do pg_dump (já comprimido e restaurável com pg_restore).
  "${COMPOSE[@]}" exec -T postgres pg_dump -U "$user" -d "$db" -Fc > "$dir/banco-$stamp.dump"
  # Arquivos (contratos, propostas, faturas): o volume do armazenamento inteiro.
  # O contêiner roda como root (precisa ler tudo); no fim devolve a posse do arquivo para o seu usuário.
  docker run --rm -e DONO="$(id -u):$(id -g)" -e SELO="$stamp" -v "${proj}_s3-data:/dados:ro" -v "$dir:/saida" alpine \
    sh -c 'tar czf "/saida/arquivos-$SELO.tar.gz" -C /dados . && chown "$DONO" "/saida/arquivos-$SELO.tar.gz"'
  chmod 600 "$dir"/banco-"$stamp".dump "$dir"/arquivos-"$stamp".tar.gz
  find "$dir" -type f \( -name 'banco-*.dump' -o -name 'arquivos-*.tar.gz' \) -mtime "+$keep" -delete
  echo "Backup salvo em $dir (banco-$stamp.dump e arquivos-$stamp.tar.gz). Mantidos os últimos $keep dias."
}

cmd_restaurar() {
  precisa_env
  local arquivo="${1:-}"
  [[ -f "$arquivo" ]] || erro "informe o arquivo de backup do banco (banco-AAAAMMDD-HHMMSS.dump)."
  echo "ATENÇÃO: isto APAGA o banco atual e coloca o do backup no lugar."
  read -r -p "Digite RESTAURAR para continuar: " ok
  [[ "$ok" == "RESTAURAR" ]] || erro "cancelado."
  local user db
  user="$(valor POSTGRES_USER)"; db="$(valor POSTGRES_DB)"
  "${COMPOSE[@]}" stop api
  "${COMPOSE[@]}" exec -T postgres pg_restore -U "$user" -d "$db" --clean --if-exists --no-owner < "$arquivo"
  "${COMPOSE[@]}" start api
  echo "Banco restaurado. Os arquivos (arquivos-*.tar.gz) se devolvem à parte: veja o guia."
}

case "${1:-}" in
  preparar) cmd_preparar ;;
  subir) cmd_subir ;;
  parar) cmd_parar ;;
  status) cmd_status ;;
  logs) shift; cmd_logs "$@" ;;
  criar-dono) cmd_criar_dono ;;
  atualizar) cmd_atualizar ;;
  backup) cmd_backup ;;
  restaurar) shift; cmd_restaurar "$@" ;;
  *) sed -n '2,13p' "$0"; exit 1 ;;
esac
