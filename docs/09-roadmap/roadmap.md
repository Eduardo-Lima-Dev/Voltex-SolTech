# Roadmap

Plano de implementação por fases. Cada fase termina em um checkpoint verificável. A ordem segue a seção 76 da modelagem: CRM + Calculator primeiro, depois Engine, Off-Grid e, por fim, execução e lifecycle.

| Fase | Entrega                                                                                    | Status       |
| ---- | ------------------------------------------------------------------------------------------ | ------------ |
| 0    | Bootstrap do monorepo (pnpm, Turborepo, TS, ESLint, Prettier, Husky, commitlint)           | ✅ Concluída |
| 1    | Documentação (`docs/`)                                                                     | ✅ Concluída |
| 2    | Pacotes compartilhados (`shared`, `solar-engine`, `ui`)                                    | ✅ Concluída |
| 3    | Infra Docker (dev/prod) + banco (Prisma, migrations, seed)                                 | ⏳           |
| 4    | API NestJS: auth, RBAC, multi-tenant, auditoria, eventos, documentos                       | ⏳           |
| 5    | Web React: casca da suíte, login, navegação, admin                                         | ⏳           |
| 6    | **MVP1** — Solar Calculator                                                                | ⏳           |
| 7    | **MVP1** — CRM Solar (leads → fatura/OCR → cotação/margem → proposta → contrato → projeto) | ⏳           |
| 8    | Qualidade, CI/CD, imagens de produção, e2e, LGPD                                           | ⏳           |
| 9    | **MVP2** — Solar Engine Studio                                                             | ⏳           |
| 10   | **MVP3** — Off-Grid Designer                                                               | ⏳           |
| 11   | Execução e lifecycle (WhatsApp, field, instalação, comissionamento, O&M, portal)           | ⏳           |
| 12   | Inteligência e ecossistema (IA, procurement, previsões)                                    | ⏳           |

## Fase 0 — Descoberta (negócio, paralela ao desenvolvimento)

Da seção 63: entrevistar 10–15 integradores, mapear processos reais, coletar exemplos anonimizados de contas e propostas, mapear concessionárias e fornecedores prioritários, escolher o ICP e identificar 5 clientes piloto. Resultado alimenta os dados iniciais de tarifas, HSP e parser de fatura.

## Critério do MVP1

O vendedor consegue sair de **lead + fatura para proposta preliminar** rapidamente: Lead → fatura → OCR validado → cálculo → cotação com margem → proposta PDF/web → aceite → contrato → projeto criado.

## Fora do MVP1

WhatsApp oficial (EPIC-CRM-004) e financiamento integrado (EPIC-CRM-010, no MVP1 apenas registro manual de status). Ver [o que evitar inicialmente](../00-visao-geral/visao-do-produto.md#fora-do-primeiro-mvp).

## Métricas de sucesso

- **CRM:** tempo até o primeiro valor, primeira proposta válida, conversão, ciclo de venda, negócios sem próxima tarefa, margem protegida, retrabalho, atraso de homologação.
- **Calculator:** tempo de cálculo, taxa de conclusão, correções manuais, % encaminhado ao Engine, diferença entre estimativa inicial e projeto final.
- **Engine:** tempo de projeto, revisões, incompatibilidades detectadas antes da obra, erros pós-aprovação, reutilização do catálogo, aprovação na primeira submissão.
- **Off-Grid:** tempo de dimensionamento, cenários comparados, consumo previsto × real, autonomia observada × projetada.

## Riscos

| Risco                                                    | Mitigação                                          |
| -------------------------------------------------------- | -------------------------------------------------- |
| Escopo amplo demais                                      | Produtos separados + fases                         |
| Cálculo técnico incorreto                                | Motor determinístico + testes + revisão técnica    |
| Regra desatualizada                                      | Rules Engine versionado                            |
| IA alucinar                                              | Human-in-the-loop                                  |
| API externa quebrar                                      | Integration Hub + fallback                         |
| Usuário abandonar o CRM                                  | Automação + UX + time-to-value                     |
| Dados duplicados entre sistemas                          | Source of truth + eventos + IDs globais            |
| Datasheet de equipamento errado                          | Governança de catálogo                             |
| Copiar concorrentes sem diferenciação                    | Foco em compliance + margem + engenharia conectada |
| Competir com software de engenharia completo cedo demais | Validação/integração antes de CAD avançado         |
