# Assistente de IA — operação e desenvolvimento

Decisões: [ADR-0029](../04-arquitetura/adr/0029-ia-provedor-trocavel-custo-zero.md) e [ADR-0030](../04-arquitetura/adr/0030-assistente-ferramentas-leitura-e-fatos.md). Plano completo: [plano da Fase 12](../09-roadmap/plano-fase-12.md). Parecer jurídico: [roteiro](../governanca/ia-roteiro-juridico.md).

> **Estado:** sub-fases 12A (fundações), 12B (privacidade e fatos), 12C (camada analítica) e 12D (catálogo de ferramentas). O orquestrador (o chat de fato) e as telas vêm nas sub-fases 12E e 12F.

## Ligar a IA no ambiente

No `.env` (nunca versionar valores reais):

```
AI_ENABLED=true
AI_PROVIDER=cloudflare
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
2. Ou pelo administrador da empresa: `PUT /ai/admin/settings` com `{ "enabled": true, "acceptTerms": true }` (a tela vem na 12F). O aceite fica registrado (quem e quando) e auditado.
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
- Latência medida em 2026-10-25: `mistral-small-3.1` 0,5 a 2 s; `llama-4-scout` 13 a 18 s em chamadas pequenas. Por isso o padrão é o primeiro e o segundo é reserva.
- Custo medido: chamada simples ≈ 1 neuron; com ferramenta ≈ 5; a estimativa usada para barrar antes de chamar é de 15.

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
