# Fase 11 — Resumo de Entrega

Implementação completa de **Execução e Lifecycle** de projetos solares, do comissionamento à operação.

## Escopo entregue

### 11A — Integration Hub

- Modelos: IntegrationConnection, IntegrationRun, IntegrationDeadLetter, CommunicationLog
- Adaptadores: padrão (registry, interface)
- Fila BullMQ: integrations, retry, DLQ
- Web: Admin → Integrações

### 11B — Instalação, Materiais, Equipes

- Modelos: Installation, MaterialList, MaterialItem, Crew, CrewMember, WorkOrder, FieldIssue
- Máquina de estados: 11 transições
- Automações: materiais pronto → agenda → instalação concluída
- Web: Operação → Instalações, Agenda, Equipes

### 11C — App de Campo (PWA Offline)

- Service Worker + Workbox (vite-plugin-pwa)
- Rota `/campo`: mobile-first, checklist, fotos, geolocalização, assinatura
- IndexedDB: fila de ações por acréscimo, sincronização idempotente
- E2e: offline-online, sync em lote

### 11D — Comissionamento e Aceite

- Modelos: CommissioningRecord, CommissioningTest
- Regra de ensaios versionada (RULESET)
- Cálculo de esperado: engine/strings + thermal (motor puro)
- Relatório PDF (pdfkit)
- Aceite: assinatura campo ou portal
- E2e: transições, reprovação, relatório

### 11E — Pós-venda: Planta, Garantias, Chamados, O&M

- Modelos: Plant, PlantAsset, ManufacturerWarrantyTerm, AssetWarranty, Ticket, MaintenancePlan, OmContract
- Ativação: CUSTOMER_ACCEPTED → cria planta, ativos, garantias
- Automações: garantia vencendo, O&M renovação, preventiva, upsell
- Web: Operação → Plantas, Chamados, Garantias, O&M
- Seed: 6 fabricantes, termos exemplo

### 11F — Monitoramento

- Modelos: PlantMonitoringLink, MonitoringDaily, MonitoringSnapshot, MonitoringAlarm
- Adaptadores: 12 oficiais + 5 não-oficiais (aceite termo explícito)
- CSV: importação universal
- Respostas gravadas: fixtures de documentação
- Desempenho: real × esperado com índice
- Regra configurável: limiar + dias para alerta → Ticket
- Web: Plantas → Monitoramento, gráfico, alerta

### 11G — Financeiro Manual (sem gateway)

- Modelos: Receivable, ProjectCostEntry, CommissionPolicy, Commission, CreditApplication
- Recebíveis: OPEN → PAID → OVERDUE → CANCELLED (manual)
- Custos: estimado × realizado
- Crédito: simulação (sem integração)
- Comissão: configurada, cálculo manual, não automatizado
- Margem: (recebido − custos − comissão) / contrato
- ADR-0024: financeiro manual, sem PCI
- Guia + componente (aba em projeto)
- E2e: criar recebível, marcar pago, resumo

### 11H — Portal do Cliente (Link Mágico)

- Modelos: PortalAccess, PortalMagicLink, PortalSession
- Link 30 min (uso único), sessão 12 h (revogável)
- Rotas: /public/portal/entrar, /public/portal/exchange, /portal/dashboard
- Web: login, acesso, dashboard com abas (projetos, documentos, garantias, chamados)
- Sem enumeração de e-mail, cookie httpOnly, SameSite=Strict
- E2e: requisições malformadas, tokens inválidos, expirados

### 11I — DocuSeal (opcional), MFA, Lead Scoring, WhatsApp

- **DocuSeal:** adaptador Integration Hub, webhook, contêiner Docker (opcional)
  - ADR-0025: validade jurídica é responsabilidade cliente
- **MFA:** TOTP (otplib) + backup codes, obrigatoriedade configurável por empresa
  - ADR-0026: RNF-SEG-011
  - Setup: QR code + verificação
  - Login: código TOTP ou backup code
- **Lead Scoring:** critérios por empresa (origem, consumo, região), roteamento (roundRobin, region)
  - Score 0-100, breakdown, guia em `lead-scoring.md`
  - Roteamento: policy configurável
- **WhatsApp:** links wa.me, registro em CommunicationLog, cópia para envio manual
- E2e: setup MFA, status, disable

### 11J — LGPD, Jornada, Documentação

- **LGPD:** eraseAccount (fotos, geo, acessos, sessões, chamados, logs), exportData
  - Controle: DELETE /crm/privacy/accounts/:id/erase, POST /crm/privacy/export
- **Jornada Playwright:** e2e completo (projeto → campo → comissionamento → aceite → planta → monitoramento)
  - Offline field, manual monitoramento (CSV)
  - Portal do cliente (magic link)
- **Seed interno:** regras de exemplo (comissionamento, monitoramento), termos garantia
- **Documentação:** ADRs 0019–0026, guias de desenvolvimento por módulo, jornada, LGPD

## ADRs

- 0019: Integration Hub e credenciais
- 0020: Módulo Operação, máquina instalação
- 0021: Campo offline, sincronização
- 0022: Portal link mágico
- 0023: Monitoramento com adapd não-oficiais
- 0024: Financeiro manual
- 0025: DocuSeal opcional
- 0026: MFA TOTP obrigatório

## Pendências da empresa (governança)

- Credenciais reais para integrações
- Checklist e tolerâncias de comissionamento (assinado RT)
- Termos de garantia (fabricante, PDF)
- Prazo retenção fotos/geo (advogado)
- Validade assinatura DocuSeal (advogado)
- Política comissão, limiar desvio, periodicidade manutenção, pesos lead scoring
- Regras de comissionamento e monitoramento

## Verificação final

1. `pnpm lint && pnpm typecheck && pnpm build`
2. `pnpm test` (motor, web, cobertura ≥ 90%)
3. `pnpm test:e2e` (API: transições, idempotência, isolamento, LGPD)
4. `pnpm test:browser` (Playwright: jornada offline, portal, relatórios)
5. `pnpm db:migrate` + `tenant-scope.test.ts`
6. Manual no navegador: app de campo (móvel), portal linkado, gráfico planta

## Roadmap futuro

- Fase 12: Backoffice (relatórios, analytics, CRM avançado)
- Fase 13: Cobrança unificada (RF-PLAT-016)
- Integrações: Stripe, Mercado Pago, gateway crédito real
- IA: predição de desvio, recomendações de manutenção
