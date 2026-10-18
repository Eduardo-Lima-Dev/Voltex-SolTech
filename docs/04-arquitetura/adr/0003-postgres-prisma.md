# ADR-0003: PostgreSQL com Prisma

- **Status:** Aceita
- **Data:** 2026-10-18

## Contexto

Necessidade de dados relacionais fortes (contas, oportunidades, projetos), transações para outbox e snapshots, e tipagem ponta a ponta.

## Decisão

PostgreSQL 17 com Prisma 6, schema multi-arquivo por domínio em `packages/database/prisma/schema`. Convenções: IDs únicos, `tenantId` em tabelas de negócio, `createdAt/updatedAt`, `deletedAt` para soft delete, nomes `snake_case` via `@@map`. Só `apps/api` importa o client.

## Consequências

Migrations versionadas e tipos gerados. Consultas muito específicas podem exigir SQL cru. O front nunca depende do Prisma.

## Alternativas consideradas

TypeORM e MikroORM (menor ergonomia de tipos/migrations); Drizzle (menos maduro no ecossistema Nest quando a decisão foi tomada).
