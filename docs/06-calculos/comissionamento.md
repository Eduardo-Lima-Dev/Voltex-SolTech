# Comissionamento: valor esperado e julgamento dos ensaios

Código: `packages/solar-engine/src/commissioning/` · versão `commissioning-1.0.0` · fontes: [EnergIF 2023 p. 193–196](../referencias/energif-2023/regras-e-medidas.md) (EF-R16 a EF-G10) e o Engine (EF-M11, ENG-F02).

O comissionamento **não é um cálculo normativo**: o sistema monta o modelo de ensaios, calcula o **valor esperado** de cada string e compara com o medido **dentro dos limites que o responsável técnico definiu**. **Nenhuma tolerância é presumida.**

## Modelo de ensaios

Cada ensaio é uma linha da regra `ops.commissioning` (ou do modelo-base provisório): `code`, `label`, `group`, `kind` (`CHECK` conferência ou `MEASURE` medição), `level` (padrão ou ampliado), `scope` (sistema, string ou inversor), `unit`, `expected` (valor esperado calculado do projeto), `tolerancePct`, `min`, `max`, `required` e **`source` obrigatória**. A regra é validada (tolerância exige esperado, conferência não tem limite, mínimo ≤ máximo, esperado só por string, código único).

- **Nível padrão** = categoria 1; **ampliado** = categorias 1 e 2 (curva I×V por string e inspeção infravermelha).
- Cada ensaio gera **uma linha por sistema, por string ou por inversor**, na ordem do modelo. As strings e os inversores vêm do **snapshot técnico aprovado** (`design.inverters[].mppts[].strings[]`, com `parallel` strings iguais por grupo); microinversor entra só como inversor. Sem projeto técnico, as strings são informadas à mão.
- O modelo usado fica **congelado** no registro: trocar a regra depois não muda o que valeu para ele.

## Valores esperados por string

Condições medidas no local: irradiância `G` (W/m², piranômetro ou célula de referência) e temperatura do módulo `T` (°C; usada como temperatura de célula). Módulo da ficha do catálogo: `Voc`, `Isc`, `β_Voc` e `α_Isc` (%/°C) e `Ns` módulos em série.

- **Voc da string:** `Voc_esp = Ns × Voc_stc × (1 + β_Voc/100 × (T − 25))`. A tensão de uma string em série é a soma das dos módulos (EF-M11); a correção linear é a do Engine (ENG-F02).
- **Isc da string:** `Isc_esp = Isc_stc × (G / 1000) × (1 + α_Isc/100 × (T − 25))`. A corrente de uma string em série é a de um módulo; o modelo é linear de primeira ordem.

## Julgamento

- **Conferência:** `passed = true` → conforme; `false` → reprovado; sem resposta → sem registro.
- **Medição:** com `tolerancePct`, `desvio = (medido − esperado) / esperado × 100` e **passa se `|desvio| ≤ tolerância`** (folga de 1e-9 para o ponto flutuante); com `min`/`max`, o medido tem de estar no intervalo; se há os dois, **os dois** valem e os motivos se somam.
- **Sem tolerância nem limite na regra** → `PENDING_RULE` ("sem regra para julgar"). **Faltando dado** (ficha do módulo incompleta, temperatura ou irradiância não informadas, irradiância ≤ 0) → `PENDING_DATA`, com o que falta. Os dois resultados **travam a aprovação**.

## Travas da aprovação

Só o responsável técnico (`ops.commissioning.approve`) aprova, e **nenhuma** destas pode estar de pé: regra provisória (sem regra ativa e revisada), ensaio obrigatório sem registro, ensaio reprovado, ensaio sem juízo, nenhum ensaio gerado. Os motivos vão na resposta (`data.blockers`) e na tela. Enviar para revisão exige todos os obrigatórios **registrados** (não necessariamente aprovados).

## Premissas e limites

- A temperatura do **módulo** medida faz o papel da temperatura de célula (a de célula não se mede de fora); a diferença é pequena e é premissa registrada.
- O modelo de Isc não corrige perda espectral nem de incidência; em irradiância baixa o desvio relativo cresce: **a faixa de irradiância válida é critério do responsável técnico** (o sistema só recusa irradiância ≤ 0).
- Não há ensaio calculado de curva I×V, termografia, isolamento ou aterramento: são conferências ou medições absolutas, com os limites da regra.
- Os números de exemplo dos testes (Voc 40 V, Isc 10 A, tolerâncias de 3 % e 5 %) são **só de teste**; não são critério de aceitação.

## Casos de teste

`evaluate.test.ts` (conta à mão: 10 módulos a 45 °C → 376 V; 800 W/m² → 8 A; 8,08 A a 45 °C; bordas da tolerância e dos limites; pendências), `model.test.ts` (modelo-base sem limites, esquema da regra, alvos do projeto, geração por nível, travas).
