# ADR-0014: Project Guard como módulo de triagem dentro do CRM

- **Status:** Aceita
- **Data:** 2026-10-18

## Contexto

O [adendo de reestruturação](../../00-visao-geral/adendo-reestruturacao-priorizacao.md) posiciona a Voltex em transformar um lead numa proposta **com premissas rastreáveis, triagem de riscos e controle de rentabilidade**. Essa triagem já está espalhada na modelagem (Regulation-as-Code, Connection Feasibility, semáforo, Rules Engine) e precisa de nome, contrato e experiência únicos, sem criar novo sistema.

## Decisão

- **Project Guard** é um **módulo** dentro de `products/crm` (API) e do CRM (web). Não é microserviço, não é um quinto produto e **não** tem motor de cálculo próprio: orquestra o resultado do Calculator, a fatura validada, os dados do intake, o Margin Guard e as regras do Rules Engine.
- **Estados da triagem:** `GREEN` (apto à proposta preliminar), `YELLOW` (revisão humana ou de engenharia necessária), `RED` (bloqueio configurado). Reaproveita `TrafficLight` e `AlertSeverity` de `@voltex/shared`.
- **Natureza:** é **triagem**, nunca homologação nem aprovação técnica. O verde não garante aprovação ou conexão; o texto do produto e do relatório diz isso. IA pode extrair e sugerir, mas não valida cálculo elétrico crítico.
- **Saídas:** alertas (código, severidade, mensagem, origem), campos faltantes, necessidade de revisão, margem estimada, justificativas e um **relatório consolidado versionado e imutável** (`TriageSnapshot`, novo tipo em `SnapshotType`) com premissas, versões de algoritmo e de regras, e responsável.
- **Avaliações versionadas:** mudar fatura, equipamento, custo ou premissa **invalida** a avaliação vigente e gera uma nova; as anteriores permanecem acessíveis. Implementado por eventos do outbox.
- **Liberação de bloqueio:** vermelho/amarelo só segue com correção ou **aprovação formal** (perfil com permissão dedicada), com justificativa e auditoria.
- **Margin Guard** passa a ser **condição obrigatória** para liberar a proposta (não só um aviso).
- **Regras:** a primeira versão usa apenas verificações **não regulatórias** (dados obrigatórios, inconsistências de consumo/área, orientação/inclinação, classe de geração, Grupo A). Regra por distribuidora só entra com **fonte oficial vigente**, versão, vigência e revisão por especialista (RN-012, RN-017).

## Consequências

- Nada do que existe muda; o Guard é aditivo (novos modelos, permissões `crm.guard.*`, eventos `ProjectGuardEvaluated` e `ProjectGuardOverridden`, tipo de snapshot).
- A Fase 6 precisa entregar o Rules Engine base e o semáforo com premissas rastreáveis, pois são entradas do Guard.
- O relatório de triagem alimenta a proposta (anexo) e o Engine Studio (`EngineeringRequest` quando amarelo, até a Fase 9).

## Como ficou na implementação (Fase 7B)

Desvios e precisões em relação ao texto acima, para a decisão não ficar desatualizada:

- **`TriageSnapshot` é uma tabela própria**, com gatilho de imutabilidade (só a invalidação pode ser gravada, uma vez), e **não** um valor novo de `SnapshotType`: o relatório tem ciclo de vida diferente (nasce, é invalidado, é liberado) e relações próprias (`TriageOverride`).
- **Mudar a cotação não invalida a triagem.** A triagem depende das premissas **técnicas** (levantamento, fatura, cálculo); a cotação é conferida pelo Margin Guard, que **derruba a aprovação de margem** quando os números mudam. Invalidar a triagem a cada ajuste de preço obrigaria a reavaliar sem que nada técnico tivesse mudado.
- **Invalidação por evento e por impressão digital.** O outbox grava a invalidação; além disso, a consulta compara uma impressão digital das premissas atuais e marca a avaliação como `stale` na hora (o evento pode demorar). Eventos atrasados que já estavam refletidos na avaliação são ignorados.
- **Liberação** exige a permissão `crm.guard.review` (gestor comercial, responsável técnico, proprietário), vale **só para a avaliação liberada** e some se as premissas mudarem.
- **Margin Guard obrigatório:** sem política de margem definida pela empresa nenhuma cotação é liberada. O sistema não presume mínimo.
- Verificações implementadas e gravidades: [Triagem, cotação e proposta](../../07-desenvolvimento/guard-e-proposta.md).

## Alternativas consideradas

Novo serviço de triagem (fragmenta a suíte e duplica dados); lógica espalhada em cada módulo (sem experiência única nem relatório consolidado); deixar a triagem só no Calculator (não enxerga margem, intake nem documentos).
