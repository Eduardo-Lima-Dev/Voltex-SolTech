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

## Histórias e critérios de aceite

Escritas na Fase 9A para guiar as sub-fases 9B a 9J. Formato: história · critérios de aceite (CA). Perfis: **Engenheiro** (projeta), **RT** (responsável técnico, aprova), **Gestor**, **Vendedor**.

### EPIC-ENG-001: Projeto técnico e fila de pedidos (9D) · RF-ENG-001

- **H1.** Como Engenheiro, vejo os pedidos de engenharia do CRM e pego um.
  - CA: lista com status `PENDING/IN_PROGRESS/DONE/CANCELLED`, responsável e oportunidade; pegar muda o status e audita.
- **H2.** Como Engenheiro, abro o projeto **a partir do pedido** com os dados do CRM.
  - CA: conta, imóvel, UC, cálculo, fatura e levantamento vêm preenchidos; criar de novo o mesmo pedido não duplica o projeto.
- **H3.** Como Engenheiro, trabalho em **versões** do projeto.
  - CA: criar versão copia a anterior; só versão em rascunho é editável; histórico e linha do tempo visíveis.
- **H4.** Como Engenheiro, uso o Studio **sem CRM**.
  - CA: projeto criado do zero com nome/código; nada do CRM é obrigatório.

### EPIC-ENG-002: Catálogo técnico por empresa (9C) · RF-ENG-002, 003, [ADR-0017](../../04-arquitetura/adr/0017-catalogo-por-empresa.md)

- **H1.** Como Engenheiro, cadastro módulos e inversores com todas as grandezas elétricas.
  - CA: validações físicas (Vmpp < Voc, Impp < Isc, Pmpp ≈ Vmpp·Impp); campo faltante impede aprovar.
- **H2.** Como RT, **aprovo** um item para ser usado em projeto.
  - CA: só `APPROVED` aparece no projeto; depois de aprovado os campos técnicos são imutáveis; corrigir cria nova revisão.
- **H3.** Como Engenheiro, registro o **INMETRO** do equipamento.
  - CA: número, situação e data da conferência; revalidação semestral vira proposta na caixa de atualizações.

### EPIC-ENG-003: Importação e Central de Dados Externos (9B/9C) · [ADR-0018](../../04-arquitetura/adr/0018-central-de-dados-externos.md)

- **H1.** Como Engenheiro, importo módulos de **CSV**, de **.PAN/.OND** e de **PDF** de ficha.
  - CA: prévia com campos lidos e **confiança por campo**; nada entra sem eu confirmar; erro de leitura é explicado; arquivo malformado não derruba a importação.
- **H2.** Como Engenheiro, **adoto** um equipamento da biblioteca de referência.
  - CA: vira rascunho da minha empresa com a origem registrada; não altera o original global.
- **H3.** Como RT, recebo **alerta** quando uma fonte vigiada muda.
  - CA: alerta com a **diferença**; nenhuma regra é alterada sozinha; decisão registrada com motivo.
- **H4.** Como Gestor, vejo cada fonte com **licença, atribuição e última coleta**.
  - CA: fonte sem licença conferida aparece desligada.

### EPIC-ENG-004: Local, clima e superfícies (9D) · RF-ENG-004, 005

- **H1.** Como Engenheiro, informo o local e o sistema traz o **clima** (série e temperaturas) da Central.
  - CA: cache por coordenada; sem internet usa o cache ou pede dado manual; a fonte e a data aparecem; **sem Tmin não há cálculo de Voc frio**.
- **H2.** Como Engenheiro, modelo **superfícies** (orientação, inclinação, recuos, obstáculos com altura e distância).
  - CA: valores validados em faixa; azimute e inclinação mostrados; alerta fora do recomendado (reaproveita o Calculator).

### EPIC-ENG-005: Layout básico e sombreamento (9D) · RF-ENG-005, 006

- **H1.** Como Engenheiro, vejo uma **prévia 2D** do layout dos módulos.
  - CA: área útil, fileiras × colunas, retrato/paisagem, espaçamento; contagem de módulos conferida.
- **H2.** Como Engenheiro, vejo a **carta solar** e a perda por sombra.
  - CA: horizonte distante + obstáculos próximos; perda mensal e anual; premissa de sombra marcada como estimativa quando informada à mão.

