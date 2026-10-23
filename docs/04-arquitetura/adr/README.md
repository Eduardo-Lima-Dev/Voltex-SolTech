# Registro de decisões de arquitetura (ADR)

Cada decisão relevante é registrada em um arquivo `NNNN-titulo.md` neste diretório, nunca editada depois de aceita (uma decisão nova a substitui e a antiga passa a `Substituída`).

Status possíveis: `Proposta` · `Aceita` · `Substituída` · `Rejeitada`.

| ADR                                                 | Título                                                         | Status |
| --------------------------------------------------- | -------------------------------------------------------------- | ------ |
| [0001](0001-monorepo-turborepo-pnpm.md)             | Monorepo com Turborepo e pnpm                                  | Aceita |
| [0002](0002-modular-monolith.md)                    | Modular monolith para o back-end                               | Aceita |
| [0003](0003-postgres-prisma.md)                     | PostgreSQL com Prisma                                          | Aceita |
| [0004](0004-zod-compartilhado.md)                   | Schemas Zod e cálculos compartilhados entre back e front       | Aceita |
| [0005](0005-multi-tenancy.md)                       | Multi-tenancy por coluna `tenantId`                            | Aceita |
| [0006](0006-snapshots-imutaveis.md)                 | Snapshots imutáveis para saídas relevantes                     | Aceita |
| [0007](0007-fluxo-git-e-commits.md)                 | Fluxo de branches e Conventional Commits                       | Aceita |
| [0008](0008-dev-hibrido-docker.md)                  | Desenvolvimento híbrido: infra no Docker, apps locais          | Aceita |
| [0009](0009-prisma-7.md)                            | Prisma 7 com driver adapter                                    | Aceita |
| [0010](0010-rustfs-no-lugar-do-minio.md)            | RustFS como S3 local no lugar do MinIO                         | Aceita |
| [0011](0011-sessao-jwt-e-refresh-rotativo.md)       | Sessão com JWT de acesso e refresh token opaco rotativo        | Aceita |
| [0012](0012-acesso-a-dados-por-tenant.md)           | Acesso a dados escopado por tenant com falha fechada           | Aceita |
| [0013](0013-arquitetura-do-front-end.md)            | Arquitetura do front-end                                       | Aceita |
| [0014](0014-project-guard.md)                       | Project Guard como módulo de triagem dentro do CRM             | Aceita |
| [0015](0015-projeto-como-documento-versionado.md)   | Projeto de engenharia como documento versionado + snapshot     | Aceita |
| [0016](0016-regras-por-chave-escopo-e-avaliador.md) | Regras por chave, escopo e avaliador de condições              | Aceita |
| [0017](0017-catalogo-por-empresa.md)                | Catálogo de equipamentos por empresa, com governança           | Aceita |
| [0018](0018-central-de-dados-externos.md)           | Central de Dados Externos (proveniência e revisão humana)      | Aceita |
| [0019](0019-integration-hub.md)                     | Integration Hub (credenciais cifradas, adaptadores desligados) | Aceita |
| [0020](0020-modulo-operacao-e-instalacao.md)        | Módulo Operação e máquina de estados da instalação             | Aceita |
| [0021](0021-campo-offline-pwa.md)                   | Campo offline (PWA) e sincronização idempotente                | Aceita |
| [0022](0022-comissionamento-regra-e-travas.md)      | Comissionamento com regra versionada e aprovação travada       | Aceita |
| [0023](0023-pos-venda-planta-garantia-e-rotina.md)  | Pós-venda: planta, garantia por termo e rotina configurada     | Aceita |

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
