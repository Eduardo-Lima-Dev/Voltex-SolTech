# Assistente de IA — operação e desenvolvimento

Decisões: [ADR-0029](../04-arquitetura/adr/0029-ia-provedor-trocavel-custo-zero.md) e [ADR-0030](../04-arquitetura/adr/0030-assistente-ferramentas-leitura-e-fatos.md). Plano completo: [plano da Fase 12](../09-roadmap/plano-fase-12.md). Parecer jurídico: [roteiro](../governanca/ia-roteiro-juridico.md).

> **Estado:** sub-fases 12A (fundações), 12B (privacidade e fatos), 12C (camada analítica), 12D (catálogo de ferramentas), 12E (assistente de ponta a ponta) e 12F (telas). 12G (insights), 12H (procurement assistido), 12I (previsões) e 12J (LGPD e fechamento) também estão entregues. **Roteiro para ver na tela:** [roteiro-fase-12.md](roteiro-fase-12.md).

## Ligar a IA no ambiente

No `.env` (nunca versionar valores reais):

```
AI_ENABLED=true
AI_PROVIDER=cloudflare     # ou `demo` para ver as telas sem rede e sem custo (respostas determinísticas, não é inteligência)
CLOUDFLARE_ACCOUNT_ID=…     # painel da Cloudflare → Workers AI → Use REST API
CLOUDFLARE_API_TOKEN=…      # token com Workers AI (Leitura e Edição)
```

Não cadastre cartão na conta da Cloudflare: no plano grátis a chamada **falha em vez de cobrar**, e isso é o que garante o custo zero. Outras variáveis (modelos, prazos, cotas) estão comentadas em `.env.example`.

## Ligar para uma empresa

1. **Empresa de demonstração** (dados fictícios; a única que usa a IA antes do parecer jurídico):
   ```bash
   set -a && . ./.env && set +a
   TENANT_SLUG=voltex-demo DEMO=true ENABLED=true node apps/api/dist/cli/set-tenant-ai.js
   ```
2. Ou pelo administrador da empresa, em **Administração → Inteligência** (marca o aceite dos termos e liga), ou por `PUT /ai/admin/settings` com `{ "enabled": true, "acceptTerms": true }`. O aceite fica registrado (quem e quando) e auditado.
3. Cotas por empresa (neurons por dia): `AI_DAILY=1500 AI_PER_USER=300 AI_INSIGHTS=150`. A soma das empresas ligadas não pode passar do teto da plataforma (`AI_DAILY_NEURONS_GLOBAL`, 9.000): a ferramenta recusa.

## Conferir que funciona

- `GET /ai/status` (perfil com `ai.assistant.use`): responde na hora com `available`, o motivo e a cota restante. **Nunca chama o provedor.**
- `POST /ai/admin/diagnostics` (perfil com `ai.admin.manage`): uma chamada mínima ao modelo. Devolve texto, modelo, custo em neurons e duração; conta na cota.
- `GET /ai/admin/usage`: uso dos últimos 30 dias da empresa (só totais, sem conteúdo).

## Por que a IA pode "não responder" (todas com mensagem pronta)

| Código                                         | Quando                                               | Mensagem ao usuário                                                  |
| ---------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------- |
| `ENV_DISABLED`                                 | `AI_ENABLED=false`, sem provedor ou sem credencial   | O assistente de IA não está disponível neste ambiente.               |
| `LEGAL_REVIEW_PENDING`                         | Sem parecer jurídico e empresa não é de demonstração | Aguarda a revisão jurídica; só funciona em empresas de demonstração. |
| `PLAN_EXCLUDES_AI`                             | `features.ai=false` no plano                         | O plano da sua empresa não inclui o assistente de IA.                |
| `TENANT_DISABLED`                              | A empresa não ligou                                  | Peça a um administrador para ligar em Administração → Inteligência.  |
| `QUOTA_TENANT` / `QUOTA_USER` / `QUOTA_GLOBAL` | Cota do dia esgotada                                 | O limite de uso volta às 21h (horário de Brasília).                  |
| `PROVIDER_QUOTA`                               | O provedor recusou por limite                        | Tente de novo amanhã.                                                |
| `PROVIDER_AUTH`                                | Credencial recusada                                  | Indisponível; avise a administração.                                 |
| `PROVIDER_DOWN`                                | Provedor fora do ar                                  | Indisponível no momento; os dados do sistema continuam acessíveis.   |
| `TIMEOUT`                                      | Passou do prazo                                      | A IA demorou demais; tente de novo.                                  |
| `CIRCUIT_OPEN`                                 | 3 falhas em 60 s                                     | Instável e pausado por alguns instantes.                             |
| `EMPTY_RESPONSE`                               | Modelo respondeu vazio (nos dois modelos)            | Não conseguiu montar uma resposta; reformule.                        |

