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

## Jornadas completas, com vídeo e relatório

Além dos testes de ponta a ponta por assunto, há **jornadas completas** que percorrem o caminho de um negócio pela tela, do jeito que uma pessoa faria, e deixam **vídeo e uma captura de cada passo** para conferência.

```bash
cd apps/e2e
pnpm jornada                       # roda a jornada (cerca de 40 s, sem abrir janela)
pnpm jornada:relatorio             # abre o relatório no navegador
SLOWMO=400 pnpm jornada --headed   # abre o navegador na sua frente, mais devagar
```

O relatório (`apps/e2e/relatorio-jornada/`, não versionado) mostra cada passo com o resultado, as capturas e o vídeo. Se um passo falha, o relatório guarda também a gravação passo a passo (`trace`). A jornada usa o banco de testes (`voltex_e2e`), recriado a cada execução, e nunca o de desenvolvimento. Antes de rodar, compile tudo com `pnpm build`.

### Jornada do integrador (`tests/jornada-integrador.spec.ts`)

Só pela tela; a API prepara apenas o que o gestor da empresa já teria feito antes (política de margem e concessionária).

1. **Visitante:** abre o site e envia o formulário de contato (o site de teste é compilado com a chave de captação do banco de teste).
2. Clica em **Entrar** e chega na tela de entrada da aplicação.
3. **Vendedor:** entra e encontra o contato como lead; converte em conta e oportunidade.
4. Cadastra **imóvel e unidade consumidora** na conta, liga à oportunidade e avança até Fatura pendente.
5. Envia a **fatura**, confere a leitura e valida; calcula a **viabilidade** já com os dados da fatura.
6. Faz a **triagem**, monta a **cotação** (margem baixa é avisada e corrigida), gera a **proposta** e envia o link.
7. **Cliente:** abre o link sem login, confere que não vê margem nem comissão, e **aceita**.
8. **Administradora:** gera o **contrato**, registra a **assinatura**; o **projeto** nasce com o mesmo código.
9. Resolve o checklist, **protocola na distribuidora**; a oportunidade fica **Ganha** e aparece no painel.

O vendedor não escreve contrato (regra do produto), por isso a segunda metade é da administradora. O `pnpm test:browser` (e a CI) roda só o projeto `chromium`; a jornada é separada para não gravar vídeo toda vez.
