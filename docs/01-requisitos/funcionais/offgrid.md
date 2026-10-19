# Requisitos funcionais — Off-Grid Designer

Épicos `EPIC-OFF-*`. Dimensionamento que começa pela **carga**. Detalhamento nas seções 21–29 da modelagem. Planejado para o **MVP3**.

| ID         | Requisito                                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------- |
| RF-OFF-001 | Cadastro de cargas (potência, partida, tensão, horas/dia, dias/semana, janela, criticidade, simultaneidade, sazonalidade) |
| RF-OFF-002 | Perfil de carga: Wh/dia, pico, pico de partida, carga crítica, curva horária, diurno/noturno                              |
| RF-OFF-003 | Autonomia: horas/dias, disponibilidade, DoD máximo, eficiência, temperatura, envelhecimento, reserva técnica              |
| RF-OFF-004 | Dimensionamento do arranjo FV a partir do recurso solar                                                                   |
| RF-OFF-005 | Banco de baterias: energia útil/nominal, tensão, série/paralelo, DoD, ciclos, correntes, expansão                         |
| RF-OFF-006 | Controlador de carga MPPT/PWM e compatibilidade                                                                           |
| RF-OFF-007 | Inversor off-grid/híbrido: potência contínua, surto, tensão do banco, carregador, entrada de gerador                      |
| RF-OFF-008 | Gerador de backup: cenários, limiar de SOC, custo de combustível e operação                                               |
| RF-OFF-009 | Cenários comparativos (FV, bateria, gerador, autonomia, CAPEX, risco)                                                     |
| RF-OFF-010 | Stress test sazonal e confiabilidade                                                                                      |
| RF-OFF-011 | CAPEX/OPEX por cenário                                                                                                    |
| RF-OFF-012 | Relatório e `OffGridSnapshot` publicado ao CRM                                                                            |