Chamada que falha por `PROVIDER_DOWN`, `TIMEOUT` ou `EMPTY_RESPONSE` é repetida **uma vez** no modelo reserva. Credencial e limite não são repetidos.

## Desenvolvimento e testes

- Testes não usam a internet nem gastam cota: `AI_PROVIDER=fake` e a classe `FakeAiProvider` (respostas programadas, atraso e falhas simuladas). Ela é recusada em produção.
- O adaptador da Cloudflare tem testes com respostas gravadas (`providers/cloudflare-ai.provider.test.ts`); sempre que possível, confira também com uma chamada real (`/ai/admin/diagnostics`).
- Modelo padrão: `qwen3-30b-a3b-fp8` (≈ 16 neurons por chamada); reserva: `mistral-small-3.1` (≈ 60 por chamada, mais fiel). O qwen3 às vezes responde vazio; então vale o reserva. `llama-4-scout` foi descartado pela latência (13 a 18 s).
- **Custo real medido com o assistente completo (2026-10-25):** 16 a 63 neurons por chamada ao modelo e **25 a 90 neurons por pergunta** (uma pergunta usa de 1 a 3 chamadas). A estimativa inicial (≈ 5 por chamada) estava otimista. Com as cotas padrão isso dá, **por dia**: ~10 perguntas por usuário (300), ~20 a 60 por empresa (1.500) e ~100 a 350 para a conta inteira (9.000). Para testes com clientes, ajuste as cotas com a CLI `set-tenant-ai` e acompanhe em Administração → Inteligência.

## Privacidade e fatos (12B)

Código em `apps/api/src/platform/ai/privacy/`. Nada disso depende do provedor e tudo roda nos testes sem internet.

| Peça                   | O que faz                                                                                                                                                                                                                          |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `detectors.ts`         | Acha CPF e CNPJ (com dígito verificador), e-mail, telefone brasileiro, CEP, coordenadas e número longo (UC, contrato). Prefere mascarar a mais.                                                                                    |
| `pseudonymizer.ts`     | Nome de cliente, contato, usuário e equipe vira `[CLIENTE_1]`… por conversa. Troca sem diferenciar maiúsculas ou acento, só palavra inteira. Na volta, mostra o nome real só a quem pode ver; sem permissão, fica "um cliente".    |
| `facts.ts`             | Todo número, data, código e texto com algarismo de uma ferramenta vira um fato `F#` com tipo, valor e fonte. O modelo recebe `{ ref: "{{F3}}", valor: "R$ 5.940,00" }` e escreve só a referência.                                  |
| `renderer.ts`          | Troca `{{F3}}` pelo valor formatado em pt-BR.                                                                                                                                                                                      |
| `validator.ts`         | Reprova a resposta com algarismo fora de referência, referência ou pseudônimo inexistente, dado pessoal ou texto fora do português.                                                                                                |
| `structured-answer.ts` | Formato `ANSWER` / `CANNOT_ANSWER` / `NEEDS_CLARIFICATION`; o texto da recusa é fixo do sistema.                                                                                                                                   |
| `session.ts`           | Junta tudo: mascara a pergunta, transforma o resultado das ferramentas, valida e renderiza a resposta. Resposta reprovada devolve o texto de reforço para a 2ª tentativa; nunca chega à tela.                                      |
| `guard.ts`             | Última barreira, dentro do gateway: se ainda houver dado pessoal no que vai ao provedor, **não envia**, registra `ai.privacy_blocked` na auditoria (só os tipos e quantos) e responde "por segurança, a pergunta não foi enviada". |

Para uma ferramenta nova (12D): devolver o resultado pela `session.ingestToolResult(...)`, registrar nomes com `session.pseudonyms.alias(...)` e usar os dados de teste de `apps/api/test/ai-pii-fixtures.ts` na suíte de vazamento.

## Camada analítica (12C)

