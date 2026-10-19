# Segurança e LGPD

O que o sistema faz hoje, o que **não** faz, e o que a operação precisa fazer. Papéis na LGPD: cada empresa cliente é a **controladora** dos dados dos clientes dela; a plataforma é a **operadora**.

## Dados pessoais cifrados

São gravados cifrados (AES-256-GCM) e decifrados só na leitura, para quem tem permissão:

- **CPF/CNPJ** de contas, de leads e do aceite de proposta;
- **Texto do contrato** e as **variáveis preenchidas** (nome, documento, endereço do cliente).

**Chave por empresa:** a partir da chave-mestra derivam-se (HKDF-SHA256, com o id da empresa) uma chave de cifra e uma de **índice cego**. Uma empresa não decifra os dados da outra, e o mesmo CPF em duas empresas gera valores e índices diferentes.

**Deduplicação e busca:** `documentNormalized` é um HMAC do documento. Detecta duplicados por igualdade; a busca por documento só funciona com o **número completo** (11 ou 14 dígitos).

**O que não está cifrado:** nome, e-mail, telefone e endereço dos cadastros (precisam de busca e listagem); o **conteúdo dos arquivos** enviados e gerados (faturas, contratos assinados, PDFs/Word). Para os arquivos, ligue a criptografia do armazenamento: `S3_SERVER_SIDE_ENCRYPTION=AES256` (o S3 da AWS faz; confira se o seu armazenamento suporta) e mantenha o bucket **privado**. Quem tem o banco **e** a chave lê os dados cifrados.

## Chave de criptografia: guarda e rodízio

`DATA_ENCRYPTION_KEY` (32 bytes em base64; gere com `openssl rand -base64 32`). **Obrigatória em produção**; a API não sobe com a chave de desenvolvimento nem com uma chave inválida.

### Quem guarda e onde

**Perder a chave = perder os dados cifrados, sem recuperação.** Recomendação:

- **Dois guardiões** (regra das duas pessoas): o **dono da plataforma** e **uma segunda pessoa de confiança** (sócio ou o responsável técnico de TI). Assim, se um deles não estiver disponível, o sistema se recupera.
- **Em uso:** no gerenciador de segredos do servidor (o da nuvem usada, ou as variáveis de ambiente protegidas do orquestrador). Nunca no repositório, em chat ou e-mail.
- **Cópia de recuperação, separada do servidor e dos backups do banco:** em um cofre de senhas com cofre compartilhado entre os dois guardiões (por exemplo, Bitwarden ou 1Password) **e** uma cópia impressa em envelope lacrado, guardada em local físico seguro (cofre ou caixa de banco).
- **Registre** (sem escrever a chave): o identificador de 8 caracteres (aparece ao rodar `rotate-encryption-key`), a data e quem guardou.
- **Nunca no mesmo lugar do backup do banco:** quem leva um leva o outro.
- **Teste anual:** restaure um backup do banco e a chave em um ambiente à parte e confira que os documentos abrem.

### Rodízio (sem parar o sistema)

Cada valor cifrado leva o identificador da chave que o cifrou, então chave antiga e nova convivem. Faça o rodízio ao trocar quem tem acesso à chave, ao suspeitar de vazamento e, como rotina, uma vez por ano.

1. Gere a nova chave e guarde-a nos cofres (passo acima) **antes** de usá-la.
2. Configure `DATA_ENCRYPTION_KEY=<nova>` e `DATA_ENCRYPTION_KEY_PREVIOUS=<a que estava em uso>` (várias anteriores, separadas por vírgula). Reinicie a API: ela já grava com a nova e lê as duas; a busca por documento considera os índices das duas.
3. Faça backup do banco e rode: `docker compose -f docker/compose.prod.yml run --rm api node dist/cli/rotate-encryption-key.js`. Ele recifra contas, leads, aceites e contratos com a chave nova e refaz os índices. É idempotente.
4. Rode de novo: se mostrar **0** em tudo, nada usa a chave antiga. Remova-a de `DATA_ENCRYPTION_KEY_PREVIOUS`, mas **guarde a antiga no cofre enquanto existirem backups feitos com ela** (um backup antigo só abre com a chave da época).

Esse mesmo comando protege dados que ainda estejam em texto (primeira execução depois de ligar a criptografia).

**Imutabilidade dos contratos:** o contrato assinado não muda, mas o rodízio precisa recifrar o texto. Existe uma exceção estreita no banco: uma transação que declare `voltex.reencrypt = on` pode alterar **somente** o texto, as variáveis e o nome de quem assinou (necessário também para a eliminação). Qualquer outra alteração continua barrada.

## Exportação dos dados da empresa (portabilidade)

Administração → Empresa → **Exportar dados** (`GET /tenant/export`; proprietário e administrador). Gera um arquivo com tudo que é da empresa, com documentos pessoais **em claro**. Não inclui senhas, MFA, sessões, tokens de link, índices cegos, fila de eventos nem o **conteúdo** dos arquivos (só a lista). Limite de 3 por minuto; fica na auditoria.

## Retenção e eliminação de dados

Administração → **Privacidade** (proprietário e administrador).

### O que a lei obriga a guardar (pesquisa)

