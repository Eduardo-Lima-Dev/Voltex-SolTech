# Páginas de privacidade e termos de uso

Páginas públicas do site: `/privacidade` e `/termos` (arquivos `apps/site/privacidade.html` e `termos.html`). Há links no rodapé do site, no consentimento do formulário e na tela de entrada da aplicação (quando `VITE_SITE_URL` está definido).

## O que elas dizem

- **Política de Privacidade (LGPD):** papéis (a Voltex SolTech é **controladora** dos contatos do site e dos usuários, e **operadora** dos dados dos clientes de cada empresa contratante), dados tratados, finalidades e bases legais (art. 7º), compartilhamento e transferência internacional (art. 33), segurança, retenção, direitos do titular (art. 18), cookies, encarregado e incidentes (art. 48). Os fatos técnicos (cifra AES-256-GCM, Argon2, retenção mínima de 5 anos para contratos, cookie de sessão) vêm de [seguranca-lgpd.md](seguranca-lgpd.md).
- **Termos de Uso:** a plataforma é **ferramenta de apoio**; **ações e decisões são de responsabilidade exclusiva de quem usa**; não é serviço de engenharia, não assina projeto nem emite ART/TRT/RRT; regras e valores de "teste interno" não valem para obra; dados de terceiros "como disponibilizados"; limitação de responsabilidade; responsabilidade da empresa contratante; lei e foro.

## O que a empresa precisa informar antes de publicar

Os campos abaixo vêm do ambiente na compilação do site. Enquanto faltarem, a página mostra o aviso amarelo "a informar":

| Variável                   | Conteúdo                          |
| -------------------------- | --------------------------------- |
| `VITE_LEGAL_COMPANY`       | Razão social                      |
| `VITE_LEGAL_CNPJ`          | CNPJ                              |
| `VITE_LEGAL_ADDRESS`       | Endereço da sede                  |
| `VITE_LEGAL_PRIVACY_EMAIL` | E-mail para pedidos dos titulares |
| `VITE_LEGAL_DPO`           | Nome do encarregado (DPO)         |
| `VITE_LEGAL_FORUM`         | Comarca do foro                   |

## Na publicação automática

O workflow `deploy-demo.yml` repassa `LEGAL_COMPANY`, `LEGAL_CNPJ`, `LEGAL_ADDRESS`, `LEGAL_PRIVACY_EMAIL`, `LEGAL_DPO` e `LEGAL_FORUM` (variáveis do ambiente `demo` do GitHub) para `scripts/publicar-front.sh site`, que as grava como `VITE_LEGAL_*` na compilação. Sem valor, a página mostra "a informar". Para publicar à mão: `LEGAL_COMPANY=... APP_URL=... ./scripts/publicar-front.sh site <host-da-api>`.

## Limites

- Estes textos foram escritos a partir da legislação e do que o sistema faz hoje. **Não são parecer jurídico e não garantem, sozinhos, proteção contra qualquer reclamação.** Peça a um advogado que revise antes de usar com clientes reais, em especial: bases legais, cláusula de limitação de responsabilidade, foro, relação de consumo (CDC) quando o contratante for pessoa física, e contrato de operador entre a plataforma e cada empresa.
- A lista de provedores de infraestrutura (Vercel, Render, Supabase, Upstash) é a da demonstração atual. **Atualize a política** se a hospedagem de produção for outra.
- Mudou o que o sistema coleta, guarda ou compartilha? Atualize o texto, a versão e a data no topo das duas páginas.
