# ADR-0004: Schemas Zod e cálculos compartilhados entre back e front

- **Status:** Aceita
- **Data:** 2026-10-18

## Contexto

Validação e regras de cálculo duplicadas entre API e front divergem com o tempo. O Calculator precisa de preview instantâneo no formulário e de resultado oficial na API.

## Decisão

Schemas Zod, enums, tipos inferidos, contratos de eventos e constantes ficam em `@voltex/shared`. Cálculos puros e determinísticos ficam em `@voltex/solar-engine`, sem dependência de Nest, React ou Prisma. A API usa `nestjs-zod`; o front usa `react-hook-form` com resolver Zod.

## Consequências

Uma única fonte da verdade para validação e fórmulas. O resultado oficial é sempre o da API (que gera o snapshot); o do front é apenas preview.

## Alternativas consideradas

DTOs com class-validator no back e Zod no front (duplicação); gerar cliente a partir de OpenAPI (mantido como complemento via Swagger).
