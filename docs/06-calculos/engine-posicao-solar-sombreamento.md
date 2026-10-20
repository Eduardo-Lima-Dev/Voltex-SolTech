# Memorial: posição solar e sombreamento (ENG-F16, F17)

**Posição solar: implementada na 9A. Sombreamento: implementado na 9D** (`shading.ts`, `shading-1.0.0`).

## ENG-F16: posição do sol (`solpos-1.0.0`)

`solar-position/position.ts`. Equações astronômicas do **NOAA Solar Calculator** (Meeus, _Astronomical Algorithms_): dia juliano → longitude e anomalia médias do sol → equação do centro → declinação (`δ`) e equação do tempo (`EoT`) → tempo solar verdadeiro `TST = UTC + EoT + 4·λ` (λ em graus, leste positivo) → ângulo horário `H = TST/4 − 180` → `cos z = sin φ sin δ + cos φ cos δ cos H` → azimute pelo norte, horário.

| Item      | Convenção                                                            |
| --------- | -------------------------------------------------------------------- |
| Latitude  | positiva ao norte; Brasil negativo                                   |
| Longitude | positiva a leste; Brasil negativo                                    |
| Azimute   | N=0°, E=90°, S=180°, W=270°                                          |
| Altura    | geométrica; `apparentElevationDegrees` inclui refração padrão (NOAA) |
| Tempo     | `Date` em UTC; o chamador converte fuso/horário de verão             |

**Precisão e validação.** 28 casos de ouro gerados com **pvlib 0.16.1** (`solarposition.get_solarposition`, método `nrel_numpy`, i.e. NREL SPA) em Brasília, Fortaleza, Porto Alegre e equador, em equinócios e solstícios de 2025 (`tools/golden/`). Diferença máxima medida: **0,006° na altura** e **0,026° no azimute**. Tolerâncias nos testes: 0,02° e 0,05°. O Engine **não** é o SPA completo; se um caso futuro exigir incerteza de 0,0003°, troca-se a implementação e o teste de ouro continua valendo.

**Limites:** datas fora de 1950–2050 degradam a precisão (polinômios de século); sol no zênite tem azimute indefinido (devolve 180° e o teste de ouro ignora azimute com zênite < 5°).

## ENG-F17: sombreamento (`shading-1.0.0`)

Para cada mês (dia 15) varre o dia de 15 em 15 minutos (hora solar de 4h às 20h), calcula a posição do sol (F16) e decide, ponto a ponto, se o sol está **bloqueado**:

1. **Horizonte distante** (perfil do PVGIS, azimute do norte): bloqueado se `altura do sol < altura do horizonte no azimute` (interpolação linear circular entre os pontos).
2. **Obstáculos próximos** (direção, distância, altura do topo acima da base do arranjo, largura): silhueta de meia-largura `atan((largura/2)/distância)` e altura angular `atan(altura/distância)`; bloqueia se o azimute do sol está dentro da faixa e a altura do sol é menor que a do topo. Altura ≤ 0 não sombreia.
3. **Valor informado à mão** (com fonte): substitui o cálculo e fica marcado como tal.

**Ponderação:** cada instante pesa `DNI_céu_claro(altura) · max(0, cos θ)`, com `DNI` de **Meinel** (`1353 · 0,7^(AM^0,678)`) e massa de ar de Kasten e Young, e `cos θ` o cosseno do ângulo de incidência no plano da superfície. A perda mensal é `Σ peso·sombreado / Σ peso`; a anual pondera os meses pelos dias e pela radiação direta do mês.

**Saídas:** perda mensal e anual, trajetórias do sol por mês (a carta solar), silhuetas dos obstáculos.

**Premissas e limites (visíveis na tela):** estimativa pela componente **direta** com céu claro (a difusa não é sombreada pelos obstáculos); sem penumbra; hora solar média (sem equação do tempo: erro de poucos minutos); sem efeito elétrico de sombra parcial (diodos de bypass) por string; sombra entre fileiras do próprio arranjo fica no layout (F15). Sem horizonte e sem obstáculos a perda é **zero** e a tela avisa.

**Validação:** casos de comportamento (obstáculo ao norte pesa mais no inverno; obstáculo atrás da face quase não pesa; horizonte alto reduz; determinismo) e a posição do sol contra o NREL SPA (casos de ouro da 9A). **Falta** comparar a perda com o PVGIS/pvlib para um mesmo horizonte; entra nos casos de ouro da simulação (9G).
