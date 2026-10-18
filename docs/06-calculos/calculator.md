# Memorial — Solar Calculator

- **Pacote:** `@voltex/solar-engine/calculator`
- **Versão do algoritmo:** `calc-1.0.0` (rascunho, sujeito a revisão por especialista antes da produção)
- **Implementação:** `packages/solar-engine/src/calculator` (entrada validada por Zod; função `runQuickCalculation`). O caso de referência abaixo é um teste automatizado.
- **Natureza:** estimativa comercial de pré-viabilidade. **Não substitui projeto de engenharia.**

Todos os parâmetros marcados como **configurável** vêm da entrada da sessão ou do Rules Engine; nenhum é constante embutida (RN-016).

## Entradas

| Grandeza                      | Símbolo | Unidade            | Observação                                                      |
| ----------------------------- | ------- | ------------------ | --------------------------------------------------------------- |
| Consumo mensal (1 a 12 meses) | `C_m`   | kWh/mês            | Média usada quando houver mais de um mês                        |
| Custo de disponibilidade      | `D`     | kWh/mês            | **Configurável** (depende de mono/bi/trifásico e regra vigente) |
| Irradiação (HSP) por mês      | `HSP_m` | h/dia (kWh/m²/dia) | Do recurso solar ou entrada manual                              |
| Performance ratio             | `PR`    | adimensional (0–1) | **Configurável**, padrão proposto 0,80                          |
| Potência do módulo            | `P_mod` | Wp                 | **Configurável**                                                |
| Área do módulo                | `A_mod` | m²                 | **Configurável**                                                |
| Tarifa                        | `T`     | R$/kWh             | Da fatura ou tarifa vigente                                     |
| Reajuste tarifário            | `r`     | %/ano              | **Configurável**                                                |
| Degradação anual              | `d`     | %/ano              | **Configurável**                                                |
| Custo do sistema              | `K`     | R$ ou R$/Wp        | Kit + mão de obra + margem                                      |

## Fórmulas

1. **Consumo a compensar:** `C_c = max(C_m − D, 0)` (kWh/mês).
2. **HSP médio:** `HSP = Σ(HSP_m × dias_m) / 365` (média ponderada pelos dias de cada mês).
3. **Potência FV necessária:** `P_kWp = (C_c × 12 / 365) / (HSP × PR)` — gera, em média, o consumo mensal a compensar.
4. **Número de módulos:** `N = ceil(P_kWp × 1000 / P_mod)`.
5. **Potência instalada real:** `P_inst = N × P_mod / 1000` (kWp).
6. **Área aproximada:** `A = N × A_mod` (m²).
7. **Geração mensal:** `G_m = P_inst × HSP_m × dias_m × PR` (kWh).
8. **Geração anual:** `G = Σ G_m`.
9. **Compensação:** `% = (G / 12) / C_m` (geração mensal média sobre o consumo médio; pode passar de 100% por arredondamento de módulos).
10. **Economia no ano n:** `G_n = G × (1 − d)^(n−1)`; `comp_n = min(G_n / 12, C_c) × 12`; `E_n = comp_n × T × (1 + r)^(n−1)`.
11. **Fluxo de caixa acumulado:** `F_n = F_(n−1) + E_n`, com `F_0 = −K`.
12. **Payback simples:** `K / E_1` (anos); **payback pelo fluxo:** primeiro ano em que `F_n ≥ 0`, interpolado linearmente.
13. **Horizonte de projeção:** 25 anos (configurável).

> Compensação de créditos, TUSD Fio B e modalidades tarifárias que alterem o valor da energia compensada são tratadas como parâmetros do Rules Engine com vigência, e não como fórmula fixa.

## Semáforo de pré-viabilidade

| Cor          | Condições (qualquer uma)                                                                                                                                                   | Ação                                 |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| **Vermelho** | Inconsistência de dados; área disponível insuficiente para `N` módulos; premissa incompatível; cálculo fora de regra configurada; necessidade explícita de revisão técnica | Bloqueia proposta definitiva         |
| **Amarelo**  | Dado crítico ausente; demanda contratada relevante; possível Grid Zero; sombreamento relevante; Grupo A complexo; híbrido/BESS; limites técnicos próximos                  | Encaminhar ao Solar Engine Studio    |
| **Verde**    | Dados suficientes, dentro das premissas comuns e sem alerta técnico relevante                                                                                              | Pode seguir para proposta preliminar |

Códigos de alerta previstos: `MISSING_CRITICAL_DATA`, `GROUP_A_COMPLEX`, `CONTRACTED_DEMAND_RELEVANT`, `POSSIBLE_GRID_ZERO`, `SHADING_RELEVANT`, `HYBRID_REQUESTED`, `INSUFFICIENT_AREA`, `INCONSISTENT_INPUT`, `ASSUMPTION_OUT_OF_RANGE`.

**Score de confiança** (0–100): parte de 100 e desconta por dado ausente, valor estimado em vez de medido, OCR de baixa confiança e premissas fora da faixa comum.

## Caso de teste de referência

Valores para conferir a implementação (a validar por especialista). Este caso é um teste automatizado em `packages/solar-engine/src/calculator/calculator.test.ts`.

| Entrada                                            | Valor                                        |
| -------------------------------------------------- | -------------------------------------------- |
| Consumo médio mensal                               | 500 kWh                                      |
| Custo de disponibilidade (monofásico, configurado) | 30 kWh                                       |
| HSP médio                                          | 5,0 h/dia (todos os meses)                   |
| PR                                                 | 0,80                                         |
| Módulo                                             | 550 Wp, 2,58 m²                              |
| Tarifa                                             | R$ 0,95/kWh (95 centavos)                    |
| Custo do sistema                                   | R$ 4.500 por kWp instalado (450 centavos/Wp) |
| Degradação / reajuste tarifário                    | 0,5% a.a. / 0%                               |

| Resultado                      | Valor esperado                                                |
| ------------------------------ | ------------------------------------------------------------- |
| Consumo a compensar            | 470 kWh/mês                                                   |
| Potência necessária            | 470 × 12 / 365 / (5,0 × 0,80) ≈ **3,863 kWp**                 |
| Módulos                        | ceil(3.863 / 550) = **8**                                     |
| Potência instalada             | **4,40 kWp**                                                  |
| Área                           | 8 × 2,58 = **20,64 m²**                                       |
| Geração anual                  | 4,40 × 5,0 × 365 × 0,80 = **6.424 kWh** (média 535,3 kWh/mês) |
| Geração em janeiro / fevereiro | **545,6 kWh** / **492,8 kWh**                                 |
| Compensação                    | 535,3 / 500 ≈ **107,1%**                                      |
| Investimento                   | 4,40 × 4.500 = **R$ 19.800**                                  |
| Economia mensal (ano 1)        | 470 × 0,95 = **R$ 446,50**                                    |
| Economia anual (ano 1)         | **R$ 5.358,00** (535.800 centavos)                            |
| Payback simples                | 19.800 / 5.358 ≈ **3,70 anos**                                |
| Semáforo / alertas / confiança | **Verde** / nenhum / **100**                                  |

## Tolerâncias

- Arredondamentos finais: kWp com 3 casas; kWh com 1 casa; valores monetários em centavos (inteiro).
- Dinheiro: entradas e saídas monetárias em **centavos** (`tariffCentsPerKwh`, `costPerWpCents`, `investmentCents`).
- Comparação em testes: tolerância relativa de 0,1% para valores derivados de ponto flutuante.

## Versionamento

Qualquer mudança de fórmula incrementa `algorithmVersion`. Snapshots antigos preservam a versão com que foram gerados (ADR-0006).
