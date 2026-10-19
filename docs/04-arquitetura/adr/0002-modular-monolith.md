# ADR-0002: Modular monolith para o back-end

- **Status:** Aceita
- **Data:** 2026-10-18

## Contexto

A modelagem prevê quatro produtos e vários serviços compartilhados, mas a seção 58 recomenda não iniciar com dezenas de microserviços.

## Decisão

Uma única API NestJS organizada em `platform/` (serviços transversais) e `products/` (crm, calculator, engine, offgrid). Módulos de produto não se importam diretamente: comunicam-se por eventos de domínio ou contratos públicos. Um único app React com áreas por produto.

## Consequências

Operação e deploy simples no início; fronteiras claras permitem extrair um módulo para serviço próprio quando escala ou isolamento justificarem. Requer revisão para impedir acoplamento entre módulos.

## Alternativas consideradas

Quatro APIs e quatro frontends independentes (custo de infraestrutura e manutenção alto demais para a fase atual); uma API com quatro frontends (fragmenta a experiência da suíte).