Rotas `GET /analytics/*` (leads, funil, ciclo de venda, motivos de perda, oportunidades paradas, tarefas, clientes, cliente por id, clientes com mais potencial) e `GET/PUT /analytics/settings`. Definições, fórmulas e exemplos em [analitica.md](../06-calculos/analitica.md). A IA vai consumir estas mesmas contas pelas ferramentas da 12D: o modelo nunca calcula, só explica o que a camada devolve. Sem amostra mínima, o resultado traz `INSUFFICIENT_SAMPLE`, e o assistente responde "não posso responder com segurança".

## Catálogo de ferramentas (12D)

Código em `apps/api/src/platform/ai/tools/`. Cada ferramenta é uma **consulta de leitura** que o modelo pode pedir; ele nunca recebe o banco, só o que elas devolvem, já mascarado e em fatos referenciados.

**Regras de toda ferramenta** (um teste confere cada uma):

1. **Permissão:** exige a mesma permissão da rota de leitura que espelha (`mirrors`), às vezes mais (o financeiro). Sem `ai.assistant.use`, nenhuma é oferecida ou executada.
2. **Quem pergunta:** roda com a empresa, o perfil e a **carteira** de quem perguntou. O vendedor só consulta o que é dele.
3. **Sem dado pessoal:** nome de cliente, contato, usuário e equipe sai como pseudônimo (`ctx.client/contact/person/crew`); texto livre digitado por pessoas (títulos de chamado, observações, descrições) **não** é devolvido.
4. **Tamanho:** o resultado é cortado até caber (listas pela metade, repetidamente) e avisa `truncated`.
5. **Falhas:** `ACCESS_DENIED` (com a área), `NOT_FOUND` (inclusive registro fora da carteira), `INVALID_ARGUMENTS` (sem repetir o valor) e `ERROR`.

| Área                 | Ferramentas                                                                                                                                                                                                                            |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Comercial            | `leads_resumo`, `leads_buscar`, `funil_resumo`, `oportunidades_paradas`, `oportunidade_detalhe`, `tarefas_resumo`, `cotacoes_margens`, `propostas_resumo`, `contratos_resumo`, `projetos_resumo`, `painel_comercial`, `faturas_resumo` |
| Clientes             | `clientes_ranking`, `cliente_perfil`, `clientes_potencial`, `clientes_risco`                                                                                                                                                           |
| Engenharia           | `engenharia_painel`, `offgrid_painel`, `calculos_resumo`                                                                                                                                                                               |
| Operação e pós-venda | `operacao_painel`, `instalacoes_buscar`, `agenda_resumo`, `pendencias_campo`, `comissionamento_resumo`, `posvenda_painel`, `planta_desempenho`, `chamados_resumo`, `garantias_resumo`, `om_contratos`                                  |
| Financeiro           | `financeiro_visao`, `recebiveis_vencidos`, `financeiro_projeto`, `comissoes_resumo`                                                                                                                                                    |
| Plataforma           | `catalogo_buscar`, `regras_ativas`, `glossario`                                                                                                                                                                                        |

**Criar uma ferramenta nova:** escreva-a no conjunto do domínio com `defineTool({ name, area, description, permissions, mirrors, params, run })`. Devolva só campos seguros e use os pseudônimos do `ctx`. Os testes de `ai-tools.e2e.test.ts` já a cobrem (espelho de permissão, vazamento, carteira, isolamento). Para seu nome de campo ser reconhecido como dinheiro, percentual, contagem ou dias, siga a convenção: `...Cents`, `...Pct` (pontos percentuais), `...Rate` (fração), `...Count`, `...Days`, `...Kwh`.

Lacunas conhecidas: `previsoes` (12I) ainda não existe; e a descoberta de clientes citados pelo nome na pergunta (para já virarem pseudônimo antes de ir ao modelo) é feita no orquestrador (12E).

## Assistente (12E)

Código em `apps/api/src/platform/ai/assistant/`. Fluxo de `AssistantService.ask`:

