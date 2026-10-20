# Memorial: viabilidade econômica (ENG-F23)

**Estado: implementado (`economics-1.1.0`, 9H) em `packages/solar-engine/src/engine/economics.ts`.** Método financeiro **ainda a validar com a pessoa de finanças** antes de uso em decisão comercial (EF-G03: o livro não traz o método). O Calculator (`calc-1.1.0`) não foi tocado: o Engine tem as suas próprias primitivas.

**Fluxo anual:** `geração_t = geração_1 × (1 − degradação)^(t−1)`; `compensada_t = min(geração_t, consumo × 12) × fator de compensação` (fator vem da regra `engine.economics`); `economia_t = compensada_t × tarifa × (1 + reajuste)^(t−1)`; `fluxo_t = economia_t − O&M` (O&M = % do CAPEX ao ano). Valores em centavos, arredondados por ano.

## Entradas

CAPEX (lista de materiais com **preço vigente**, F24, mais mão de obra e margem da cotação), OPEX anual, geração anual (F19, com degradação F21), consumo e tarifa da UC (com proposta de atualização vinda da Central), regra de compensação (Lei 14.300/Fio B) da regra `engine.economics`, reajuste tarifário, taxa de desconto, vida útil de 25 anos, financiamento opcional.

## Saídas

Fluxo de caixa de 25 anos; payback simples e descontado; **VPL** `Σ FC_t/(1+i)^t − CAPEX`; **TIR** (raiz de `VPL(i)=0`, por bisseção com tolerância documentada); **LCOE** `Σ custos_t/(1+i)^t ÷ Σ energia_t/(1+i)^t`; financiamento por **Price** e **SAC**; até 3 cenários; **sensibilidade** (tornado: tarifa, reajuste, degradação, CAPEX, taxa de desconto).

## Financiamento, cenários e sensibilidade (implementados)

- **Financiamento** (opcional): entrada em % do CAPEX; taxa **efetiva anual** convertida em mensal `i = (1 + a)^(1/12) − 1`. **Price**: parcela `P·i / (1 − (1+i)^−n)`. **SAC**: amortização `P/n` mais juros sobre o saldo. Resultado: parcelas inicial e final, juros totais, **VPL de quem financia** (entrada no ano 0; fluxo = economia − O&M − parcelas do ano) e payback sobre a entrada. Não inclui tarifas bancárias, seguro nem IOF.
- **Cenários** (até 3): sobrescrevem reajuste da tarifa, taxa de desconto, fator de geração e fator de CAPEX sobre o caso-base; cada um devolve payback, VPL, TIR e LCOE.
- **Sensibilidade (tornado):** varia ±10% (relativo) geração, CAPEX, tarifa, reajuste, taxa de desconto e O&M; devolve o VPL nos dois extremos e ordena pela amplitude.

## Trava

Sem regra `engine.economics` ativa e revisada, a compensação (Fio B) **não é presumida**: o resultado aparece como "sem regra de compensação" e bloqueia a aprovação. Tarifa sem fonte e vigência: aviso visível.

## Validação

Os testes do motor trazem casos calculados à mão (juros zero, Price constante, SAC decrescente, tornado ordenado, ±10% da geração = ±10.000 no caso de referência). **Pendente:** planilha de referência versionada em `tools/golden/` conferida por duas implementações e **validação por quem entende de finanças** (método de compensação, impostos e financiamento reais).
