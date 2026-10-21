# Off-Grid Designer (Fase 10)

Sistemas **isolados** e **híbridos** (rede + bateria, **sem injeção na rede**; BESS comercial fica fora). É um módulo **próprio** — pedidos, projetos, versões, snapshot e fila separados do Solar Engine Studio — que reaproveita o que já existe: catálogo por empresa (com os novos tipos), regras versionadas, Central de Dados (clima e série horária), permissões `offgrid.*`, auditoria, outbox e os componentes de tela (busca de equipamento, campos numéricos, local e clima). Cálculos: [memoriais](../06-calculos/README.md) `offgrid-*.md`.

## Modelo

| Peça                                                  | O que é                                                                                                                                                                                                                |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Pedido** (`OffgridRequest`)                         | Fila própria (`PENDING → IN_PROGRESS → WAITING_VISIT/WAITING_INFO → IN_REVIEW → DONE/CANCELLED`), prioridade, prazo, responsável, tipo (`OFFGRID`/`HYBRID`), oportunidade opcional. Aprovar a versão conclui o pedido. |
| **Projeto** (`OffgridProject`)                        | Código `OFG-AAAA-NNNN`, responsável, ART, situação. Criado do zero ou **a partir do pedido** (que passa a "Em andamento").                                                                                             |
| **Versão** (`OffgridVersion`)                         | `design` (JSON, `offgridDesignSchema`) + `results` recalculado + hash. `DRAFT → SUBMITTED → APPROVED/REJECTED`, `APPROVED → SUPERSEDED`. Gatilho do banco congela a versão enviada; o snapshot é imutável.             |
| **Comentários de revisão**, **Snapshot**, **Eventos** | Comentário aberto bloqueia a aprovação; snapshot com desenho, resultados, fichas copiadas e regras; linha do tempo do pedido e do projeto.                                                                             |

Tenancy: todas as tabelas estão em `TENANT_SCOPED_MODELS`. Evento de domínio `OFFGRID_DESIGN_REQUESTED` (pedido criado) e `OFFGRID_SCENARIO_APPROVED` (versão aprovada, com `projectCode`, `versionId` e hash do snapshot).

## Catálogo

Quatro tipos novos em `EquipmentKind`: `BATTERY` (química, tensão, Ah no regime, DoD máxima, eficiência, ciclos × DoD, vida de calendário, correntes, paralelo máximo), `CHARGE_CONTROLLER` (MPPT/PWM, tensão do banco, corrente, Voc máxima, faixa MPPT), `OFFGRID_INVERTER` (off-grid ou híbrido; contínua, surto, tensão do banco, carregador, entradas de rede e gerador, MPPT embutido) e `GENERATOR` (combustível, potência, consumo, carga mínima). Têm validação física (`catalog/validate.ts`), modelo de planilha CSV, formulário e rótulos no catálogo, e o classificador de fontes por link reconhece bateria, controlador e gerador. A **leitura de ficha em PDF** para estes tipos usa rótulos em português e inglês e o título do produto (`datasheet-offgrid`): o que não achar aparece como "faltando" na prévia, e a pessoa completa e importa com um clique. Também entram por planilha ou cadastro manual.

## Regra `offgrid.design`

Parâmetros (todos por chave, nenhum no código): `red1Default`, `red2Default`, `batteryEfficiencyDefault`, `inverterEfficiencyMin`, `autonomyMinDays`, `dodMaxLeadFlooded`, `dodMaxLeadVrla`, `dodMaxStationary`, `dodMaxLithium`, `controllerCurrentFactor`, `vocColdFactor`, `inverterSurgeMargin`, `maxBatteriesParallel`, `maxChargeCRate`, `lolpMaxPct`, `chargeVoltageFactor`, `pvOtherLossFactor`. Aceita escopo (UF, etc.). **Sem regra ativa** o motor calcula com valores provisórios do Manual CRESESB (exemplos) e marca `RULE_PARAMETERS_MISSING`: a versão **não pode ser enviada nem aprovada**. Os valores de exemplo dos testes **não** são normativos; quem define é o responsável técnico, ao ativar a regra com a fonte.

## O desenho (`offgridDesignSchema`)