1. **Privacidade da pergunta:** detectores trocam CPF, CNPJ, e-mail, telefone, CEP e coordenadas por marcadores; os tipos removidos viram o `notice` mostrado ao usuário. Nomes de clientes citados viram pseudônimos (`[CLIENTE_1]`); nome ambíguo vira pedido de esclarecimento.
2. **Área sem acesso:** se a pergunta é de uma área que o perfil não pode ver (ex.: financeiro), responde com recusa fixa, sem chamar o modelo.
3. **Seleção de ferramentas** por palavra-chave (`tool-selection.ts`), só as que o perfil pode usar; até 3 rodadas de chamadas de ferramenta.
4. **Resposta estruturada** (`ANSWER`, `CANNOT_ANSWER`, `NEEDS_CLARIFICATION`) com referências `{{F#}}`; o validador barra número solto, referência inexistente, dado pessoal e idioma errado. Falhou: **uma** nova tentativa com instrução; falhou de novo: **resposta só com os dados** (`FALLBACK`), sem inventar.
5. **Barreira final** antes de qualquer chamada ao provedor (`PRIVACY_BLOCKED`) e prazos de 15 s por chamada e 30 s no total.

Rotas: `POST /ai/chat` (JSON, ou fluxo SSE com `Accept: text/event-stream`, eventos `progress`, `answer` e `error`), `GET /ai/conversations`, `GET /ai/conversations/:id`, `DELETE /ai/conversations/:id`, `POST /ai/messages/:id/feedback`. **Só o dono lê a própria conversa**; o título e o texto guardado são os mascarados; as conversas entram na exportação e na eliminação de dados da empresa (LGPD). A instrução de sistema é versionada (`PROMPT_VERSION`).

### Avaliação de 70 perguntas

`apps/api/test/ai-eval.e2e.test.ts`: 29 respondíveis, 11 sem dado, 8 sem acesso, 8 fora de escopo, 4 amostra pequena, 6 injeção de instrução e 4 com dado pessoal. Em CI roda com o provedor simulado e **exige 70/70**. Com o modelo real (`AI_EVAL_REAL=1 pnpm ai:eval`, opcional `AI_EVAL_MODEL`; gasta cota) os relatórios ficam em `apps/api/test-results/` (fora do git).

Medido com o `qwen3` (modelo padrão):

| Data       | Resultado           | Observação                                                                                           |
| ---------- | ------------------- | ---------------------------------------------------------------------------------------------------- |
| 2026-10-25 | 58 de 70            | respostas vazias, recusas indevidas, resposta de memória sem consultar nada                          |
| 2026-10-28 | 66 de 69 concluídas | depois da instrução `2026-10-28.1`, da trava "sem consulta" e da revisão das ferramentas de clientes |

As falhas que sobram mudam de uma rodada para outra (o modelo não é determinístico): na última foram uma resposta só com dados (`FALLBACK`), uma recusa por "amostra insuficiente" e uma recusa por falta de dado em perguntas respondíveis. **Nenhum vazamento de dado pessoal em nenhuma execução.** Duas perguntas do conjunto foram corrigidas por depender dos dados de teste: "resultado por vendedor" (a empresa de teste tem um vendedor, amostra pequena demais) virou "oportunidades por etapa", e "regras ativas" (sem regras ativas na empresa de teste) virou caso de "sem dado". Para rodar só algumas perguntas: `AI_EVAL_ONLY=a01,s04`; para ver o que o modelo respondeu em cada chamada: `AI_EVAL_TRACE=1` (grava `trace.log` ao lado do relatório).

**O que mudou no assistente por causa da avaliação:** (1) a instrução manda chamar uma ferramenta **antes** de responder e só pedir esclarecimento quando nenhuma ferramenta resolve (período omitido usa o padrão da ferramenta); (2) resposta `ANSWER` sem ter consultado nada e sem citar nenhum valor é reprovada, o modelo é mandado consultar e, se insistir, a recusa fixa `NO_TOOL` aparece; (3) as descrições de `clientes_ranking` e `clientes_potencial` deixam claro quando usar cada uma, e "perfil", "chance" e "parecem" selecionam `clientes_potencial`.

## Telas (12F)

Código em `apps/web/src/features/ai/` e `features/admin/intelligence/`.

