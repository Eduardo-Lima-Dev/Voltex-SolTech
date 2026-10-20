# Memorial: layout dos módulos (ENG-F15)

`packages/solar-engine/src/engine/layout.ts` (`layout-1.0.0`). **Implementado na 9D.** Geometria pura: não usa norma nem tabela.

## Entradas

Superfície (largura ao longo do beiral, profundidade, recuos `esquerda/direita/topo/base`, orientação dos módulos, folga entre módulos, limite de quantidade, espaçamento entre fileiras) e o módulo (comprimento, largura, Pmax). A latitude entra no espaçamento mínimo.

## Cálculo

- **Área útil:** `largura − recuo esquerdo − recuo direito` por `profundidade − recuo do topo − recuo da base`.
- **Módulo no plano:** retrato → lado ao longo do beiral = largura do módulo, lado ao longo da água = comprimento; paisagem inverte.
- **Colunas:** `floor((útil_largura + folga) / (w + folga))`. **Fileiras (telhado inclinado):** `floor((útil_prof + folga) / (h + folga))`.
- **Laje ou solo com estrutura (FLAT_RACK):** cada fileira ocupa `h · cos(inclinação)` na planta; o passo entre fileiras é `h·cos(β) + espaçamento`, com `fileiras = floor((útil_prof − h·cos β) / passo) + 1`.
- **Espaçamento mínimo** (`minRowSpacingM`): a sombra da borda de cima de uma fileira (altura `H = h·sen β`) não pode atingir a fileira de trás **no solstício de inverno do hemisfério do local, às 9h e às 15h (hora solar)**. Com o sol de altura `α` e azimute `A`, a sombra tem comprimento `H / tan α` e sua componente no eixo das fileiras é `(H / tan α)·cos(A − azimute da face)`. Vale o maior valor entre as duas horas.
- **Potência** `= módulos · Pmax / 1000` (kWp); **área de módulos** `= módulos · comprimento · largura`.

## Caso de referência (feito à mão)

Superfície 10 × 5 m, recuos 0,3 m, módulo 2278 × 1134 mm em retrato, folga 0,02 m: útil 9,4 × 4,4 m → colunas `floor(9,42 / 1,154) = 8`, fileiras `floor(4,42 / 2,298) = 1` → **8 módulos, 4,4 kWp**. Espaçamento: latitude −15°, inclinação 15°, módulo de 2 m ao longo da inclinação: `H = 0,5176 m`; às 9h do solstício de junho o sol tem altura 31,58° e azimute 49,6° → `0,842 · cos 49,6° = 0,546 m` → **0,55 m**.

## Limites

Superfície **retangular** (sem polígono, sem recortes nem chaminés dentro da área: use recuos ou crie outra superfície). Sem editor interativo: a prévia em planta é só visualização. Sombra entre fileiras só no FLAT_RACK; no telhado inclinado os módulos são coplanares. A ocupação real (circulação, bandejas) vem dos recuos.
