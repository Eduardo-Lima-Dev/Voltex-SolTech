# EnergIF — Energia Fotovoltaica (vol. 3), 2023

- **Obra:** _Energia fotovoltaica: volume 3_, José Soares Batista Lopes (IFRN). Florianópolis: ENBPar/IFSC, 2023. 220 p. (Projeto EnergIF, vol. 3). ISBN 978-65-981191-3-3.
- **Arquivo:** [energif-energia-fotovoltaica-vol3-2023.pdf](energif-energia-fotovoltaica-vol3-2023.pdf) (cópia do original, sem alterações). A numeração de página do PDF **coincide** com a impressa: as páginas citadas na documentação valem para os dois.
- **Natureza:** material didático (Procel/MEC). Não é norma nem fonte regulatória. Redigido em 2022–2023: leis, resoluções e normas citadas podem ter sido alteradas ou revisadas ([RN-015](../../01-requisitos/regras-de-negocio.md)).
- **Textos extraídos:** o PDF tem camada de texto, **mas as equações e várias tabelas são imagens** (por exemplo as equações 2.1 a 2.4, p. 41). Onde um valor foi usado, a página foi conferida visualmente.

## O que está aqui

| Arquivo                                    | Conteúdo                                                                                                                                  |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| [regras-e-medidas.md](regras-e-medidas.md) | **Base extraída** para as Fases 6 a 8: medidas, parâmetros, regras de processo, o que o livro _não_ fornece e inconsistências encontradas |
| Este README                                | Índice do livro, mapa por fase e limitações                                                                                               |

## Índice do livro e uso por fase

| Unidade / seção                                   | Páginas | Tema                                               | Uso                                                 |
| ------------------------------------------------- | ------- | -------------------------------------------------- | --------------------------------------------------- |
| 1.1 Panorama                                      | 12–14   | Matriz energética e mercado                        | Contexto, sem uso técnico                           |
| 1.2.1 Energia solar                               | 15–17   | Radiação, recurso solar no Brasil                  | **Fase 6** (faixa de HSP)                           |
| 1.2.2 Orientação dos módulos                      | 18      | Orientação, inclinação mínima, sombreamento        | **Fase 6**                                          |
| 1.2.3 Regulamentação e normas                     | 19–22   | Decretos, leis, resoluções e normas ABNT           | **Fases 6–7** (fontes do Rules Engine)              |
| 1.3 Off-grid, on-grid, híbrido                    | 23–27   | Tipos de sistema                                   | Glossário; híbrido/off-grid → Fase 10               |
| 2.1 Células e módulos                             | 29–42   | Tipos, curvas, temperatura, arranjos               | **Fase 6** (módulo de referência); strings → Fase 9 |
| 2.2 Inversores                                    | 43–44   | Parâmetros e tipos                                 | Classes por potência: **Fase 6**; detalhes → Fase 9 |
| 2.3–2.6 Proteções, cabos, acessórios              | 45–47   | String box, proteções CC/CA, cabos                 | Fase 9                                              |
| 3 Off-grid                                        | 50–65   | Aplicações, baterias, controlador, mês crítico     | Fase 10                                             |
| 4.1 Classificação                                 | 67      | Micro, mini e usina                                | **Fases 6–7**                                       |
| 4.2–4.4 Aplicações, equipamentos, microinversores | 68–82   | Vantagens, equipamentos, central × micro           | Fase 9                                              |
| 4.5 Dimensionamento e viabilidade                 | 83–84   | Etapas de projeto e procedimento de acesso         | **Fases 6–7**                                       |
| 4.6 Ferramentas computacionais                    | 84–101  | Homer, Easy-PV, SolarEdge, RETScreen, SAM...       | Referência de mercado (benchmark)                   |
| 4.7 Acesso à rede                                 | 102     | Requisitos de segurança da conexão                 | **Fase 7** (checklist)                              |
| 4.8 Qualidade de energia                          | 103–106 | Tensão, frequência, harmônicos, fator de potência  | Fase 9 (Compatibility/Grid)                         |
| 4.9 Exemplo e solicitação de acesso               | 106–123 | Tutorial de projeto e processo com a distribuidora | **Fase 7** (homologação)                            |
| 5 Instalação e manutenção                         | 126–200 | Segurança, montagem, comissionamento, manutenção   | Fase 11 (exceto 5.3.3, usada na Fase 6)             |
| Gabarito e referências                            | 201–219 | —                                                  | Fontes técnicas a obter (ver regras e medidas)      |

**Em uso agora (até a Fase 8):** 1.2, 2.1.2 (módulos), 2.2 (classes de inversor), 4.1, 4.5, 4.7, 4.9.2 e 5.3.3.
**Inventariado para depois:** strings e compatibilidade (2.1.4, 4.3), proteções e cabos (2.3–2.5), qualidade de energia (4.8), off-grid (3), instalação, comissionamento e manutenção (5).

## Limitações a ter em mente

1. **Não traz as fórmulas de dimensionamento comercial** (fator de desempenho/PR, payback, custo de disponibilidade, fator de capacidade, degradação anual). O exemplo on-grid (4.9.1) é um tutorial do software SolarEdge Designer, sem equações próprias. Veja a seção "O que o livro não fornece" em [regras e medidas](regras-e-medidas.md).
2. **Tem erros de digitação** que não devem ser copiados (Tabela 5.3, Tabela 4.6, Quadro 2.7): veja as inconsistências catalogadas.
3. **Regulação defasada:** prazos e exigências de acesso à rede são de 2023.
4. Os valores de módulos são de **modelos de 2022**; servem como padrão inicial, não como catálogo.
