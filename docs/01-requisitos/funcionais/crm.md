# Requisitos funcionais — CRM Solar

Épicos `EPIC-CRM-*`. Detalhamento na seção 8 da modelagem.

## Leads e captação (EPIC-CRM-002)

| ID         | Requisito                                                                                              | Fase |
| ---------- | ------------------------------------------------------------------------------------------------------ | ---- |
| RF-CRM-001 | Cadastrar lead manualmente, por importação CSV e por endpoint público de captação (formulário/landing) | MVP1 |
| RF-CRM-002 | Registrar origem e UTM de cada lead                                                                    | MVP1 |
| RF-CRM-003 | Deduplicar leads por telefone, e-mail e documento normalizados                                         | MVP1 |
| RF-CRM-004 | Classificar lead por segmento (residencial, rural, comercial, industrial) e Grupo A/B preliminar       | MVP1 |
| RF-CRM-005 | Medir SLA de primeiro contato e alertar quando estourar                                                | MVP1 |
| RF-CRM-006 | Lead scoring e roteamento automático                                                                   | F11  |

## Contas, contatos e unidades consumidoras (EPIC-CRM-002)

| ID         | Requisito                                                                            | Fase |
| ---------- | ------------------------------------------------------------------------------------ | ---- |
| RF-CRM-010 | Conta com vários contatos, imóveis (sites), unidades consumidoras, projetos e usinas | MVP1 |
| RF-CRM-011 | Converter lead em conta + contato + oportunidade                                     | MVP1 |
| RF-CRM-012 | Registrar UC com concessionária, grupo tarifário e classe                            | MVP1 |

## Pipeline e oportunidades (EPIC-CRM-003)

| ID         | Requisito                                                                                  | Fase |
| ---------- | ------------------------------------------------------------------------------------------ | ---- |
| RF-CRM-020 | Pipeline padrão de 15 etapas, personalizável por tenant                                    | MVP1 |
| RF-CRM-021 | Kanban com arrastar e soltar entre etapas                                                  | MVP1 |
| RF-CRM-022 | Transições validadas pela [máquina de estados](../../03-diagramas/estados/oportunidade.md) | MVP1 |
| RF-CRM-023 | Motivo de perda obrigatório ao marcar como perdido                                         | MVP1 |
| RF-CRM-024 | Timeline de eventos por oportunidade                                                       | MVP1 |
| RF-CRM-025 | `projectCode` global criado na oportunidade e mantido até o O&M (Project Digital Thread)   | MVP1 |
| RF-CRM-026 | Tarefas com responsável e prazo; indicador de negócios sem próxima tarefa                  | MVP1 |

## Fatura de energia e OCR (EPIC-CRM-005)

| ID         | Requisito                                                                    | Fase |
| ---------- | ---------------------------------------------------------------------------- | ---- |
| RF-CRM-030 | Upload de fatura (PDF/foto) vinculada à UC/oportunidade                      | MVP1 |
| RF-CRM-031 | Extração de campos com score de confiança por campo                          | MVP1 |
| RF-CRM-032 | Tela de revisão destacando campos incertos para confirmação/correção         | MVP1 |
| RF-CRM-033 | Versão validada vira `EnergyBillSnapshot` imutável que alimenta o Calculator | MVP1 |

## Integração com Calculator/Engine/Off-Grid

| ID         | Requisito                                                                              | Fase      |
| ---------- | -------------------------------------------------------------------------------------- | --------- |
| RF-CRM-040 | Criar cálculo a partir da oportunidade com UC e fatura pré-preenchidas                 | MVP1      |
| RF-CRM-041 | Receber resultado e vincular à oportunidade (`CalculationLink`)                        | MVP1      |
| RF-CRM-042 | Semáforo amarelo cria `EngineeringRequest` e move a etapa para "Engenharia necessária" | MVP1      |
| RF-CRM-043 | Receber `EngineeringSnapshot` / `OffGridSnapshot` aprovados                            | MVP2/MVP3 |

## Cotação, margem e propostas (EPIC-CRM-006/007/008)

