# Memorial: viabilidade econômica (ENG-F23)

**Estado: projeto (implementação na 9H).** Método financeiro a **validar com a pessoa de finanças** antes da liberação (EF-G03: o livro não traz o método). Primitivas financeiras serão extraídas para `src/finance/` **sem alterar o Calculator** (`calc-1.1.0` segue idêntico; teste prova).

## Entradas

CAPEX (lista de materiais com **preço vigente**, F24, mais mão de obra e margem da cotação), OPEX anual, geração anual (F19, com degradação F21), consumo e tarifa da UC (com proposta de atualização vinda da Central), regra de compensação (Lei 14.300/Fio B) da regra `engine.economics`, reajuste tarifário, taxa de desconto, vida útil de 25 anos, financiamento opcional.

## Saídas

Fluxo de caixa de 25 anos; payback simples e descontado; **VPL** `Σ FC_t/(1+i)^t − CAPEX`; **TIR** (raiz de `VPL(i)=0`, por bisseção com tolerância documentada); **LCOE** `Σ custos_t/(1+i)^t ÷ Σ energia_t/(1+i)^t`; financiamento por **Price** e **SAC**; até 3 cenários; **sensibilidade** (tornado: tarifa, reajuste, degradação, CAPEX, taxa de desconto).

## Trava

Sem regra `engine.economics` ativa e revisada, a compensação (Fio B) **não é presumida**: o resultado aparece como "sem regra de compensação" e bloqueia a aprovação. Tarifa sem fonte e vigência: aviso visível.

## Validação prevista

Planilha de referência versionada (`tools/golden/`) com o mesmo caso calculado à mão; TIR e VPL conferidos por duas implementações independentes (uma no motor e uma no script Python).
