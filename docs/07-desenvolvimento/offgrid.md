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

Quatro tipos novos em `EquipmentKind`: `BATTERY` (química, tensão, Ah no regime, DoD máxima, eficiência, ciclos × DoD, vida de calendário, correntes, paralelo máximo), `CHARGE_CONTROLLER` (MPPT/PWM, tensão do banco, corrente, Voc máxima, faixa MPPT), `OFFGRID_INVERTER` (off-grid ou híbrido; contínua, surto, tensão do banco, carregador, entradas de rede e gerador, MPPT embutido) e `GENERATOR` (combustível, potência, consumo, carga mínima). Têm validação física (`catalog/validate.ts`), modelo de planilha CSV, formulário e rótulos no catálogo, e o classificador de fontes por link reconhece bateria, controlador e gerador. **Leitura automática de PDF para estes tipos ainda não existe**: eles entram por planilha ou cadastro manual (limite declarado).

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

- Leitura de PDF/ficha para bateria, controlador, inversor off-grid e gerador: **não implementada**.
- Sem integração de cotação a partir do snapshot off-grid (a cotação do CRM segue o Engine).
- Sem unifilar nem relatório público para cliente final.
- SIGFI (RN ANEEL 493/2012) fica como dado de regra ainda não implementado (ver [CR-19](../referencias/cresesb-2014/README.md)).
- Sem autodescarga, Peukert e derating por temperatura; conversão do carregador fixa em 90%.
- Valores de regra são **exemplos** até a revisão do responsável técnico.

### Visual realista (3D e 2D)

- **Cena 3D:** `three` + `@react-three/fiber` + `@react-three/drei` (carregados só ao abrir a cena, em um pacote separado). Modelos montados por código, sem arquivos externos: casa com telhado de duas águas, porta e janelas; casa de máquinas com porta metálica e placa de risco; gerador; poste com cruzeta, isoladores e transformador; caixa d'água elevada; árvore; painéis com moldura, células e estrutura. Sol com sombras suaves e céu pela data e hora escolhidas; cabos CC (vermelho) e CA (azul tracejado), com a linha da rede aérea. Vistas isométrica, de cima e de frente; arrastar um objeto o move no chão.
- **Planta 2D:** cada objeto tem símbolo próprio visto de cima (telhado com cumeeira e telhas, raio na casa de máquinas, ventoinha no gerador, cruzeta no poste, caixa d'água, copa da árvore).
- **Sem WebGL** (navegador ou máquina sem aceleração) a cena simplificada em SVG continua disponível.
