# Fluxo do Solar Engine Studio

Do projeto técnico até a publicação do snapshot de engenharia aprovado para o CRM.

```mermaid
flowchart TD
    A[Projeto técnico criado] --> B[Local + concessionária]
    B --> C[Recurso solar]
    C --> D[Superfície / telhado]
    D --> E[Orientação + inclinação + obstáculos]
    E --> F[Selecionar módulo]
    F --> G[Gerar layout]
    G --> H[Selecionar inversor]
    H --> I[String Designer]
    I --> J[Compatibility Engine]
    J --> K{Configuração válida?}
    K -- Não --> L[Ajustar equipamentos / strings]
    L --> I
    K -- Sim --> M[Proteções e cabos]
    M --> N[Simulação energética]
    N --> O[Grid / regras de conexão]
    O --> P[Viabilidade econômica]
    P --> Q[Compliance checks]
    Q --> R{Aprovado tecnicamente?}
    R -- Não --> S[Pendências técnicas]
    S --> D
    R -- Sim --> T[Congelar versão técnica]
    T --> U[Gerar relatórios]
    U --> V[Publicar snapshot para CRM]
```

> Fonte: [modelagem completa](../00-visao-geral/modelagem-completa.md), seção 18.
