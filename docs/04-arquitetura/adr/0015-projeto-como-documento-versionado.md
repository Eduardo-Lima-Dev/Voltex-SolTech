# ADR-0015: Projeto de engenharia como documento versionado, com snapshot imutável

- **Status:** Aceita
- **Data:** 2026-10-20

## Contexto

O Solar Engine Studio descreve um sistema com muitas partes ligadas (local, superfícies, obstáculos, arranjos, inversores, strings, proteções, cabos, simulação, conexão, economia). Modelar cada parte em tabelas próprias criaria dezenas de tabelas que mudam juntas e dificultaria comparar versões e congelar o que foi aprovado (RN-014).

## Decisão

- Cada **versão do projeto** guarda o **desenho como um documento JSON** validado por um schema Zod compartilhado (`engineeringDesignSchema`), e os **resultados recalculados** em outro campo (`results`). Criar versão = **cópia** do documento anterior; editar só altera versões em rascunho.
- Uma tabela desnormalizada (`EngineeringVersionEquipment`) lista os equipamentos usados por versão, só para consultas de impacto ("quais projetos usam este módulo?").
- A **aprovação** do responsável técnico congela a versão (gatilho no banco) e publica um **`EngineeringSnapshot` imutável** com o documento, os resultados, as **fichas copiadas** dos equipamentos, as **regras e fontes** (`ref` de cada regra), os **dados externos com proveniência**, as versões de algoritmo, os preços e os avisos, mais um hash. É o que o CRM consome (Project Guard, cotação).
- Mudar premissa depois da aprovação cria **nova versão**; a aprovada vira `SUPERSEDED` e continua legível.
- O mesmo motor de cálculo roda no navegador (feedback imediato) e no servidor (fonte oficial ao salvar), como no Calculator.

## Consequências

- Comparar versões é comparar dois documentos (diferença estruturada).
- Migração de schema do documento exige versão do schema dentro do JSON e função de migração testada.
- Consultas por campo interno do desenho são limitadas; o que precisa ser consultado vai para colunas/tabela desnormalizada.
- Segue o padrão de snapshot da [ADR-0006](0006-snapshots-imutaveis.md) e o caminho LGPD de eliminação do snapshot.

## Alternativas consideradas

Tabelas relacionais para cada parte do desenho (muitas tabelas e joins, congelamento difícil); event sourcing completo (complexidade sem ganho no MVP2).
