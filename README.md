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
pnpm setup   # instala dependências, sobe a infra, migra e popula o banco
pnpm dev     # sobe infra (Docker) + API + Web
```

> `pnpm setup` e a infra Docker ficam disponíveis a partir da Fase 3 do [roadmap](docs/09-roadmap/).

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
