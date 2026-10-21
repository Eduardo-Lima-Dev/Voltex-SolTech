# Memorial: temperatura, strings e compatibilidade (ENG-F01 a F09)

Pacote `@voltex/solar-engine`, pastas `engine/thermal` e `engine/strings` (**9A**), `engine/compatibility` (`compat-1.0.0`) e `engine/configurator` (`configurator-1.0.0`) (**9E, implementados**). Fontes: [CRESESB 2014](../referencias/cresesb-2014/README.md) (CR-01..08) e [EnergIF 2023](../referencias/energif-2023/regras-e-medidas.md) (EF-M10, M11, R12, R13).

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

## Compatibility Engine (`compat-1.0.0`)

Confere cada **inversor do projeto** (strings por MPPT ou microinversor) e a **alocação dos módulos** de cada superfície. Cada verificação devolve: código estável, severidade (`ERROR`, `WARNING`, `INFO`), resultado (`PASS`, `FAIL`, `PENDING`), mensagem, **fórmula**, **fonte**, valor, limite e unidade. A tela mostra "Como foi calculado" em cada uma.

| Código                                                                                                           | Fórmula                                                                                                  | Severidade                 | Fonte                   |
| ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------- | ----------------------- |
| `VOC_COLD_EXCEEDS_MAX`                                                                                           | `Ns × Voc(Tmín) ≤ Vdc máx. do inversor`                                                                  | ERRO                       | CRESESB Eq. 6.30 e 4.2  |
| `MODULE_SYSTEM_VOLTAGE_EXCEEDED`                                                                                 | `Ns × Voc(Tmín) ≤ tensão máx. do sistema do módulo`                                                      | ERRO                       | CRESESB p. 333          |
| `VMPP_ABOVE_MPPT`                                                                                                | `Ns × Vmpp(Tmín) ≤ V MPPT máx.`                                                                          | ERRO                       | CRESESB Eq. 6.31        |
| `VMPP_BELOW_MPPT`                                                                                                | `Ns × Vmpp(Tcél. máx.) ≥ V MPPT mín.`                                                                    | ERRO                       | CRESESB Eq. 6.31        |
| `START_VOLTAGE_NOT_REACHED`                                                                                      | `Ns × Vmpp(Tcél. máx.) ≥ V de partida`                                                                   | aviso                      | CRESESB Eq. 6.31        |
| `MPPT_CURRENT_EXCEEDED`                                                                                          | `Σ (strings em paralelo × Impp) ≤ corrente máx. por MPPT`                                                | ERRO                       | CRESESB Eq. 6.32; ficha |
| `MPPT_SHORT_CIRCUIT_EXCEEDED`                                                                                    | `Σ (strings em paralelo × Isc) ≤ Isc admissível por MPPT` (só se a ficha traz)                           | ERRO                       | ficha                   |
| `INPUTS_PER_MPPT_EXCEEDED`, `MPPT_COUNT_EXCEEDED`                                                                | contagens contra a ficha                                                                                 | ERRO                       | ficha                   |
| `STRING_MISMATCH`                                                                                                | mesmo MPPT: mesmo módulo e mesmo nº em série (**erro**); orientação diferente em mais de 10° (**aviso**) | ERRO / aviso               | EnergIF p. 169 (EF-R13) |
| `DC_POWER_EXCEEDED`                                                                                              | `Σ Pmax dos módulos ≤ potência CC máxima`                                                                | ERRO                       | ficha                   |
| `DC_AC_RATIO_OUT_OF_POLICY`                                                                                      | `CC/CA = Σ Pmax ÷ Pac nominal` na faixa da regra                                                         | aviso (pendente sem regra) | regra `engine.design`   |
| `MICRO_INPUT_MISMATCH`                                                                                           | módulos por unidade ≤ entradas do microinversor                                                          | ERRO                       | ficha                   |
| `MODULES_OVER_ALLOCATED` / `MODULES_NOT_ALLOCATED`                                                               | módulos nas strings × módulos do layout por superfície                                                   | ERRO / aviso               | geometria               |
| `MODULE_NOT_APPROVED`, `INVERTER_NOT_APPROVED`, `INVERTER_NOT_FOUND`, `MODULE_NOT_SELECTED`, `SURFACE_NOT_FOUND` | catálogo e referências                                                                                   | ERRO                       | ADR-0017                |

