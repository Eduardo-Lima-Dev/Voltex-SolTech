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
