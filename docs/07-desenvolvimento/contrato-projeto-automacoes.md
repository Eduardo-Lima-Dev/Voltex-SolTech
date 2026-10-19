# Contrato, projeto, automações e painel (Fase 7C)

Módulos `products/crm/{contracts,projects,automations,dashboard}` da API; aba **Contrato** na oportunidade, áreas **Projetos** e **Painel** no CRM e as abas **Contratos** e **Homologação** em Administração, na Web.

```
Proposta aceita ─▶ Contrato (rascunho) ─▶ Contrato assinado ─┬─▶ Oportunidade GANHA (DealWon)
                                                             └─▶ Projeto + checklist de homologação (mesmo Project ID)
```

## Contrato

- **Modelo com variáveis** (`{{cliente.nome}}`, `{{contrato.valor}}`…): `GET/PUT /contract-template`. Cada publicação é uma **versão nova e imutável** (gatilho); sem nenhuma, vale o **modelo-base**, que avisa não ter revisão jurídica e **não define prazos, multas nem garantias**. Variável desconhecida bloqueia o salvamento (erro de digitação).
- **Modelo em Word (.docx) da empresa:** em Administração → Contratos, a empresa envia o contrato dela em Word, com as variáveis entre chaves duplas (`{{cliente.nome}}`). O sistema valida (extensão, arquivo legível, **variável desconhecida ou nenhuma variável** são recusadas com a explicação), guarda como nova versão do modelo e passa a **preencher o próprio arquivo** em cada contrato, mantendo a formatação. O contrato sai em **Word** (`fileKind = DOCX`) em vez de PDF; o PDF só é gerado para modelos em texto. Enviar ou publicar um modelo novo (Word ou texto) substitui o anterior para os contratos seguintes. Sem modelo da empresa vale o modelo-base (sem revisão jurídica).
- **Geração** (`POST /opportunities/:id/contracts`): só com a oportunidade na etapa **Contrato** e a proposta **aceita**. Com mais de um cenário, o vendedor informa qual o cliente escolheu (`SCENARIO_REQUIRED` devolve as opções). O valor é o do cenário. Dados que faltam (CPF/CNPJ, endereço) saem como "(não informado)" e ficam listados; `customerDocument`, `customerAddress` e `companyDocument` completam na hora.
- O **texto final fica gravado** e é **imutável** no banco; para ajustar, cancela-se o rascunho (com motivo) e gera-se outro. Um contrato não cancelado por oportunidade (índice parcial). O PDF é gerado a partir do texto (pdfkit).
- **Assinatura** (`POST /contracts/:id/sign`, multipart): anexa o arquivo digitalizado (PDF/PNG/JPEG), com data e quem assinou. **Não é assinatura eletrônica**: é o registro do contrato assinado fora do sistema.
- **Tudo ou nada:** na **mesma transação** da assinatura o contrato vira `SIGNED`, a oportunidade vai a **Ganho** (só aqui; mover à mão para Ganho continua recusado), saem os eventos `ContractSigned`, `DealWon` e `ProjectCreated` e nasce o **projeto**. Se a criação do projeto falhar, nada é gravado.
- Permissão: gerar, cancelar e assinar exigem `crm.contract.write` (gestor comercial, administrador, proprietário); o vendedor lê. Assinar exige também `platform.document.write`.

## Projeto e homologação básica

- Nasce com o **mesmo Project ID** da oportunidade, o valor do contrato, a concessionária da UC e a classe de geração do cálculo (micro/mini).
- **Situações:** Reunindo documentos → Solicitação protocolada → Vistoria → Homologado (ou Cancelado). Transições permitidas (EF-R03): avançar um passo; voltar a "Reunindo documentos" quando a distribuidora pede pendências (com o motivo); cancelar (com motivo). Não se pula a vistoria. Homologado e cancelado são finais.
- **Protocolar** exige o número do protocolo **e** que os documentos obrigatórios do checklist estejam concluídos ou dispensados (`CHECKLIST_INCOMPLETE` lista o que falta).
- **Responsável técnico:** só usuário da engenharia ou responsável técnico (`PATCH /projects/:id`).
- Cada mudança vai para a linha do tempo da oportunidade, a auditoria e os eventos `HomologationStarted`, `HomologationPending` e `HomologationApproved`.

### Checklist como dado versionado com fonte

As exigências **não estão no código de negócio**: vêm de `HomologationChecklist` (regras versionadas e imutáveis, por distribuidora ou padrão da empresa) ou, na falta delas, da **base EnergIF 2023** embutida (`BUILT_IN_HOMOLOGATION_RULES` em `@voltex/shared`).

