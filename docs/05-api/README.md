# API

Base: `/api/v1`. Documentação interativa (Swagger/OpenAPI, gerada a partir dos schemas Zod): `http://localhost:3000/api/docs` em desenvolvimento.

## Convenções

- **REST + JSON**, recursos no plural em `kebab-case`: `/users`, `/branches`, `/audit-logs`.
- **Versionamento** no caminho (`/api/v1`). Mudanças incompatíveis geram `/api/v2`.
- **Autenticação:** `Authorization: Bearer <accessToken>`. O refresh token vai somente em cookie `httpOnly` (`voltex_refresh`, `Path=/api/v1/auth`). O front deve enviar as requisições de `/auth/*` com `credentials: 'include'`. Detalhes: [ADR-0011](../04-arquitetura/adr/0011-sessao-jwt-e-refresh-rotativo.md).
- **Autorização:** negado por padrão; cada rota declara `@Public()`, `@Authenticated()` ou `@RequirePermissions(...)`.
- **Tenant:** derivado do token; qualquer `tenantId` enviado pelo cliente é ignorado. Dado de outro tenant responde **404** (não 403), para não revelar que existe.
- **Validação:** schemas Zod de `@voltex/shared`; erro de validação retorna **422** com `details` por campo, com mensagens em **português do Brasil**. UUID inválido em `:id` retorna 400.
- **Datas** em ISO 8601 UTC; **dinheiro** em centavos (inteiro); **unidades físicas** no nome do campo (`powerKwp`, `energyKwh`).
- **Paginação** obrigatória em listas: `?page=1&pageSize=20` (máx. 100) → `{ data, meta: { page, pageSize, total } }`.
- **Limite de requisições:** 120/min por IP (padrão) e 5/min em `POST /auth/login`; excedido → **429**.
- **Rastreamento:** toda resposta traz `x-request-id` (aceita o do cliente se seguro); o mesmo ID vai nos logs, na auditoria e no corpo dos erros.
- **Erros** no formato único `ApiError`:

```json
{
  "statusCode": 422,
  "code": "VALIDATION_ERROR",
  "message": "Dados inválidos",
  "details": [{ "path": "email", "message": "E-mail inválido" }],
  "requestId": "6f1c…"
}
```

Códigos: `BAD_REQUEST` 400 · `UNAUTHORIZED` 401 · `FORBIDDEN` 403 · `NOT_FOUND` 404 · `CONFLICT` 409 · `PAYLOAD_TOO_LARGE` 413 · `UNSUPPORTED_MEDIA_TYPE` 415 · `VALIDATION_ERROR` 422 · `TOO_MANY_REQUESTS` 429 · `INTERNAL_ERROR` 500 (sem detalhes internos).

## Endpoints implementados (Fase 4)

| Método e rota                                                           | Acesso                                 | Descrição                                                                   |
| ----------------------------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------- |
| `POST /auth/login`                                                      | público                                | Login; devolve `accessToken`, `expiresIn`, `user`; seta o cookie de refresh |
| `POST /auth/refresh`                                                    | público (cookie)                       | Rotaciona o refresh token e emite novo access token                         |
| `POST /auth/logout`                                                     | público (cookie)                       | Revoga a sessão; 204, idempotente                                           |
| `GET /auth/me`                                                          | autenticado                            | Usuário atual e permissões                                                  |
| `GET /tenant` · `PATCH /tenant`                                         | autenticado · `platform.tenant.manage` | Dados da empresa                                                            |
| `GET/POST /branches` · `PATCH/DELETE /branches/:id`                     | autenticado · `platform.tenant.manage` | Filiais                                                                     |
| `GET/POST /teams` · `PATCH/DELETE /teams/:id`                           | autenticado · `platform.tenant.manage` | Times                                                                       |
| `GET /users` · `GET /users/:id`                                         | `platform.user.read`                   | Usuários (filtros `search`, `role`, `isActive`)                             |
| `PATCH /users/:id` · `DELETE /users/:id`                                | `platform.user.manage`                 | Editar / excluir (lógico)                                                   |
| `POST/GET /invitations` · `DELETE /invitations/:id`                     | `platform.user.manage`                 | Convites                                                                    |
| `POST /invitations/accept`                                              | público                                | Aceita o convite, cria o usuário e já abre a sessão                         |
| `POST /documents`                                                       | `platform.document.write`              | Upload multipart (`file`, `entityType`+`entityId`, `replacesDocumentId`)    |
| `GET /documents` · `GET /documents/:id` · `GET /documents/:id/versions` | `platform.document.read`               | Consulta                                                                    |
| `GET /documents/:id/download-url`                                       | `platform.document.read`               | URL pré-assinada (5 min)                                                    |
| `DELETE /documents/:id`                                                 | `platform.document.write`              | Exclusão lógica                                                             |
| `GET /audit-logs`                                                       | `platform.audit.read`                  | Auditoria (filtros `entity`, `entityId`, `actorId`, `action`, `from`, `to`) |
| `GET /health`                                                           | público                                | Banco, Redis e armazenamento; 503 se algum falhar                           |

