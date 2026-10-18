# Memorial — Solar Calculator

- **Pacote:** `@voltex/solar-engine/calculator`
- **Versão do algoritmo:** `calc-1.0.0` (rascunho, sujeito a revisão por especialista antes da produção)
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
2. **HSP médio:** `HSP = média(HSP_m)` ponderada por dias do mês quando houver série mensal.
3. **Potência FV necessária:** `P_kWp = (C_c / 30) / (HSP × PR)`.
4. **Número de módulos:** `N = ceil(P_kWp × 1000 / P_mod)`.
5. **Potência instalada real:** `P_inst = N × P_mod / 1000` (kWp).
6. **Área aproximada:** `A = N × A_mod` (m²).
7. **Geração mensal:** `G_m = P_inst × HSP_m × dias_m × PR` (kWh).
8. **Geração anual:** `G = Σ G_m`.
9. **Compensação:** `% = min(G_m_média, C_c) / C_c`.
10. **Economia no ano n:** `E_n = G_comp × (1 − d)^(n−1) × T × (1 + r)^(n−1) × 12`, com `G_comp = min(G_mensal, C_c)`.
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

Valores para conferir a implementação (a validar por especialista):

| Entrada                                            | Valor                      |
| -------------------------------------------------- | -------------------------- |
| Consumo médio mensal                               | 500 kWh                    |
| Custo de disponibilidade (monofásico, configurado) | 30 kWh                     |
| HSP médio                                          | 5,0 h/dia                  |
| PR                                                 | 0,80                       |
| Módulo                                             | 550 Wp                     |
| Tarifa                                             | R$ 0,95/kWh                |
| Custo do sistema                                   | R$ 4.500 por kWp instalado |

| Resultado               | Valor esperado                          |
| ----------------------- | --------------------------------------- |
| Consumo a compensar     | 470 kWh/mês                             |
| Potência necessária     | 470 / 30 / (5,0 × 0,80) ≈ **3,917 kWp** |
| Módulos                 | ceil(3.916,7 / 550) = **8**             |
| Potência instalada      | **4,40 kWp**                            |
| Geração mensal média    | 4,40 × 5,0 × 30 × 0,80 = **528 kWh**    |
| Investimento            | 4,40 × 4.500 = **R$ 19.800**            |
| Economia mensal (ano 1) | 470 × 0,95 = **R$ 446,50**              |
| Economia anual (ano 1)  | **R$ 5.358,00**                         |
| Payback simples         | 19.800 / 5.358 ≈ **3,70 anos**          |

## Tolerâncias

- Arredondamentos finais: kWp com 3 casas; kWh inteiro; valores monetários em centavos.
- Comparação em testes: tolerância relativa de 0,1% para valores derivados de ponto flutuante.

## Versionamento

Qualquer mudança de fórmula incrementa `algorithmVersion`. Snapshots antigos preservam a versão com que foram gerados (ADR-0006).
