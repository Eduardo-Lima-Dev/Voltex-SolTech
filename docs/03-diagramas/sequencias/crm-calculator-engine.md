# Sequência CRM → Calculator → Engine

Interação entre vendedor, CRM, OCR, Calculator, Engine Studio e Rules Engine, com os dois caminhos (caso simples e engenharia necessária).

```mermaid
sequenceDiagram
    actor V as Vendedor
    participant CRM as CRM Solar
    participant OCR as OCR Service
    participant CALC as Solar Calculator
    participant ENG as Solar Engine Studio
    participant RULE as Rules Engine

    V->>CRM: Anexa conta de energia
    CRM->>OCR: Parse da fatura
    OCR-->>CRM: Dados + confiança
    V->>CRM: Confirma campos
    CRM->>CALC: Criar cálculo preliminar
    CALC->>RULE: Solicitar regras vigentes
    RULE-->>CALC: RuleSet versionado
    CALC-->>CRM: Resultado + semáforo

    alt Caso simples
        CRM-->>V: Liberar cotação/proposta
    else Engenharia necessária
        CRM->>ENG: Criar Engineering Request
        ENG->>RULE: Regras e validações
        RULE-->>ENG: RuleSet
        ENG-->>CRM: Engineering Snapshot aprovado
        CRM-->>V: Liberar cotação/proposta
    end
```

> Fonte: [modelagem completa](../../00-visao-geral/modelagem-completa.md), seção 31.
