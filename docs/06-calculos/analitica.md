# Camada analítica — definições e exemplos

Fase 12C (RF-PLAT-018). Código: `apps/api/src/platform/analytics/` (contas puras em `analytics-core.ts`, com testes sobre uma base fixa). Rotas: `GET /analytics/*`.

> **O que isto é e não é.** São contas determinísticas sobre os registros da empresa, sempre com o **tamanho da amostra**. Os mínimos de amostra são **prudência estatística da plataforma**, não norma, e a empresa pode ajustá-los. Nada aqui é previsão de fechamento nem decisão: quem decide é uma pessoa.

## Quem vê o quê

- Tudo é calculado pelo cliente de banco da requisição: a **carteira** do vendedor (ADR-0028) vale sozinha. O vendedor analisa só os clientes, leads e oportunidades dele; a gestão, tudo.
- **Dinheiro (recebido, custos, comissões, margem, inadimplência) só sai para perfil com `crm.finance.read`.** Sem ele, esses campos vêm `null` e ordenar por eles devolve lista vazia com o aviso.
- Os nomes dos campos seguem a convenção que o assistente usa para saber o tipo do valor: `…Cents` dinheiro, `…Pct` pontos percentuais (24,5), `…Rate` fração (0,25), `…Count` contagem, `…Days` dias.

## Amostras mínimas (padrões; `tenant.settings.analytics.minSamples`)

| Análise                                                                           | Mínimo                                  | O que acontece abaixo                           |
| --------------------------------------------------------------------------------- | --------------------------------------- | ----------------------------------------------- |
| Clientes com mais potencial                                                       | 25 clientes com valor recebido          | `INSUFFICIENT_SAMPLE`, com o tamanho da amostra |
| Grupo (origem, segmento, UF, vendedor)                                            | 5 oportunidades **encerradas** no grupo | grupo marcado `smallSample`, taxa `null`        |
| Taxa de conversão geral do funil                                                  | 30 encerradas (ganhas + perdidas)       | taxa `null` e `conversionNote`                  |
| Médias simples (ciclo de venda; conversão de leads)                               | 5 registros                             | média `null` e nota                             |
| Previsões (12I): parcelas pagas 20, instalações concluídas 10, dias de leitura 14 | —                                       | —                                               |

Valores aceitos na configuração: de 3 a 1.000 por mínimo; fatia dos melhores de 5% a 50% (padrão 20%); dias para "parada" de 3 a 180 (padrão 14).

## Funil por grupo

Grupo = **oportunidades criadas no período** (padrão: últimos 90 dias), agrupadas por origem (lead de origem), segmento (da conta), UF (do imóvel), vendedor ou tipo de projeto. Quem não tem a informação cai em "Sem …".

| Campo                                           | Definição                                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------------------------- |
| `leadsCount`                                    | leads criados no período com a mesma chave (nulo para tipo de projeto)                |
| `proposalsSentCount` / `proposalsAcceptedCount` | oportunidades do grupo com proposta enviada / aceita (uma por oportunidade)           |
| `wonCount`, `lostCount`, `closedCount`          | `closedCount` = ganhas + perdidas                                                     |
| `winRate`                                       | `wonCount ÷ closedCount`, arredondada a 2 casas, **só** com a amostra mínima do grupo |
| `wonValueCents`                                 | soma do valor dos contratos **assinados** das oportunidades do grupo                  |
| `averageTicketCents`                            | `wonValueCents ÷ nº de contratos assinados`                                           |
| `averageCycleDays`                              | média de (assinatura do contrato − criação da oportunidade), em dias                  |

**Exemplo (base fixa dos testes).** Origem _Indicação_: 5 oportunidades, 2 ganhas (contratos de R$ 20.000 e R$ 10.000, criadas em 01/08 e 10/08 e assinadas em 01/09 e 09/09), 1 perdida. Encerradas = 3; taxa = 2 ÷ 3 = **0,67**; ticket = (2.000.000 + 1.000.000) ÷ 2 = **R$ 15.000,00**; ciclo = (31 + 30) ÷ 2 = **30,5 dias**. Com o mínimo padrão (5), a taxa **não é mostrada**.

