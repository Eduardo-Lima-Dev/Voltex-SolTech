# Docker

Duas composições, conforme o [ADR-0008](../04-arquitetura/adr/0008-dev-hibrido-docker.md). Os arquivos são criados na Fase 3 (infra) e finalizados na Fase 8 (imagens de produção).

## Desenvolvimento — `docker/compose.dev.yml`

Somente infraestrutura, com `healthcheck` para o `--wait` funcionar:

| Serviço    | Imagem                                   | Porta       |
| ---------- | ---------------------------------------- | ----------- |
| `postgres` | `postgres:17-alpine`                     | 5432        |
| `redis`    | `redis:7-alpine`                         | 6379        |
| `minio`    | `minio/minio` (+ job `mc` cria o bucket) | 9000 / 9001 |
| `mailpit`  | `axllent/mailpit`                        | 8025 / 1025 |

`pnpm dev` executa `docker compose -f docker/compose.dev.yml up -d --wait` e depois o Turborepo sobe API e Web localmente com hot reload.

## Produção — `docker/compose.prod.yml`

| Serviço                      | Descrição                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------- |
| `migrate`                    | Job único: `prisma migrate deploy` antes da API                                 |
| `api`                        | Imagem multi-stage (`turbo prune --docker`), `node:24-alpine`, usuário não-root |
| `web`                        | Build Vite servido por `nginx:alpine`, fallback SPA e proxy `/api`              |
| `postgres`, `redis`, `minio` | Infraestrutura (em produção real, preferir serviços gerenciados)                |

Comandos: `pnpm docker:build` e `pnpm docker:up`.

## Ambientes

| Ambiente        | Branch       | Observação                                   |
| --------------- | ------------ | -------------------------------------------- |
| Desenvolvimento | `develop`    | Máquinas dos desenvolvedores                 |
| Homologação     | `homologate` | Mesma composição de produção, dados de teste |
| Produção        | `main`       | Imagens versionadas por tag                  |
