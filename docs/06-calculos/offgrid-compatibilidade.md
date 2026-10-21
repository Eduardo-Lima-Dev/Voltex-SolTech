# Off-Grid: verificação do que foi escolhido (OFF-F05..F06)

Código: `offgrid/selection.ts` · versão `offgrid-selection-1.0.0`. Cada verificação tem código estável e severidade `OK`, `WARNING` ou `ERROR` (erro ⇒ projeto `INVALID`).

| Código                                                                                               | Verifica                                                                              |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `EQUIPMENT_NOT_FOUND` / `EQUIPMENT_NOT_APPROVED`                                                     | Item citado existe e está **aprovado** no catálogo                                    |
| `VOC_COLD_OK` / `VOC_COLD_EXCEEDS`                                                                   | `Ns · Voc(Tmin) · fator` ≤ Voc máxima do controlador (ou do MPPT embutido)            |
| `VMPP_BELOW_MPPT`, `ARRAY_BELOW_CHARGE_VOLTAGE`, `PWM_CANNOT_CHARGE`                                 | Vmpp a quente alcança o mínimo do MPPT e a tensão de carga do banco (`Vsist · fator`) |
| `CONTROLLER_CURRENT_*`, `CONTROLLER_POWER_*`, `CONTROLLER_VOLTAGE_*`                                 | Corrente (`fator · Isc total`), potência FV e tensão de banco aceita                  |
| `BANK_VOLTAGE_*`                                                                                     | Banco (série × Vnom) dentro de ±10% da tensão do sistema (51,2 V serve a 48 V)        |
| `BANK_PARALLEL_*`                                                                                    | Colunas em paralelo ≤ mínimo(ficha, regra)                                            |
| `AUTONOMY_*`                                                                                         | `Wh úteis ÷ energia/dia` ≥ autonomia mínima da regra                                  |
| `DOD_LIMITED`, `BATTERY_COLD`, `CHARGE_RATE_*`                                                       | DoD limitada pela ficha/regra; banco frio; C-rate do FV acima do limite               |
| `INVERTER_VOLTAGE_*`, `INVERTER_POWER_*`, `INVERTER_SURGE_*`                                         | Tensão do banco; `pico × (1+margem)`; partida                                         |
| `INVERTER_NOT_HYBRID`, `INVERTER_NO_GENERATOR_INPUT`, `INVERTER_NOT_SINE`, `INVERTER_EFFICIENCY_LOW` | Topologia híbrida com entrada de rede; entrada de gerador; onda; eficiência mínima    |
| `GENERATOR_POWER_*`, `GENERATOR_CHARGING_LIMITED`, `GENERATOR_SOC_INVERTED`                          | Gerador atende o pico; folga para recarregar; SOC de parada > partida                 |
| `LOLP_OK` / `LOLP_EXCEEDS`                                                                           | Perda de carga anual dentro do limite da regra                                        |
| `STRESS_OK` / `STRESS_FAILED`                                                                        | Teste de estresse (aviso)                                                             |

Temperaturas: `designTminC`/`designTmaxAmbientC` do local; sem elas usa o clima da Central, e sem clima a Voc a frio fica **pendente**.
