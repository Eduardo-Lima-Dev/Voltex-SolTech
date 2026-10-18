# Máquina de estados da oportunidade

Transições permitidas entre as etapas do pipeline padrão. A mesma máquina será implementada em `@voltex/shared` e validada na API. O pipeline é personalizável por tenant, mas as transições devem respeitar esta base.

```mermaid
stateDiagram-v2
    [*] --> NovoLead
    NovoLead --> Contato
    Contato --> Qualificacao
    Qualificacao --> AguardandoFatura
    AguardandoFatura --> PreDimensionamento
    PreDimensionamento --> Engenharia: complexidade técnica
    PreDimensionamento --> Cotacao: caso simples
    Engenharia --> Cotacao
    Cotacao --> PropostaPronta
    PropostaPronta --> PropostaEnviada
    PropostaEnviada --> Negociacao
    Negociacao --> CreditoContrato
    Negociacao --> Perdido
    CreditoContrato --> Ganho
    CreditoContrato --> Perdido
    Ganho --> [*]
    Perdido --> [*]
```

> Fonte: [modelagem completa](../../00-visao-geral/modelagem-completa.md), seção 10.
