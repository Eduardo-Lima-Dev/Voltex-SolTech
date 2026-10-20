# ADR-0016: Regras por chave, escopo e avaliador de condições

- **Status:** Aceita (implementada na Fase 9A)
- **Data:** 2026-10-20

## Contexto

O Rules Engine base atende só `calculator.rules`. O Engine precisa de fatores de projeto, tabelas de cabos, parâmetros de transposição, exigências de conexão por distribuidora e premissas econômicas: normas pagas e regulação que mudam, e que **não podem virar constantes no código** (RN-012). Uma exigência vale só para certa distribuidora, estado ou tipo de projeto.

## Decisão

- **Registro de chaves** (`RULESET_DEFINITIONS` em `@voltex/shared`): `calculator.rules` (inalterada), `engine.design`, `engine.cables`, `engine.transposition`, `engine.connection`, `engine.economics`. Cada chave tem seu schema de definição e diz se aceita escopo. A API recusa chave desconhecida e definição inválida.
- **Definição do Engine** = `parameters` (números), `tables` (linhas versionadas) e `rules` (condicionais). **Sem valores padrão embutidos**: fator normativo sem regra ativa e revisada não existe. Quem consome recebe `null` e **trava a aprovação** (resultado "pendente de regra").
- **Escopo** (distribuidora, estado, tipo de projeto, grupo): `RuleSet.scope` + `scope_key` canônica. **Uma versão ativa por tenant, chave e escopo** (índice único parcial no banco). Resolução (`RulesService.resolve(key, contexto, at)`): entre as ativas e vigentes cujo escopo **casa** com o contexto, vence a de **escopo mais específico**; empate → versão maior. Ativar uma regra aposenta só a ativa **do mesmo escopo**.
- **Avaliador de condições** (ENG-F26, `solar-engine/src/rules/evaluate.ts`, puro): operadores `=`, `!=`, `>`, `>=`, `<`, `<=`, `in`, `between`, `exists`, comparação com outro campo (`valueFrom`) e combinadores `all`/`any`/`not`. Campo ausente **nunca** satisfaz comparação (a regra não dispara por dado que o projeto ainda não tem). Saída `{severidade, código, mensagem, fonte}`; **regra sem fonte é inválida**.
- Ativar continua exigindo **revisor** (responsável técnico), a definição e o escopo são **imutáveis** depois de ativa (gatilho no banco) e cada ativação publica o evento **`RuleSetActivated`** (com `ref` e `previousRef`) para revalidar projetos que usam a regra.
- O snapshot de qualquer cálculo guarda o `ref` (`<id>@<versão>`) de cada regra usada.

## Consequências

- O Calculator não muda (`calc-1.1.0`, `builtin@1` sem regra ativa).
- Regra nova de norma = dado novo, não deploy. A tela de regras ganha formulários por chave nas próximas fases.
- A Central de Dados Externos (ADR-0018) liga regra à fonte vigiada: mudança na fonte gera **proposta de revisão**, nunca regra automática.

## Alternativas consideradas

Constantes no código com versão do produto (exige deploy a cada mudança normativa e perde a vigência por tenant); motor de regras genérico de mercado (dependência pesada para um conjunto pequeno de operadores); regras por distribuidora em tabelas próprias (uma tabela por assunto).
