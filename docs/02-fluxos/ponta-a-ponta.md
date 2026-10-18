# Jornada ponta a ponta da integradora

Os 22 passos do Project Digital Thread: lead → oportunidade → cálculo → engenharia → cotação → proposta → contrato → homologação → instalação → comissionamento → O&M.

```mermaid
flowchart TB
    LEAD[1. Lead] --> QUAL[2. Qualificação]
    QUAL --> BILL[3. Fatura / OCR]
    BILL --> QUICK[4. Solar Calculator]
    QUICK --> DEC{5. Gate técnico}

    DEC -- Simples --> QUOTE[7. Cotação]
    DEC -- On-grid complexo --> ENG[6A. Solar Engine Studio]
    DEC -- Off-grid --> OFF[6B. Off-Grid Designer]

    ENG --> QUOTE
    OFF --> QUOTE

    QUOTE --> MARGIN[8. Margin Guard]
    MARGIN --> PROP[9. Proposta]
    PROP --> NEG[10. Negociação]
    NEG --> CREDIT[11. Crédito]
    CREDIT --> CONTRACT[12. Contrato]
    CONTRACT --> WON[13. Venda ganha]

    WON --> HOM[14. Engenharia final / homologação]
    HOM --> PROC[15. Procurement]
    PROC --> SCHED[16. Agendamento]
    SCHED --> INSTALL[17. Instalação]
    INSTALL --> COMM[18. Comissionamento]
    COMM --> ACCEPT[19. Aceite]
    ACCEPT --> PLANT[20. Planta ativa]
    PLANT --> OM[21. O&M]
    OM --> LIFE[22. Upsell / renovação / expansão]
```

> Fonte: [modelagem completa](../00-visao-geral/modelagem-completa.md), seção 75.
