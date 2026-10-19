# Fluxo do Solar Calculator

Sessão de cálculo rápido, do cliente/endereço até o snapshot e o envio ao CRM. O semáforo decide se a proposta segue, vai para engenharia ou é bloqueada.

```mermaid
flowchart TD
    A[Nova sessão] --> B[Cliente / endereço]
    B --> C[Conta ou consumo]
    C --> D[Tarifa e concessionária]
    D --> E[Recurso solar]
    E --> F[Premissas de perdas]
    F --> G[Dimensionamento preliminar]
    G --> H[Estimativa de geração]
    H --> I[Economia e payback]
    I --> J[Validações]
    J --> K{Semáforo}
    K -- Verde --> L[Salvar Snapshot]
    K -- Amarelo --> M[Solicitar Engine Studio]
    K -- Vermelho --> N[Bloquear proposta definitiva]
    L --> O[Enviar resultados ao CRM]
    M --> O
    N --> O
```

> Fonte: [modelagem completa](../00-visao-geral/modelagem-completa.md), seção 15.