- **Pergunte ao Voltex:** botão no cabeçalho (só com `ai.assistant.use`) abre o painel lateral (tela cheia no celular). Mostra o progresso do fluxo, a resposta com os valores como **chips** (clique para ver a consulta, o campo e a hora de onde veio), "Ver os dados", o selo "Gerado por IA a partir dos dados do sistema. Confira antes de decidir.", sugestões por tela, perguntas de seguimento, avaliação útil/não útil com motivo, nova conversa e histórico com apagar. Os estados (indisponível, cota esgotada, recusa, só dados, erro) mostram a mensagem pronta do servidor.
- **Copiloto nas fichas:** botão "Resumir com IA" no projeto, na planta e no financeiro abre o painel numa conversa nova com a pergunta pronta (e o código do projeto no contexto).
- **Administração → Inteligência** (`ai.admin.manage`): liga/desliga com aceite dos termos aqui registrado, situação e cotas do dia, uso dos últimos 30 dias, teste do modelo e, para quem administra a empresa (`platform.tenant.manage`), os **parâmetros de análise e previsão** (mínimos de amostra e dias para uma oportunidade ser dada como parada). As **cotas diárias** de custo continuam fora da tela de propósito: são controle de custo da plataforma, ajustadas pela CLI `set-tenant-ai`. Avisa quando falta o parecer jurídico (a IA só funciona em empresa de demonstração).
- Testes: `features/ai/assistant.test.tsx` e `features/admin/intelligence/intelligence.test.tsx` (MSW); Playwright `apps/e2e/tests/jornada-ia.spec.ts` (`pnpm jornada`), com `AI_PROVIDER=demo` no servidor de teste e a empresa marcada como demonstração em `prepare-db.mjs`.

## Insights proativos (12G)

Código em `apps/api/src/platform/ai/insights/`. Uma rotina diária (fila `ai-insights`, `AI_INSIGHTS_INTERVAL_MS`, 24 h; 0 desliga) roda para cada empresa com a IA ligada. **Detectores determinísticos** (`insight-detectors.ts`, funções puras) leem o sistema e viram `Insight`; a IA só **redige a frase** a partir dos fatos (`{{F#}}`, mesmo validador do assistente), com a **cota própria de insights** (150 neurons/dia/empresa), e o texto padrão do detector aparece sempre que a IA não está disponível ou a frase reprova.

| Detector                | Regra                                                                                      | Quem vê                                           |
| ----------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| `OVERDUE_RECEIVABLES`   | parcelas vencidas há 7 dias ou mais (**padrão do sistema**, `INSIGHT_DEFAULTS`)            | `crm.finance.read`                                |
| `STALLED_OPPORTUNITIES` | oportunidades paradas (prazo `stalledDays` da empresa), **um achado por dono da carteira** | `crm.opportunity.read`; vendedor/SDR só o próprio |
| `OVERDUE_INSTALLATIONS` | instalações atrasadas                                                                      | `ops.installation.read`                           |
| `WARRANTIES_EXPIRING`   | só com o prazo de aviso de garantia configurado pela empresa                               | `ops.warranty.manage`                             |
| `BREACHED_TICKETS`      | chamados fora do prazo (SLA da empresa)                                                    | `ops.ticket.read`                                 |

Regras de ciclo de vida: o mesmo problema não vira dois insights (`dedupeKey`); se o problema some, o insight se **resolve sozinho** e reabre se voltar; “não relevante” ou “resolvido” por uma pessoa silencia por 30 dias. Rotas: `GET /ai/insights`, `PATCH /ai/insights/:id` (`ai.insights.read`), `POST /ai/insights/run` (`ai.admin.manage`; também na tela Inteligência). Cartão “O que a IA notou hoje” no início.

## Procurement assistido (12H)

Código em `apps/api/src/platform/ai/procurement/`. Em Administração → Catálogo → Preços, “Ler tabela de preços com IA” (permissão `procurement.price.extract` + `platform.catalog.manage`):

1. Envia PDF ou CSV (até 10 MB). O texto é extraído no servidor, passa pelos detectores de dado pessoal (o que parecer pessoal é removido) e é dividido em até 3 pedaços.
2. O modelo devolve JSON (fabricante, modelo, descrição, fornecedor, SKU, preço, vigência, **trecho exato do documento**). O servidor **descarta** toda linha cujo trecho não esteja no documento ou não contenha o preço (`confirmsInSource`), remove repetidas e valida por zod.
3. A prévia mostra cada linha com a origem, o casamento com o catálogo aprovado e os problemas (fornecedor, vigência, equipamento desconhecido). A pessoa corrige e escolhe as linhas.
4. “Importar” gera o CSV no modelo existente e chama a **mesma rotina** `PriceListService.import`, com a fonte “extraído por IA, conferido por {nome}: arquivo”. Nada é gravado antes disso. Sem IA, a importação manual por CSV continua igual.

Comparação de fornecedores: em Operação → Instalação → Materiais → “Comparar ofertas” agora aparece também o **total da lista inteira por fornecedor** (itens cobertos, itens sem oferta, validade e menor total entre quem cobre tudo).

