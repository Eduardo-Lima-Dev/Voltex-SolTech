# ADR-0025: Portal do cliente por link mágico

- **Status:** Aceita
- **Data:** 2026-10-23

## Contexto

O cliente precisa acompanhar o projeto (etapas, documentos, visitas, garantias, chamados, parcelas) sem criar senha e sem
entrar no sistema interno.

## Decisão

- Acesso por **link mágico** de uso único (`PortalMagicLink`), válido por 30 minutos, gerado por um usuário interno ou
  pedido pelo próprio cliente em `/portal/entrar`. A resposta do pedido é sempre a mesma, para não revelar se o e-mail existe.
- O link é trocado por uma **sessão própria** (`PortalSession`, 12 h, revogável) em cookie httpOnly e SameSite=Strict,
  separada do JWT interno. O portal só enxerga a conta do acesso.
- Token: `randomBytes(32)`; só o **hash SHA-256** é guardado.
- Envio de documentos pelo cliente fica em quarentena até um usuário interno aceitar.
- O registro de auditoria do acesso não guarda o e-mail do cliente.

## Consequências

- Sem senha para o cliente guardar; o risco passa a ser a caixa de e-mail dele (por isso o link vale pouco e uma vez).
- Revogar o acesso encerra as sessões abertas.

## Alternativas consideradas

- Conta com senha no sistema interno: rejeitada (mistura perfis e amplia a superfície).
- Link permanente: rejeitada (vaza para sempre se encaminhado).
