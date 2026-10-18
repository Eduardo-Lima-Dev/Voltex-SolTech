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

## Alternativas consideradas

Novo serviço de triagem (fragmenta a suíte e duplica dados); lógica espalhada em cada módulo (sem experiência única nem relatório consolidado); deixar a triagem só no Calculator (não enxerga margem, intake nem documentos).
