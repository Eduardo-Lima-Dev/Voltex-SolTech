# Off-Grid: despacho horário, gerador, rede e estresse (OFF-F07..F08)

Código: `offgrid/dispatch.ts`, `offgrid/stress.ts` · versões `offgrid-dispatch-1.0.0`, `offgrid-stress-1.0.0`.

## Balanço a cada hora (barramento CC)

1. **FV** (`G` no plano, temperatura de célula `Tamb + (NOCT−20)/800·G`, `P = N·Pmax·G/1000·(1+γ(Tc−25))·(1−sombra)·fator de sujeira·Red2`) passa pelo controlador (eficiência, limite de corrente/potência) e alimenta as cargas.
2. **Gerador** (se ligado): alimenta as cargas CA direto e o que sobra recarrega o banco pelo carregador do inversor (`CHARGER_EFFICIENCY = 0,9`). Liga ao descer ao SOC de partida (sem rede), desliga ao atingir o SOC de parada depois do tempo mínimo, só na janela de horas permitida. Combustível ∝ carga (mínimo 25%), a partir do consumo a 75%.
3. **Rede** (híbrido, **nunca injeta**): `BACKUP` — a rede alimenta as cargas e a bateria guarda a reserva para as quedas; `SELF_CONSUMPTION` — a bateria é usada até o piso e a rede cobre o resto. Quedas: janela diária e quedas prolongadas (dias do ano). Recarga pela rede abaixo de um SOC, com histerese.
4. **Banco**: descarrega até o piso (`1 − DoD`), limitado pela corrente/inversor; o excedente de FV carrega o banco (limitado pela corrente de carga); o resto é desperdiçado. Eficiência de ciclo dividida igualmente entre carga e descarga (`√ηciclo`).

O ano é simulado **duas vezes seguidas**; só a segunda passada é reportada (o SOC inicial deixa de pesar).

## Indicadores

Perda de carga (`LOLP` = horas com carga não atendida ÷ horas), energia não atendida, cobertura, maior sequência de falha, SOC mínimo (mensal, diário, dia típico), ciclos equivalentes (`energia descarregada ÷ Wh úteis`) e **vida do banco** por energia processada: `ciclos × Wh nominais × DoD do ensaio ÷ energia anual descarregada`, limitada pela vida de calendário.

## Estresse sazonal

No mês de projeto: até 14 dias normais (aquecimento), `N` dias seguidos com a irradiância reduzida (padrão 3 dias a 30%) e carga aumentada (padrão +20%), e 3 dias de recuperação. Reporta atendimento, energia faltante, SOC mínimo e horas até esgotar.

## Limites

Sem autodescarga, sem curva de Peukert, sem derating de capacidade por temperatura (só aviso), conversão do carregador fixa em 90%. São refinamentos previstos para uma revisão do memorial.
