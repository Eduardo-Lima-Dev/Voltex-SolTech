# Site de apresentação (landing page)

O site fica em `apps/site` e é **separado da aplicação** (`apps/web`): outro endereço, outra imagem Docker, outra publicação. Os dois se ligam por endereços configurados no ambiente.

```
www.suaempresa.com.br   →  site (apresentação, formulário de contato)
app.suaempresa.com.br   →  aplicação (login, CRM, calculadora…)
```

## Como se conectam

| De → Para               | Como                                                                                                                                                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Site → aplicação        | Os botões **Entrar** levam a `{VITE_APP_URL}/login`.                                                                                                                                                                                                          |
| Aplicação → site        | Se `VITE_SITE_URL` estiver definido, a tela de entrada mostra o logo e o link **Voltar ao site**.                                                                                                                                                             |
| Site → CRM (formulário) | O formulário de contato envia para `POST /api/v1/public/leads/{chave}`, o mesmo endereço de captação que qualquer empresa usa no próprio site. O contato chega como **lead** na empresa dona da chave, com os campos de campanha (`utm_*`) da URL de entrada. |

O site chama a API **na mesma origem**: em desenvolvimento o Vite encaminha `/api`; em produção o nginx do site encaminha **só** `/api/v1/public/leads/` para a API. Nada mais da API fica exposto pelo site, e não precisa de CORS.

## Variáveis (`.env` da raiz; veja também [variáveis de ambiente](variaveis-de-ambiente.md))

| Variável        | Onde vale | Para quê                                                                                                                                                                                      |
| --------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_APP_URL`  | site      | Endereço da aplicação. Padrão em dev: `http://localhost:5173`. Gravado na **compilação**.                                                                                                     |
| `VITE_SITE_URL` | web       | Endereço do site, para o "Voltar ao site". Opcional.                                                                                                                                          |
| `VITE_LEAD_KEY` | site      | Chave de captação da empresa que recebe os contatos. Sem ela o formulário avisa que não pôde enviar.                                                                                          |
| `VITE_LEGAL_*`  | site      | Dados da empresa nas páginas `/privacidade` e `/termos` (`COMPANY`, `CNPJ`, `ADDRESS`, `PRIVACY_EMAIL`, `DPO`, `FORUM`). Gravados na **compilação**; sem valor, a página mostra "a informar". |
| `SITE_PORT`     | compose   | Porta do host do site em produção (padrão 8081).                                                                                                                                              |
| `SITE_LEAD_KEY` | compose   | Valor de `VITE_LEAD_KEY` na imagem de produção.                                                                                                                                               |

Para receber os contatos: crie a empresa dona da plataforma (`create-owner`), entre no CRM Solar → Leads, copie a chave de captação e coloque em `VITE_LEAD_KEY` (dev) ou `SITE_LEAD_KEY` (produção). Como `VITE_*` é gravada na compilação, **gere a imagem de novo** ao trocar um endereço ou a chave.

## Desenvolvimento

`pnpm dev` já sobe o site em `http://localhost:5174` junto com a aplicação (5173) e a API (3000). Sozinho: `pnpm --filter @voltex/site dev`.

## Produção

`pnpm docker:build && pnpm docker:up` inclui o serviço `site` (porta `SITE_PORT`, padrão 8081). Aponte o domínio principal para ele e o subdomínio da aplicação para o serviço `web`, cada um com o seu certificado/proxy reverso. `WEB_URL` precisa ser o endereço público da **aplicação**: é com ele que o site monta o botão Entrar.

## Como o site é feito

- Vite + TypeScript puro, sem framework: o conteúdo está em `index.html` e o visual em `src/styles.css` (cores e fonte da [identidade visual](../00-visao-geral/identidade-visual.md)).
- Animações com **GSAP** (`ScrollTrigger`, `SplitText`, `DrawSVG`, `Flip`): arco do sol e títulos na abertura, quadro de exemplo com cartão que muda de coluna sozinho, seção "O caminho de um negócio" fixa durante a rolagem, simulação de margem e perguntas que abrem com altura animada.
- Respeita `prefers-reduced-motion`: sem animação, o conteúdo aparece completo e parado. Em telas estreitas a seção do caminho vira uma lista simples.
- Os números das telas de exemplo (valores, nomes, kWp) são **ilustrativos**, e a página avisa isso onde aparecem. O site não traz depoimentos, preços nem métricas de clientes: só entram quando houver fonte real.
- Testes: `apps/site/src/config.test.ts` (endereços e campanhas) e `apps/e2e/tests/site.spec.ts` (Entrar, perguntas, margem e formulário).
