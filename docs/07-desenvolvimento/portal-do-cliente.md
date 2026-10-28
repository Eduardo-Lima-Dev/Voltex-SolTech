# Portal do cliente

Decisão: [ADR-0025](../04-arquitetura/adr/0025-portal-do-cliente-link-magico.md).

## Fluxo interno

Ficha do cliente → cartão **Portal do cliente** → liberar o acesso para um e-mail → **Gerar link** → enviar por
e-mail, WhatsApp (wa.me, sem API) ou copiar. Cada envio grava `CommunicationLog`. O link vale 30 minutos e abre uma vez.

## Fluxo do cliente

`/portal/acesso/:token` troca o link pela sessão e abre **Meus projetos**: etapas, visitas, garantias, chamados,
parcelas (só consulta) e envio de documentos. Sem o link, o cliente pede um novo em `/portal/entrar`.

## Revisão de envios

Arquivos enviados pelo cliente ficam em quarentena; um usuário interno aceita ou recusa (permissão
`crm.portal.manage`).
