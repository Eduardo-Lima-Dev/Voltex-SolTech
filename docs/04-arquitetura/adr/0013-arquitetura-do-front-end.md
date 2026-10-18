# ADR-0013: Arquitetura do front-end

- **Status:** Aceita
- **Data:** 2026-10-18

## Contexto

O front é uma suíte com quatro produtos e uma área de administração, usada por equipes comerciais e técnicas em computador e celular. Precisa de login seguro com a API da [ADR-0011](0011-sessao-jwt-e-refresh-rotativo.md), carregamento rápido do login e telas que escondam o que o perfil não pode fazer.

## Decisão

- **Um único app React (Vite)** com rotas por produto, carregadas sob demanda (`lazy`) para o login abrir rápido; cada produto novo entra como mais um conjunto de rotas.
- **Mesma origem para a API:** o front chama `/api/v1`; em desenvolvimento o Vite encaminha para a API, em produção o nginx fará o mesmo. Assim o cookie de refresh funciona sem CORS. `VITE_API_URL` permite apontar para outro endereço.
- **Sessão:** access token **somente em memória**; refresh em cookie `httpOnly`; renovação automática em voo único ao receber 401; uma "dica de sessão" não secreta no `localStorage` evita chamadas de renovação inúteis. A interface esconde ações por permissão, mas a API continua sendo a barreira.
- **Dados do servidor com TanStack Query** (cache, invalidação por chaves centralizadas, repetição só para falhas de rede/5xx); **formulários com react-hook-form + Zod** reaproveitando os schemas de `@voltex/shared`.
- **Contratos compartilhados:** tipos de resposta, `ROUTES`, política de perfis e rótulos de domínio vêm de pacotes compartilhados ou de `i18n/labels.ts` (com teste de completude).
- **Interface:** `@voltex/ui` (Radix + Tailwind 4) com a paleta do logo; barra lateral sempre azul-marinho; tema claro/escuro/sistema.
- **Versões:** React Router **8** (o plano citava a 7; a API de rotas é a mesma) e Vite 8.
- **Testes:** Vitest + Testing Library + **MSW** (API simulada na rede), com falha para requisição sem handler; verificação manual no navegador e e2e automatizado na Fase 8.

## Consequências

- Trocar de rota nunca recarrega a sessão (ela vive na memória) e recarregar a página restaura a sessão pelo cookie.
- O front depende de `/api` estar na mesma origem em produção (nginx na Fase 8) ou de `CORS_ORIGIN` configurado na API.
- Adicionar uma permissão exige atualizar `PERMISSION_LABELS` (um teste falha se esquecer).
- Os produtos ainda mostram uma página "em desenvolvimento"; cada fase os substitui.

## Alternativas consideradas

Next.js/SSR (sem necessidade de SEO numa aplicação autenticada, mais complexidade de infraestrutura); um app por produto (fragmenta a experiência da suíte); access token em `localStorage` (exposto a XSS); Redux (TanStack Query cobre o estado de servidor e o estado local é pequeno).
