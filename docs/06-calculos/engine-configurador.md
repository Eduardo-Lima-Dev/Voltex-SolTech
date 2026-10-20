# Memorial: gerador de configurações (ENG-F25)

**Estado: implementado na 9E** (`engine/configurator.ts`, `configurator-1.0.0`). Busca **determinística** (sem IA) no catálogo aprovado da empresa; sempre **sugestão a confirmar**, nunca decisão.

## Problema

Dada a potência-alvo (kWp), o local (Tmin, Tmax de célula) e as restrições (fase, tipo de projeto), listar combinações **módulo × inversor × nº de módulos por string × nº de strings por MPPT** que passam em **todas** as verificações de compatibilidade (F02–F09, [memorial](engine-compatibilidade.md)).

## Algoritmo

1. Sem **temperatura mínima e máxima de projeto**, sem a regra `engine.design` (`hotCellIrradianceWm2`, `dcAcRatioMin`, `dcAcRatioMax`) ou sem a superfície, **não gera**: devolve as pendências.
2. Para cada módulo aprovado: calcula quantos **cabem** na superfície (layout F15). Para cada inversor aprovado: calcula `Nmin..Nmax` módulos em série (F06); par sem faixa viável é descartado **com o motivo**.
3. Meta de módulos `T = round(kWp_alvo × 1000 / Pmax)`. Quantidade de inversores `k` de `ceil(T·Pmax / (Pac·CC/CA máx.))` a `floor(T·Pmax / (Pac·CC/CA mín.))`, até o máximo pedido. Para cada `Ns` viável: `S = floor(T/Ns)` e `ceil(T/Ns)` (com `S ≥ k` e `Ns·S ≤ cabem`); ficam as 8 formas mais próximas da meta.
4. As `S` strings se distribuem pelos `k × nº de MPPT` com uma string por MPPT primeiro e depois dobrando de forma equilibrada (respeitando as entradas por MPPT).
5. **Cada candidata passa pelo Compatibility Engine completo**; só `VALID` e `VALID_WITH_WARNINGS` entram. Microinversores: para cada nº de módulos por unidade, `unidades = round(T/mpu)`.
6. **Ordem:** (a) distância à meta em faixas de 5%; (b) menor **custo por kWp** (preço vigente da tabela de preços, senão o custo de referência; item sem preço fica depois); (c) distância exata à meta; (d) relação CC/CA mais perto do centro da faixa; (e) maior folga de tensão; (f) menos inversores; (g) desempate por id (resultado sempre o mesmo).
7. Devolve as N primeiras com **por que passou** (os valores estão na conferência de cada uma, ao usar) e avisos.

## Garantias

Mesma entrada → mesma saída (sem aleatoriedade, ordenação total). Equipamento não aprovado nunca entra. Regra `engine.design` ausente → o gerador devolve "pendente de regra" em vez de lista.

## Limites

Uma superfície por configuração no MVP2; várias superfícies são combinadas manualmente no editor. Microinversor entra com regra própria de entrada por módulo.

## Testes

Caso de referência feito à mão (6,6 kWp = 12 módulos em 2 strings de 6 num inversor de 5 kW, CC/CA 1,32); folga de tensão como critério de desempate; preço por kWp e item sem preço; microinversores; par inviável explicado; módulo que não cabe; vários inversores; pendências; **determinismo** (inclusive invertendo a ordem do catálogo).

**Ao usar uma configuração**, a tela limita a superfície aos módulos da configuração (`moduleCount`) e troca os inversores daquela superfície pelas entradas sugeridas; o servidor recalcula ao salvar.
