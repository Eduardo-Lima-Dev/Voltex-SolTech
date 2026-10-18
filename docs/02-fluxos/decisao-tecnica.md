# Fluxo de decisão técnica

Define qual sistema é acionado a partir de uma oportunidade: Calculator (simples), Engine Studio (Grupo A, Grid Zero, híbrido, on-grid complexo) ou Off-Grid Designer.

```mermaid
flowchart TD
    A[Oportunidade no CRM] --> B[Solar Calculator]
    B --> C{Tipo de projeto}

    C -- On-grid simples --> D{Complexidade baixa?}
    D -- Sim --> E[Calculator Snapshot]
    D -- Não --> F[Solar Engine Studio]

    C -- Grupo A / Grid Zero / híbrido --> F
    C -- Off-grid --> G[Off-Grid Designer]

    F --> H[Engineering Snapshot aprovado]
    G --> I[Off-Grid Snapshot aprovado]

    E --> J[CRM: cotação + margem]
    H --> J
    I --> J
```

> Fonte: [modelagem completa](../00-visao-geral/modelagem-completa.md), seção 30.
