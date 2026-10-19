# Banco de dados

PostgreSQL 17 + Prisma 7 em `packages/database` (`@voltex/database`). Decisões: [ADR-0003](../04-arquitetura/adr/0003-postgres-prisma.md), [ADR-0009](../04-arquitetura/adr/0009-prisma-7.md) e [ADR-0005](../04-arquitetura/adr/0005-multi-tenancy.md).

## Estrutura

```
packages/database/
├── prisma.config.ts          # schema, migrations, seed e URL do banco
├── prisma/
│   ├── schema/               # um .prisma por domínio
│   │   ├── schema.prisma     # generator + datasource
│   │   └── platform.prisma   # Tenant, Branch, Team, User, RefreshToken, AuditLog, OutboxEvent, Invitation, Document
│   ├── migrations/           # versionadas no Git
│   └── seed.ts               # dados de demonstração (somente dev)
└── src/
    ├── client.ts             # createPrismaClient() com adapter pg
    ├── tenant-scope.ts       # TENANT_SCOPED_MODELS
    └── generated/            # client gerado (NÃO versionado)
```

Modelo atual: [ER da plataforma](../03-diagramas/er/plataforma.md). Os modelos do CRM e do Calculator chegam nas Fases 6 e 7.

## Convenções

- IDs `uuid(7)` (ordenáveis por tempo), coluna `@db.Uuid`.
- Tabelas em `snake_case` plural (`@@map("users")`), colunas em `snake_case` (`@map("tenant_id")`), campos em `camelCase`.
- Todo modelo de negócio tem `tenantId` obrigatório e um índice que **começa** por ele.
- `createdAt`/`updatedAt` sempre; `deletedAt` quando houver soft delete.
- Dinheiro em centavos (inteiro); campos físicos com unidade no nome.
- Logs e snapshots são imutáveis: sem `updatedAt`, sem update/delete.

### Adicionando um modelo com `tenantId`

1. Declare o modelo com `tenantId String @map("tenant_id") @db.Uuid` e `@@index([tenantId, ...])`.
2. Inclua o nome em `TENANT_SCOPED_MODELS` (`src/tenant-scope.ts`). O teste `tenant-scope.test.ts` falha se faltar, se o campo não for uuid obrigatório ou se não houver índice por tenant.
3. Crie a migration (`pnpm db:migrate`).

### Audit log imutável

Um trigger (`audit_logs_immutable`, migration `audit_log_immutable`) recusa `UPDATE` e `DELETE` em `audit_logs`, mesmo para quem acessa o banco direto. Qualquer outro log imutável deve seguir o mesmo padrão.

## Comandos

Da raiz do monorepo:

| Comando            | Faz                                                                 |
| ------------------ | ------------------------------------------------------------------- |
| `pnpm db:generate` | Gera o client Prisma (também roda no `postinstall` e no `build`)    |
| `pnpm db:migrate`  | Cria/aplica migrations em desenvolvimento (`prisma migrate dev`)    |
| `pnpm db:deploy`   | Aplica migrations pendentes sem prompts (CI, homologação, produção) |
| `pnpm db:seed`     | Popula dados de demonstração (idempotente)                          |
| `pnpm db:studio`   | Abre o Prisma Studio                                                |

Reset completo do banco de desenvolvimento: `pnpm --filter @voltex/database exec prisma migrate reset` (apaga todos os dados). O Prisma exige consentimento explícito do usuário quando o comando é chamado por um agente de IA.

## Seed de demonstração

Senha de todos os usuários: valor de `SEED_PASSWORD` no `.env` (padrão `Voltex@2026`). O seed recusa rodar com `NODE_ENV=production`.

| Tenant              | E-mail                   | Perfil         |
| ------------------- | ------------------------ | -------------- |
| Voltex Demo         | `owner@voltex.demo`      | OWNER          |
| Voltex Demo         | `admin@voltex.demo`      | ADMIN          |
| Voltex Demo         | `gestor@voltex.demo`     | SALES_MANAGER  |
| Voltex Demo         | `sdr@voltex.demo`        | SDR            |
| Voltex Demo         | `vendedor@voltex.demo`   | SALESPERSON    |
| Voltex Demo         | `engenharia@voltex.demo` | ENGINEERING    |
| Voltex Demo         | `rt@voltex.demo`         | TECHNICAL_LEAD |
| Voltex Demo         | `operacao@voltex.demo`   | OPERATIONS     |
| Voltex Demo         | `financeiro@voltex.demo` | FINANCE        |
| Rival Energia Solar | `owner@rival.demo`       | OWNER          |

O segundo tenant existe para testar manualmente (e nos testes e2e da Fase 4) o isolamento entre empresas. O pipeline padrão entra no seed junto com as tabelas do CRM (Fase 7).

## Usando o client

```ts
import { createPrismaClient } from '@voltex/database';

const prisma = createPrismaClient(); // usa DATABASE_URL
const user = await prisma.user.findUnique({ where: { email } });
```

A API NestJS usa `PrismaService` com duas portas — `db` (extensão de tenant sobre `TENANT_SCOPED_MODELS`, falha sem tenant) e `system` (sem filtro, só para login/convite/outbox). Veja [API](api.md#acesso-a-dados-e-tenant-adr-0012).
