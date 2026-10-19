# Variáveis de ambiente

`.env.example` (na raiz) é a referência; `pnpm dev` e `pnpm setup` criam o `.env` a partir dele se não existir (nunca sobrescrevem). `.env` nunca é versionado. A API valida as variáveis com Zod na inicialização (Fase 4) e falha se faltar alguma obrigatória.

| Variável                                                  | Uso                                                           | Padrão (dev)                                                  |
| --------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------- |
| `NODE_ENV`                                                | Ambiente                                                      | `development`                                                 |
| `API_PORT`                                                | Porta da API                                                  | `3000`                                                        |
| `CORS_ORIGIN`                                             | Origem permitida do front                                     | `http://localhost:5173`                                       |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB`     | Credenciais do container PostgreSQL                           | `voltex` / `voltex` / `voltex`                                |
| `POSTGRES_PORT`                                           | Porta do PostgreSQL no host                                   | `5433`                                                        |
| `DATABASE_URL`                                            | Conexão usada por API, Prisma e seed                          | `postgresql://voltex:voltex@localhost:5433/voltex`            |
| `REDIS_PORT` / `REDIS_URL`                                | Redis (filas BullMQ)                                          | `6379` / `redis://localhost:6379`                             |
| `S3_API_PORT` / `S3_CONSOLE_PORT`                         | Portas do armazenamento S3 local                              | `9000` / `9001`                                               |
| `S3_ENDPOINT`                                             | Endpoint S3                                                   | `http://localhost:9000`                                       |
| `S3_REGION`                                               | Região                                                        | `us-east-1`                                                   |
| `S3_BUCKET`                                               | Bucket de documentos                                          | `voltex-documents`                                            |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY`                         | Credenciais S3                                                | `voltex` / `voltex-secret`                                    |
| `S3_FORCE_PATH_STYLE`                                     | Endereçamento por caminho (necessário no S3 local)            | `true`                                                        |
| `SMTP_HOST` / `SMTP_PORT`                                 | E-mail (Mailpit em dev)                                       | `localhost` / `1025`                                          |
| `MAILPIT_UI_PORT`                                         | Interface do Mailpit                                          | `8025`                                                        |
| `MAIL_FROM`                                               | Remetente                                                     | `Voltex SolTech <no-reply@voltex.local>`                      |
| `JWT_SECRET` / `JWT_REFRESH_SECRET`                       | Assinatura dos tokens                                         | valores de dev — **trocar**                                   |
| `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL`                      | Validade dos tokens                                           | `15m` / `7d`                                                  |
| `DATA_ENCRYPTION_KEY`                                     | Chave-mestra (32 bytes, base64) dos CPF/CNPJ cifrados         | chave de dev embutida — **obrigatória e própria em produção** |
| `TRUST_PROXY`                                             | Proxies confiáveis na frente da API (nginx = 1)               | `0`                                                           |
| `AUTOMATION_SCAN_INTERVAL_MS` / `AUTOMATION_QUEUE_PREFIX` | Varredura das automações do CRM (0 desliga) e prefixo da fila | `60000` / `voltex`                                            |
| `SEED_PASSWORD`                                           | Senha dos usuários do seed (só dev)                           | `Voltex@2026`                                                 |
| `VITE_API_URL`                                            | URL da API usada pelo front                                   | `http://localhost:3000/api/v1`                                |

**Segurança:** segredos de homologação e produção ficam no gerenciador de secrets do ambiente, nunca no repositório. Gere valores com `openssl rand -base64 48`. No `compose.prod.yml`, `POSTGRES_*` e `S3_ACCESS_KEY`/`S3_SECRET_KEY` são obrigatórios.
