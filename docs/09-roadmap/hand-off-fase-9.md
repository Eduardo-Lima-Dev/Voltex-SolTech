# Handoff — Fase 9: Solar Engine Studio

**Atualizado em 20/10/2026.** Use este documento para retomar a implementação integral da Fase 9 (9A–9J), cujo plano de origem está em `~/.claude/plans/dentro-dessa-pasta-eu-curried-piglet.md`.

## Estado do trabalho

A árvore de trabalho contém mudanças **não commitadas** de implementações anteriores e desta retomada. Preserve-as; não use `git reset`, `git checkout` ou comandos destrutivos para limpar a árvore.

O projeto compila e os testes abaixo passaram na última validação:

- `pnpm build`
- `pnpm --filter @voltex/shared typecheck`
- `pnpm --filter @voltex/solar-engine test` — **360 testes**, cobertura global 97,55% statements / 90,32% branches.
- `pnpm --filter @voltex/api lint`
- `pnpm --filter @voltex/api typecheck`
- `pnpm --filter @voltex/web typecheck`
- E2E (PostgreSQL local):
  - `engineering.e2e.test.ts` — **33 testes**.
  - `crm-quotes.e2e.test.ts` — **19 testes**.
  - `crm-proposals.e2e.test.ts` — **17 testes**.

O build do web emite somente o aviso conhecido de chunks acima de 500 kB; não falha.

## O que está implementado

### 9A–9F (base que já existia e foi mantida)

- Rules Engine com chaves/escopo e impacto em versões de engenharia.
- Central de Dados: fontes, clima/cache, vigilância e propostas de atualização.
- Catálogo por empresa, revisões, importadores, preços vigentes e origem dos dados.
- Projetos, pedidos, versões congeladas, layout, sombra, strings/MPPT e compatibilidade.
- Proteções, cabos e BOM com preço de referência/lista vigente.

### 9G — simulação e conexão

- Novos contratos em `packages/shared/src/schemas/engineering.ts`:
  - `simulationDesignSchema`
  - `connectionDesignSchema`
  - `economicsDesignSchema`
- Série horária é lida no servidor pela Central (`ClimateService.hourlySeries`); o cliente não recebe nem inventa série.
- Motor puro em:
  - `packages/solar-engine/src/engine/simulation.ts`
  - `packages/solar-engine/src/engine/connection.ts`
- Integração em `computeEngineeringResults` (`project.ts`), incluindo clipping, perdas, PR, comparação PVGIS e regras condicionais de conexão.
- Telas do editor:
  - `simulation-step.tsx`
  - `connection-step.tsx`

### 9H — economia

- Motor em `packages/solar-engine/src/engine/economics.ts`: fluxo de caixa, payback simples/descontado, VPL, TIR e LCOE.
- `EngineeringEconomicsResult` inclui agora CAPEX, economia do primeiro ano, acumulado do horizonte e horizonte, para permitir consumo seguro pela proposta.
- Resultado oficial montado em `packages/solar-engine/src/engine/project.ts`.
- Tela `apps/web/src/features/engine/editor/economics-step.tsx`.
- Ainda faltam os itens completos do plano: Price/SAC, até três cenários explícitos e análise de sensibilidade/tornado.

### 9I — revisão, aprovação, snapshot, memorial e unifilar

- Fluxo API: enviar, comentários por seção, resolver, aprovar e recusar.
- Aprovação bloqueia resultados inválidos/incompletos, pendências, versão desatualizada e comentário aberto.
- Snapshot imutável criado na aprovação, com desenho, resultados, regras, dados e equipamentos copiados.
- Rotas relevantes em `EngineeringController`:
  - `POST /engineering/versions/:id/submit`
  - `POST /engineering/versions/:id/comments`
  - `POST /engineering/versions/:id/comments/:commentId/resolve`
  - `POST /engineering/versions/:id/approve`
  - `POST /engineering/versions/:id/reject`
  - `GET /engineering/versions/:id/report.pdf`
  - `GET /engineering/versions/:id/single-line.svg`
  - `GET /engineering/versions/:id/single-line.pdf`
  - `GET /engineering/versions/:id/single-line.dxf`
- `apps/api/src/products/engine/engineering-report-pdf.ts` gera:
  - memorial técnico PDF (premissas, compatibilidade, geração, conexão, materiais, economia e algoritmos);
  - unifilar PDF preliminar.
