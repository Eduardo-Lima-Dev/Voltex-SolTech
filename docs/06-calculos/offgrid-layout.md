# Off-Grid: projeto visual do terreno (OFF-F11)

Código: `packages/solar-engine/src/offgrid/layout.ts` · versão `offgrid-layout-1.0.0`. Telas: etapas **Diagrama do sistema** e **Terreno 2D/3D** do editor.

## Pegada dos arranjos

Módulos em retrato: **colunas = módulos em série** (largura = `n × largura do módulo + folgas de 2 cm`) e **fileiras = strings em paralelo** (profundidade na inclinação = `fileiras × comprimento`). A projeção horizontal é `profundidade × cos(inclinação)` e o topo fica a `profundidade × sen(inclinação)`. Sem a ficha, usa um módulo de 2,278 × 1,134 m. O arranjo é tratado como **uma mesa só**: o sombreamento entre fileiras de uma estrutura de solo não é calculado aqui.

## Sombra das construções

Cada objeto do terreno com altura vira um **obstáculo** visto do centro do arranjo (azimute, distância até a face mais próxima, largura vista e altura) e passa pela **varredura anual do Engine** (`computeShading`, 12 meses, passos de 15 min). O resultado é a perda da **componente direta** (referência); o projetista decide se a usa como perda por sombra do arranjo. A altura da base do arranjo é considerada zero.

## Trajetos de cabo

Distância em linha reta entre os centros × `(1 + folga)`. Trajetos: cada arranjo → casa de máquinas (CC), casa de máquinas → casa (CA), gerador → casa de máquinas, poste da rede → casa de máquinas (só no híbrido) e banco → inversor (distância informada). Corrente: CC dos módulos = `strings × Impp`; CA = `pico ÷ tensão`; gerador e rede pela potência; banco = `potência do inversor ÷ tensão do banco`.

**Seção mínima** (CRESESB Eq. 6.33/6.34): `S = ρ(T) · 2d · I / (queda% · V)`, com `ρ(20 °C) = 0,01724 Ω·mm²/m`, `α = 0,0039 /°C` e condutor a 70 °C. A seção comercial é a próxima da série 1,5 … 240 mm². **A queda máxima é escolha do projetista** (padrões 3% CC/CA e 1% no banco, não são norma). A capacidade de condução, agrupamento e aprovação do cabo seguem a regra `engine.cables` e **não** são aplicadas aqui.

## Avisos

Objeto fora do terreno, arranjo sobreposto a construção, falta da casa de máquinas ou da casa, e trajeto que exige mais de 240 mm².
