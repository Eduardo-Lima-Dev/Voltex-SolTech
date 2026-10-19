# Memorial — Solar Calculator

- **Pacote:** `@voltex/solar-engine/calculator`
- **Versão do algoritmo:** `calc-1.1.0` (rascunho, sujeito a revisão por especialista antes da produção)
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

## Orientação, inclinação, classe e premissas (`calc-1.1.0`)

Origem: [EnergIF](../referencias/energif-2023/regras-e-medidas.md). São **avisos informativos**: não alteram a geração estimada (não há fator de correção com fonte, EF-G08).

- **PR:** informado (`performanceRatio`), **ou** composto por perdas (`losses`, `PR = Π(1 − perda)`), **ou** o padrão `defaultPerformanceRatio` (0,80, hipótese sem fonte validada). A origem (`INPUT`, `LOSSES`, `DEFAULT`) vai no resultado e o padrão gera o aviso `DEFAULT_PERFORMANCE_RATIO`. Informar PR e perdas juntos é recusado.
- **Orientação** (`roofAzimuthDegrees`, 0° = Norte): azimute ideal 0° no hemisfério sul (padrão) e 180° se a latitude for positiva. Avisa (`ORIENTATION_NOT_OPTIMAL`) quando o desvio passa de `orientationToleranceDegrees` (45°, hipótese do produto).
- **Inclinação** (`tiltDegrees`): avisa (`TILT_BELOW_RECOMMENDED`) abaixo de `minRecommendedTiltDegrees` (10°, EF-M03).
- **Inclinação recomendada** (com `latitude`), EF-M04 sobre a latitude absoluta: ≤ 10° → 10° · ≤ 20° → lat · ≤ 30° → lat + 5° · ≤ 40° → lat + 10° · acima → lat + 15° (limites superiores inclusivos; a faixa 31°–40° está impressa errada no livro, EF-I01).
- **Classe da geração** pela potência instalada em kWp: ≤ `microgenerationMaxKw` (75) micro; ≤ `minigenerationMaxKw` (5000) mini; acima, usina. Mini → amarelo (`MINIGENERATION_CLASS`, exige engenharia e documentação extra); usina → vermelho (`UTILITY_SCALE_OUT_OF_SCOPE`). A regulação trata da potência instalada de geração, possivelmente limitada pelo inversor (a confirmar).
- **HSP:** fora da faixa típica `typicalHspMin`–`typicalHspMax` (4 a 6,5, EF-M01) só avisa (`HSP_OUTSIDE_TYPICAL_RANGE`); a faixa bloqueante (2 a 8) segue como julgamento de engenharia.
- **Premissas:** o resultado traz `assumptions` com tudo de que depende (PR e origem, HSP, custo de disponibilidade, tarifa, reajuste, degradação, módulo, horizonte, modelo de custo, orientação, inclinação e limites usados) e o snapshot guarda esse registro.

Todos os limites ficam em `thresholds` e são **parâmetros do Rules Engine**.

## Uso na API e na Web

O servidor é a fonte oficial: `POST /calculations/quick` valida a entrada, aplica os limites da **regra em vigor da empresa** ([Rules Engine](../04-arquitetura/rules-engine.md)), calcula com este memorial e grava a sessão com `algorithmVersion` e `ruleSetRef`. O wizard usa o mesmo motor para o resultado em tempo real, com os mesmos limites. Snapshots congelam entrada, resultado, regra e versão e nunca mudam.

## Tolerâncias

- Arredondamentos finais: kWp com 3 casas; kWh com 1 casa; valores monetários em centavos (inteiro).
- Dinheiro: entradas e saídas monetárias em **centavos** (`tariffCentsPerKwh`, `costPerWpCents`, `investmentCents`).
- Comparação em testes: tolerância relativa de 0,1% para valores derivados de ponto flutuante.

## Versionamento

Qualquer mudança de fórmula incrementa `algorithmVersion`. Snapshots antigos preservam a versão com que foram gerados (ADR-0006).

## Fontes e lacunas

- **Do EnergIF 2023 (usado):** faixa típica de HSP (EF-M01), orientação ao Norte (EF-M02), inclinação mínima de 10° e inclinação por latitude (EF-M03, EF-M04), classes micro/mini/usina (EF-M06), módulos de referência e área típica (EF-M07), a ideia de cálculo **preliminar × preciso** (EF-R02) e o conteúdo do relatório com fatores de perda (EF-R08). Detalhes e páginas em [regras e medidas](../referencias/energif-2023/regras-e-medidas.md).
- **Sem fonte no livro (hipóteses a validar):** PR de 0,80, degradação de 0,5% a.a., custo de disponibilidade, método de payback e fluxo de caixa, fator de correção por orientação/inclinação (EF-G01 a EF-G08). Obter o _Manual de Engenharia para Sistemas Fotovoltaicos_ (CEPEL/CRESESB, 2014) e a regulação tarifária vigente antes da revisão do especialista.
