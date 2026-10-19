# Diagrama de contexto do ecossistema

Visão de contexto (C4 nível 1): quem usa a suíte, os quatro produtos e os serviços compartilhados.

```mermaid
flowchart TB
    subgraph CLIENTE[Empresa Integradora]
        SALES[Comercial / SDR]
        ENG[Engenharia]
        OPS[Operações / Instalação]
        FIN[Financeiro]
        OM[Pós-venda / O&M]
        MGMT[Gestão]
    end

    subgraph SUITE[Ecossistema Hydra Solar]
        CRM[CRM Solar]
        CALC[Solar Calculator]
        ENGINE[Solar Engine Studio]
        OFFGRID[Off-Grid Designer]

        RULES[Rules Engine]
        CATALOG[Catálogo Técnico]
        DOCS[Document Service]
        AI[AI Orchestrator]
        HUB[Integration Hub]
        DATA[Data Platform]
    end

    SALES --> CRM
    SALES --> CALC
    ENG --> ENGINE
    ENG --> OFFGRID
    OPS --> CRM
    FIN --> CRM
    OM --> CRM
    MGMT --> CRM
    MGMT --> DATA

    CRM <--> CALC
    CRM <--> ENGINE
    CRM <--> OFFGRID

    CALC --> RULES
    ENGINE --> RULES
    OFFGRID --> RULES

    CALC --> CATALOG
    ENGINE --> CATALOG
    OFFGRID --> CATALOG

    CRM --> DOCS
    ENGINE --> DOCS
    OFFGRID --> DOCS

    CRM <--> AI
    CALC <--> AI
    ENGINE <--> AI
    OFFGRID <--> AI

    CRM <--> HUB
    CALC <--> HUB
    ENGINE <--> HUB
    OFFGRID <--> HUB

    CRM --> DATA
    CALC --> DATA
    ENGINE --> DATA
    OFFGRID --> DATA
```

> Fonte: [modelagem completa](../00-visao-geral/modelagem-completa.md), seção 4.