### EPIC-ENG-006: Strings e MPPT (9E) · RF-ENG-007

- **H1.** Como Engenheiro, associo módulos a strings e MPPT com **cálculo ao vivo**.
  - CA: tensão e corrente com a temperatura de projeto; cada verificação mostra fórmula, fonte, valor e limite.
- **H2.** Como Engenheiro, uso **vários inversores e superfícies** e **microinversores**.
  - CA: cada superfície/MPPT é verificada separadamente.

### EPIC-ENG-007: Compatibilidade e gerador de configurações (9E) · RF-ENG-008

- **H1.** Como Engenheiro, vejo `VALID`, `VALID_WITH_WARNINGS` ou `INVALID` com **códigos estáveis**.
  - CA: `INVALID` explica o motivo; **bloqueia a aprovação**; equipamento não aprovado gera erro.
- **H2.** Como Engenheiro, peço **configurações sugeridas**.
  - CA: lista ranqueada e determinística do catálogo aprovado; "usar esta" preenche o desenho; é sugestão a confirmar.

### EPIC-ENG-008: Proteções (9F) · RF-ENG-009

- **H1.** Como Engenheiro, o sistema escolhe **fusível, seccionadora, DPS, disjuntor e DR** do catálogo com justificativa.
  - CA: sem regra `engine.design` ativa e revisada, a etapa fica **pendente** e bloqueia a aprovação; nenhum fator presumido.

### EPIC-ENG-009: Cabos e lista de materiais (9F) · RF-ENG-010, 015

- **H1.** Como Engenheiro, dimensiono os **trechos de cabo** (queda e capacidade).
  - CA: queda por fórmula física; capacidade só com tabela de regra ativa (senão `PENDING_RULE`).
- **H2.** Como Gestor, tenho a **lista de materiais** com preço vigente.
  - CA: item sem preço é sinalizado e bloqueia a cotação desse item.

### EPIC-ENG-010: Simulação energética (9G) · RF-ENG-011

- **H1.** Como Engenheiro, simulo a geração **hora a hora** com perdas em cascata.
  - CA: PR sai da simulação; clipping calculado; degradação pela garantia da ficha; diagrama de perdas.
- **H2.** Como RT, comparo com o **Calculator** e com o **PVGIS**.
  - CA: diferença em % e aviso acima do limite da regra; resultado dentro da tolerância dos casos de ouro.

### EPIC-ENG-011: Conexão com a rede (9G) · RF-ENG-012, 014

- **H1.** Como Engenheiro, verifico potência, classe, injeção, Grid Zero e inversão de fluxo.
  - CA: exigências vêm de regras `engine.connection` por escopo com **fonte**; regra sem fonte não dispara; sem regra da distribuidora, aviso "sem regra vigente cadastrada".

### EPIC-ENG-012: Viabilidade econômica (9H) · RF-ENG-013

- **H1.** Como Gestor, vejo payback, VPL, TIR, LCOE, financiamento (Price/SAC), cenários e sensibilidade.
  - CA: sem regra de compensação ativa, o resultado informa e **bloqueia a aprovação**; método validado com finanças antes da liberação.

### EPIC-ENG-013: Revisão, aprovação, snapshot e relatórios (9I/9J) · RF-ENG-015, 016

- **H1.** Como RT, **reviso por seção com comentários** e comparo versões.
  - CA: comentário aberto bloqueia a aprovação; comparação mostra o que mudou no desenho e nos resultados.
- **H2.** Como RT, **aprovo** a versão.
  - CA: bloqueada com `INVALID`, regra não revisada ou comentário aberto; aprovar congela a versão e publica o snapshot com a **proveniência** dos dados externos e o `ref` de cada regra.
- **H3.** Como Gestor, recebo os **relatórios** (memorial, ficha técnica, compatibilidade, geração e perdas, lista de materiais, economia, unifilar SVG/PDF/DXF).
  - CA: marca "RASCUNHO" até aprovar; unifilar marcado "rascunho para revisão; não substitui o projeto assinado".
- **H4.** Como Vendedor, vejo no CRM o **status** e uso a lista de materiais aprovada na cotação.
  - CA: Project Guard reconhece o snapshot; mudança de premissa na oportunidade invalida.
