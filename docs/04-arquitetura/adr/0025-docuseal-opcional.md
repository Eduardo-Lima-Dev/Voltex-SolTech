# ADR-0025: Assinatura DocuSeal (opcional, desligado)

**Status:** Proposed (2026-10-23)

**Context**

Contratos precisam ser assinados para valer. A validação jurídica requer assinatura eletrônica.
DocuSeal é AGPL, auto-hospedado, gratuito. A integração será opcional e desligada por padrão,
porque a validade jurídica (MP 2.200-2/2001, art. 10, §2º) depende da avaliação de um advogado.

**Decision**

1. Adaptador DocuSeal no Integration Hub (`kind: SIGNATURE`).
2. `ContractsService.sendForSignature()` chama a API DocuSeal com o PDF e e-mail do signatário.
3. Webhook DocuSeal ao concluir (assinado ou recusado) baixa o PDF assinado e chama `sign()`.
4. Contêiner `docuseal` em `docker/compose.prod.yml` como profile opcional.
5. Antes de ativar em produção: verificar que a edição livre da DocuSeal tem API e webhooks.

**Rationale**

- Sem gateway de pagamento, assinatura é o último passo antes de venda (projeto ativo).
- Auto-hospedado = dados dentro da empresa.
- AGPL = sem custo, mas aviso sobre validade jurídica é obrigação da integração.

**Consequences**

- Validade jurídica é responsabilidade do cliente (avogado).
- Falha de webhook requer reprocessamento manual.
- Custo de hospedagem (Render, AWS, etc).

**Related**

- 11I: Assinatura DocuSeal, MFA, lead scoring, wa.me
- ContractsService: `src/products/crm/contracts/contracts.service.ts`