A LGPD manda eliminar o dado pessoal quando acaba a finalidade, mas **permite conservar** para cumprir obrigação legal (art. 16, I) — e só pelo prazo exigido. Não há um prazo único: cada tipo de dado tem o seu. O que encontrei (confirme com o seu advogado, as fontes são secundárias):

| Dado                                          | Prazo mínimo            | Base                                                                                                                                                      |
| --------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Documentos fiscais/contábeis e da venda       | **5 anos**              | CTN (arts. 173, 174 e 195)                                                                                                                                |
| Contrato de consumo                           | **5 anos**              | CDC, art. 27 (prescrição da pretensão de reparação)                                                                                                       |
| Registros de acesso à aplicação (logs)        | **6 meses**             | Marco Civil da Internet, art. 15 (provedor de aplicação). Há divergência entre fontes sobre provedores de conexão (1 ano), que não é o caso da plataforma |
| Ações de contrato (prescrição geral)          | até 10 anos             | Código Civil, art. 205 (**não confirmado na pesquisa**: pergunte ao jurídico se a empresa quer guardar mais)                                              |
| Lead que nunca virou cliente; negócio perdido | **não há mínimo legal** | Decisão da empresa, pela finalidade                                                                                                                       |

### O que o sistema faz

- **Piso imposto:** contratos assinados (e o que depende deles) são guardados por, no mínimo, **60 meses (5 anos)** a partir da assinatura. A empresa pode aumentar, **nunca diminuir**.
- **Prazos da empresa:** contatos que não viraram cliente (meses) e negócios perdidos (meses depois de perdido). **Em branco = nunca apagar sozinho.** Não há padrão assumido: sem decisão da empresa, nada é apagado. Uma rotina diária aplica o que foi definido.
- **Eliminação a pedido do titular:** escolha o contato ou o cliente, anote de onde veio o pedido e confirme. Remove nome, contatos, documento, endereço, textos livres (notas, linha do tempo, propostas, cálculos, faturas lidas) e **apaga os arquivos** (faturas, contratos, PDFs). O registro fica **como número** (valores, datas, etapas) para as estatísticas. Não dá para desfazer.
- **Bloqueios:** o pedido é **recusado, com o motivo e a data**, se houver **negócio em aberto** ou **contrato assinado dentro do prazo legal**; depois do prazo, o contrato é anonimizado também. Um lead que virou cliente é tratado pela conta.
- **Registro:** cada pedido (feito, bloqueado ou automático) gera um registro **imutável sem dado pessoal** (data, iniciais, resultado, quem pediu) e entra na auditoria.

### O que **não** é eliminado

- A **auditoria** e a linha de eventos técnicos mantêm o histórico de quem fez o quê (necessário à segurança e à prestação de contas; ao menos 6 meses são obrigatórios). Nomes que tenham aparecido em registros de auditoria de cadastro **permanecem** nesse histórico. Eliminação completa do histórico de auditoria é decisão separada, com o jurídico.
- **Backups:** os dados eliminados continuam nos backups feitos antes; saem quando o backup expira. Defina a validade dos backups com isso em mente.
- Arquivos já **baixados ou exportados** por usuários fora do sistema.

## Backups

Sem backup testado não há recuperação.

| O quê                   | Como                                                                              | Frequência sugerida      |
| ----------------------- | --------------------------------------------------------------------------------- | ------------------------ |
| PostgreSQL              | `pg_dump --format=custom` (ou backup gerenciado com recuperação a ponto no tempo) | diária + antes de migrar |
| Arquivos (S3/RustFS)    | replicação/versionamento do bucket, ou cópia periódica                            | diária                   |
| `DATA_ENCRYPTION_KEY`   | cofres descritos acima, **separados** dos backups acima                           | ao criar/alterar         |
| Segredos (`JWT_*` etc.) | cofre de segredos                                                                 | ao alterar               |

**Teste a restauração** (banco + arquivos + chave) em um ambiente à parte, ao menos a cada trimestre. O volume `postgres-data` do compose é só persistência local: **não é backup**.

## Outros controles que já existem

Isolamento entre empresas por `tenantId` em toda consulta (falha fechada) e testes de isolamento; senhas com Argon2; sessão com token curto e refresh rotativo com detecção de reuso; limite de tentativas de login; Helmet, CORS restrito, limite de requisições e IP real atrás do proxy (`TRUST_PROXY`); auditoria de ações críticas; propostas por link com token de 256 bits (só o hash é guardado) e sem custos/margem; contêineres da aplicação sem root.

## Pendências assumidas

MFA (o campo existe, o fluxo não); anonimização do histórico de auditoria; verificação de dependências no CI; alerta de expiração de backups.

## Fontes da pesquisa de prazos

- [Quanto tempo guardar documentos? Tabela de prazos e a LGPD](https://confidata.com.br/blog/prazo-guarda-documentos-empresa-tabela-lgpd)
- [LGPD Comentada: término e eliminação](https://confidata.com.br/blog/lgpd-comentada-11-termino-eliminacao)
- [Política de Retenção de Dados Brasil (modelo)](https://forms-legal.com/pt/brasil/business/policies/politica-retencao-dados-brasil)

Blogs e modelos, **não** o texto das leis: confirme na Lei 13.709/2018 (LGPD), Lei 12.965/2014 (Marco Civil), CTN, CDC e Código Civil, com um advogado.
