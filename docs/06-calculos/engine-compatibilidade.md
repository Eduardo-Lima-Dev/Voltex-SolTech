# Memorial: temperatura, strings e compatibilidade (ENG-F01 a F09)

Pacote `@voltex/solar-engine`, pastas `engine/thermal` e `engine/strings` (**implementadas na 9A**); `engine/compatibility` e o gerador de configurações entram na 9E. Fontes: [CRESESB 2014](../referencias/cresesb-2014/README.md) (CR-01..08) e [EnergIF 2023](../referencias/energif-2023/regras-e-medidas.md) (EF-M10, M11, R12, R13).

**Estado de cada fórmula:** as de física pura (lineares, séries e paralelos) estão prontas e testadas. **Fatores normativos** (margem de corrente, limite de strings sem fusível, relação CC/CA) **não têm valor embutido**: são parâmetros da regra `engine.design`; sem regra ativa e revisada, o resultado fica **pendente** e a aprovação trava (ADR-0016).

## ENG-F01: temperatura da célula (`thermal-1.0.0`)

`Tcel = Tamb + (NOCT − 20) / 800 × G` (CR-03, CR-04: é a Eq. 4.6 com `Kt = (NOCT − 20)/800`).

| Entrada         | Unidade | Faixa                             |
| --------------- | ------- | --------------------------------- |
| `ambientC`      | °C      | livre                             |
| `noctC`         | °C      | da ficha (tipicamente 40 a 50)    |
| `irradianceWm2` | W/m²    | ≥ 0 (negativo lança `RangeError`) |

Sem NOCT na ficha, o manual admite `Kt = 0,03 °C·m²/W`: fica como **premissa registrada**, nunca silenciosa. Caso de teste: 30 °C, NOCT 45, 800 W/m² → 55 °C.

## ENG-F02: Voc no frio

`Voc(T) = Voc_stc × (1 + β/100 × (T − 25))`, β em %/°C (CR-01). Para o dimensionamento usa-se a **temperatura mínima prevista do local** como temperatura da célula: a Voc máxima ocorre no inverno, ao nascer do sol ou com a rede desligada, quando a célula ainda não esquentou (CR-05).

Caso de teste: 49,5 V, β −0,27 %/°C, Tmin −5 °C → **53,5095 V**.

**De onde vem a Tmin:** da série do local (Central de Dados, 9B) ou do recurso solar com temperaturas informadas (pessoa, com fonte). **Sem Tmin informada o cálculo não roda** (não existe "temperatura padrão").

## ENG-F03: Vmpp no quente e no frio

Mesma equação com `Vmpp_stc`. No quente usa-se a temperatura máxima da célula (o manual cita mais de 70 °C no verão brasileiro, CR-06; calculada por F01 com a irradiância de projeto, ou informada). Sem `β_Vmpp` na ficha, usa-se `β_Voc` e o resultado marca `BETA_VOC_ASSUMED` (conservador nos dois sentidos; ver nota no [extrato CRESESB](../referencias/cresesb-2014/README.md)).

Casos: Vmpp 41,5 V, β −0,27 %/°C: frio (5 °C) 43,741 V; quente (70 °C) 36,45775 V; com β_Vmpp −0,35 %/°C o quente é 34,96375 V.

## ENG-F04: corrente com a temperatura

`Isc(T) = Isc_stc × (1 + α/100 × (T − 25))` (CR-01). Caso: 13,9 A, α +0,05 %/°C, 70 °C → 14,21275 A. O fator de projeto da corrente (ex.: 1,25 em controladores, citado no cap. 6 do manual para controlador de carga) **não é aplicado aqui**: é parâmetro de `engine.design` (F10).

## ENG-F05: série e paralelo (`strings-1.0.0`)

`V = Ns × Vmod`, `I = Np × Imod`, `P = V × I` (EnergIF p. 41–42, EF-M11; equações conferidas visualmente). Só com módulos iguais; `Ns` e `Np` inteiros ≥ 1.

## ENG-F06: limites de módulos por string

- Máximo pela tensão do inversor: `floor(min(Vdc_max_inv, Vsys_max_mod) / Voc_frio)` (CR-05).
- Máximo pelo MPPT: `floor(Vmppt_max / Vmpp_frio)` (CR-06).
- Mínimo: `ceil(max(Vmppt_min, Vpartida) / Vmpp_quente)` (CR-06).
- `Nmax = min(máximos)`; `feasible = Nmax ≥ Nmin`. O resultado diz **qual limite decidiu** (`INVERTER_MAX_VOLTAGE`, `MPPT_MAX_VOLTAGE`, `MODULE_SYSTEM_VOLTAGE`, `MPPT_MIN_VOLTAGE`, `START_VOLTAGE`) para a explicação ao usuário.

Casos: Voc frio 53,5 V, Vmpp frio 43,7 V, Vmpp quente 36,5 V, inversor 1100 V / MPPT 200–1000 V / partida 250 V → Nmax 20 (tensão do inversor), Nmin 7 (partida). Com tensão máxima do sistema do módulo 1000 V → Nmax 18.

## ENG-F07..F09 e a avaliação de compatibilidade (9E)

- **F07 corrente por MPPT:** `Np,max = floor(Ii,max / Isc)` (CR-07). O Engine usa a Isc corrigida pela temperatura **quando a regra `engine.design` pedir**, e sempre confere o curto-circuito admissível do MPPT.
- **F08 relação CC/CA:** `FDI = P_ca_nom / P_FV` (CR-08). Faixa de política **versionada** (o manual cita 0,75–0,85 como mínimo de mercado e 1,05 como máximo, mas é referência, não regra).
- **F09 desequilíbrio:** strings iguais por MPPT (EF-R13).
- **Códigos estáveis do resultado:** `VOC_COLD_EXCEEDS_MAX`, `VMPP_BELOW_MPPT`, `VMPP_ABOVE_MPPT`, `START_VOLTAGE_NOT_REACHED`, `MPPT_CURRENT_EXCEEDED`, `MPPT_SHORT_CIRCUIT_EXCEEDED`, `DC_POWER_EXCEEDED`, `DC_AC_RATIO_OUT_OF_POLICY`, `STRING_MISMATCH`, `MODULE_NOT_APPROVED`, `INVERTER_NOT_APPROVED`, `MICRO_INPUT_MISMATCH`, `MODULE_SYSTEM_VOLTAGE_EXCEEDED`. Status: `VALID`, `VALID_WITH_WARNINGS`, `INVALID`; `INVALID` bloqueia a aprovação (RN-013).

## Premissas e limites

- Modelo linear de temperatura (padrão de fichas); não modela efeito de baixa irradiância no Voc.
- Células tratadas como uniformes no arranjo (sem gradiente térmico entre módulos).
- Microinversores têm regra própria (entrada por módulo), tratada na 9E.

## Testes

`thermal.test.ts` e `strings.test.ts` (valores acima, bordas, erros). Cobertura do pacote ≥ 90% (hoje 99%).