- **Resolução:** versão mais recente da distribuidora → padrão da empresa → base EnergIF.
- A base traz formulário, ART/TRT, unifilar, certificado do inversor, procuração, memorial e, **só para minigeração**, cronograma (EF-R04); itens opcionais (rateio de UCs, especificação das proteções, localização da UC, tipo de fonte) com a ressalva de **confirmar com a distribuidora**. Cada item e cada prazo carrega a **fonte**.
- **Prazos sugeridos** (EF-R06: parecer em 60 dias, vistoria em 7, execução em 120 após a homologação) são **sugestões**: aparecem com a fonte e o aviso "confirme na regulação vigente" e viram prazo efetivo só ao protocolar/solicitar vistoria (a data informada pelo usuário vale mais). Passou do prazo: o projeto aparece com **"prazo vencido"**.
- A base **não está revisada** por responsável técnico (o livro tem ambiguidades, EF-I05/I06); a tela avisa. Publicar regras próprias (`POST /homologation/checklists`) exige **fonte** e aceita o nome de quem revisou; só `platform.rule.manage` publica (proprietário, administrador, responsável técnico).
- O projeto **guarda uma cópia** das regras que usou (referência, fonte, revisão, prazos): publicar versão nova não muda projetos existentes. Mudar a concessionária (só enquanto reúne documentos) reaplica as regras: entram os itens novos, saem os não iniciados que deixaram de valer.

## Automações (BullMQ)

Fila `crm-automations` (Redis), worker na própria API. Regras **idempotentes**: cada tarefa leva uma `automationKey` única; repetir a varredura ou reentregar um evento não duplica.

| Regra                        | Gatilho                                                                        | Resultado                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Lead sem contato no prazo    | varredura (a cada `AUTOMATION_SCAN_INTERVAL_MS`, padrão 60 s)                  | evento `LeadSlaBreached` + tarefa ao responsável; marca `slaAlertedAt`                                     |
| Fatura pedida e não recebida | oportunidade em "Fatura pendente" há mais de `billFollowUpHours` (padrão 24 h) | tarefa de cobrança; nova passagem pela etapa gera nova tarefa                                              |
| Proposta visualizada         | evento `ProposalViewed` (primeira abertura), via fila                          | tarefa de follow-up ao responsável, para 4 h depois                                                        |
| Contrato assinado → projeto  | assinatura                                                                     | **na própria transação** (não passa pela fila: tudo ou nada); cria também a tarefa "iniciar a homologação" |

- `billFollowUpHours` fica em `tenant.settings`. `AUTOMATION_SCAN_INTERVAL_MS=0` desliga o agendamento (os testes chamam a varredura direto); `AUTOMATION_QUEUE_PREFIX` isola as chaves no Redis.
- O alerta de lead é **evento + tarefa**: ainda não há notificação (e-mail/WhatsApp/sino) — fica para a Fase 11.

## Painel comercial (RF-CRM-100)

`GET /dashboard/commercial?from&to` (`crm.dashboard.read`: gestor comercial, financeiro, administrador, proprietário). Padrão: últimos 30 dias. Tudo calculado dos registros; nada é estimado.

- **Leads por origem** e total do período.
- **Funil:** quantas oportunidades **chegaram** a cada etapa no período (pela linha do tempo; as criadas contam na etapa inicial) e a conversão sobre a **etapa anterior que teve passagem** (etapas opcionais, como negociação, não zeram a conta).
- **Propostas** geradas, enviadas, visualizadas e aceitas no período.
- **Ganhos e ticket médio:** contratos **assinados** no período (soma e média).
- **Previsão simples:** pipeline **aberto agora** pelo preço da cotação mais recente, por mês de fechamento esperado. O **total ponderado** só existe se a empresa definir `forecastWeights` por etapa em `tenant.settings` (ainda sem tela); **não se inventam pesos**.

## Permissões

| Área                  | Ler                  | Escrever / decidir                                              |
| --------------------- | -------------------- | --------------------------------------------------------------- |
| Modelo e contratos    | `crm.contract.read`  | `crm.contract.write` (+ `platform.document.write` para assinar) |
| Projetos              | `crm.project.read`   | `crm.project.write` (operação, engenharia, responsável técnico) |
| Regras de homologação | `platform.rule.read` | `platform.rule.manage`                                          |
| Painel                | `crm.dashboard.read` | —                                                               |

## Limites conhecidos

- O contrato-base **não tem revisão jurídica**; cada empresa precisa publicar o seu modelo.
- A assinatura é um **registro** do arquivo assinado, sem validade jurídica própria do sistema (assinatura eletrônica integrada fica para depois).
- A **base EnergIF 2023 não está revisada** e não é a lista vigente de nenhuma distribuidora; prazos são sugestões. O responsável técnico das regras **ainda não foi definido**.
- Quem não tem `platform.user.read` (ex.: operação) vê o responsável técnico, mas não o troca pela tela; quem tem `platform.rule.read` troca a concessionária.
- Sem notificações: alertas viram tarefas e eventos.
- O documento (CPF/CNPJ) segue em texto até a criptografia da Fase 8.
