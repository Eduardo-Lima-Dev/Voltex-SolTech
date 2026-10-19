# Docker

Duas composições, conforme o [ADR-0008](../04-arquitetura/adr/0008-dev-hibrido-docker.md).

## Desenvolvimento — `docker/compose.dev.yml`

Somente infraestrutura, todos os serviços com `healthcheck` (por isso `up --wait` funciona). Projeto Docker: `voltex-dev`.

| Serviço    | Imagem               | Porta no host               | Observação                                                                                                                                                                                 |
| ---------- | -------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `postgres` | `postgres:17-alpine` | **5433**                    | A 5433 evita conflito com um PostgreSQL local na 5432; configurável por `POSTGRES_PORT`. `docker/postgres/init.sql` cria as extensões `pg_trgm` e `unaccent` na primeira criação do volume |
| `redis`    | `redis:7-alpine`     | 6379                        | Persistência AOF                                                                                                                                                                           |
| `s3`       | `rustfs/rustfs`      | 9000 (API) / 9001 (console) | S3-compatível ([ADR-0010](../04-arquitetura/adr/0010-rustfs-no-lugar-do-minio.md))                                                                                                         |
| `s3-init`  | `amazon/aws-cli`     | —                           | Job único: cria o bucket `S3_BUCKET` e termina                                                                                                                                             |
| `mailpit`  | `axllent/mailpit`    | 8025 (UI) / 1025 (SMTP)     | Captura e-mails de desenvolvimento                                                                                                                                                         |

As variáveis vêm do `.env` da raiz (os comandos usam `--project-directory .`); sem `.env`, valem os padrões do arquivo. Os dados ficam em volumes nomeados e sobrevivem a `pnpm infra:down`. Para apagar os dados: `docker compose --project-directory . -f docker/compose.dev.yml down -v`.

`pnpm dev` executa: criar `.env` se não existir → `docker compose up -d --wait` → `turbo run dev` (watchers dos pacotes; API e Web entram nas Fases 4 e 5).

## Produção/homologação — `docker/compose.prod.yml`

Projeto Docker: `voltex`. **Nenhuma porta é publicada no host**; os segredos são obrigatórios (`${VAR:?}`, sem valor padrão).

| Serviço                              | Descrição                                                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `postgres`, `redis`, `s3`, `s3-init` | Infraestrutura (em produção real, preferir serviços gerenciados)                                                                      |
| `migrate`                            | Job único (`docker/migrate.Dockerfile`, `node:24-alpine` + Prisma CLI 7.10.1) que roda `prisma migrate deploy` e termina com código 0 |

Serviços de aplicação (Fase 8):

| Serviço | Descrição                                                                                                                                                                                               |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api`   | `apps/api/Dockerfile` (multi-stage: build com Turbo, `pnpm deploy --prod`, runtime `node:24-alpine` **sem root**). Depende de `migrate` e `s3-init` concluídos. `TRUST_PROXY=1` (atrás do nginx)        |
| `web`   | `apps/web/Dockerfile` (build Vite + `nginx-unprivileged`): SPA com fallback para `index.html`, proxy de `/api` para a API, cabeçalhos de segurança. **Única porta publicada** (`WEB_PORT`, padrão 8080) |

Validado de ponta a ponta: build das imagens, pilha completa saudável, login pela porta pública (nginx → API), página pública `/p/:token` servida pela SPA, usuário `1000` na API.

**Primeiro acesso:** o banco novo não tem usuários (o seed de demonstração é recusado em produção). Crie a primeira empresa e o proprietário:

```bash
docker compose -f docker/compose.prod.yml run --rm \
  -e TENANT_NAME="Sua Empresa" -e OWNER_NAME="Nome Sobrenome" \
  -e OWNER_EMAIL=voce@empresa.com.br -e OWNER_PASSWORD='senha longa e única' \
  api node dist/cli/create-owner.js
```

A senha vem só do ambiente (12+ caracteres, letras e números) e não é gravada em log; recusa e-mail ou empresa já existentes.

**CI** (`.github/workflows/ci.yml`): em push (`develop`, `homolog`, `main`) e PR — instala com `--frozen-lockfile`, sobe a infra, roda lint, typecheck, testes, build e os e2e da API; depois constrói as imagens (`api`, `web`, `migrate`) com cache. O workflow **ainda não rodou no GitHub** (foi validado só localmente).

Comandos: `pnpm docker:build`, `pnpm docker:up`, `pnpm docker:down`.

## Tamanho das imagens

Todas são multi-stage: o estágio de compilação (com Turbo, pnpm e dependências de desenvolvimento) **não** vai para a imagem final.

| Imagem    | Antes   | Agora      | Como                                                                                                                                                                                                                                          |
| --------- | ------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api`     | 805 MB  | **330 MB** | Dependências só de produção, sem a CLI do Prisma (peer opcional que trazia ~150 MB), sem mapas/tipos/documentação, sem os compiladores de consulta de outros bancos, e base Alpine mínima com só o binário do Node (sem npm, yarn e corepack) |
| `migrate` | 1,04 GB | **493 MB** | Instalação em estágio separado (sem cache do npm) e base mínima                                                                                                                                                                               |
| `web`     | 105 MB  | **42 MB**  | `nginx-unprivileged:alpine-slim`                                                                                                                                                                                                              |
| `site`    | 94 MB   | **32 MB**  | `nginx-unprivileged:alpine-slim`                                                                                                                                                                                                              |

A imagem da API foi validada com os 18 testes de navegador e a **jornada completa do integrador** rodando contra ela (`E2E_API_IMAGE=voltex/api:local pnpm jornada`), além da pilha de produção inteira. A API continua rodando **sem root**.

## Ambientes

| Ambiente        | Branch    | Observação                                   |
| --------------- | --------- | -------------------------------------------- |
| Desenvolvimento | `develop` | Máquinas dos desenvolvedores                 |
| Homologação     | `homolog` | Mesma composição de produção, dados de teste |
| Produção        | `main`    | Imagens versionadas por tag                  |

## Tipos de deploy

A composição `compose.prod.yml` é a base de todos. Cada tipo de deploy acrescenta o que precisa:

| Tipo                                                          | Para quê                                           | Guia                                      |
| ------------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------- |
| **1. Servidor de teste em casa** (notebook)                   | Demonstrar e testar com dados fictícios, sem custo | [Servidor de teste](servidor-de-teste.md) |
| **2. Serviços gratuitos na nuvem** (Vercel, Render, Supabase) | Demonstrar sem pagar e sem depender do notebook    | [Nuvem gratuita](nuvem-gratuita.md)       |
| 3. Servidor pago ou gerenciado                                | Cliente real, backup fora de casa                  | _a definir_                               |
