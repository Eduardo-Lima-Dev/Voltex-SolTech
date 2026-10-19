# ADR-0001: Monorepo com Turborepo e pnpm

- **Status:** Aceita
- **Data:** 2026-10-18

## Contexto

A suíte tem uma API, um front e código que precisa ser compartilhado (tipos, validações, cálculos, banco). Manter repositórios separados geraria divergência de contratos.

## Decisão

Um único repositório com pnpm workspaces e Turborepo para orquestrar `dev`, `build`, `lint`, `typecheck` e `test` com cache. Estrutura: `apps/` (api, web) e `packages/` (shared, solar-engine, database, ui, configs). Node >= 24, pnpm fixado via `packageManager`.

## Consequências

Mudanças de contrato são atômicas (um commit altera API, front e pacote compartilhado). Um único comando sobe tudo. Exige disciplina nas regras de dependência entre pacotes (ver [arquitetura](../../03-diagramas/arquitetura.md)).

## Alternativas consideradas

npm workspaces (menos estrito e mais lento); Nx (mais pesado do que o necessário); repositórios separados (contratos divergem).
