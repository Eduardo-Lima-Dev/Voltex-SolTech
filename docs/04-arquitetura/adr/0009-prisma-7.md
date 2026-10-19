# ADR-0009: Prisma 7 com driver adapter

- **Status:** Aceita
- **Data:** 2026-10-18

## Contexto

A [ADR-0003](0003-postgres-prisma.md) previa Prisma 6. Na implementação da Fase 3, a linha estável atual do Prisma é a 7.x (`@prisma/client` 7.10.1); a tag `latest` do CLI aponta para um release candidate da 8.x, que não usamos.

## Decisão

Usar **Prisma 7.10.x**, com versão fixa (`7.10.1`) para CLI, client e adapter. Consequências diretas da versão:

- `prisma.config.ts` define schema (`prisma/schema`), migrations, seed e a URL do banco (a `datasource` do schema não tem mais `url`).
- O client usa **driver adapter** (`@prisma/adapter-pg`) e é criado por `createPrismaClient()` em `@voltex/database`.
- Generator `prisma-client`, com saída em `packages/database/src/generated` (ignorada no Git, gerada no `postinstall` e no `build`) e `moduleFormat = "cjs"`, para a API NestJS em CommonJS.
- Não existe mais `Prisma.dmmf` público: testes que precisam da lista de modelos leem os arquivos `.prisma`.
- `prisma migrate reset` pede consentimento explícito quando chamado por agentes de IA; nunca é contornado.
- `prisma generate` não acessa o banco; o `prisma.config.ts` usa uma URL placeholder inválida quando `DATABASE_URL` não existe, para que CI e builds Docker não exijam a variável.

## Consequências

Alinhado à versão suportada. Pacotes e scripts documentados em [banco de dados](../../07-desenvolvimento/banco-de-dados.md). Atualizações de versão do Prisma exigem revisar este ADR.

## Alternativas consideradas

Prisma 6 (linha anterior, sem ganho para o projeto); Prisma 8 RC (instável).
