# Fluxo do Off-Grid Designer

Começa pela carga (e não pela conta de energia) e termina no snapshot off-grid publicado para o CRM.

```mermaid
flowchart TD
    A[Novo projeto off-grid] --> B[Cadastrar cargas]
    B --> C[Gerar perfil de carga]
    C --> D[Separar cargas críticas]
    D --> E[Definir autonomia]
    E --> F[Recurso solar / HSP]
    F --> G[Dimensionar arranjo FV]
    G --> H[Dimensionar banco de baterias]
    H --> I[Selecionar inversor]
    I --> J[Selecionar controlador]
    J --> K{Necessita gerador?}
    K -- Sim --> L[Dimensionar backup]
    K -- Não --> M[Simulação]
    L --> M
    M --> N[Stress test sazonal]
    N --> O[CAPEX / OPEX]
    O --> P[Comparar cenários]
    P --> Q[Validação técnica]
    Q --> R[Gerar relatório]
    R --> S[Publicar snapshot para CRM]
```

> Fonte: [modelagem completa](../00-visao-geral/modelagem-completa.md), seção 29.
