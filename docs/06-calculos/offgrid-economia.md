# Off-Grid: custo (OFF-F09)

Código: `offgrid/economics.ts` · versão `offgrid-economics-1.0.0`.

- **CAPEX** = equipamentos do catálogo (preço vigente da tabela de preços ou custo de referência) + instalação + outros custos informados. Item sem preço aparece em `missingPrices` e não entra no total.
- **OPEX anual** = manutenção (% do CAPEX de equipamentos) + combustível (litros × preço) + energia da rede (kWh × tarifa).
- **Troca do banco** a cada `vida` anos dentro do horizonte (custo das baterias).
- **Custo nivelado** = VP dos custos ÷ VP da energia entregue (taxa de desconto informada).
- **Economia/retorno** só quando há custo evitado informado (R$/kWh): `economia = energia × custo evitado − OPEX`; `retorno = CAPEX ÷ economia`.

Não há tarifa social, tributos nem financiamento. Cenários (até 3) recalculam seleção, despacho e custo com banco, strings e gerador alterados.
