# Segurança e LGPD

O que o sistema faz hoje, o que **não** faz, e o que a operação precisa fazer. Papéis na LGPD: cada empresa cliente é a **controladora** dos dados dos clientes dela; a plataforma é a **operadora**.

## Documentos pessoais cifrados

CPF/CNPJ de **contas**, de **leads** e do **aceite de proposta** são gravados cifrados (AES-256-GCM). A API os decifra ao ler, para quem tem permissão.

- **Chave-mestra:** `DATA_ENCRYPTION_KEY` (32 bytes em base64; gere com `openssl rand -base64 32`). Só o servidor a tem. **Obrigatória em produção** (a API não sobe com a chave de desenvolvimento).
- **Chave por empresa:** a partir da mestra derivam-se (HKDF-SHA256, com o id da empresa) uma chave de cifra e uma de **índice cego**. Uma empresa não decifra os dados da outra, e o mesmo CPF em duas empresas gera valores e índices diferentes (nada se correlaciona).
- **Deduplicação e busca:** `documentNormalized` virou um HMAC do documento. Detecta duplicados por igualdade; a busca por documento só funciona com o **número completo** (11 ou 14 dígitos), não por pedaço.
- **Dados antigos em texto:** `node dist/cli/encrypt-documents.js` (na imagem da API, com a **mesma** chave) protege o que ainda estiver em claro. Idempotente. Faça backup antes.

### Guarda da chave (o ponto crítico)

- **Perder a chave = perder os documentos cifrados**, sem recuperação. Guarde uma cópia **fora do servidor e separada do backup do banco** (gerenciador de segredos ou cofre de senhas, com acesso restrito). Quem tem o banco e a chave tem os dados: não os guarde juntos.
- **Rodízio da chave:** **não implementado.** Trocar a `DATA_ENCRYPTION_KEY` hoje deixa os dados antigos ilegíveis. Antes de trocar, é preciso uma ferramenta de re-cifragem (decifrar com a antiga, cifrar com a nova), que ainda não existe.

### O que **não** está cifrado

- Nome, e-mail, telefone e endereço (precisam de busca e listagem).
- O **texto dos contratos** e os PDFs de contrato/proposta, que contêm o CPF por natureza; e `variables` do contrato. Eles ficam no armazenamento de arquivos.
- Arquivos enviados (faturas, contratos assinados): a proteção em repouso depende da configuração do armazenamento S3 (recomenda-se criptografia do bucket e acesso privado).
- Quem tem acesso direto ao banco **e** à chave lê tudo; a cifra protege contra vazamento só do banco (backup roubado, SQL injection de leitura).

## Exportação dos dados da empresa (portabilidade)

Administração → Empresa → **Exportar dados** (ou `GET /tenant/export`; `platform.tenant.manage`: proprietário e administrador). Gera um JSON com tudo que é da empresa: leads, contas, contatos, imóveis, unidades, oportunidades, linha do tempo, tarefas, faturas, cálculos, cotações, propostas, contratos, projetos, regras, usuários e a lista de documentos. Documentos pessoais vêm **em claro**.

- **Não inclui:** senhas, MFA, sessões, tokens de link, índices cegos, fila de eventos e o **conteúdo** dos arquivos (só os metadados; cada arquivo se baixa pelo documento).
- Limite de 3 por minuto; cada exportação fica na **auditoria** (`tenant.exported`).
- O arquivo é dado pessoal: quem exporta responde por guardá-lo.

## Retenção e exclusão — o que existe e o que falta

- Exclusões no sistema são **lógicas** (`deletedAt`): o dado sai das telas, mas **continua no banco e nos backups**. A auditoria, as linhas do tempo e os snapshots (cálculo, triagem, proposta, contrato) são **imutáveis por desenho** (rastreabilidade).
- **Não há purga automática** nem ferramenta de **anonimização/eliminação** a pedido do titular. Atender um pedido de eliminação hoje exige operação manual no banco, avaliando o que a lei manda reter (fiscal, contratual). Isso **ainda precisa ser construído**.
- **Política de retenção:** o prazo para cada tipo de dado é decisão da empresa controladora, com o seu jurídico; o sistema não assume prazos. Recomenda-se definir: leads não convertidos, contas inativas, contratos e documentos fiscais, logs.

## Backups

Sem backup testado não há recuperação. Recomendado:

| O quê                   | Como                                                                              | Frequência sugerida      |
| ----------------------- | --------------------------------------------------------------------------------- | ------------------------ |
| PostgreSQL              | `pg_dump --format=custom` (ou backup gerenciado com recuperação a ponto no tempo) | diária + antes de migrar |
| Arquivos (S3/RustFS)    | replicação/versionamento do bucket, ou cópia periódica                            | diária                   |
| `DATA_ENCRYPTION_KEY`   | cópia em cofre, **separada** dos backups acima                                    | ao criar/alterar         |
| Segredos (`JWT_*` etc.) | cofre de segredos                                                                 | ao alterar               |

- **Teste a restauração** (banco + arquivos + chave) em um ambiente à parte, ao menos a cada trimestre. Backup que nunca foi restaurado não é backup.
- O volume `postgres-data` do compose é só persistência local: **não é backup**.

## Outros controles que já existem

- Isolamento entre empresas por `tenantId` em toda consulta (falha fechada) e testes de isolamento.
- Senhas com Argon2; sessão com token curto e refresh rotativo com detecção de reuso; limite de tentativas de login.
- Helmet, CORS restrito, limite de requisições (e no nginx, cabeçalhos de segurança); IP real atrás do proxy (`TRUST_PROXY`).
- Auditoria de ações críticas; propostas por link com token de 256 bits (só o hash é guardado) e sem custos/margem.
- Contêineres da aplicação sem root.

## Pendências assumidas

Rodízio de chave; anonimização/eliminação a pedido; purga por retenção; criptografia do texto dos contratos; MFA (o campo existe, o fluxo não); verificação de dependências no CI (auditoria de pacotes).
