# Off-Grid: perfil de carga (OFF-F01)

Código: `packages/solar-engine/src/offgrid/load.ts` · versão `offgrid-load-1.0.0`.

## O que calcula

Para cada carga: `energia na hora = potência × quantidade × duty × sazonalidade[mês]`, só dentro da **janela de uso** (que pode atravessar a meia-noite) e nos **dias da semana** marcados.

- `duty = min(1, horas por dia ÷ comprimento da janela)`: as horas por dia são espalhadas uniformemente na janela.
- Sazonalidade: fator por mês (1 = uso normal; 0 = desligada, como casa de praia fora de temporada).
- **Energia diária do mês** = soma das 24 horas × 7 dias da semana ÷ 7. O **mês crítico de carga** é o de maior energia diária.
- **Pico** = maior soma, em qualquer mês/dia/hora, da `potência × quantidade × simultaneidade` das cargas que podem estar ligadas ao mesmo tempo.
- **Surto (partida)** = pico + `potência × (fator de partida − 1)` da maior partida possível (uma partida por vez).
- **Consumo noturno** = fração da energia entre 18 h e 6 h; **crítica** = energia das cargas marcadas como críticas.

## Limites

- A distribuição uniforme na janela é uma simplificação: a curva real de uso vem de medição ou levantamento (etapa de levantamento do Engine).
- Cargas CA passam pelo inversor; cargas CC ligam direto no banco.
