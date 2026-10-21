# Catálogo técnico (Fase 9C)

Módulos, inversores, proteções e cabos **por empresa**, com governança, importação conferida por pessoa, registro do INMETRO e tabelas de preço. Decisão: [ADR-0017](../04-arquitetura/adr/0017-catalogo-por-empresa.md). Tela: Administração → **Catálogo técnico** (`apps/web/src/features/admin/catalog/`).

## Governança

| Situação       | O que pode acontecer                                                                                                                                              |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Rascunho**   | Editar, excluir, aprovar. Não aparece em projeto.                                                                                                                 |
| **Aprovado**   | Só ele vale em projeto. A ficha **não muda mais** (gatilho no banco): corrigir = **nova revisão**. Pode-se conferir o INMETRO, anexar a ficha em PDF e aposentar. |
| **Aposentado** | Não volta a valer (gatilho). Projetos já aprovados guardam a ficha copiada.                                                                                       |

- **Quem faz o quê:** cadastrar, editar, importar, propor e conferir o INMETRO: `platform.catalog.manage` (engenharia). **Aprovar e aposentar: `engine.project.approve`** (responsável técnico).
- **Uma revisão aprovada por modelo** (índice único parcial). Aprovar a revisão 2 aposenta a 1 na mesma transação.
- **Aprovação exige ficha sem erro físico.** Aviso não bloqueia (ex.: INMETRO ainda não conferido).
- Tabela única `equipment_items` com `kind` e a ficha em `spec` (JSON validado por tipo): um gatilho, um controlador, um modelo de dados para os quatro tipos. A coluna `spec` é imutável depois de aprovada.

## Conferência física (`@voltex/solar-engine`, `catalog/validate.ts`)

Separa **erro** (impede aprovar) de **aviso**. Exemplos de erro: Vmpp ≥ Voc, Impp ≥ Isc, Pmax que difere mais de 5% de Vmpp × Impp, coeficientes de Voc/potência não negativos, MPPT invertido ou acima da tensão CC máxima, potência CA máxima abaixo da nominal, proteção sem os campos do seu tipo. Avisos: faixas típicas de coeficientes, NOCT, área do módulo, eficiência × área, Voc por célula, curto por MPPT, eficiência, corrente CA × potência. As faixas servem para pegar erro de digitação e de unidade; **não são norma**.

## Importação (duas etapas: prévia e gravação)

`POST /catalog/import/preview?format=csv|pan|ond|datasheet-pdf[&kind]` lê e valida **sem gravar nada**. `POST /catalog/import/commit` grava os candidatos confirmados como **rascunhos** (modelo que já existe vira nova revisão; rascunho aberto do mesmo modelo é conflito; tudo ou nada). Cada campo lido de arquivo leva a **confiança**: `HIGH` (lido direto), `MEDIUM` (convertido de unidade), `LOW` (presumido). A tela destaca o que precisa de conferência e o que falta.

| Formato                     | O que lê                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Cuidados                                                                                                                                                                                                                                          |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CSV**                     | Modelo por tipo (cabeçalhos em português, `;` ou `,`, decimal com vírgula). Baixe o modelo na tela.                                                                                                                                                                                                                                                                                                                                                                                                                                     | Tudo entra com confiança alta: a conferência é de quem preencheu. Linha com erro é apontada (com o número) e não impede as outras.                                                                                                                |
| **.PAN** (módulo PVsyst)    | Fabricante, modelo, tecnologia, Pmax, Vmpp, Impp, Voc, Isc, coeficientes, células em série, dimensões, peso, tensão máxima do sistema.                                                                                                                                                                                                                                                                                                                                                                                                  | Coeficientes **convertidos**: `muVocSpec` (mV/°C) ÷ (Voc × 10) e `muISC` (mA/°C) ÷ (Isc × 10) → %/°C; dimensões de metros para mm. Eficiência é calculada. Não traz NOCT nem garantia.                                                            |
| **.OND** (inversor PVsyst)  | Fabricante, modelo, potências (kW → W), tensão CA, fases, faixa MPPT, tensão CC máxima, eficiências, corrente CA, nº de MPPT e entradas.                                                                                                                                                                                                                                                                                                                                                                                                | A corrente por MPPT é **derivada** (`IMaxDC` total ÷ nº de MPPT, confiança baixa). Topologia assumida STRING. Não traz tensão de partida.                                                                                                         |
| **Ficha em PDF (inversor)** | Lê a **tabela de especificações por coluna de modelo** usando a posição de cada texto no PDF (`io/layout.ts` + `io/datasheet-inverter.ts`): um registro por modelo, células que cobrem vários modelos atribuídas pela posição (confiança baixa), correntes diferentes por MPPT (`40A+20A`) usam o menor valor e avisam, potência nominal ausente vem do nome do modelo (baixa). Português e inglês; milhar com ponto (`3.000 Wp`). Layouts já cobertos com casos reais: CSI Solar, Livoltek, Chint, Deye (híbrido) e Huawei (linha L1). | **Sugestão.** Tabela de outro layout vira "não reconheci" (nunca um módulo falso) ou rascunho parcial para completar. Cada fabricante imprime a tabela de um jeito: ampliar a cobertura é acrescentar sinônimos e um caso real em `io/fixtures/`. |
| **Ficha em PDF (módulo)**   | Procura rótulos em inglês e português (potências, tensões, correntes, coeficientes, NOCT, tensão máxima do sistema, fusível, dimensões, peso, tecnologia).                                                                                                                                                                                                                                                                                                                                                                              | **Sugestão.** Fabricante e modelo não são lidos. Tabelas com vários modelos: usa o primeiro valor e avisa. Coeficiente sem sinal é assumido negativo (confiança baixa). PDF escaneado não tem texto.                                              |

