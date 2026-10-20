# Solar Engine Studio: projeto técnico (Fase 9)

Decisão de arquitetura: [ADR-0015](../04-arquitetura/adr/0015-projeto-como-documento-versionado.md). Cálculos: [memoriais](../06-calculos/README.md). Tela: menu **Solar Engine Studio**.

## Modelo

| Peça                                            | O que é                                                                                                                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Pedido de engenharia** (`EngineeringRequest`) | Nasce no CRM (semáforo amarelo). Na fila: pegar, abrir projeto, cancelar com motivo.                                                                               |
| **Projeto** (`EngineeringProject`)              | Código = Project ID da oportunidade (ou `ENG-AAAA-NNNN` se avulso), responsável, situação (`IN_PROGRESS`, `APPROVED`, `CANCELLED`). Funciona **sem CRM**.          |
| **Versão** (`EngineeringVersion`)               | `design` (documento JSON, `engineeringDesignSchema`) + `results` (recalculado) + hash. Situação: `DRAFT → SUBMITTED → APPROVED/REJECTED`, `APPROVED → SUPERSEDED`. |
| **Equipamentos da versão**                      | Tabela de impacto: quais projetos usam este módulo.                                                                                                                |
| **Comentários de revisão** e **Snapshot**       | Comentários abertos bloqueiam aprovação; a aprovação cria snapshot imutável com hash, fichas, regras e resultados.                                                 |

**Congelamento (gatilho no banco):** versão que saiu de `DRAFT` não muda `design`, `results`, hash, regras e dados usados; só o ciclo de vida, a decisão e a marca `stale`. **Uma versão aprovada por projeto** (índice único parcial). Criar nova versão **copia** o desenho (cópia na escrita); só pode haver um rascunho por projeto. O snapshot é imutável (mesma regra de eliminação de dados pessoais dos demais).

## O desenho (`engineeringDesignSchema`, 9D)

- **Local:** coordenadas, cidade/UF, altitude; **clima** (resumo mensal da NASA POWER com origem e atribuição); **horizonte** (PVGIS); **temperatura mínima de projeto** (`designTminC`), que é **sempre da pessoa** e exige a fonte: a mínima da fonte de grade não serve (ver [Central de Dados](central-de-dados.md)).
- **Superfícies:** tipo (`PITCHED` telhado inclinado, `FLAT_RACK` laje/solo com estrutura), azimute, inclinação, dimensões, recuos, orientação e folga dos módulos, espaçamento entre fileiras, módulo próprio, limite de quantidade, **obstáculos**, perda por sombra informada (exige fonte).
- **Módulo padrão** do projeto.
- **Inversores e strings (9E):** cada inversor (unidade física) liga strings por MPPT (`modulesInSeries` × `parallel`, por superfície) ou, no microinversor, `units` × `modulesPerUnit` numa superfície.
- **Proteções/cabos, simulação, conexão e economia (9F–9H):** cabos e escolhas manuais, referência da série horária, dados da UC e premissas econômicas são parte do documento versionado. Série horária é carregada pelo servidor da Central; regras de conexão/economia continuam dados revisados, nunca valores embutidos.

## Cálculo

`computeEngineeringResults(design, { modules })` em `@voltex/solar-engine`: **puro**, roda no **navegador** (prévia ao vivo) e no **servidor** (fonte oficial ao salvar). O servidor valida que os módulos **e inversores** existem e estão **aprovados** no catálogo (`EQUIPMENT_NOT_AVAILABLE`), lê a regra `engine.design` em vigor (referência guardada em `ruleRefs`), recalcula, grava `results` + hash e sincroniza os equipamentos da versão. Pendências (`NO_SURFACES`, `MODULE_NOT_SELECTED`, `MODULE_NOT_FOUND`) aparecem na tela e não são erro.

## API (`/engineering`)

| Rota                                                                                                                             | Permissão                         |
| -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `GET requests` · `GET projects` · `GET projects/:id` · `GET versions/:id`                                                        | `engine.project.read`             |
| `POST requests/:id/{assign,cancel}` · `POST projects` · `POST projects/from-request/:requestId` · `POST projects/:id/cancel`     | `engine.project.write`            |
| `POST versions/:id/configurations` (sugestões do gerador, ver [memorial](../06-calculos/engine-configurador.md))                 | `engine.project.read`             |
| `PUT versions/:id/design` · `POST versions/:id/{recalculate,new-version}` · `DELETE versions/:id`                                | `engine.project.write`            |
| `POST versions/:id/submit` · `POST versions/:id/comments/:commentId/resolve`                                                     | `engine.project.write`            |
| `POST versions/:id/{approve,reject,comments}` · `GET versions/:id/comments`                                                      | revisão: `engine.project.approve` |
| `GET versions/:id/{report.pdf,single-line.svg,single-line.pdf,single-line.dxf}` · `GET projects/:id/snapshot`                    | `engine.project.read`             |
| `GET versions/:id/compare?with=<outra versão>` (desenho e indicadores; só do mesmo projeto)                                      | `engine.project.read`             |
| `GET versions/:id/share-links` · `POST versions/:id/share-links` (cria; o token aparece uma vez) · `POST share-links/:id/revoke` | read / `engine.project.write`     |
| `POST versions/:id/attach-homologation` (memorial e unifilar ao checklist do projeto do CRM, sem concluir os itens)              | `engine.project.write`            |
| `GET public/engineering/:token` (relatório simplificado do cliente; sem login; 404 se inexistente/revogado, 410 se vencido)      | pública (limite de requisições)   |

