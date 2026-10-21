# Off-Grid: recurso solar e dimensionamento (OFF-F02..F04, F10)

Código: `offgrid/resource.ts`, `offgrid/sizing.ts`, `offgrid/suggest.ts` · versões `offgrid-resource-1.0.0`, `offgrid-sizing-1.0.0`, `offgrid-suggest-1.0.0`.
Fonte: CRESESB, _Manual de Engenharia para Sistemas Fotovoltaicos_ (2014), cap. 6 (extração `CR-13…CR-18` em [referencias/cresesb-2014](../referencias/cresesb-2014/README.md)).

## Recurso solar

- Com **série horária** da Central (NASA POWER/PVGIS), cada arranjo é transposto para o seu plano pelo mesmo modelo isotrópico do Engine (`buildPlaneHours`).
- **Sem série**, monta-se um **ano sintético** da climatologia mensal: a irradiação diária do mês é distribuída pelas horas com peso `sen(altura do sol)`, fração difusa **presumida de 35%** e temperatura em senoide (média ± amplitude do clima). Sempre com aviso.
- **HSP do mês** = soma da irradiância no plano ÷ 1000 ÷ dias do mês. **Mês de projeto** = o de maior `carga ÷ HSP`.

## Dimensionamento (mês crítico)

| Passo                   | Equação                                                                      | CR      |
| ----------------------- | ---------------------------------------------------------------------------- | ------- |
| Energia/dia             | `L = Lcc/ηbat + Lca/(ηbat·ηinv)`                                             | 6.2     |
| Potência FV             | `Pm = máx_i [ Li / (HSPi · Red1 · Red2) ]`                                   | 6.3     |
| Banco                   | `C = L · N / Pd` (Wh); `Ah = C / Vsist`                                      | 6.10–12 |
| Série/paralelo          | `Vsist/Vbat`; `CBI/CBIbat`                                                   | 6.16–17 |
| Corrente do controlador | `Ic = fator · Isc · Np` (típico 1,25)                                        | 6.18    |
| Voc a frio              | `Ns · Voc(Tmin) · fator < Vmáx do controlador`                               | 6.20    |
| Autonomia sugerida      | `N = 4,58 − 0,48 · HSPmin` ⚠️ (equação reconstruída do texto; só referência) | 6.13    |

`Red1` e `Red2`, `ηbat`, `ηinv`, DoD por química, autonomia mínima, fatores e limites vêm da regra **`offgrid.design`** ([guia](../07-desenvolvimento/offgrid.md)). **Sem regra ativa** o motor usa valores provisórios (exemplos do manual), marca `RULE_PARAMETERS_MISSING` e a aprovação fica travada.

## Sugestor (OFF-F10)

Enumera combinações do catálogo **aprovado** (módulo × bateria × controlador × inversor; até 5 de cada, as mais baratas): inversor na tensão do banco com potência e surto suficientes; banco com a série que fecha a tensão e o paralelo que fecha o Ah (respeitando o limite da ficha e da regra); módulos em série pela faixa do controlador e a tensão de carga; strings em paralelo pela potência de pico; controladores em paralelo pela corrente. Ordena por custo e **confirma as 12 melhores com a simulação horária** (perda de carga ≤ limite da regra). É uma sugestão a confirmar, nunca uma aprovação.
