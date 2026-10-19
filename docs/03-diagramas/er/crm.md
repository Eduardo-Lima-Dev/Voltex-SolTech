# Modelo de entidades do CRM

Entidades principais do CRM Solar (conceitual). O modelo físico real fica em `packages/database/prisma/schema` e será exportado para cá (Fase 3).

```mermaid
erDiagram
    TENANT ||--o{ USER : possui
    TENANT ||--o{ ACCOUNT : possui
    ACCOUNT ||--o{ CONTACT : possui
    ACCOUNT ||--o{ SITE : possui
    ACCOUNT ||--o{ OPPORTUNITY : gera
    SITE ||--o{ ENERGY_BILL : recebe
    OPPORTUNITY ||--o{ CALCULATION_LINK : possui
    OPPORTUNITY ||--o{ QUOTE : possui
    OPPORTUNITY ||--o{ PROPOSAL : possui
    OPPORTUNITY ||--o| CONTRACT : fecha
    OPPORTUNITY ||--o| PROJECT : converte
    PROJECT ||--o{ HOMOLOGATION_CASE : possui
    PROJECT ||--o{ WORK_ORDER : possui
    PROJECT ||--o| PLANT : gera
    PLANT ||--o{ ASSET : possui
    PLANT ||--o{ MAINTENANCE_TICKET : possui
    PLANT ||--o{ OM_CONTRACT : possui
    PROJECT ||--o{ DOCUMENT : possui
    OPPORTUNITY ||--o{ TIMELINE_EVENT : registra
```

> Fonte: [modelagem completa](../../00-visao-geral/modelagem-completa.md), seção 34.