## Previsões (12I)

Funções puras no motor (`packages/solar-engine/src/forecast/`), memorial em [previsoes.md](../06-calculos/previsoes.md). Rotas `GET /forecasts/{receivables,funnel,installations,generation/:projectCode}` e ferramentas `previsoes_*` do assistente. Abaixo do mínimo de amostra (parâmetros da empresa), a resposta é `INSUFFICIENT_SAMPLE` e a tela diz “Dados insuficientes: há X e o mínimo é Y”. Cartões em Financeiro, Painel comercial, Painel da operação e ficha da planta.

## LGPD das conversas e dos novos dados (12J)

- **Retenção:** Administração → Privacidade → “Conversas com o assistente de IA (meses)” (`aiConversationsMonths`; em branco = até a pessoa apagar). A rotina diária de retenção apaga conversas e mensagens sem atividade além do prazo.
- **Eliminação do titular:** eliminar um lead ou uma conta apaga as conversas cujos pseudônimos citam essa pessoa (o resumo traz `conversasDaIa`).
- **Exportação da empresa:** inclui conversas e mensagens (sem o texto com marcadores e sem o mapa de pseudônimos), insights e extrações de preço.
- **Textos públicos:** Política de Privacidade e Termos v1.2 (IA, suboperador, finalidade, dado mascarado, conversas) e a landing (seção “Seus dados” e pergunta “O que a IA faz? E o que ela não faz?”). A revisão do advogado continua pendente: [roteiro](../governanca/ia-roteiro-juridico.md).

## Publicar com a IA (produção/demonstração na nuvem)

Quando algo é mesclado na `main`, o fluxo `deploy-demo.yml` publica a API na Render, aplica as migrations no Supabase e repassa as variáveis da IA. **A IA só funciona depois destes passos únicos** (nenhum valor secreto vai para o repositório):

1. **Cloudflare:** conta **sem cartão** (no plano grátis a chamada falha em vez de cobrar), com o token de Workers AI (Leitura e Edição).
2. **GitHub → Settings → Environments → `demo`:**
   - **Secrets:** `CLOUDFLARE_ACCOUNT_ID` e `CLOUDFLARE_API_TOKEN`. O fluxo os envia à Render a cada publicação, sem imprimir o valor.
   - **Variables:** `AI_ENABLED=true` e `AI_PROVIDER=cloudflare` (o `render.yaml` já traz esses dois como padrão, mas a variável do ambiente tem prioridade). Opcionais: `AI_MODEL_DEFAULT`, `AI_MODEL_FALLBACK`, `AI_DAILY_NEURONS_GLOBAL`.
   - **Variable `AI_DEMO_TENANT_SLUG`** (ex.: `voltex-demo`): o fluxo marca essa empresa como **demonstração**, o que libera a IA nela mesmo sem o parecer jurídico.
3. **Parecer jurídico (empresas reais):** depois do parecer, defina a variável `AI_LEGAL_REVIEWED_AT` (ex.: `2026-11-15`). Sem ela, empresa que não é de demonstração continua com a IA bloqueada.
4. **Ligar na empresa:** o administrador entra em **Administração → Inteligência**, aceita os termos e clica em "Ligar a IA". Use "Testar a IA" para conferir credencial, prazo e custo.

**Antes de publicar, confira:** `REDIS_URL` configurado na Render (a rotina de insights usa uma fila; ela gasta pouquíssimos comandos, 1 execução por dia, e `AI_INSIGHTS_INTERVAL_MS=0` a desliga) e o `NODE_ENV=production` (o provedor simulado `fake`/`demo` é recusado em produção, de propósito).

**Acompanhar o uso e as cotas:** Administração → Inteligência → "Uso do assistente" mostra perguntas hoje, pontos gastos, média de pontos por pergunta, **quantas perguntas ainda cabem hoje**, o uso da plataforma contra o teto diário (9.000 de 10.000 do plano grátis) e a tabela dos últimos 30 dias com perguntas por dia. As cotas por empresa e por pessoa (padrão 1.500 e 300 pontos/dia, cerca de 10 perguntas por pessoa) aparecem no painel do assistente para cada usuário e se alteram pela CLI `set-tenant-ai`. Se a cota acabar, o sistema avisa com a hora em que volta (meia-noite UTC = 21h em Brasília) e os dados continuam acessíveis.
