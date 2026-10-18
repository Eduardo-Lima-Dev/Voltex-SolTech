# Requisitos funcionais — Solar Engine Studio

Épicos `EPIC-ENG-*`. Projeto e validação técnica avançada. Detalhamento na seção 17 da modelagem. Planejado para o **MVP2**.

| ID         | Requisito                                                                                                                           |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| RF-ENG-001 | Projetos técnicos com versões e responsável técnico                                                                                 |
| RF-ENG-002 | Catálogo de módulos (Pmpp, Vmpp, Impp, Voc, Isc, coeficientes térmicos, dimensões, datasheet) com importação CSV e governança       |
| RF-ENG-003 | Catálogo de inversores (potências, faixa MPPT, correntes, nº de MPPTs, entradas)                                                    |
| RF-ENG-004 | Recurso solar com fonte e versão registradas                                                                                        |
| RF-ENG-005 | Superfícies/telhados com orientação, inclinação, obstáculos, recuos e sombreamento                                                  |
| RF-ENG-006 | Layout básico de módulos                                                                                                            |
| RF-ENG-007 | String Designer: strings, associação a MPPT, tensão/corrente com temperatura de projeto                                             |
| RF-ENG-008 | Compatibility Engine com resultado `VALID`, `VALID_WITH_WARNINGS` ou `INVALID` (Voc corrigido, faixa MPPT, corrente, relação DC/AC) |
| RF-ENG-009 | Proteções (string box, seccionamento, fusível, DPS, disjuntor, DR, aterramento)                                                     |
| RF-ENG-010 | Cabos CC/CA com queda de tensão                                                                                                     |
| RF-ENG-011 | Simulação energética: geração mensal/anual, perdas, PR, clipping, sombreamento, degradação                                          |
| RF-ENG-012 | Connection Feasibility: injeção, demanda contratada, Grid Zero, inversão de fluxo, checklist de acesso                              |
| RF-ENG-013 | Viabilidade econômica com cenários e sensibilidade                                                                                  |
| RF-ENG-014 | Compliance checks apoiados no Rules Engine                                                                                          |
| RF-ENG-015 | Relatórios: memorial de cálculo, ficha técnica, compatibilidade, geração, lista de materiais                                        |
| RF-ENG-016 | Aprovação técnica pelo Responsável técnico, congelamento da versão e `EngineeringSnapshot` publicado ao CRM                         |