**Validação dos leitores do PVsyst:** o formato **não tem especificação pública**. O leitor foi escrito a partir de um `.OND` real publicado por um fabricante e do trecho de um `.PAN` real postado em fórum público, e as conversões de unidade foram conferidas à mão com os valores do módulo de filme fino (α = +0,04 %/°C, β = −0,28 %/°C). Os fixtures versionados são **derivados** desses arquivos, com nomes trocados. **Falta** validar com arquivos de módulos de silício de fabricantes (peça ao fornecedor); até lá, a prévia obrigatória cobre o risco.

## Fontes de equipamentos na internet (aba Referências externas)

A aba lista **todas as fontes** (ligada/desligada, termos a conferir, quantos registros, última atualização). Em cada fonte de documentos há **Atualizar lista da fonte**, busca por marca/modelo/tipo e **Ver prévia e importar**: o servidor baixa o PDF escolhido, lê pelo mesmo caminho do envio manual e abre a prévia; **nada é gravado sem a sua confirmação**, e tudo entra como rascunho.

- **Techlux (techlux.com.br/download):** a lista pública de datasheets e manuais (22 páginas, ~660 documentos, ~160 de inversor). O `robots.txt` permite o acesso; o sistema lê uma página por vez com pausa, guarda **só os links** (tabela global `external_records`, tipo `DOC_*`) e baixa o PDF só quando você pede (limite de 20 MB, só o endereço da fonte). Ligar: `techlux` em `DATA_HUB_ENABLED_SOURCES`. Os termos de uso do site **não foram revistos por jurídico** (marcado "termos a conferir").
- **Cobertura da leitura (medida em 20/10/2026 sobre os 160 datasheets de inversor da Techlux):** 16 vêm completos, 72 parciais (faltam campos para completar na prévia) e 72 não são reconhecidos (layouts de Hopewind, Sofar, Sungrow, Solis e outros ainda não suportados; vários "datasheets" do site são manuais de 100+ páginas). A prévia sempre diz o que faltou.
- **CEC/SAM:** continua bloqueada até a licença ser conferida.
- Módulos, proteções, cabos e preços **não têm fonte aberta confiável**: use CSV/.PAN/PDF/planilha de preços.

## Suas fontes por link e busca ao digitar

- **Fontes por link:** na aba Referências externas, cole o endereço de uma página de downloads (ou de um arquivo PDF/CSV/PAN/OND). O **analisador** (`io/source-analyzer.ts`, função pura) lê a página e as seguintes da mesma listagem (até 12 páginas, uma por vez, com pausa), acha os arquivos e classifica cada um: tipo de documento (ficha técnica, manual, certificado, planilha), tipo de equipamento (módulo, inversor, cabo, proteção), marca (coluna "Marca" da tabela ou lista de marcas conhecidas) e a **confiança com os motivos** (mostrados ao passar o mouse). Só endereços públicos (bloqueio de rede interna), arquivo baixado só quando você pede a prévia (até 20 MB) e descartado. Tabelas `catalog_source_links` e `catalog_source_documents` (por empresa).
- **Importar de um link:** PDF passa pelo leitor de ficha (inversor por colunas ou módulo), `.PAN`/`.OND` pelo leitor PVsyst, CSV pelo modelo do tipo. A prévia mostra o que faltou para você completar; quem pode aprovar marca **Aprovar já ao importar**.
- **Busca ao digitar** (`GET /catalog/search`): no editor do projeto, os campos de módulo, inversor, proteção e cabo têm uma busca que procura no seu catálogo **e** nas fontes (públicas, CEC e as suas). Cada resultado mostra a origem e o que é. Aprovado entra direto; de fonte abre a prévia para importar e usar.
- **Cobertura da leitura de PDF de inversor (casos reais em `io/fixtures/`):** CSI Solar, Livoltek, Chint, Deye (híbrido), Huawei (L1), **APsystems (microinversor)** e **Elgin** (string e híbrido). Na loja Elgin (`shopsolar.elgin.com.br/downloads-inversor-solar`: 210 arquivos), 31 das 34 fichas técnicas de inversor saem completas. Deduções (potência VA como W, corrente nominal no lugar da máxima, monofásico pela tensão) vêm com confiança menor e aviso.
- **Páginas montadas por JavaScript** (ex.: `csolar.com.br/produtos`): os links não existem no HTML recebido e o sistema avisa isso; use o link direto do PDF ou envie o arquivo.
- **Atualizar o banco local:** depois de atualizar o código, rode `pnpm --filter @voltex/database db:deploy` (migrações pendentes causam erro 500 nas telas novas).
- **Limites:** a classificação é heurística (pode errar; a confiança "baixa" avisa); páginas montadas por script (sem links no HTML) ou atrás de login não são lidas.

