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

## Situação das pendências do plano (atualizada em 20/10/2026)

**Resolvidas no código, com testes:**

1. **9G:** gráficos mensal × consumo, dia típico e cascata de perdas; comparação com PVGIS e Calculator na tela; albedo; coeficiente de potência da ficha; casos de ouro do pvlib (`tools/golden/cases/simulation-hourly.json`, 27 casos, 0,5%).
2. **9H:** financiamento Price/SAC, até três cenários, tornado de sensibilidade e gráfico de caixa; memorial atualizado.
3. **9I:** comparação de versões (API + tela), entregáveis no editor, relatório técnico simplificado público (`/r/:token`, com validade e revogação).
4. **9J:** anexo do memorial e do unifilar ao checklist de homologação (manual e automático); e2e da API `engineering-journey` (pedido → aprovação → snapshot → cotação, com série "gravada" no cache); `jornada-engenharia.spec.ts` (Playwright, vídeo e capturas); docs, verificação manual e memória.

**Limites declarados (não são bugs):**

- No Playwright, o **desenho** (strings, cabos, premissas) é gravado pela API; a tela confere cada etapa e conduz envio, revisão, aprovação, link do cliente. A edição campo a campo de todas as etapas está coberta pelos testes de componente do web.
- **Ficha INMETRO/CEC:** CEC/SAM segue bloqueada até licença inequívoca. Preço de venda continua decisão comercial.
- A cotação importa a lista de materiais; **frete, instalação e margem** são decisão explícita do vendedor.

**Dependem de pessoas (não há como fechar só com código):**

- Regras reais de conexão por distribuidora com fonte oficial, e os parâmetros normativos de `engine.design`/`engine.cables` (os valores dos testes são de exemplo) revisados pelo responsável técnico (ainda sem nome).
- Validação financeira do método econômico (compensação, impostos, financiamento).
- Conferência jurídica dos termos de PVGIS/NASA POWER antes de ligar os conectores; CEC/SAM.
- Arquivos `.PAN` de silício e PDFs reais de fabricantes; tabelas de preço reais.

## Cuidados técnicos

- Regras normativas e de compensação continuam sendo dados versionados. Não inclua fatores normativos fixos no motor.
- Resultado oficial é calculado no servidor; o motor puro também pode oferecer prévia no navegador.
- Dados externos não devem entrar diretamente em regra ou catálogo sem proposta/revisão.
- Para E2E, use `pnpm --filter @voltex/api exec vitest run --config vitest.e2e.config.mts <arquivo>` e PostgreSQL local.
- A `EngineeringModule` agora importa `CrmModule` para o consumidor atualizar Guard/Timeline. Não remova essa ligação sem substituir o consumidor de evento.
