# API

Base: `/api/v1`. Documentação interativa (Swagger/OpenAPI, gerada a partir dos schemas Zod): `http://localhost:3000/api/docs` em desenvolvimento.

## Convenções

- **REST + JSON**, recursos no plural em `kebab-case`: `/leads`, `/opportunities`, `/energy-bills`.
- **Versionamento** no caminho (`/api/v1`). Mudanças incompatíveis geram `/api/v2`.
- **Autenticação:** `Authorization: Bearer <access token>`; refresh token em cookie `httpOnly`. Rotas públicas são marcadas explicitamente (`@Public()`).
- **Autorização:** toda rota exige permissão (`@RequirePermissions('crm.lead.read')`); negado por padrão.
- **Tenant:** derivado do token. Nunca é enviado pelo cliente.
- **Validação:** schemas Zod de `@voltex/shared`; erro de validação retorna `422`.
- **Datas** em ISO 8601 UTC; **valores monetários** em centavos (inteiro) com moeda explícita quando não for BRL; **unidades físicas** sempre explícitas no nome do campo (`powerKwp`, `energyKwh`, `voltageV`).
- **Paginação** obrigatória em listas: `?page=1&pageSize=20` → `{ data, meta: { page, pageSize, total } }`.
- **Filtros e ordenação:** `?filter[campo]=valor&sort=-createdAt`.
- **Idempotência:** `POST` críticos aceitam `Idempotency-Key`.
- **Erros** no formato único `ApiError`:

```json
{
  "statusCode": 422,
  "code": "VALIDATION_ERROR",
  "message": "Dados inválidos",
  "details": [{ "path": "email", "message": "E-mail inválido" }],
  "requestId": "…"
}
```

## Contrato conceitual (modelagem, seção 39)

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
