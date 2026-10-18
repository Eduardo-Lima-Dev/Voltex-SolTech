# Variáveis de ambiente

O arquivo `.env.example` (Fase 3) é a referência; `.env` nunca é versionado. A API valida as variáveis com Zod na inicialização e falha se faltar alguma obrigatória.

| Variável                             | Uso                              | Exemplo (dev)                                      |
| ------------------------------------ | -------------------------------- | -------------------------------------------------- |
| `NODE_ENV`                           | Ambiente                         | `development`                                      |
| `API_PORT`                           | Porta da API                     | `3000`                                             |
| `DATABASE_URL`                       | Conexão PostgreSQL               | `postgresql://voltex:voltex@localhost:5432/voltex` |
| `REDIS_URL`                          | Conexão Redis                    | `redis://localhost:6379`                           |
| `JWT_SECRET`                         | Assinatura do access token       | _gerar valor aleatório_                            |
| `JWT_REFRESH_SECRET`                 | Assinatura do refresh token      | _gerar valor aleatório_                            |
| `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL` | Validade dos tokens              | `15m` / `7d`                                       |
| `S3_ENDPOINT`                        | Endpoint S3/MinIO                | `http://localhost:9000`                            |
| `S3_BUCKET`                          | Bucket de documentos             | `voltex-documents`                                 |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY`    | Credenciais                      | _definir_                                          |
| `SMTP_HOST` / `SMTP_PORT`            | E-mail (Mailpit em dev)          | `localhost` / `1025`                               |
| `CORS_ORIGIN`                        | Origem permitida do front        | `http://localhost:5173`                            |
| `FIELD_ENCRYPTION_KEY`               | Criptografia de campos sensíveis | _gerar valor aleatório_                            |
| `VITE_API_URL`                       | URL da API usada pelo front      | `http://localhost:3000/api/v1`                     |

**Segurança:** segredos de homologação e produção ficam no gerenciador de secrets do ambiente, nunca no repositório.
