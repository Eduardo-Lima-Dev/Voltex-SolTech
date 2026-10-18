# Setup local

## Pré-requisitos

- Node.js >= 24 (`nvm use` lê o `.nvmrc`)
- pnpm >= 9
- Docker e Docker Compose
- Git

## Passo a passo

```bash
git clone git@github.com:Eduardo-Lima-Dev/Voltex-SolTech.git
cd Voltex-SolTech
pnpm setup     # cria o .env, instala, sobe a infra, aplica migrations e popula o banco
pnpm dev       # infra (Docker) + watchers dos pacotes + API + Web
```

`pnpm dev` e `npm run dev` fazem a mesma coisa. Abra http://localhost:5173 e entre com um usuário de demonstração (por exemplo `owner@voltex.demo` / `Voltex@2026`): veja a lista em [banco de dados](banco-de-dados.md#seed-de-demonstração).

## Endereços em desenvolvimento

| Serviço                  | URL / porta                                                                |
| ------------------------ | -------------------------------------------------------------------------- |
| Web (React)              | http://localhost:5173                                                      |
| API — Fase 4             | http://localhost:3000/api/v1                                               |
| Swagger — Fase 4         | http://localhost:3000/api/docs                                             |
| PostgreSQL               | localhost:**5433**                                                         |
| Redis                    | localhost:6379                                                             |
| S3 local (API / console) | http://localhost:9000 / http://localhost:9001 (`voltex` / `voltex-secret`) |
| Mailpit                  | http://localhost:8025                                                      |

Se alguma porta já estiver em uso na sua máquina, altere-a no `.env` (`POSTGRES_PORT`, `REDIS_PORT`, `S3_API_PORT`...) e ajuste as URLs correspondentes.

## Scripts da raiz

| Script                                                                    | O que faz                                                                             |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `pnpm dev`                                                                | Garante o `.env`, sobe a infra e roda os watchers via Turborepo                       |
| `pnpm setup`                                                              | Primeira configuração completa (idempotente)                                          |
| `pnpm infra:up` / `infra:down` / `infra:ps` / `infra:logs`                | Gerencia PostgreSQL, Redis, S3 local e Mailpit                                        |
| `pnpm build` / `lint` / `typecheck` / `test`                              | Qualidade, via Turborepo                                                              |
| `pnpm test:e2e`                                                           | Testes e2e da API (sobe a infra; usa o banco `voltex_test`, recriado a cada execução) |
| `pnpm format` / `format:check`                                            | Prettier                                                                              |
| `pnpm db:generate` / `db:migrate` / `db:deploy` / `db:seed` / `db:studio` | Banco ([guia](banco-de-dados.md))                                                     |
| `pnpm docker:build` / `docker:up` / `docker:down`                         | Composição de produção ([Docker](../08-deploy/docker.md))                             |

## Problemas comuns

- **Porta 5432 ocupada:** já é evitada (usamos 5433). Para outras portas, veja acima.
- **`prisma generate` falha após clonar:** rode `pnpm install` (o `postinstall` gera o client).
- **"Muitas tentativas de login":** a API limita o login a 5 por minuto por IP; espere um minuto (ou, só em desenvolvimento, use `THROTTLE_DISABLED=true`).
- **Erro `DATABASE_URL-nao-definida.invalid`:** o `.env` não foi carregado; rode `node scripts/ensure-env.mjs`.