Documentação interativa: `/api/docs`. Visão do código: [API (NestJS)](../07-desenvolvimento/api.md).

## Endpoints implementados (Fase 6)

| Método e rota                                                           | Acesso                                                            | Descrição                                                                                     |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `GET /calculations/quick/config`                                        | `calculator.session.read`                                         | Regra em vigor: limites, custo de disponibilidade e fontes (usada também no preview do front) |
| `POST /calculations/quick`                                              | `calculator.session.create`                                       | Recalcula **no servidor** com a regra da empresa, grava sessão, auditoria e evento            |
| `GET /calculations/quick` · `GET /calculations/quick/:id`               | `calculator.session.read`                                         | Lista paginada (`search`, `trafficLight`) e detalhe                                           |
| `POST /calculations/quick/:id/snapshot`                                 | `calculator.snapshot.create`                                      | Congela entrada, resultado, regra e versão do algoritmo (imutável)                            |
| `GET /calculations/quick/:id/snapshots` · `GET …/snapshots/:snapshotId` | `calculator.session.read`                                         | Snapshots de um cálculo; um snapshot                                                          |
| `GET/POST /distributors` · `PATCH/DELETE /distributors/:id`             | leitura `calculator.session.read`; escrita `platform.rule.manage` | Concessionárias                                                                               |
| `GET/POST /tariffs` · `DELETE /tariffs/:id`                             | idem                                                              | Tarifas com vigência e fonte (filtros `distributorId`, `customerGroup`)                       |
| `GET/POST /solar-resources` · `GET/DELETE /solar-resources/:id`         | idem                                                              | Irradiação (HSP mensal) por local, com fonte; `POST` atualiza o mesmo nome+UF                 |
| `POST /solar-resources/import`                                          | `platform.rule.manage`                                            | Importação em lote (até 500 linhas); devolve `{ created, updated }`                           |
| `GET /rules` · `GET /rules/effective`                                   | `platform.rule.read`                                              | Versões da regra e regra em vigor                                                             |
| `POST /rules` · `POST /rules/:id/activate` · `DELETE /rules/:id`        | `platform.rule.manage`                                            | Criar rascunho, ativar (exige `reviewedBy`) e excluir rascunho                                |

Particularidades do Calculator:

- O cliente **não** define limites: qualquer `thresholds` enviado é ignorado; valem os da regra da empresa. O preview do front usa o mesmo motor e os mesmos limites (`/config`), por isso bate com o que o servidor grava.
- `references` (`solarResourceId`, `tariffId`) é opcional; o servidor registra a fonte e se o usuário alterou o valor (`overridden`). Id inexistente ou de outra empresa → **404**.
- `POST /calculations/quick`: corpo `{ title?, customerName?, references?, input }`; erro de entrada → **422** com o caminho do campo (`input.costPerWpCents`).

## Contrato conceitual dos demais produtos (modelagem, seção 39)

```http
# CRM
POST /api/v1/leads
POST /api/v1/opportunities
GET  /api/v1/opportunities/{id}
POST /api/v1/opportunities/{id}/stage
POST /api/v1/opportunities/{id}/engineering-request
POST /api/v1/opportunities/{id}/proposal
POST /api/v1/projects
GET  /api/v1/projects/{id}

# Documentos / OCR
POST /api/v1/documents
POST /api/v1/energy-bills/parse
POST /api/v1/energy-bills/{id}/validate

# Solar Calculator
POST /api/v1/calculations/quick
GET  /api/v1/calculations/quick/{id}
POST /api/v1/calculations/quick/{id}/snapshot

# Solar Engine Studio (MVP2)
POST /api/v1/engineering/projects
POST /api/v1/engineering/projects/{id}/versions
POST /api/v1/engineering/projects/{id}/validate
POST /api/v1/engineering/projects/{id}/approve
GET  /api/v1/engineering/projects/{id}/snapshot

# Off-Grid Designer (MVP3)
POST /api/v1/offgrid/projects
POST /api/v1/offgrid/projects/{id}/loads
POST /api/v1/offgrid/projects/{id}/scenarios
POST /api/v1/offgrid/scenarios/{id}/simulate
POST /api/v1/offgrid/scenarios/{id}/approve

# Catálogo
GET  /api/v1/catalog/modules
GET  /api/v1/catalog/inverters
GET  /api/v1/catalog/batteries
GET  /api/v1/catalog/controllers
POST /api/v1/catalog/equipment/import
```

Este é o contrato conceitual; o contrato real é o Swagger gerado pela API.
