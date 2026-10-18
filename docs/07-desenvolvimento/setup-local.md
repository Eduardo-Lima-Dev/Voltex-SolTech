# Setup local

## Pré-requisitos

- Node.js >= 24 (`nvm use` lê o `.nvmrc`)
- pnpm >= 9 (`npm i -g pnpm` ou Corepack)
- Docker e Docker Compose
- Git

## Passo a passo

```bash
git clone git@github.com:Eduardo-Lima-Dev/Voltex-SolTech.git
cd Voltex-SolTech
cp .env.example .env     # disponível a partir da Fase 3
pnpm setup               # instala, sobe infra, migra e popula o banco
pnpm dev                 # infra + API + Web
```

> `pnpm setup`, `pnpm dev` completo e o Docker de infra ficam disponíveis a partir da Fase 3; `apps/api` e `apps/web` a partir das Fases 4 e 5. Veja o [roadmap](../09-roadmap/roadmap.md).

## Endereços em desenvolvimento

| Serviço               | URL                             |
| --------------------- | ------------------------------- |
| Web (React)           | http://localhost:5173           |
| API                   | http://localhost:3000/api/v1    |
| Swagger               | http://localhost:3000/api/docs  |
| PostgreSQL            | localhost:5432                  |
| Redis                 | localhost:6379                  |
| MinIO (API / console) | localhost:9000 / localhost:9001 |
| Mailpit               | http://localhost:8025           |

## Scripts da raiz

| Script                                      | O que faz                                                                        |
| ------------------------------------------- | -------------------------------------------------------------------------------- |
| `pnpm dev`                                  | Sobe infra (Docker) e roda API + Web em paralelo (`npm run dev` também funciona) |
| `pnpm infra:up` / `infra:down`              | Sobe/derruba PostgreSQL, Redis, MinIO e Mailpit                                  |
| `pnpm build`                                | Build de todos os pacotes e apps                                                 |
| `pnpm lint` / `typecheck` / `test`          | Qualidade, via Turborepo                                                         |
| `pnpm format` / `format:check`              | Prettier                                                                         |
| `pnpm db:migrate` / `db:seed` / `db:studio` | Banco (Fase 3)                                                                   |
| `pnpm docker:build` / `docker:up`           | Imagens e execução de produção (Fase 3/8)                                        |
