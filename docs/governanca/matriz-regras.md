# Matriz de regras reais do Engine

Cada linha é uma **proposta**: valor, fonte, confiança e quem confirma. Os arquivos em [`regras/`](regras/) têm o mesmo conteúdo no formato aceito por `POST /rules` (campo `rule`) e entram como **rascunho**. **Nenhuma regra é ativada automaticamente**: quem ativa é a empresa, e o engenheiro de cada projeto confere e assume as regras ao assinar.

**Limites da pesquisa.** O texto das normas ABNT (pagas) não foi lido; os valores técnicos vêm de artigo do Canal Solar que cita NBR 16690, 5410 e 16612, e do CRESESB 2014. A Lei 14.300 foi lida em espelho secundário (o Planalto não respondeu). Tudo abaixo é "a conferir pelo engenheiro".

## `engine.design`

| Parâmetro                       | Proposta                        | Fonte                                                                                        | Observação                                                                                                 |
| ------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `fuseMinFactor`                 | 1,5                             | NBR 16690 (via Canal Solar): 1,5·Isc < In < 2,4·Isc                                          | Falta o máximo (2,4): código novo `fuseMaxFactor`                                                          |
| `dcSwitchCurrentFactor`         | 1,25                            | NBR 16690: sub-arranjo/arranjo 1,25·Isc < In < 2,4·Isc                                       |                                                                                                            |
| `acBreakerFactor`               | engenheiro escolhe (1,0 a 1,25) | prática                                                                                      | Não preenchido                                                                                             |
| `rcdSensitivityMa`              | 30                              | NBR 5410                                                                                     |                                                                                                            |
| `dcAcRatioMin` / `dcAcRatioMax` | 0,95 / 1,33                     | CRESESB 2014 (FDI 0,75–0,85 a 1,05)                                                          | Política da empresa                                                                                        |
| `hotCellIrradianceWm2`          | 1000                            | EnergIF                                                                                      |                                                                                                            |
| `maxParallelStringsWithoutFuse` | **calcular**, não fixar         | NBR 16690: fusível de string só se a corrente reversa possível passar a suportada pela série | Código: `engine/protection.ts` usa o parâmetro; passar a usar a corrente reversa máxima da ficha do módulo |

## `engine.cables`

| Parâmetro / tabela                            | Proposta        | Fonte                                 | Observação                                                                                  |
| --------------------------------------------- | --------------- | ------------------------------------- | ------------------------------------------------------------------------------------------- |
| `cableCurrentFactorDc`                        | 1,25            | NBR 16690, Tabela 5                   | Cabo sem proteção: ≥ 1,25 × Isc do arranjo                                                  |
| `cableCurrentFactorAc`                        | 1,0             | corrente do dispositivo de proteção   |                                                                                             |
| `conductorTempC`                              | 90              | NBR 16612 Anexo C                     |                                                                                             |
| `maxVoltageDropDcPct` / `maxVoltageDropAcPct` | **sem valor**   | NBR 5410 6.2.7.1 e NBR 16690          | Só o limite de 7% a partir do transformador MT/BT foi confirmado; 4%/5% para BT pública não |
| `tables.ampacity`                             | planilha-modelo | NBR 16612 Anexo C, NBR 5410 Tabela 36 | Colunas `seção;método;ampacidade`; o engenheiro preenche; `Iz' = Iz·FTA·FRS·FAC`            |

## `engine.economics`

| Dado                     | Proposta                                                                        | Fonte                       | Observação                                                                |
| ------------------------ | ------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------- |
| `tables.fio_b` (ano → %) | 2023: 15, 2024: 30, 2025: 45, 2026: 60, 2027: 75, 2028: 90                      | Lei 14.300/2022, art. 27    | Hoje o motor tem um único `compensationFactor`: precisa da tabela por ano |
| 2029 em diante           | cenário do financeiro                                                           | Lei 14.300, art. 17 (ANEEL) |                                                                           |
| Direito adquirido        | unidades com acesso solicitado até 06/01/2023, regras anteriores até 31/12/2045 | Lei 14.300                  | Marcar no projeto                                                         |

## `engine.connection`

Classe: micro ≤ 75 kW; mini > 75 kW até 5 MW (REN 1.000/2021). Limite pela potência disponibilizada no Grupo B. As exigências específicas saem das normas da distribuidora, **uma regra por exigência, sempre com `source`**.

| Distribuidora                                                  | Norma encontrada                                            | Estado            |
| -------------------------------------------------------------- | ----------------------------------------------------------- | ----------------- |
| Energisa                                                       | NDU-013 v9.0 (abr/2026), BT                                 | extrair           |
| Neoenergia                                                     | DIS-NOR-031 (rev. 01, 2022), DIS-NOR-033 (MT)               | extrair           |
| EDP                                                            | PT.DT.PDN.00059 v5 (BT), 00058 v6 (MT), vigência 02/08/2023 | extrair           |
| Enel SP / GO                                                   | NT 6.012 v5 (2019, provável defasagem) / NTC-71             | conferir vigência |
| CEMIG-D, COPEL, COELBA, CPFL Paulista, RGE Sul, Equatorial/EMT | **não encontradas**                                         | buscar            |

## `offgrid.design`

Os 17 parâmetros provisórios do CRESESB ficam em `packages/solar-engine/src/offgrid/parameters.ts` (branch do Off-Grid). Esta branch não os altera; o engenheiro os substitui quando o Off-Grid entrar.

## Parâmetros que o código ainda não aceita

- `fuseMaxFactor` (`engine.design`), importação CSV da `tables.ampacity` e `tables.fio_b` em `economics.ts`. Entram na fase 3 do plano.
