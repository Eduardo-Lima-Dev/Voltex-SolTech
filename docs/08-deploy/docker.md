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

Estado atual: infraestrutura + `migrate`, **validado de ponta a ponta** (build da imagem, banco novo, migrations aplicadas). Os serviços `api` e `web` (imagens multi-stage, `nginx` com proxy `/api`, `depends_on: migrate: service_completed_successfully`) são adicionados na **Fase 8**.

Comandos: `pnpm docker:build`, `pnpm docker:up`, `pnpm docker:down`.

## Ambientes

| Ambiente        | Branch       | Observação                                   |
| --------------- | ------------ | -------------------------------------------- |
| Desenvolvimento | `develop`    | Máquinas dos desenvolvedores                 |
| Homologação     | `homologate` | Mesma composição de produção, dados de teste |
| Produção        | `main`       | Imagens versionadas por tag                  |
