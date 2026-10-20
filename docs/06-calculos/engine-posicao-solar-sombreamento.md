# Memorial: posição solar e sombreamento (ENG-F16, F17)

**Posição solar: implementada na 9A.** Sombreamento: projeto (implementação na 9D).

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

## ENG-F17: sombreamento (projeto, 9D)

Três fontes, combinadas **por hora e por superfície**:

1. **Horizonte distante** (perfil de elevação por azimute, do PVGIS via Central de Dados): o sol está sombreado quando `elevação_sol < horizonte(azimute)`.
2. **Obstáculos próximos** informados no projeto (altura, distância, largura, direção): ângulo de sombra `atan((h_obstáculo − h_superfície) / distância)`; o obstáculo bloqueia o sol quando o azimute do sol cai dentro do setor angular que ele ocupa e a elevação é menor que o ângulo de sombra.
3. **Valor informado** com fonte (quando não há dados): fração mensal de perda fornecida pela pessoa, sempre marcada como estimativa.

Saídas: fração sombreada por hora e mês, perda anual estimada (ponderada pela irradiação direta, nunca a difusa), **carta solar** (trajetórias do sol por mês, horizonte e obstáculos desenhados). Sombra sobre fileiras do próprio arranjo (espaçamento) entra no layout (F15).

Fontes: geometria e EF-M05 (sombreamento reduz a geração). Validação: casos de ouro com horizonte sintético (cálculo à mão) e comparação do horizonte com o PVGIS no mesmo local.

**Premissas:** sombra tratada como ligar/desligar por hora (sem penumbra), difusa não sombreada pelo obstáculo, sem efeito elétrico de sombra parcial por string (diodos de bypass), que fica para versão futura e aparece como aviso.
