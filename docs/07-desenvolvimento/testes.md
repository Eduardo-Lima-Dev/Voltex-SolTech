# Testes

| Camada               | Ferramenta                     | Como rodar                           | O que cobre                                                                        |
| -------------------- | ------------------------------ | ------------------------------------ | ---------------------------------------------------------------------------------- |
| Pacotes e API (unit) | Vitest                         | `pnpm test`                          | Motor de cálculo, schemas, regras puras, criptografia, serviços sem banco          |
| Web                  | Vitest + Testing Library + MSW | `pnpm test`                          | Telas, formulários e permissões, com a API simulada                                |
| API (e2e)            | Vitest + Supertest             | `pnpm --filter @voltex/api test:e2e` | A API inteira contra Postgres/Redis/S3 reais: isolamento de empresas, RBAC, fluxos |
| Navegador (e2e)      | Playwright (Chromium)          | `pnpm test:browser`                  | Fluxos críticos pela interface, com API e front reais                              |

## Navegador (`apps/e2e`)

- Pré-requisitos: `pnpm setup` (infra no ar), `pnpm build` e, uma vez, `pnpm --filter @voltex/e2e exec playwright install chromium`.
- Usa um banco **próprio** (`voltex_e2e`, recriado a cada execução com migrations e os usuários de demonstração) e sobe a API compilada na porta 3100 e o front (`vite preview`) na 4173. Nunca toca o banco de desenvolvimento.
- Cobre: login e permissões; cálculo no Solar Calculator; lead → conversão → funil; triagem → cotação com margem → proposta → aceite do cliente pelo link público; pedido e aprovação de margem por perfis diferentes; contrato → assinatura → ganho e projeto → checklist → protocolo; painel.
- Os dados de apoio (faturas, contratos assinados) são **sintéticos**. Falhas guardam screenshot e _trace_ em `test-results/`.

## Cuidados que já custaram tempo

- Os e2e da API compartilham um banco e um **outbox**: ao entregar eventos, passe o `tenantId` (`publishPending(500, tenantId)`) para não consumir eventos de outro teste.
- Em testes de tela, requisições que escapam de um teste podem aparecer no seguinte: espere a navegação terminar e registre os `server.use` depois dos padrões.
- O jsdom não serializa `multipart` de forma confiável: teste o envio de arquivos espionando a função do cliente.
