# ADR-0006: Snapshots imutáveis para saídas relevantes

- **Status:** Aceita
- **Data:** 2026-10-18

## Contexto

Uma proposta antiga não pode mudar porque preço, tarifa, regra ou algoritmo foram atualizados (seção 33).

## Decisão

Toda saída relevante (`QuickCalculationSnapshot`, `EngineeringSnapshot`, `OffGridSnapshot`, `QuoteSnapshot`, `ProposalSnapshot`) grava inputs, outputs, versão do algoritmo, versão da regra, preços, equipamentos, usuário, data, avisos e aprovação. Registros não têm update nem delete; correções geram novo snapshot.

## Consequências

Auditoria e reprodutibilidade garantidas, com custo de armazenamento maior. O sistema precisa manter versões antigas de algoritmo disponíveis para reprodução.

## Alternativas consideradas

Recalcular a partir de dados atuais (viola a regra de negócio RN-001).
