# Voltex SolTech

Suíte de software para integradores fotovoltaicos, reunindo quatro produtos sobre uma plataforma compartilhada:

- **CRM Solar** — comercial, propostas, contratos, projetos e pós-venda
- **Solar Calculator** — pré-viabilidade e proposta comercial rápida
- **Solar Engine Studio** — projeto e validação técnica fotovoltaica
- **Off-Grid Designer** — dimensionamento de sistemas isolados e com armazenamento

## Stack

Monorepo **Turborepo + pnpm** · **NestJS** (API) · **PostgreSQL + Prisma** · **React + Vite** (web) · **Docker**

## Pré-requisitos

- Node.js >= 24 (`.nvmrc`)
- pnpm >= 9
- Docker + Docker Compose

## Como rodar

```bash
pnpm setup   # cria o .env, instala, sobe a infra, aplica as migrations e popula o banco
pnpm dev     # sobe a infra (Docker) e os apps/pacotes em modo watch
```

> Hoje `pnpm dev` sobe a infra (PostgreSQL, Redis, S3 local, Mailpit) e os watchers dos pacotes; API e Web entram nas Fases 4 e 5 do [roadmap](docs/09-roadmap/roadmap.md). Detalhes em [setup local](docs/07-desenvolvimento/setup-local.md).

## Estrutura

```
apps/       aplicações (api, web)
packages/   código compartilhado (shared, solar-engine, database, ui, configs)
docs/       documentação (requisitos, fluxos, diagramas, arquitetura, API, cálculos)
docker/     composições Docker (dev e produção)
```

## Fluxo de desenvolvimento

Branches: `develop` (desenvolvimento) → `homologate` (homologação) → `main` (produção).

- Novas funcionalidades partem de `develop` em branches `feat/...`, `fix/...`, `chore/...`.
- `develop` é promovida para `homologate`, e `homologate` para `main`, somente via pull request.
- Commits seguem [Conventional Commits](https://www.conventionalcommits.org/pt-br/) (validado por commitlint).