## Ciclo de venda, perdas e paradas

- **Ciclo de venda:** contratos assinados no período; média e mediana de (assinatura − criação da oportunidade).
- **Motivos de perda:** oportunidades perdidas no período; o motivo é normalizado (sem diferença de maiúsculas e acento: "Preço alto" = "preco alto"); `shareRate` = parte do total de perdidas; quem não informou motivo é contado à parte.
- **Oportunidades paradas:** abertas que estão **sem tarefa aberta** ou **há `stalledDays` (14) dias ou mais na mesma etapa**. Ordem: mais tempo na etapa primeiro.
- **Tarefas:** abertas e atrasadas (vencimento passado) por responsável.
- **Leads:** por origem, segmento, UF e situação; SLA estourado = lead novo, sem primeiro contato e com o prazo vencido; conversão = convertidos ÷ leads (só com 5 ou mais).

## Métricas por cliente (conta)

Somam todos os projetos da conta. Mesma fórmula do financeiro do projeto (11G):

```
recebido  = soma das parcelas PAGAS
margem real = recebido − custos realizados − comissões
margem real (%) = margem real ÷ recebido × 100          (nula se nada foi recebido)
inadimplência = parcelas VENCIDAS (status vencida, ou aberta com vencimento passado); canceladas não contam
```

**Exemplo.** Conta A: projeto de R$ 20.000; recebeu R$ 10.000 + R$ 5.000; custos R$ 6.000; comissões R$ 1.000; uma parcela de R$ 5.000 vencida há 10 dias. Recebido R$ 15.000; margem real = 15.000 − 6.000 − 1.000 = **R$ 8.000**; margem = 8.000 ÷ 15.000 = **53,3%**; inadimplência R$ 5.000 (1 parcela, 10 dias).

Também por conta: usinas, chamados (total e abertos), contratos de O&M ativos e tempo de venda (média, em dias).

## Clientes com mais potencial (semelhança com os melhores)

1. Entram os clientes com algo **recebido**. Menos que o mínimo (25): `INSUFFICIENT_SAMPLE`.
2. **Melhores** = a fatia (padrão 20%, arredondada para cima, pelo menos 1) com maior valor do critério: margem real recebida (padrão), recebido, número de projetos ou contratos de O&M ativos.
3. Atributos comparados: segmento, UF, origem do lead e faixa da conta de luz do lead de origem (até R$ 299; R$ 300–999; R$ 1.000–2.999; a partir de R$ 3.000).
4. Para cada atributo e valor: `lift = (parte dos melhores com o valor) ÷ (parte de todos os clientes com o valor)`, considerando só quem tem o atributo conhecido. Só vale se o valor aparece em **pelo menos 5 clientes**; valor raro não gera nota.
5. **Nota do candidato** = média dos `lift` dos atributos dele que valem. Acima de 1: parece com os melhores; abaixo: parece menos. A resposta traz a explicação atributo a atributo.
6. Candidatos: leads em aberto e contas com oportunidade aberta que ainda não são clientes.

**Exemplo.** 30 clientes; os 6 melhores são todos _comerciais_ do CE. Comerciais são 12 de 30 (40%), mas 6 de 6 (100%) entre os melhores: `lift` = 1 ÷ 0,4 = **2,5**. Todos são do CE: `lift` da UF = **1**. Um lead comercial do CE tem nota (2,5 + 1) ÷ 2 = **1,75**; um residencial do CE, (0 + 1) ÷ 2 = **0,5**.

> **Não é probabilidade de fechar.** É só semelhança com os melhores clientes nos atributos que o sistema conhece, e o resultado leva sempre esse aviso. Exige acesso ao financeiro, porque a margem decide quem é "melhor".

## Limitações conhecidas

- O perfil **Financeiro** não tem `crm.account.read`, então não consulta análises por cliente (decisão de permissões a rever).
- As consultas carregam os registros em memória: servem ao porte atual das empresas; volumes muito maiores pedem agregação no banco.
- A origem e a conta de luz do cliente vêm do lead que originou a oportunidade; cliente criado sem lead fica sem esses atributos.
