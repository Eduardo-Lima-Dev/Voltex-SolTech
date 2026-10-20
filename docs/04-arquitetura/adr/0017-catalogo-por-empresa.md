# ADR-0017: Catálogo de equipamentos por empresa, com governança e importação

- **Status:** Aceita
- **Data:** 2026-10-20

## Contexto

O Engine precisa de fichas de módulos, inversores, proteções e cabos. Um catálogo global único exigiria alguém da plataforma mantendo dados de todos os mercados e esconderia diferenças de preço, fornecedor e homologação de cada empresa. Os dados vêm de fontes variadas (planilha, `.PAN/.OND`, PDF do fabricante, bibliotecas públicas).

## Decisão

- **Catálogo por empresa** (isolamento por tenant, como o restante). Dados públicos de referência (ex.: biblioteca CEC) ficam em tabela **global** da Central de Dados e cada empresa **adota** o item: vira rascunho no catálogo dela, com a origem registrada.
- **Governança:** `DRAFT → APPROVED → RETIRED`; campos técnicos **imutáveis depois de aprovado** (gatilho no banco); corrigir = **nova revisão** (`supersedesId`). Cálculo só usa `APPROVED`.
- **Proveniência por campo:** `origem` (`MANUAL`, `CSV`, `PAN`, `DATASHEET_PDF`, `CEC`), confiança por campo na leitura de arquivo, datasheet anexado, registro **INMETRO** e data da conferência.
- **Validações físicas** na entrada (ex.: Vmpp < Voc, Impp < Isc, potência ≈ Vmpp × Impp dentro da tolerância).
- **Preços** em tabela própria com vigência; custo de referência no item.

## Consequências

- Cada empresa mantém o seu catálogo (mais trabalho inicial, mitigado por importação e adoção).
- Mudança de ficha na fonte pública vira **proposta de nova revisão** na caixa de atualizações, nunca edição direta.
- Projetos aprovados guardam a **ficha copiada** no snapshot: mudar o catálogo não altera o passado.

## Alternativas consideradas

Catálogo global mantido pela plataforma (depende do painel do dono, Fase 13, e esconde preço/fornecedor); catálogo livre sem aprovação (cálculo sobre dado não conferido, contra RN-013).

## Como ficou na implementação (Fase 9C)

- **Uma tabela só** (`equipment_items`) com `kind` e a ficha em `spec` (JSON validado por tipo), em vez de quatro tabelas: um gatilho de imutabilidade, um controlador, uma lista. O custo é consultar campo interno da ficha só por JSON; o que precisa ser consultado (fabricante, modelo, situação, INMETRO) tem coluna.
- **Aprovar e aposentar exigem `engine.project.approve`** (responsável técnico). Cadastrar, importar, propor e conferir o INMETRO ficam com `platform.catalog.manage` (engenharia).
- **Revisão:** índice único parcial garante uma revisão aprovada por modelo; aprovar a nova aposenta a anterior. Aposentado não volta (gatilho).
- **INMETRO é verificação assistida:** guarda o que a pessoa conferiu; o sistema só lembra de reconferir (183 dias), sem raspar o site.
- Detalhes, formatos de importação e limites: [Catálogo técnico](../../07-desenvolvimento/catalogo-tecnico.md).
