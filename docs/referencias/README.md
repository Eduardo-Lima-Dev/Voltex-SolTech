# Referências técnicas

Material de base do projeto. **Referência não é regra:** um livro, norma ou guia descreve o conhecimento; só vira comportamento do sistema quando é transformado em **dado ou cálculo rastreável** (fonte, página/artigo, vigência, versão, testes e revisão por especialista), conforme as regras [RN-011](../01-requisitos/regras-de-negocio.md), [RN-012](../01-requisitos/regras-de-negocio.md) e [RN-015](../01-requisitos/regras-de-negocio.md).

| Referência                                                           | O que é                                                                                   | Onde                                    |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------- |
| **EnergIF vol. 3 — Energia Fotovoltaica** (Lopes, ENBPar/IFSC, 2023) | Material didático de 220 páginas: componentes, off-grid, on-grid, instalação e manutenção | [energif-2023/](energif-2023/README.md) |

## Como usar uma referência no desenvolvimento

1. **Procure primeiro aqui** ([regras e medidas do EnergIF](energif-2023/regras-e-medidas.md)): se o item já foi extraído, use o ID (por exemplo `EF-M03`) no código, nos testes e no commit.
2. **Se faltar**, abra o PDF na página indicada, extraia o item para o arquivo de regras e medidas (com página, status e ressalvas) e só então implemente.
3. **Regra regulatória** (prazos, limites de potência, documentos exigidos) vai para o Rules Engine como dado versionado, com fonte oficial vigente. O livro é de 2023 e serve de ponto de partida, não de fonte final.
4. **Cálculo** vai para `@voltex/solar-engine` com memorial em [06-calculos](../06-calculos/README.md) citando a fonte.
5. Item sem fonte suficiente permanece como **hipótese** declarada, nunca como constante embutida.

## Escopo atual

O desenvolvimento vai **até a Fase 8** ([roadmap](../09-roadmap/roadmap.md)). Do EnergIF extraímos agora apenas o que as Fases 6, 7 e 8 usam; o restante está inventariado com páginas para quando as fases 9 a 12 começarem.