## INMETRO (verificação assistida)

Não há base aberta nem API confirmada, e o sistema **não raspa** o site. O campo guarda o resultado da consulta feita por uma pessoa (registro, situação, data, quem). Módulo ou inversor **aprovado** com a conferência vencida (mais de 183 dias) ou nunca feita gera uma proposta na caixa de atualizações (`CATALOG_ITEM`, `INMETRO_DUE`), uma por vencimento. O job `inmetro-due` roda junto da vigilância semanal.

## Referências externas (biblioteca CEC/SAM)

Tabela **global** `external_records` (sem dado de empresa). `POST /catalog/references/import` carrega a planilha e **exige a fonte `cec-library` ligada** no servidor; a licença dos arquivos **não foi conferida**, então ela vem desligada (`docs/referencias/fontes-externas.md`). A empresa **adota** um registro: vira rascunho dela, com `origin = CEC` e `externalRecordId`. A biblioteca traz só a área do módulo, não as dimensões: a adoção pede o comprimento e a largura. Equipamentos são do mercado norte-americano: a tela avisa para conferir venda e homologação no Brasil.

## Tabelas de preço

`POST /catalog/prices/import?dryRun=true|false` (CSV: `fabricante; modelo; descricao; fornecedor; sku; preco_reais; vigencia_inicio; vigencia_fim`). Cada linha liga a um equipamento **aprovado** (fabricante + modelo, sem diferenciar acento/caixa) ou é insumo avulso (só descrição). Linha sem par vai para a lista "sem equipamento aprovado"; linha com erro é apontada com o número. `dryRun` só confere. `PriceListService.currentPrice(equipmentId, data)` devolve o preço vigente (usado pela lista de materiais, 9F).

## Recurso solar da Central de Dados

`POST /data-hub/solar-resources/propose` pede a climatologia da NASA POWER de um local e cria uma **proposta** `SOLAR_RESOURCE` (HSP mensal no plano horizontal + temperaturas mensais). Aprovar cria ou atualiza o local (mesmo nome e UF) com a fonte e a atribuição; as temperaturas ficam em `SolarResource.temperatures` como **informativas**: a temperatura de projeto do Voc frio continua sendo do responsável técnico. Na tela: Irradiação → **Buscar da NASA**.

## API

| Rota                                                                                                                      | Permissão                 |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `GET /catalog/items` · `GET /catalog/items/:id`                                                                           | `platform.catalog.read`   |
| `POST /catalog/items` · `PATCH/DELETE /catalog/items/:id` · `POST /catalog/items/:id/{revise,inmetro,datasheet}`          | `platform.catalog.manage` |
| `POST /catalog/items/:id/{approve,retire}`                                                                                | `engine.project.approve`  |
| `POST /catalog/import/{preview,commit}`                                                                                   | `platform.catalog.manage` |
| `GET /catalog/import/template?kind=` · `GET /catalog/prices` · `GET /catalog/prices/template` · `GET /catalog/references` | `platform.catalog.read`   |
| `POST /catalog/prices/import` · `POST /catalog/references/import` · `POST /catalog/references/:id/adopt`                  | `platform.catalog.manage` |

## Pendências

- Arquivos `.PAN` de módulos de silício e fichas PDF reais de fabricantes para ampliar os testes dos leitores (o PDF foi testado com texto sintético).
- Licença dos arquivos da biblioteca CEC/SAM (a carga fica desligada até lá).
- Tabelas de preço reais de distribuidores para validar o formato da planilha.
- A tela de catálogo mora hoje em Administração; muda para `/engine/catalogo` quando o Studio ganhar a sua casca (9D).