- SVG e DXF são gerados em `packages/solar-engine/src/engine/single-line.ts`.
- Todos os entregáveis não aprovados trazem aviso de rascunho; não devem ser apresentados como projeto elétrico assinado.
- Ainda falta: comparação de versões visual/API robusta e link público simplificado de relatório técnico para o cliente.

### 9J — CRM e jornada

- Cotação vinculada ao snapshot de engenharia:
  - migration `packages/database/prisma/migrations/20261021130000_cotacao_snapshot_engenharia/migration.sql`;
  - `Quote.engineeringSnapshotId` e relação Prisma;
  - endpoint `POST /opportunities/:id/quotes/from-engineering`;
  - importa BOM aprovado e recusa snapshot de outra oportunidade;
  - vendedor precisa apenas de `crm.quote.write` (a exigência incorreta de `engine.project.read` foi removida).
- Proposta comercial agora prioriza os dados do snapshot técnico aprovado da cotação:
  - potência instalada, número de módulos e geração anual;
  - economia de primeiro ano, acumulada, payback e horizonte;
  - sem expor custos técnicos, margem ou dados internos ao cliente.
- `EngineeringCrmIntegrationService` consome `ENGINEERING_VERSION_APPROVED`:
  - encerra pedido técnico associado;
  - grava `ENGINEERING_APPROVED` na Timeline;
  - força nova avaliação do Project Guard, incluindo o pedido encerrado no fingerprint.

## Arquivos principais alterados nesta retomada

```text
apps/api/src/products/engine/engineering-versions.service.ts
apps/api/src/products/engine/engineering.controller.ts
apps/api/src/products/engine/engineering.module.ts
apps/api/src/products/engine/engineering-crm-integration.service.ts
apps/api/src/products/engine/engineering-report-pdf.ts
apps/api/src/products/crm/quotes/quotes.controller.ts
apps/api/src/products/crm/quotes/quotes.service.ts
apps/api/src/products/crm/proposals/proposal-content.ts
apps/api/src/products/crm/proposals/proposals.service.ts
apps/api/test/engineering.e2e.test.ts
apps/api/test/crm-quotes.e2e.test.ts
apps/api/test/crm-proposals.e2e.test.ts
apps/web/src/features/engine/editor/{version-editor-page,protections-cables-step,simulation-step,connection-step,economics-step}.tsx
packages/shared/src/{schemas,types}/engineering.ts
packages/solar-engine/src/engine/{project,simulation,connection,economics,single-line}.ts
packages/database/prisma/schema/{commercial,engineering}.prisma
packages/database/prisma/migrations/20261021130000_cotacao_snapshot_engenharia/migration.sql
docs/07-desenvolvimento/engine.md
```

## Pendências objetivas para concluir o plano

Não declare a Fase 9 concluída sem tratar e verificar estes pontos do plano original:

1. **9G:** gráficos de geração × consumo mensal, perfil de dia típico, diagrama de perdas e comparação explícita com Calculator/PVGIS na UI; validação contra casos de ouro externos gravados.
2. **9H:** Price/SAC; cenários econômicos (máximo três); sensibilidade/tornado; planilha de referência documentada e validação por responsável financeiro.
3. **9I:** comparação entre versões; relatório técnico simplificado e público; possível persistência/anexo do memorial e unifilar no fluxo de homologação.
4. **9J:** anexar memorial/unifilar/fichas ao checklist de homologação quando houver projeto 7C; criar `jornada-engenharia.spec.ts` ponta a ponta com conectores gravados e, se requerido, vídeo; concluir documentação, diagnóstico e roteiro manual.
5. **Governança externa:** regras de conexão reais por distribuidora precisam de fonte oficial/revisão de responsável técnico; metodologia econômica precisa de validação financeira; CEC/SAM segue bloqueada até licença inequívoca.

## Cuidados técnicos

- Regras normativas e de compensação continuam sendo dados versionados. Não inclua fatores normativos fixos no motor.
- Resultado oficial é calculado no servidor; o motor puro também pode oferecer prévia no navegador.
- Dados externos não devem entrar diretamente em regra ou catálogo sem proposta/revisão.
- Para E2E, use `pnpm --filter @voltex/api exec vitest run --config vitest.e2e.config.mts <arquivo>` e PostgreSQL local.
- A `EngineeringModule` agora importa `CrmModule` para o consumidor atualizar Guard/Timeline. Não remova essa ligação sem substituir o consumidor de evento.
