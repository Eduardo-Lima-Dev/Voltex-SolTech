# Padrões de código

## Geral

- TypeScript `strict` em todo o monorepo (`@voltex/tsconfig`); `noUncheckedIndexedAccess` ativo.
- ESLint (`@voltex/eslint-config`) e Prettier (aspas simples, ponto e vírgula, largura 100).
- Código e identificadores em **inglês**; textos de interface, mensagens e documentação em **português (pt-BR)**.
- Sem `any` implícito; preferir `unknown` e estreitamento.
- Imports de tipo com `import type` (exceto no Nest, que precisa dos valores para injeção).

## Nomes

- Arquivos em `kebab-case`. Classes em `PascalCase`. Funções e variáveis em `camelCase`. Constantes e enums de domínio em `UPPER_SNAKE_CASE`.
- Campos físicos com unidade no nome: `powerKwp`, `energyKwh`, `voltageV`, `areaM2`.
- Dinheiro em centavos (inteiro).

## Backend (NestJS)

- Um módulo por contexto; controllers finos, regra de negócio em services.
- Validação por schema Zod de `@voltex/shared`; nunca confiar em entrada sem validar.
- Toda rota com permissão explícita; `@Public()` só quando indispensável.
- Acesso a dados somente via `PrismaService` (com extensão de tenant).
- Alterações de estado relevantes emitem evento de domínio pelo outbox.

## Frontend (React)

- Estrutura por funcionalidade (`features/<produto>/…`); componentes compartilhados em `@voltex/ui`.
- Dados do servidor com TanStack Query; estado de UI local ou Zustand; formulários com react-hook-form + Zod.
- Não importar `@voltex/database` nem nada do Prisma no front.

## Cálculos (`@voltex/solar-engine`)

- Funções puras, sem I/O, com unidades explícitas e validação de faixa.
- Toda função tem `algorithmVersion`, testes e memorial em [06-calculos](../06-calculos/README.md).

## Testes

- Vitest para pacotes e web; testes e2e da API com Supertest e banco de teste; Playwright para fluxos críticos.
- Todo bug corrigido ganha um teste que o reproduz.
- Isolamento de tenant e RBAC têm testes obrigatórios.
