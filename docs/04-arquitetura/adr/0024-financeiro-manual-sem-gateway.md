# ADR-0024: Financeiro manual, sem gateway de pagamento

**Status:** Accepted (2026-10-23)

**Context**

A cobrança de contratos é complexa: requer integração com gateways (Stripe, PayPal), tratamento de falhas, reembolsos, prescrição e contabilidade. Na fase inicial (MVP2), o foco é no fluxo técnico do projeto, não no fluxo financeiro.

**Decision**

O módulo de financeiro registra recebíveis (parcelas), custos reais e crédito de forma manual:

1. **Recebíveis**: criadas pela empresa (número de NF, data, valor). Status: OPEN → PAID → OVERDUE → CANCELLED. Sem webhook de pagamento.
2. **Custos**: registro manual de material, mão de obra, transporte. Previsto × realizado.
3. **Crédito**: simulação de financiamento com cálculo de juros. Sem integração com instituição — é só registro e acompanhamento de status (SIMULATED → SENT → PENDING → APPROVED/REJECTED).
4. **Comissão**: política por empresa (base RECEBIDO ou ASSINADO, % por perfil). Cálculo manual, sem automação de pagamento.

**Rationale**

- **Simplicidade:** evita dependência de gateway, reduz attack surface (PCI).
- **Flexibilidade:** cada empresa pode usar seu próprio sistema de pagamento, integração bancária ou operador de crédito.
- **Conformidade:** sem dados de cartão ou conta no sistema.

**Consequences**

- Recebimento é manual: o operador marca a parcela como paga após conferir transferência/boleto.
- Crédito é um registro de intenção, não uma integração ativa. A aprovação/rejeição vem de fora (e-mail, sistema do banco).
- Comissão é calculada mas não paga automaticamente.
- Relatórios financeiros dependem desse registro manual ser preciso (auditoria importante).

**Related**

- RF-PLAT-016: cobrança unificada (Fase 13, fora do escopo).
- 11G: Financeiro por projeto.
