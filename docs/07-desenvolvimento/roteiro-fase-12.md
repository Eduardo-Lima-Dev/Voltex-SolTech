# Roteiro de teste — Fase 12 (assistente de IA)

Para ver o assistente funcionando na tela, sem gastar a cota da Cloudflare, use o **provedor de demonstração**. Ele escolhe a ferramenta por palavra-chave e escreve uma resposta curta: serve para ver telas, fontes e estados, **não** para avaliar a inteligência. Para avaliar a qualidade de verdade, use `AI_PROVIDER=cloudflare` (veja [assistente-ia.md](assistente-ia.md)).

## Preparar

1. No `.env`: `AI_ENABLED=true` e `AI_PROVIDER=demo` (ou `cloudflare` com as credenciais).
2. `pnpm db:deploy` (aplica as migrations da Fase 12) e `pnpm dev`.
3. A empresa `voltex-demo` já está marcada como demonstração. Se não estiver:
   `TENANT_SLUG=voltex-demo DEMO=true ENABLED=true node apps/api/dist/cli/set-tenant-ai.js` (depois de `pnpm build`).

## Passo a passo

1. **Ligar a IA.** Entre como proprietário e abra Administração → Inteligência. Confira o selo "Empresa de demonstração", marque o aceite dos termos e clique em "Ligar a IA". Clique em "Testar a IA": deve mostrar o tempo e o custo.
2. **Perguntar.** Clique em "Pergunte ao Voltex" no cabeçalho. Pergunte "Quanto está vencido nas parcelas?". Confira: progresso, resposta com valores destacados, selo "Gerado por IA…".
3. **Fonte dos valores.** Clique num valor destacado: aparece a consulta, o campo e a hora. Clique em "Ver os dados" para a lista completa.
4. **Avaliar.** Clique em "Resposta útil"; depois em "Resposta não útil" e escreva um motivo.
5. **Recusa padrão.** Pergunte "Escreva um poema sobre o sol": o sistema responde com a recusa fixa, sem inventar.
6. **Dado pessoal.** Pergunte incluindo um CPF ou e-mail: a resposta vem com o aviso "Removi … da sua pergunta", e o dado nunca vai ao modelo.
7. **Perfil.** Entre como vendedor e pergunte sobre financeiro: recusa por falta de acesso. Pergunte sobre o funil: só vê a própria carteira.
8. **Histórico.** Abra "Histórico", reabra uma conversa e apague outra.
9. **Copiloto.** Abra Operação → Financeiro e clique em "Resumir com IA": o painel abre com a pergunta já enviada. Repita na ficha de um projeto e de uma planta.
10. **Indisponível.** Em Inteligência, desligue a IA: o painel passa a mostrar a mensagem de indisponibilidade e bloqueia o envio.
11. **Teclado e leitor de tela.** O painel abre e fecha com o teclado (Esc fecha), Enter envia (Shift+Enter quebra a linha) e a conversa é anunciada como região de log.

## Automatizado

- `pnpm test:e2e` (API: assistente, ferramentas, avaliação simulada de 70 perguntas).
- `pnpm --filter @voltex/web test` (painel e Inteligência).
- `pnpm jornada` → `jornada-ia.spec.ts` (relatório com capturas: `pnpm jornada:relatorio`).
