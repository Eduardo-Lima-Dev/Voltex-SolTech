# Pacotes compartilhados

Código usado por `apps/api` e `apps/web` fica em `packages/`. Regras de dependência: [arquitetura](../03-diagramas/arquitetura.md#regras-de-dependência).

| Pacote                  | Conteúdo                                                                                                      | Depende de              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `@voltex/shared`        | Enums, permissões e perfis, pipeline padrão, schemas Zod, catálogo de eventos, rotas da API, formatação pt-BR | `zod`                   |
| `@voltex/solar-engine`  | Unidades e cálculos puros (Solar Calculator; Engine e Off-Grid nas próximas fases)                            | `@voltex/shared`, `zod` |
| `@voltex/ui`            | Tema da marca (tokens) e componentes (shadcn/ui + Radix + Tailwind 4)                                         | React (peer)            |
| `@voltex/tsconfig`      | `base`, `library`, `node` e `react`                                                                           | —                       |
| `@voltex/eslint-config` | `base`, `nest` e `react`                                                                                      | —                       |
| `@voltex/database`      | Prisma (schema, migrations, seed) — Fase 3                                                                    | —                       |

## Build e consumo

Cada pacote compila com **tsup** para `dist/` em ESM e CJS, com tipos (`.d.ts`/`.d.cts`):

- a API (NestJS, CommonJS) consome o build CJS; o Web (Vite) consome o ESM;
- `turbo.json` faz `lint`, `typecheck`, `test` e `dev` dependerem de `^build`, então os pacotes são compilados antes dos apps;
- em `pnpm dev`, cada pacote roda `tsup --watch` e recompila ao salvar.

> Decisão: o plano inicial previa consumir a fonte TypeScript em desenvolvimento, mas o NestJS em CommonJS não importa TypeScript direto de pacotes do workspace. Compilar sempre para `dist` mantém um único caminho para dev, CI e Docker.

## `@voltex/shared`

```ts
import { Role, hasPermission, createLeadSchema, formatBrlFromCents, ROUTES } from '@voltex/shared';

hasPermission(Role.SALESPERSON, 'crm.margin.approve'); // false
createLeadSchema.parse({ name: 'Maria Silva', state: 'ce' }); // state → 'CE'
formatBrlFromCents(1_980_000); // "R$ 19.800,00"
```

- Dinheiro sempre em **centavos** (inteiro). Tarifa em centavos por kWh (admite fração).
- Enums são objetos `as const` + tipo derivado, usáveis em `z.enum(...)`.
- Permissões seguem `<produto>.<recurso>.<ação>`; o mapeamento perfil → permissões fica em `ROLE_PERMISSIONS`.

## `@voltex/solar-engine`

```ts
import { runQuickCalculation } from '@voltex/solar-engine';

const r = runQuickCalculation({
  consumptionMonthlyKwh: Array(12).fill(500),
  availabilityCostKwh: 30, // vem da regra vigente, nunca fixo
  hspMonthly: Array(12).fill(5),
  modulePowerWp: 550,
  moduleAreaM2: 2.58,
  tariffCentsPerKwh: 95,
  costPerWpCents: 450,
});
r.trafficLight; // 'GREEN'
r.installedPowerKwp; // 4.4
```

- Funções puras e determinísticas; toda saída traz `algorithmVersion`.
- Entrada inválida lança `ZodError`.
- Cobertura mínima exigida: 90% (`vitest.config.ts`). Memorial: [Solar Calculator](../06-calculos/calculator.md).
- Os limites do semáforo (`thresholds`) são parâmetros; o Rules Engine poderá sobrescrevê-los.

## `@voltex/ui`

No CSS do app (Tailwind 4):

```css
@import 'tailwindcss';
@import '@voltex/ui/styles.css';
@source '../../../packages/ui/src';
```

```tsx
import { Button, Card, Badge, Toaster } from '@voltex/ui';
```

- Tema claro/escuro por classe `.dark` no `<html>`.
- A paleta vem do **logo oficial** (azul-marinho `#002362`, ciano `#8CDDF4`, gelo `#E3EBF0`); as cores vivem só em `src/styles.css`. Veja [identidade visual](../00-visao-geral/identidade-visual.md).
- `Logo` e `LogoMark` são o logo oficial em SVG (tons `auto`, `on-dark` e `on-light`), gerados por `scripts/build-brand-assets.mjs`.
- `theme.test.ts` garante contraste WCAG AA e que os tokens derivam das cores do logo.
- Componentes de formulário integram com `react-hook-form` (`Form`, `FormField`, `FormItem`, `FormLabel`, `FormControl`, `FormMessage`) e um resolver Zod com os schemas de `@voltex/shared`.
