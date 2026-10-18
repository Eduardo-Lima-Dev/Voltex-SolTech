# Arquitetura lógica

A modelagem original (seção 59) descreve quatro backends e serviços compartilhados. Na implementação, seguimos a recomendação da seção 58: **modular monolith** — uma única API NestJS, com um módulo por produto e módulos de plataforma, separados por fronteiras explícitas e prontos para extração futura. Veja [ADR-0002](../04-arquitetura/adr/0002-modular-monolith.md).

## Visão implementada

```mermaid
flowchart TB
    subgraph WEB[apps/web — React]
        SUITE[Suíte: shell + login + navegação]
        FCRM[features/crm]
        FCALC[features/calculator]
        FENG[features/engine]
        FOFF[features/offgrid]
        FADM[features/admin]
    end

    subgraph API[apps/api — NestJS /api/v1]
        subgraph PRODUCTS[products/]
            CRM[crm]
            CALC[calculator]
            ENG[engine]
            OFF[offgrid]
        end
        subgraph PLATFORM[platform/]
            AUTH[auth + users + RBAC]
            TEN[tenancy]
            RULES[rules]
            CAT[catalog]
            DOCS[documents]
            EVT[events + outbox]
            AUD[audit]
        end
    end

    subgraph PKG[packages/]
        SHARED[shared: enums, schemas Zod, eventos]
        SENG[solar-engine: cálculos puros]
        DB[database: Prisma]
        UI[ui: design system]
    end

    subgraph INFRA[Infraestrutura]
        PG[(PostgreSQL)]
        REDIS[(Redis / BullMQ)]
        S3[(MinIO / S3)]
    end

    FCRM & FCALC & FENG & FOFF & FADM --> API
    WEB --> SHARED & SENG & UI
    PRODUCTS --> PLATFORM
    API --> SHARED & SENG & DB
    DB --> PG
    EVT --> REDIS
    DOCS --> S3
```

## Regras de dependência

- `apps/*` dependem de `packages/*`; `packages/*` nunca dependem de `apps/*`.
- `@voltex/shared` e `@voltex/solar-engine` **não** dependem de Nest, React nem Prisma.
- Somente `apps/api` importa `@voltex/database` (Prisma). O front usa tipos/enums de `@voltex/shared`.
- Módulos de `products/*` não importam uns aos outros diretamente: a comunicação é por **eventos de domínio** ou por **contratos públicos** (serviços exportados explicitamente).
- Módulos de `products/*` podem usar `platform/*`; o inverso não é permitido.

## Visão original (modelagem)

Para referência, a arquitetura-alvo completa com serviços independentes:

```mermaid
flowchart TB
    subgraph FRONT[Frontends]
        WEBCRM[CRM Web]
        WEBCALC[Calculator Web]
        WEBENG[Engine Web]
        WEBOFF[Off-Grid Web]
        FIELD[Field PWA]
        PORTAL[Customer Portal]
    end

    subgraph BFF[API / BFF]
        APIGW[API Gateway]
    end

    subgraph PRODUCTS[Product Backends]
        CRMSVC[CRM Service]
        CALCSVC[Calculator Service]
        ENGSVC[Engine Service]
        OFFSVC[Off-Grid Service]
    end

    subgraph SHARED[Shared Services]
        IAM[Identity / Tenant]
        RULES[Rules Engine]
        CAT[Catalog]
        DOC[Documents]
        AI[AI Orchestrator]
        INT[Integration Hub]
        NOTIF[Notifications]
        AUDIT[Audit]
    end

    subgraph DATA[Data]
        CRMDB[(CRM DB)]
        CALCDB[(Calc DB)]
        ENGDB[(Engineering DB)]
        OFFDB[(OffGrid DB)]
        OBJ[(Object Storage)]
        BUS[(Event Bus)]
        WH[(Analytics Warehouse)]
    end

    FRONT --> APIGW
    APIGW --> PRODUCTS

    CRMSVC --> CRMDB
    CALCSVC --> CALCDB
    ENGSVC --> ENGDB
    OFFSVC --> OFFDB

    PRODUCTS --> IAM
    PRODUCTS --> RULES
    PRODUCTS --> CAT
    PRODUCTS --> DOC
    PRODUCTS --> AI
    PRODUCTS --> INT
    PRODUCTS --> NOTIF
    PRODUCTS --> AUDIT

    DOC --> OBJ
    PRODUCTS <--> BUS
    BUS --> WH
```