`from-request` é **idempotente** (o mesmo pedido devolve o mesmo projeto), pega o pedido, copia o local da oportunidade (ou usa as coordenadas informadas; sem elas, `400 SITE_COORDINATES_MISSING`) e registra `ENGINEERING_STARTED` na linha do tempo da oportunidade.

## Web

`/engine/pedidos`, `/engine/projetos`, `/engine/projetos/:id`, `/engine/projetos/:id/versoes/:versionId` (editor em etapas) e `/engine/catalogo`. A aba **Engenharia** da oportunidade no CRM tem **Abrir no Studio**. O editor inclui proteções/cabos/materiais, simulação horária, conexão e economia. A revisão permite comentários por seção, envio, resolução e decisão justificada.

O memorial técnico é exportável em PDF e reúne premissas, compatibilidade, geração, conexão, materiais, economia e versões dos algoritmos persistidos; em rascunho, traz a marca de revisão. O unifilar é exportável em SVG, PDF ou DXF, sempre com a marca **“RASCUNHO PARA REVISÃO — não substitui projeto elétrico assinado”**. A aprovação publica `EngineeringVersionApproved`; o consumidor CRM encerra o pedido associado, registra `ENGINEERING_APPROVED` na linha do tempo e reavalia o Guard com o pedido concluído no fingerprint. A cotação lê o snapshot aprovado como fonte dos materiais, mas preço de venda, frete, instalação e margem continuam decisão comercial explícita.

## Impacto e desatualização

Ativar nova versão de regra `engine.*` ou aposentar/revisar um equipamento publica evento e marca como **desatualizadas** (com o motivo) as versões que os usam, inclusive a aprovada (que não muda, só ganha a marca). A tela mostra o aviso; recalcular o rascunho limpa a marca.

## Visualização 2D/3D

A etapa **3. Visualização 2D/3D** do editor mostra: (2D) a planta de cada superfície com o layout dos módulos e (3D) uma cena girável com telhado/laje inclinados, módulos, obstáculos (caixas) e a **sombra dos obstáculos no chão** para a data e a hora escolhidas (posição do sol do próprio motor). É projeção ortográfica em SVG, sem biblioteca 3D: serve para conferir geometria, não é um editor 3D (arrastar módulos, importar modelos, sombra sobre o telhado) nem substitui o CAD.

## Busca de equipamentos no editor

Módulo (padrão e por superfície), inversor, proteção e cabo têm busca ao digitar no catálogo e nas fontes, mostrando a origem. Ver [catálogo técnico](catalogo-tecnico.md).

## Entregáveis, comparação e relatório do cliente (9I/9J)

- **Entregáveis** no editor: memorial (PDF), unifilar (PDF, SVG e DXF); até a aprovação saem marcados como rascunho.
- **Comparar versões:** escolha outra versão do mesmo projeto e veja o que mudou no desenho (por caminho, com `id` dos itens) e nos indicadores (módulos, kWp, status, custo, geração, VPL, payback...).
- **Relatório do cliente:** com a versão aprovada, **Gerar link** cria um endereço `/r/<token>` (30 dias; só o hash fica guardado; pode ser revogado). A página mostra potência, módulos, geração, gráfico mensal × consumo e economia, **nunca** custos, margem, regras ou fichas.
- **Homologação:** **Anexar à homologação** coloca o memorial e o unifilar nos itens `MEMORIAL` e `SINGLE_LINE` do projeto do CRM (7C) com a nota "confira e assine". Não conclui o item: assinar (ART/TRT) é decisão humana. Se o projeto de homologação já existir na hora da aprovação, o anexo é automático.

## Economia completa (9H)

Fluxo de 25 anos, payback simples e descontado, VPL, TIR, LCOE, financiamento Price/SAC, até 3 cenários e tornado de sensibilidade: [memorial](../06-calculos/engine-economia.md). Sem regra `engine.economics` ativa não há compensação presumida: o resultado fica pendente.

## Testes

Motor: `pnpm --filter @voltex/solar-engine test` (cobertura ≥ 90%; casos de ouro do pvlib para posição solar e simulação). API: `engineering*.e2e.test.ts` (incluindo `engineering-journey` — pedido → aprovação → cotação — com a série horária "gravada" no cache). Navegador: `pnpm --filter @voltex/e2e jornada` roda `jornada-engenharia.spec.ts` com vídeo e capturas.

## Limites da 9D e 9E

Superfícies retangulares; sem editor interativo de telhado; sombreamento estimado pela radiação direta com céu claro (ver [memorial](../06-calculos/engine-posicao-solar-sombreamento.md)); proteções, simulação, conexão, economia e a revisão/aprovação chegam nas fases 9F a 9I. Na 9E: um inversor por entrada (sem agrupar), uma superfície por configuração gerada, sem fator de segurança normativo embutido nas correntes.