| ID         | Requisito                                                                                     | Fase |
| ---------- | --------------------------------------------------------------------------------------------- | ---- |
| RF-CRM-050 | Cotação com BOM (kit, módulos, inversor, estrutura, proteções, cabos) e custos                | MVP1 |
| RF-CRM-051 | Cálculo de margem de contribuição por cenário (Margin Guard)                                  | MVP1 |
| RF-CRM-052 | Política de margem mínima por tenant/time/tipo de projeto                                     | MVP1 |
| RF-CRM-053 | Margem abaixo do mínimo bloqueia a proposta e abre solicitação de aprovação com justificativa | MVP1 |
| RF-CRM-054 | Múltiplas fontes de preço e comparação de fornecedores (procurement)                          | F11  |
| RF-CRM-060 | Proposta com marca do tenant, múltiplos cenários, economia, payback e condições comerciais    | MVP1 |
| RF-CRM-061 | Geração de PDF e proposta web por link público com token                                      | MVP1 |
| RF-CRM-062 | Rastreamento de abertura e aceite online                                                      | MVP1 |
| RF-CRM-063 | Versionamento com `ProposalSnapshot` imutável                                                 | MVP1 |

## Contrato, projeto e homologação (EPIC-CRM-009/011)

| ID         | Requisito                                                                                                                                                                                                                    | Fase      |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| RF-CRM-070 | Gerar contrato por template com variáveis automáticas                                                                                                                                                                        | MVP1      |
| RF-CRM-071 | Registrar contrato assinado (upload) e emitir `ContractSigned`                                                                                                                                                               | MVP1      |
| RF-CRM-072 | Assinatura eletrônica integrada                                                                                                                                                                                              | F11       |
| RF-CRM-073 | `DealWon` cria projeto automaticamente com o mesmo `projectCode`                                                                                                                                                             | MVP1      |
| RF-CRM-074 | Projeto com responsável técnico, status, datas e SLA                                                                                                                                                                         | MVP1      |
| RF-CRM-075 | Checklist de documentos de homologação por concessionária (dado versionado) e pendências                                                                                                                                     | MVP1      |
| RF-CRM-076 | Checklist de documentos do acesso à rede por distribuidora e classe de geração, como dado versionado. Origem: [EF-R04](../../referencias/energif-2023/regras-e-medidas.md)                                                   | MVP1 (7C) |
| RF-CRM-077 | Etapas e responsáveis da conexão e prazos (SLA) como dado versionado, com fonte e vigência. Origem: [EF-R03, EF-R06](../../referencias/energif-2023/regras-e-medidas.md)                                                     | MVP1 (7C) |
| RF-CRM-078 | Intake técnico: visita técnica, padrão de entrada (disjuntor e aterramento), orientação, inclinação e sombreamento do telhado. Origem: [EF-R05, EF-R09, EF-M02 a EF-M05](../../referencias/energif-2023/regras-e-medidas.md) | MVP1 (7A) |

## Financiamento, execução e lifecycle

| ID         | Requisito                                                                        | Fase |
| ---------- | -------------------------------------------------------------------------------- | ---- |
| RF-CRM-080 | Registro manual de status de financiamento                                       | MVP1 |
| RF-CRM-081 | Integração com parceiros de crédito (simulação, submissão, status)               | F11  |
| RF-CRM-090 | WhatsApp oficial (EPIC-CRM-004), e-mail, templates e histórico                   | F11  |
| RF-CRM-091 | Field service: visitas, agenda, rota, checklist, modo offline                    | F11  |
| RF-CRM-092 | Instalação com 11 status ([estados](../../03-diagramas/estados/instalacao.md))   | F11  |
| RF-CRM-093 | Comissionamento com checklists, medições e evidências                            | F11  |
| RF-CRM-094 | Pós-venda e O&M: planta, ativos, garantias, tickets, contratos recorrentes       | F11  |
| RF-CRM-095 | Financeiro por projeto: previsto × realizado, recebíveis, comissões, margem real | F11  |
| RF-CRM-096 | Portal do cliente final                                                          | F11  |

## Dashboard comercial (subset de MVP1)

| ID         | Requisito                                                                                              | Fase |
| ---------- | ------------------------------------------------------------------------------------------------------ | ---- |
| RF-CRM-100 | Leads por origem, conversão por etapa, propostas enviadas/visualizadas, ticket médio, forecast simples | MVP1 |
