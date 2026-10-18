# ADR-0005: Multi-tenancy por coluna `tenantId`

- **Status:** Aceita
- **Data:** 2026-10-18

## Contexto

Cada integradora é um tenant e seus dados não podem vazar para outro. A seção 60 pede isolamento lógico, RBAC e possibilidade de isolamento físico no futuro.

## Decisão

Banco único, coluna `tenantId` em toda tabela de negócio. O `tenantId` vem do JWT, é guardado em contexto assíncrono por requisição e uma extensão do Prisma injeta o filtro automaticamente nos modelos com escopo de tenant. Testes e2e verificam isolamento entre dois tenants.

## Consequências

Defesa em profundidade contra esquecimento de filtro. Migração futura para schema/banco por tenant é possível porque o acesso passa por uma camada única. Operações administrativas entre tenants exigem caminho explícito.

## Alternativas consideradas

Schema por tenant (migrations e conexões mais complexas); banco por tenant (custo alto); Row Level Security do Postgres (pode ser adicionado depois como camada extra).
