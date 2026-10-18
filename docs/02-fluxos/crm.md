# Fluxo principal do CRM

Do recebimento do lead até o pós-venda/O&M, passando pelo Solar Calculator, pela engenharia (quando necessária), cotação com margem, proposta, contrato e projeto.

```mermaid
flowchart LR
    A[Lead recebido] --> B[Deduplicar e enriquecer]
    B --> C[Qualificação]
    C --> D{Conta de energia disponível?}
    D -- Não --> E[Solicitar fatura]
    E --> D
    D -- Sim --> F[OCR + validação]
    F --> G[Solar Calculator]
    G --> H{Pré-viável?}
    H -- Não --> I[Registrar motivo / nutrir / perder]
    H -- Sim --> J{Exige engenharia avançada?}
    J -- Não --> K[Cotação e margem]
    J -- Sim --> L[Solar Engine Studio]
    L --> K
    K --> M[Gerar proposta]
    M --> N[Enviar e rastrear]
    N --> O{Cliente aprovou?}
    O -- Não --> P[Follow-up / revisão]
    P --> M
    O -- Sim --> Q[Crédito e contrato]
    Q --> R[Deal Won]
    R --> S[Projeto + homologação]
    S --> T[Compras / logística]
    T --> U[Instalação]
    U --> V[Comissionamento]
    V --> W[Aceite]
    W --> X[Pós-venda / O&M]
```

> Fonte: [modelagem completa](../00-visao-geral/modelagem-completa.md), seção 9.
