# Solar Engine Studio: projeto técnico (Fase 9D em diante)

Decisão de arquitetura: [ADR-0015](../04-arquitetura/adr/0015-projeto-como-documento-versionado.md). Cálculos: [memoriais](../06-calculos/README.md). Tela: menu **Solar Engine Studio**.

## Modelo

| Peça                                            | O que é                                                                                                                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Pedido de engenharia** (`EngineeringRequest`) | Nasce no CRM (semáforo amarelo). Na fila: pegar, abrir projeto, cancelar com motivo.                                                                               |
| **Projeto** (`EngineeringProject`)              | Código = Project ID da oportunidade (ou `ENG-AAAA-NNNN` se avulso), responsável, situação (`IN_PROGRESS`, `APPROVED`, `CANCELLED`). Funciona **sem CRM**.          |
| **Versão** (`EngineeringVersion`)               | `design` (documento JSON, `engineeringDesignSchema`) + `results` (recalculado) + hash. Situação: `DRAFT → SUBMITTED → APPROVED/REJECTED`, `APPROVED → SUPERSEDED`. |
| **Equipamentos da versão**                      | Tabela de impacto: quais projetos usam este módulo.                                                                                                                |
| **Comentários de revisão** e **Snapshot**       | Tabelas criadas na 9D; usadas na 9I.                                                                                                                               |

**Congelamento (gatilho no banco):** versão que saiu de `DRAFT` não muda `design`, `results`, hash, regras e dados usados; só o ciclo de vida, a decisão e a marca `stale`. **Uma versão aprovada por projeto** (índice único parcial). Criar nova versão **copia** o desenho (cópia na escrita); só pode haver um rascunho por projeto. O snapshot é imutável (mesma regra de eliminação de dados pessoais dos demais).

## O desenho (`engineeringDesignSchema`, 9D)

- **Local:** coordenadas, cidade/UF, altitude; **clima** (resumo mensal da NASA POWER com origem e atribuição); **horizonte** (PVGIS); **temperatura mínima de projeto** (`designTminC`), que é **sempre da pessoa** e exige a fonte: a mínima da fonte de grade não serve (ver [Central de Dados](central-de-dados.md)).
- **Superfícies:** tipo (`PITCHED` telhado inclinado, `FLAT_RACK` laje/solo com estrutura), azimute, inclinação, dimensões, recuos, orientação e folga dos módulos, espaçamento entre fileiras, módulo próprio, limite de quantidade, **obstáculos**, perda por sombra informada (exige fonte).
- **Módulo padrão** do projeto.
- **Inversores e strings (9E):** cada inversor (unidade física) liga strings por MPPT (`modulesInSeries` × `parallel`, por superfície) ou, no microinversor, `units` × `modulesPerUnit` numa superfície. Novos assuntos (proteções, simulação...) entram como chaves opcionais nas próximas fases.

## Cálculo

`computeEngineeringResults(design, { modules })` em `@voltex/solar-engine`: **puro**, roda no **navegador** (prévia ao vivo) e no **servidor** (fonte oficial ao salvar). O servidor valida que os módulos **e inversores** existem e estão **aprovados** no catálogo (`EQUIPMENT_NOT_AVAILABLE`), lê a regra `engine.design` em vigor (referência guardada em `ruleRefs`), recalcula, grava `results` + hash e sincroniza os equipamentos da versão. Pendências (`NO_SURFACES`, `MODULE_NOT_SELECTED`, `MODULE_NOT_FOUND`) aparecem na tela e não são erro.

## API (`/engineering`)

| Rota                                                                                                                         | Permissão              |
| ---------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `GET requests` · `GET projects` · `GET projects/:id` · `GET versions/:id`                                                    | `engine.project.read`  |
| `POST requests/:id/{assign,cancel}` · `POST projects` · `POST projects/from-request/:requestId` · `POST projects/:id/cancel` | `engine.project.write` |
| `POST versions/:id/configurations` (sugestões do gerador, ver [memorial](../06-calculos/engine-configurador.md))             | `engine.project.read`  |
| `PUT versions/:id/design` · `POST versions/:id/{recalculate,new-version}` · `DELETE versions/:id`                            | `engine.project.write` |

`from-request` é **idempotente** (o mesmo pedido devolve o mesmo projeto), pega o pedido, copia o local da oportunidade (ou usa as coordenadas informadas; sem elas, `400 SITE_COORDINATES_MISSING`) e registra `ENGINEERING_STARTED` na linha do tempo da oportunidade.

## Web

`/engine/pedidos`, `/engine/projetos`, `/engine/projetos/:id`, `/engine/projetos/:id/versoes/:versionId` (editor em etapas) e `/engine/catalogo`. A aba **Engenharia** da oportunidade no CRM tem **Abrir no Studio**. O editor tem 3 etapas até a 9E: **Local e clima**, **Superfícies, layout e sombra** (prévia 2D em SVG, carta solar, perda mensal) e **Equipamentos e strings** (inversores, MPPT, conferência ao vivo com a explicação de cada verificação e o gerador de configurações).

## Impacto e desatualização

Ativar nova versão de regra `engine.*` ou aposentar/revisar um equipamento publica evento e marca como **desatualizadas** (com o motivo) as versões que os usam, inclusive a aprovada (que não muda, só ganha a marca). A tela mostra o aviso; recalcular o rascunho limpa a marca.

## Limites da 9D e 9E

Superfícies retangulares; sem editor interativo de telhado; sombreamento estimado pela radiação direta com céu claro (ver [memorial](../06-calculos/engine-posicao-solar-sombreamento.md)); proteções, simulação, conexão, economia e a revisão/aprovação chegam nas fases 9F a 9I. Na 9E: um inversor por entrada (sem agrupar), uma superfície por configuração gerada, sem fator de segurança normativo embutido nas correntes.
