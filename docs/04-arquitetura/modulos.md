# Módulos e fonte da verdade

## Mapa de módulos da API (`apps/api/src`)

| Módulo                | Camada     | Responsabilidade                                                                                         |
| --------------------- | ---------- | -------------------------------------------------------------------------------------------------------- |
| `config`              | base       | Variáveis de ambiente validadas por Zod                                                                  |
| `common`              | base       | Guards, interceptors, filtros, decorators e pipes                                                        |
| `platform/prisma`     | plataforma | Acesso ao banco e extensão de tenant                                                                     |
| `platform/auth`       | plataforma | Login, refresh token, JWT, guard global                                                                  |
| `platform/tenancy`    | plataforma | Tenant, filiais, times e contexto da requisição                                                          |
| `platform/users`      | plataforma | Usuários, perfis e permissões (RBAC)                                                                     |
| `platform/audit`      | plataforma | Trilha de auditoria                                                                                      |
| `platform/events`     | plataforma | Event bus interno e outbox                                                                               |
| `platform/documents`  | plataforma | Upload/download, metadados e vínculos                                                                    |
| `platform/rules`      | plataforma | Rules Engine versionado                                                                                  |
| `platform/catalog`    | plataforma | Catálogo técnico de equipamentos                                                                         |
| `platform/health`     | plataforma | Health checks                                                                                            |
| `products/crm`        | produto    | Leads, contas, oportunidades, pipeline, tarefas, fatura, cotação, margem, propostas, contratos, projetos |
| `products/calculator` | produto    | Sessões de cálculo rápido e snapshots                                                                    |
| `products/engine`     | produto    | Projeto técnico fotovoltaico (MVP2)                                                                      |
| `products/offgrid`    | produto    | Dimensionamento off-grid (MVP3)                                                                          |

Regras de dependência: [arquitetura](../03-diagramas/arquitetura.md#regras-de-dependência).

## Source of truth por domínio

Seção 32 da modelagem. Cada informação tem **um** sistema de origem; os demais a referenciam por ID e por snapshot, nunca por cópia editável.

| Informação            | Sistema de origem                             |
| --------------------- | --------------------------------------------- |
| Lead, conta, contato  | CRM                                           |
| Oportunidade          | CRM                                           |
| Comunicação           | CRM                                           |
| Fatura validada       | CRM / Document Service                        |
| Cálculo rápido        | Solar Calculator                              |
| Projeto técnico       | Solar Engine Studio                           |
| Projeto off-grid      | Off-Grid Designer                             |
| Equipamentos técnicos | Catálogo compartilhado                        |
| Regras regulatórias   | Rules Engine                                  |
| Proposta comercial    | CRM                                           |
| Contrato              | CRM                                           |
| Homologação           | CRM                                           |
| Instalação            | CRM                                           |
| Planta instalada      | CRM                                           |
| Telemetria bruta      | Integration Hub / plataforma de monitoramento |
| Métricas consolidadas | Data Platform                                 |

## Integrações entre produtos

- CRM → Calculator: cria sessão a partir da oportunidade (UC + fatura validada). Calculator → CRM: devolve `QuickCalculationSnapshot` e semáforo.
- CRM → Engine/Off-Grid: `EngineeringRequested` / `OffGridDesignRequested`. Engine/Off-Grid → CRM: `EngineeringSnapshot` / `OffGridSnapshot` aprovados.
- Todos → Rules Engine e Catálogo: leitura de regras vigentes e equipamentos.
- Detalhes de sequência: [CRM → Calculator → Engine](../03-diagramas/sequencias/crm-calculator-engine.md) e [decisão técnica](../02-fluxos/decisao-tecnica.md).

## Rules Engine

Separa **lógica física** (fórmulas versionadas em `@voltex/solar-engine`: série/paralelo, potência, energia, correção térmica, curva de carga, banco de baterias, eficiência, perdas) de **regulação e compliance** (dados versionados: concessionária, documentação, tarifa, vigência, conexão, Grid Zero, políticas internas, normas). Estrutura de uma regra:

```yaml
id: rule_grid_connection_x
version: 7
status: active
valid_from: 2026-08-01
valid_to: null
distributor: DISTRIBUIDORA_X
region: CE
project_type: ON_GRID
customer_group: B
source:
  type: regulation
  reference: 'documento oficial'
condition:
  field: inverter_ac_power
  operator: '>'
  value_from: contracted_demand
action:
  severity: warning
  code: DEMAND_REVIEW_REQUIRED
  message: 'Revisar demanda antes de liberar o projeto.'
reviewed_by: 'responsável técnico'
```

Uma regra só é considerada pronta com fonte, vigência, versão, escopo, testes, responsável pela revisão, processo de atualização, histórico e impacto em projetos existentes (RN-012).
