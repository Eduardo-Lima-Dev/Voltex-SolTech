# ADR-0007: Fluxo de branches e Conventional Commits

- **Status:** Aceita
- **Data:** 2026-10-18

## Contexto

O projeto precisa de ambientes de desenvolvimento, homologação e produção com promoção controlada.

## Decisão

Branches permanentes: `develop` (desenvolvimento) → `homologate` (homologação) → `main` (produção). Trabalho em branches curtas `feat/...`, `fix/...`, `docs/...`, `chore/...` a partir de `develop`. Promoção entre ambientes por pull request. Commits em [Conventional Commits](https://www.conventionalcommits.org/pt-br/), validados por commitlint e Husky. Detalhes em [fluxo Git](../../07-desenvolvimento/fluxo-git.md).

## Consequências

Histórico legível e changelog automatizável. Produção só recebe código já validado em homologação.

## Alternativas consideradas

Trunk-based development (menos controle de homologação).
