# Registro de decisões de arquitetura (ADR)

Cada decisão relevante é registrada em um arquivo `NNNN-titulo.md` neste diretório, nunca editada depois de aceita (uma decisão nova a substitui e a antiga passa a `Substituída`).

Status possíveis: `Proposta` · `Aceita` · `Substituída` · `Rejeitada`.

| ADR                                           | Título                                                   | Status |
| --------------------------------------------- | -------------------------------------------------------- | ------ |
| [0001](0001-monorepo-turborepo-pnpm.md)       | Monorepo com Turborepo e pnpm                            | Aceita |
| [0002](0002-modular-monolith.md)              | Modular monolith para o back-end                         | Aceita |
| [0003](0003-postgres-prisma.md)               | PostgreSQL com Prisma                                    | Aceita |
| [0004](0004-zod-compartilhado.md)             | Schemas Zod e cálculos compartilhados entre back e front | Aceita |
| [0005](0005-multi-tenancy.md)                 | Multi-tenancy por coluna `tenantId`                      | Aceita |
| [0006](0006-snapshots-imutaveis.md)           | Snapshots imutáveis para saídas relevantes               | Aceita |
| [0007](0007-fluxo-git-e-commits.md)           | Fluxo de branches e Conventional Commits                 | Aceita |
| [0008](0008-dev-hibrido-docker.md)            | Desenvolvimento híbrido: infra no Docker, apps locais    | Aceita |
| [0009](0009-prisma-7.md)                      | Prisma 7 com driver adapter                              | Aceita |
| [0010](0010-rustfs-no-lugar-do-minio.md)      | RustFS como S3 local no lugar do MinIO                   | Aceita |
| [0011](0011-sessao-jwt-e-refresh-rotativo.md) | Sessão com JWT de acesso e refresh token opaco rotativo  | Aceita |
| [0012](0012-acesso-a-dados-por-tenant.md)     | Acesso a dados escopado por tenant com falha fechada     | Aceita |
| [0013](0013-arquitetura-do-front-end.md)      | Arquitetura do front-end                                 | Aceita |
| [0014](0014-project-guard.md)                 | Project Guard como módulo de triagem dentro do CRM       | Aceita |

## Modelo

```markdown
# ADR-NNNN: Título

- **Status:** Proposta | Aceita | Substituída | Rejeitada
- **Data:** AAAA-MM-DD

## Contexto

## Decisão

## Consequências

## Alternativas consideradas
```