Local (reaproveita `siteDesignSchema`: clima, horizonte, Tmin/Tmax de projeto), tipo, tensão do banco (12/24/48 V), **cargas** (potência, quantidade, CA/CC, horas, janela, dias da semana, sazonalidade mensal, fator de partida, simultaneidade, crítica), autonomia, redutores/eficiências opcionais, **arranjos** (módulo, série × paralelo, azimute, inclinação, sombra), **banco**, controlador, inversor (com quantidade em paralelo), **gerador** (SOC de partida/parada, tempo mínimo, janela de horas, preço do combustível), **rede** (híbrido: modo reserva/autoconsumo, quedas diárias e prolongadas, reserva, recarga pela rede, tarifa), série da Central, custos, até 3 **cenários** e o teste de **estresse**.

## Cálculo

`computeOffgridResults(design, context)` em `@voltex/solar-engine/offgrid`: puro, roda no **navegador** (prévia ao vivo, ano sintético) e no **servidor** (oficial ao salvar; usa a série horária da Central quando o desenho a referencia). Resultado: carga, recurso, dimensionamento (CRESESB), verificações com código estável, simulação horária, estresse, custo, cenários, pendências e `status` (`INCOMPLETE`, `INVALID`, `VALID_WITH_WARNINGS`, `VALID`). Cobertura do motor ≥ 90% de ramos.

## API (`/offgrid`)

| Rota                                                                                                                                                               | Permissão                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| `GET requests` · `GET requests/:id` · `GET projects` · `GET projects/:id` · `GET versions/:id` · `GET versions/:id/{comments,report.pdf}` · `GET dashboard`        | `offgrid.project.read`                           |
| `POST requests` · `PATCH requests/:id` · `POST requests/:id/comments` · `POST/PATCH projects`                                                                      | `offgrid.project.write`                          |
| `PUT versions/:id/design` · `POST versions/:id/{recalculate,suggest,submit,new-version}` · `DELETE versions/:id` · `POST versions/:id/comments/:commentId/resolve` | `offgrid.project.write`                          |
| `POST versions/:id/{approve,reject,comments}`                                                                                                                      | `offgrid.scenario.approve` (responsável técnico) |

## Web

Menu **Off-Grid Designer**: `/offgrid/painel`, `/offgrid/pedidos` (e `:id`), `/offgrid/projetos` (e `:id`, `:id/versoes/:versionId`) e `/offgrid/catalogo` (a mesma página do catálogo, com os novos tipos). Editor em 11 etapas: Local e clima · Cargas · Premissas e dimensionamento (com **sugestão do catálogo**) · Arranjo FV · Baterias · Controlador e inversor · Gerador e rede · **Diagrama do sistema** · **Terreno 2D/3D** · Simulação e estresse · Cenários e custo. Gráficos: curva de carga, dia típico, geração × consumo mensal, SOC do ano.

### Projeto visual (2D/3D)

- **Diagrama do sistema:** fluxo FV → controlador → banco → inversor → cargas (com gerador e rede no híbrido), com os valores do cálculo e a cor do resultado das verificações em cada bloco; clicar abre a etapa.
- **Terreno 2D:** planta com norte para cima, grade de 5 m e escala; casa, casa de máquinas, gerador, poste da rede, caixa d'água, árvore e outros objetos, e os arranjos, **arrastáveis** (setas do teclado movem 0,1 m, Shift 1 m). Mostra os trajetos de cabo com a distância e a sombra do sol na data e hora escolhidas.
- **Cena 3D:** terreno, construções em caixa, mesas de módulos inclinadas na orientação real, cabos e sombras; gira (arrastar ou controle), aproxima (roda ou botões) e muda a data/hora do sol.
- **Resultado:** pegada dos arranjos, sombra das construções, distância, corrente e **seção mínima por queda de tensão** de cada trajeto (ver [memorial](../06-calculos/offgrid-layout.md)); tudo entra no memorial em PDF. Limites: arranjo tratado como mesa única (sem sombra entre fileiras), terreno plano, sem importação de modelo 3D ou de imagem de satélite, sem polígonos livres.

## Limites desta entrega

