# Deploy tipo 2: serviços gratuitos na nuvem (demonstração)

Coloca o sistema no ar **sem pagar**, usando planos gratuitos de vários serviços. Serve para **demonstrar e testar com dados fictícios**. Não é para cliente real (veja [Limites e riscos](#limites-e-riscos)). Alternativa totalmente sua: o [servidor de teste em casa](servidor-de-teste.md).

## Quem faz o quê

| Peça                                     | Serviço                             | Onde fica                                                           |
| ---------------------------------------- | ----------------------------------- | ------------------------------------------------------------------- |
| Aplicação (login, CRM, calculadora)      | **Vercel** (arquivos estáticos)     | `https://voltex-app.vercel.app` (o nome pode variar)                |
| Site de apresentação                     | **Vercel**                          | `https://voltex-site.vercel.app`                                    |
| API                                      | **Render** (plano Free, Docker)     | `https://voltex-api.onrender.com`                                   |
| Banco de dados                           | **Supabase** (Postgres)             | região mais próxima                                                 |
| Arquivos (contratos, propostas, faturas) | **Supabase Storage** (protocolo S3) | bucket privado                                                      |
| Filas e automações (Redis)               | **Upstash** (plano gratuito)        | `REDIS_URL` no formato `rediss://default:SENHA@host:6379` (com TLS) |

```mermaid
flowchart LR
  P[Pessoa] --> APP[Vercel: aplicação]
  P --> SITE[Vercel: site]
  APP -->|"/api" encaminhado| API[Render: API]
  SITE -->|"/api/v1/public/leads"| API
  API --> DB[(Supabase: Postgres)]
  API --> ST[(Supabase: Storage S3)]
  API --> RD[(Redis)]
```

**Por que a aplicação fala com a API pelo próprio endereço (e não direto na Render).** Aplicação e API ficam em "sites" diferentes. O navegador bloqueia o cookie de login entre sites. Por isso a Vercel **encaminha `/api` para a Render**, e o navegador só enxerga um endereço (`deploy/nuvem/vercel-app.json.template`).

## O que só você faz

1. **Criar as contas** (e-mail, verificação, às vezes cartão): Supabase, Render, Vercel e a do Redis escolhido.
2. **Entrar nas ferramentas** (`npx vercel login`, `supabase login`, `render login`) ou gerar **tokens** e colocá-los em variáveis de ambiente (**nunca** colar token em conversa ou em arquivo versionado).
3. **Aprovar cada publicação**: enviar código a um serviço de terceiros sai da sua máquina.
4. O que o serviço só deixar fazer pelo painel (por exemplo, conectar uma conta de código).

## O que já está pronto no projeto

| Arquivo                                                               | Para quê                                                                                                                                  |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `render.yaml`                                                         | Descrição da API para a Render (Docker, plano Free, verificação de saúde, lista de variáveis; os segredos ficam em branco).               |
| `deploy/nuvem/vercel-app.json.template` / `vercel-site.json.template` | Configuração da Vercel: encaminhamento de `/api`, cabeçalhos de segurança, cache.                                                         |
| `scripts/publicar-front.sh`                                           | Compila a aplicação ou o site com os endereços certos e envia para a Vercel **sem passar pelo GitHub**. `--so-preparar` só monta a pasta. |
| `apps/api/src/cli/check-storage.ts`                                   | Testa o armazenamento S3 com as mesmas operações da API. Rode `node dist/cli/check-storage.js` com as variáveis `S3_*`.                   |
| Ajuste na API                                                         | Aceita a porta da hospedagem em `PORT` (a Render usa); `API_PORT` continua tendo prioridade.                                              |

## Ordem dos passos

Há uma dependência circular de endereços (a API precisa saber o endereço da aplicação, e a aplicação precisa saber o da API). A ordem abaixo resolve.

1. **Supabase** (banco e arquivos)
   1. Criar o projeto (guarde a senha do banco no gerenciador de senhas).
   2. Em _Database → Extensions_, habilitar `pg_trgm` e `unaccent` (o sistema usa).
   3. Copiar a **string de conexão** (use a conexão **direta** ou a do _session pooler_, não a do _transaction pooler_: o Prisma precisa de sessão).
   4. Em _Storage_, criar um bucket **privado** (`voltex-documents`) e gerar as **chaves S3** em _Storage → S3 Connection_.
   5. **Testar o armazenamento:** `S3_ENDPOINT=https://<projeto>.supabase.co/storage/v1/s3 S3_REGION=<região> S3_BUCKET=voltex-documents S3_ACCESS_KEY=... S3_SECRET_KEY=... node apps/api/dist/cli/check-storage.js`. Os cinco itens devem dar **OK**. Se o quarto avisar que o nome do arquivo foi ignorado, é só um incômodo (o download sai com outro nome).
2. **Banco:** aplicar as migrações no Supabase e **fechar a API pública dele**:

   ```bash
   DATABASE_URL='postgresql://...' pnpm --filter @voltex/database exec prisma migrate deploy
   psql "$DATABASE_URL" -f deploy/nuvem/supabase-travar-api.sql
   ```

   **O segundo comando é obrigatório.** O Supabase expõe as tabelas do esquema `public` numa API pública, acessível com a chave "anon" (que não é secreta). Sem o bloqueio, qualquer pessoa com o endereço do projeto poderia ler os dados. A nossa API não usa isso, então o script liga a segurança por linha em todas as tabelas e retira o acesso dessas funções. (Em Configurações → Data API você também pode desligar a API de dados do Supabase.)

3. **Vercel, primeira vez:** publicar a aplicação e o site com um `<host-da-api>` provisório só para conhecer os endereços finais.
4. **Render:** criar o serviço da API (veja [Como enviar a API](#como-enviar-a-api-para-a-render)), preenchendo as variáveis (`WEB_URL` e `CORS_ORIGIN` = endereço da aplicação na Vercel).
5. **Vercel, de novo:** publicar a aplicação e o site com o host real da API:

   ```bash
   SITE_URL=https://voltex-site.vercel.app ./scripts/publicar-front.sh app voltex-api.onrender.com
   APP_URL=https://voltex-app.vercel.app LEAD_KEY=lk_... ./scripts/publicar-front.sh site voltex-api.onrender.com
   ```

6. **Primeiro acesso:** criar a empresa e o proprietário, rodando o comando local contra o banco do Supabase:

   ```bash
   DATABASE_URL='postgresql://...' DATA_ENCRYPTION_KEY='a mesma da API' \
   TENANT_NAME="Sua Empresa" OWNER_NAME="Nome" OWNER_EMAIL=voce@empresa.com OWNER_PASSWORD='senha longa' \
   node apps/api/dist/cli/create-owner.js
   ```

7. **Formulário do site:** pegar a chave em _CRM Solar → Leads → Receber contatos do seu site_ e republicar o site com `LEAD_KEY=...`.
8. **Teste de ponta a ponta:** rodar a jornada do integrador apontando para os endereços reais (será adaptada para isso).

## Como enviar a API para a Render

Decisão tomada: **imagem Docker em um registro privado**, sem enviar o repositório ao GitHub. O `scripts/publicar-api.sh` constrói e publica a imagem:

```bash
docker login ghcr.io                                   # uma vez (usuário do GitHub + token com permissão de pacotes)
./scripts/publicar-api.sh ghcr.io/SEU_USUARIO/voltex-api
```

Na Render: _New → Web Service → Existing image_ (plano **Free**), informe a imagem e, por ser privada, as **credenciais do registro** (usuário e token só de **leitura** de pacotes). Em _Health Check Path_ use `/api/v1/health/live`. Preencha as variáveis da tabela abaixo.

A imagem tem cerca de 800 MB e leva o **código compilado** da API (sem segredos: eles entram como variáveis na Render). Por isso o repositório do registro deve ser **privado**.

Se um dia o repositório for ao GitHub, o `render.yaml` permite publicar direto dele.

## Variáveis da API (Render)

| Variável                                                                  | Valor                                                  |
| ------------------------------------------------------------------------- | ------------------------------------------------------ |
| `DATABASE_URL`                                                            | conexão do Supabase (direta ou _session pooler_)       |
| `REDIS_URL`                                                               | do Redis escolhido                                     |
| `JWT_SECRET`, `JWT_REFRESH_SECRET`                                        | `openssl rand -base64 48` (cada um)                    |
| `DATA_ENCRYPTION_KEY`                                                     | `openssl rand -base64 32` — **guarde fora do serviço** |
| `WEB_URL`, `CORS_ORIGIN`                                                  | endereço da aplicação na Vercel                        |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` | do Supabase Storage                                    |
| `S3_FORCE_PATH_STYLE=true`, `S3_SERVER_SIDE_ENCRYPTION=none`              | já no `render.yaml`                                    |
| `TRUST_PROXY=2`                                                           | Render e Vercel na frente (já no `render.yaml`)        |
| `NODE_ENV=production`                                                     | já no `render.yaml`                                    |

E-mails (convites): neste deploy **não há servidor de e-mail**. Convites só funcionam copiando o link; para e-mail real é preciso um serviço de envio (próximo tipo de deploy).

## Limites e riscos

- **Redis (Upstash) pode esgotar o limite:** a fila consulta o Redis mesmo sem trabalho. Por isso a verificação de saúde da Render usa `/api/v1/health/live` (sem Redis) e a varredura das automações roda a cada 15 minutos. Se o limite acabar, a API continua de pé, mas filas e automações param até o mês virar.
- **A API gratuita dorme** depois de uns 15 minutos sem uso; o primeiro acesso depois demora cerca de um minuto. **As automações e as filas rodam dentro da API**, então param enquanto ela dorme.
- **O projeto gratuito do Supabase pausa** depois de cerca de uma semana sem uso; pausado, a API fica sem banco e sem arquivos até você reativar pelo painel.
- **Sem backup automático** garantido nos planos gratuitos. Use `pg_dump` periodicamente.
- **Termos de uso:** o plano gratuito da Vercel é para uso **não comercial**; para um produto comercial, a hospedagem do site e da aplicação por lá pode ir contra o contrato.
- **Cada plano muda de regras**: confira as páginas oficiais antes de depender.
- **Dados pessoais (LGPD):** use só dados fictícios.

## Estado da demonstração publicada

| Peça                          | Endereço                                                                  |
| ----------------------------- | ------------------------------------------------------------------------- |
| Aplicação                     | https://voltex-app-rho.vercel.app                                         |
| Site                          | https://voltex-site-one.vercel.app                                        |
| API (Render, região Virgínia) | https://voltex-api-zc9f.onrender.com                                      |
| Banco e arquivos              | Supabase, projeto `voltex` (São Paulo), bucket privado `voltex-documents` |
| Redis                         | Upstash                                                                   |

Segredos ficam em `~/.voltex-deploy/` (fora do repositório, permissão 600). Scripts usados: `guardar-segredo.sh`, `publicar-api.sh`, `render-api.mjs` (cria ou atualiza o serviço na Render pela API), `publicar-front.sh` e `criar-dono-nuvem.sh` (primeira empresa e proprietário).

Para **atualizar a API**: `./scripts/publicar-api.sh ghcr.io/eduardo-lima-dev/voltex-api`, depois `node scripts/render-api.mjs ghcr.io/eduardo-lima-dev/voltex-api:latest https://voltex-app-rho.vercel.app` (atualiza as variáveis e pede nova publicação). Para **atualizar o front**: rode de novo o `publicar-front.sh`.

## Publicação automática (GitHub Actions)

Hoje a publicação é feita à mão, pelos scripts. O workflow `.github/workflows/deploy-demo.yml` faz **tudo sozinho, somente quando algo é mesclado na `main`**, seguindo o fluxo `develop → homolog → main`. Enquanto o trabalho estiver em `develop` ou `homolog`, **nenhuma Action roda em push**; os testes (CI) rodam quando você abre um pull request para `homolog` ou `main`, e de novo na `main`, dentro da publicação.

```mermaid
flowchart LR
  P[merge na main] --> CI[Testes<br/>lint, tipos, testes, e2e]
  CI --> IMG[Imagem da API<br/>no GHCR]
  IMG --> DB[Migrações<br/>no Supabase]
  DB --> API[API<br/>na Render]
  API --> FRONT[Site e aplicação<br/>na Vercel]
  FRONT --> OK[Conferência<br/>no ar]
```

Se qualquer etapa falhar, as seguintes **não rodam** e a demonstração continua na versão anterior. As migrações só rodam depois que os testes passam, e a API só é trocada depois que as migrações terminam.

### O que configurar uma vez no GitHub

No repositório: _Settings → Environments → New environment_ chamado **`demo`** (dá para exigir aprovação manual antes de cada publicação, em _Required reviewers_). Dentro dele:

| Tipo     | Nome                | Valor                                                                                 |
| -------- | ------------------- | ------------------------------------------------------------------------------------- |
| Secret   | `DEMO_DATABASE_URL` | conexão do Supabase (_session pooler_), a mesma de `~/.voltex-deploy/supabase-db-url` |
| Secret   | `RENDER_API_KEY`    | chave da API da Render                                                                |
| Secret   | `VERCEL_TOKEN`      | token criado em vercel.com/account/tokens                                             |
| Variável | `RENDER_SERVICE_ID` | `srv-dbb8t3o473hc73c46ke0`                                                            |
| Variável | `API_HOST`          | `voltex-api-zc9f.onrender.com` (sem `https://`)                                       |
| Variável | `APP_URL`           | `https://voltex-app-rho.vercel.app`                                                   |
| Variável | `SITE_URL`          | `https://voltex-site-one.vercel.app`                                                  |
| Variável | `LEAD_KEY`          | chave de captação do formulário do site (não é segredo: fica visível no site)         |
| Variável | `VERCEL_SCOPE`      | a equipe/conta da Vercel (ex.: `luizeduardobls-projects`)                             |
| Variável | `LEGAL_*`           | dados da empresa nas páginas `/privacidade` e `/termos` (opcionais; veja abaixo)      |

**Páginas legais.** Defina, como variáveis do ambiente `demo`, `LEGAL_COMPANY`, `LEGAL_CNPJ`, `LEGAL_ADDRESS`, `LEGAL_PRIVACY_EMAIL`, `LEGAL_DPO` e `LEGAL_FORUM` (razão social, CNPJ, endereço, e-mail de privacidade, encarregado e comarca do foro). Elas são gravadas **na compilação do site**; vazias, as páginas mostram "a informar" em destaque. Depois de mudar, publique de novo o site. Veja [páginas legais](paginas-legais.md).

```bash
gh variable set LEGAL_COMPANY --env demo --body "Razão social Ltda"   # idem para as demais
```

Com a CLI do GitHub, a partir de `~/.voltex-deploy` (os segredos não passam pela tela):

```bash
gh api -X PUT repos/Eduardo-Lima-Dev/Voltex-SolTech/environments/demo
gh secret set DEMO_DATABASE_URL --env demo < ~/.voltex-deploy/supabase-db-url
gh secret set RENDER_API_KEY    --env demo < ~/.voltex-deploy/render
gh secret set VERCEL_TOKEN      --env demo < ~/.voltex-deploy/vercel-token
gh variable set RENDER_SERVICE_ID --env demo --body srv-dbb8t3o473hc73c46ke0
gh variable set API_HOST          --env demo --body voltex-api-zc9f.onrender.com
gh variable set APP_URL           --env demo --body https://voltex-app-rho.vercel.app
gh variable set SITE_URL          --env demo --body https://voltex-site-one.vercel.app
gh variable set VERCEL_SCOPE      --env demo --body SUA_EQUIPE
```

**Estado atual:** o ambiente `demo` já foi criado, **restrito à branch `main`** (nenhuma outra branch, nem um pull request, consegue usar os segredos dele), com os segredos `DEMO_DATABASE_URL` e `RENDER_API_KEY` e todas as variáveis da tabela. **Falta só o `VERCEL_TOKEN`**, que precisa ser criado por você em vercel.com/account/tokens (`./scripts/guardar-segredo.sh vercel-token`) e então enviado com `gh secret set VERCEL_TOKEN --env demo < ~/.voltex-deploy/vercel-token`. Atenção: o repositório do GitHub é **público**; por isso os segredos ficam só no ambiente `demo` (e a imagem da API fica em um pacote privado).

**Pacote de imagens:** o pacote `voltex-api` do GHCR foi criado à mão. Para o Actions poder gravar nele, vá em _github.com → seu perfil → Packages → voltex-api → Package settings → Manage Actions access_ e adicione o repositório com permissão **Write**. (Na primeira imagem publicada pelo workflow, o pacote também passa a apontar para o repositório.)

### O que não é automático

- **A Render só troca a imagem**; as variáveis de ambiente (segredos da API) continuam as que estão no serviço. Para mudar uma variável, use `node scripts/render-api.mjs ...`.
- **Hoje a `main` publica a demonstração.** Quando existir uma produção real, ela terá o próprio ambiente no GitHub (com aprovação manual) e o próprio workflow, e a demonstração passará a sair de outra branch.
- **A primeira execução do CI no GitHub** ainda não aconteceu (o repositório não recebeu push dessas mudanças). Pode haver ajustes até ele passar; enquanto não passar, nada é publicado.