**Temperaturas (ENG-F01..F03).** `Voc` e `Vmpp` frios usam a **temperatura mínima de projeto** (`site.designTminC`) como temperatura da célula. `Vmpp` quente usa a célula quente `Tcel = Tamb,máx + (NOCT − 20)/800 × G`, com `Tamb,máx = site.designTmaxAmbientC` e `G` = parâmetro `hotCellIrradianceWm2` da regra. Sem NOCT na ficha usa-se `Kt = 0,03` (CRESESB, NOCT equivalente de 44 °C) e a origem aparece como `KT_DEFAULT`. Sem `β_Vmpp` usa-se `β_Voc` (`BETA_VOC_ASSUMED`; conservador nos dois sentidos).

**Status do projeto:** `INVALID` (algum erro falhou) > `INCOMPLETE` (falta dado ou regra) > `VALID_WITH_WARNINGS` > `VALID`. **Inválido e incompleto bloqueiam a aprovação** (RN-013 e trava das regras, 9I). Erro físico não impede **salvar**: a versão fica salva e explicada.

**O que fica pendente em vez de ser presumido:**

| Pendência                      | Tipo  | Como resolver                                                                               |
| ------------------------------ | ----- | ------------------------------------------------------------------------------------------- |
| `TMIN_MISSING`, `TMAX_MISSING` | dado  | o responsável técnico informa a temperatura de projeto, com a fonte, na etapa Local e clima |
| `RULE_HOT_CELL_IRRADIANCE`     | regra | parâmetro `hotCellIrradianceWm2` da regra `engine.design`                                   |
| `RULE_DC_AC_RATIO`             | regra | parâmetros `dcAcRatioMin` e `dcAcRatioMax` da regra `engine.design`                         |
| `NO_INVERTERS`                 | dado  | adicionar um inversor ao projeto                                                            |

**Regra `engine.design` — modelo para o responsável técnico (valores de PARTIDA, não revisados).** O Manual CRESESB cita, para o fator de dimensionamento do inversor (potência CA ÷ potência CC), limite inferior de mercado de 0,75 a 0,85 e superior de 1,05 (CR-08), o que equivale a uma relação CC/CA de **cerca de 0,95 a 1,33**; o exemplo da p. 152 usa 1000 W/m² na célula. Esses números são **referência de literatura**; a política da empresa é do responsável técnico, que cria e ativa a regra com a fonte:

```json
{
  "key": "engine.design",
  "definition": {
    "parameters": { "dcAcRatioMin": 0.95, "dcAcRatioMax": 1.33, "hotCellIrradianceWm2": 1000 }
  },
  "sources": [
    {
      "type": "BOOK",
      "reference": "Manual CRESESB 2014, p. 152 e 332 (política da empresa a revisar)"
    }
  ]
}
```

**Impacto.** Ativar uma nova versão de regra `engine.*` ou aposentar/revisar um equipamento marca como **desatualizadas** as versões que os usam (com o motivo). A versão aprovada não é alterada: só ganha a marca. Recalcular um rascunho limpa a marca e registra a nova referência da regra (`ruleRefs`).

## Microinversor

Cada unidade liga `modulesPerUnit` módulos da mesma superfície. Confere: módulos por unidade ≤ entradas; Voc frio ≤ Vdc máx.; Vmpp frio/quente na faixa; Impp ≤ corrente por entrada; Isc ≤ Isc admissível; potência CC por unidade ≤ máximo; relação CC/CA por unidade.

## Premissas e limites

- Modelo linear de temperatura (padrão de fichas); não modela efeito de baixa irradiância no Voc.
- Células tratadas como uniformes no arranjo (sem gradiente térmico entre módulos).
- Efeito de baixa irradiância no Voc e gradiente térmico entre módulos não são modelados.
- Corrente por MPPT usa `Impp` e `Isc` nas STC (sem fator de segurança embutido): um fator normativo entraria como parâmetro da regra.

## Testes

`thermal.test.ts` e `strings.test.ts` (valores acima, bordas, erros). Cobertura do pacote ≥ 90% (hoje 99%).