- A leitura de PDF dos tipos do Off-Grid é por rótulos e título, menos precisa que a de módulo e inversor de rede: sempre conferir a prévia.
- Sem integração de cotação a partir do snapshot off-grid (a cotação do CRM segue o Engine).
- Sem unifilar nem relatório público para cliente final.
- SIGFI (RN ANEEL 493/2012) fica como dado de regra ainda não implementado (ver [CR-19](../referencias/cresesb-2014/README.md)).
- Sem autodescarga, Peukert e derating por temperatura; conversão do carregador fixa em 90%.
- Valores de regra são **exemplos** até a revisão do responsável técnico.

### Visual realista (3D e 2D)

- **Cena 3D:** `three` + `@react-three/fiber` + `@react-three/drei` (carregados só ao abrir a cena, em um pacote separado). Modelos montados por código, sem arquivos externos: casa com telhado de duas águas, porta e janelas; casa de máquinas com porta metálica e placa de risco; gerador; poste com cruzeta, isoladores e transformador; caixa d'água elevada; árvore; painéis com moldura, células e estrutura. Sol com sombras suaves e céu pela data e hora escolhidas; cabos CC (vermelho) e CA (azul tracejado), com a linha da rede aérea. Vistas isométrica, de cima e de frente; arrastar um objeto o move no chão.
- **Planta 2D:** cada objeto tem símbolo próprio visto de cima (telhado com cumeeira e telhas, raio na casa de máquinas, ventoinha no gerador, cruzeta no poste, caixa d'água, copa da árvore).
- **Sem WebGL** (navegador ou máquina sem aceleração) a cena simplificada em SVG continua disponível.

### Objetos do terreno: tipos e descrição em texto

Além de casa, casa de máquinas, gerador, poste, caixa d'água e árvore, há **contêiner, galpão, estufa, silo, aerogerador, torre/antena, poço, piscina/lago, veículo e muro/cerca**, todos com modelo 3D e símbolo 2D, e **cor** escolhível. Em **Descreva um objeto e eu desenho** a pessoa escreve em português (ex.: "contêiner azul de 6 x 2,5 x 2,6 m", "galpão grande verde", "torre de antena com 20 m de altura") e o sistema reconhece o tipo por palavras, as medidas por padrões numéricos e a cor por nome, mostrando o que entendeu. O interpretador é local, determinístico e funciona sem internet; o que não reconhece vira um bloco genérico (o tipo, as medidas e a cor podem ser trocados ao selecionar o objeto). Uma interpretação por IA generativa (descrições livres, objetos novos) não está incluída: exigiria um serviço externo e chave de acesso.

### Busca de equipamentos e importação

- Ao abrir o campo de equipamento, **já aparece a lista** do tipo (suas fichas, bibliotecas e fontes), sem digitar. Ao digitar, a busca olha a lista da empresa, a biblioteca CEC/SAM (módulos e inversores), as fontes públicas (Techlux) e as fontes por link. Documentos sem tipo são classificados por palavras do título (bateria, controlador, gerador, híbrido/off-grid); o inversor off-grid também mostra inversores comuns ao digitar.
- Sem resultado (ou no rodapé da lista): **Procurar na internet** abre a busca com o tipo e "ficha técnica datasheet pdf", e há um campo para **colar o link** do PDF ou da página do fabricante, que vira fonte da empresa na hora.
- **Importação em um clique:** quem pode aprovar já importa aprovado. Item com ficha completa vem marcado; item com campos faltando abre a conferência e, ao salvar, grava e aprova sem segundo clique (item único).
- **Biblioteca CEC/SAM:** botão **Carregar da internet** (Catálogo → Referências externas) baixa as planilhas do repositório público do NREL (cerca de 21 mil módulos e 2,3 mil inversores). A licença dos arquivos não está confirmada.
- **Proteções e cabos:** o mesmo campo de busca vale na etapa de proteções e cabos do Engine. A leitura de ficha em PDF reconhece disjuntor, DPS (CC ou CA pelo contexto fotovoltaico), fusível, seccionadora, DR e string box (corrente, tensão, polos, curva, capacidade de interrupção, sensibilidade, norma) e cabos (seção, solar ou CA, condutor, isolação, tensão, temperatura, norma), pelos rótulos e pelo título. Documentos sem tipo são classificados por palavras (disjuntor, DPS, fusível, seccionador, cabo, PV1-F…). O que não for lido aparece como faltando na prévia.
