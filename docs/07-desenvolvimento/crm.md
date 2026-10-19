# CRM Solar (Fase 7A)

Módulo `products/crm` da API e `features/crm` da Web. Cobre o caminho do lead até o cálculo vinculado à oportunidade: **leads → contas → oportunidades (Kanban) → tarefas → fatura → cálculo**. A triagem (Project Guard), a margem e a proposta são a 7B e estão em [Triagem, cotação e proposta](guard-e-proposta.md); contrato e projeto, a 7C.

## Leads

- **Cadastro** manual, por **CSV** (até 500 linhas, lido no navegador) e por **formulário público** (`POST /public/leads/:chave`).
- **Deduplicação** por telefone, e-mail e documento **normalizados** (`normalizePhone/Email/Document` em `@voltex/shared`): `(85) 98888-7777` e `+55 85988887777` são o mesmo lead. Duplicado devolve **409** `DUPLICATE_LEAD` com `data.matchedLeadId`. Lead sem telefone/e-mail/documento nunca é duplicado de outro sem contato. A deduplicação é **por empresa**.
- **SLA do primeiro contato:** cada lead nasce com prazo (`leadFirstContactSlaMinutes` em `tenant.settings`, padrão 30 min). Passou do prazo sem contato → `slaBreached`, filtro "SLA estourado" e (7C) alerta.
- **Status:** novo → contatado → qualificado; desqualificar exige motivo; **convertido** só pelo fluxo de conversão.
- **Conversão:** cria a conta e o contato principal e, para quem pode (`crm.opportunity.write`), a oportunidade com Project ID. Conta com o mesmo documento é **reaproveitada**. A etapa inicial acompanha o andamento do lead (novo → Novo lead, contatado → Primeiro contato, qualificado → Qualificação).
- **Captação pública:** chave por empresa (`lk_…`, rotacionável em `GET/POST /lead-capture`). Exige telefone ou e-mail e `consent: true` (LGPD); campo-isca `website` barra robôs; limite de 10 requisições/min; **sempre responde igual** (inclusive duplicado) para não revelar quem já é cliente; CORS aberto só nessa rota, sem credenciais.

## Contas, imóveis e unidades consumidoras

Conta → contatos (um principal), **imóveis** com o **levantamento técnico** (tipo de telhado, azimute, inclinação, sombreamento, área livre, disjuntor de entrada, aterramento, visita técnica — EnergIF EF-M02/M03/M05/R05/R09) e **UCs** (concessionária, grupo, ligação, classe). Mudar o intake do imóvel, a localização ou o grupo/ligação da UC emite `OpportunityPremisesChanged` para cada oportunidade aberta afetada (a 7B usa isso para invalidar a triagem).

> Cuidado de implementação: os schemas de **atualização** partem da base **sem valores padrão**. Um `.partial()` direto sobre um campo com `.default()` reaplica o padrão e apagaria o dado existente em qualquer edição parcial (há teste de regressão).

## Pipeline e oportunidades

- **Pipeline por empresa:** 15 etapas criadas na primeira consulta; o gestor renomeia e reordena (`crm.pipeline.manage`). As **chaves** seguem a máquina de estados e não mudam.
- **Máquina de estados** (`OPPORTUNITY_TRANSITIONS`, validada na API e no navegador): avança só para a etapa seguinte do fluxo, recua para refazer um passo, qualquer etapa aberta vai a **Perdido** (motivo obrigatório, também por regra no banco) e Perdido pode ser **reaberto** em Primeiro contato ou Qualificação. **Ganho** só nasce do contrato assinado (7C): a API recusa mover direto. Erro de transição devolve `INVALID_STAGE_TRANSITION` com as etapas permitidas.
- **Project ID** (`VLX-` + 8 caracteres de Crockford, aleatório de propósito para não revelar volume) criado na oportunidade e usado em eventos.
- **Linha do tempo imutável** (gatilho no banco): criação, notas, etapas, tarefas, fatura, cálculo, engenharia.
- **Kanban:** uma coluna por etapa, total real mesmo quando os cartões são limitados (50 por coluna), fechadas só dos últimos 30 dias. Arrastar pelo ícone **ou** o seletor "Mover para…" (teclado e celular); colunas inválidas ficam esmaecidas durante o arrasto.
- **Tarefas:** responsável, prazo, atrasadas; indicador **"sem próxima tarefa"** (cartão, lista e filtro).

## Fatura de energia

1. **Envio** (PDF, PNG ou JPEG) pela oportunidade: o arquivo vai para o armazenamento com versão e checksum.
2. **Leitura:** `BillParserProvider` (`pdf-text-heuristic@1.0.0`) extrai texto de PDFs com camada de texto (`unpdf`) e procura UC (rotulada como "unidade consumidora", "UC", "instalação" ou "código do cliente"), distribuidora (**só** entre as cadastradas pela empresa), mês de referência, histórico de consumo (`AGO/26 480` ou `08/2026 480`), total, vencimento, grupo e ligação. Cada campo traz uma **confiança**; imagens e PDFs escaneados não têm texto e seguem para preenchimento manual.
3. **Revisão obrigatória** (RF-CRM-032): campos de baixa confiança (< 75%) aparecem destacados, os não lidos tracejados. **Nada** vai ao cálculo antes da confirmação.
4. **Snapshot imutável** (`EnergyBillSnapshot`, gatilho no banco) a cada confirmação; o mais recente vale. Confirmar tira a oportunidade de "Fatura pendente" e atualiza grupo/ligação da UC. Cada confirmação emite `EnergyBillValidated` (a 7B invalida triagens anteriores).

**Limites conhecidos:** a leitura é por heurísticas e foi testada com faturas **sintéticas**; ainda **não** foi validada com faturas reais de distribuidoras. Precisa de amostras para medir a taxa de acerto por distribuidora e decidir se entra um OCR/IA (a interface já comporta). Por isso a revisão humana é obrigatória.

## Integração com o Calculator

- "Novo cálculo" na oportunidade abre o wizard **pré-preenchido**: consumo da fatura validada no **mês do calendário** correspondente (como o gráfico lê), grupo/ligação da UC, tarifa (a da fatura, com impostos, tem prioridade sobre a do cadastro), latitude/azimute/inclinação/área/sombreamento do imóvel.
- O cálculo salvo fica **vinculado** à oportunidade (`POST /opportunities/:id/calculations`) e é recalculado pelo servidor como sempre.
- **Semáforo amarelo** (ou "requer engenharia") abre um **pedido de engenharia** e, quando a máquina de estados permite, move para "Engenharia necessária" (RF-CRM-042). O atendimento acontece no Solar Engine Studio (Fase 9).

## Importação da ANEEL

`POST /reference-data/aneel/import` (e botão em Administração → Tarifas) lê o CSV dos **Dados Abertos da ANEEL** ("Tarifas das distribuidoras de energia elétrica", licença ODbL, semanal) em fluxo: cadastra as distribuidoras (com CNPJ) e a tarifa **residencial B1 convencional vigente** de cada uma. O arquivo tem mais de 150 MB e **655 mil linhas** (cerca de 8 s para processar; o download leva ~2 min). Idempotente.

- Valor = TUSD + TE (R$/MWh) convertido em centavos/kWh, **sem impostos** (ICMS, PIS, COFINS). A tarifa da fatura tem prioridade nos cálculos.
- Não importa Grupo A, tarifa branca nem pré-pagamento; a UF das distribuidoras não vem no arquivo.
- A fonte registrada em cada tarifa é a resolução homologatória.

## Permissões

| Área                    | Ler                       | Escrever                                                    |
| ----------------------- | ------------------------- | ----------------------------------------------------------- |
| Leads                   | `crm.lead.read`           | `crm.lead.write` (converter também: `crm.account.write`)    |
| Contas                  | `crm.account.read`        | `crm.account.write`                                         |
| Oportunidades           | `crm.opportunity.read`    | `crm.opportunity.write` (pipeline: `crm.pipeline.manage`)   |
| Tarefas                 | `crm.task.read`           | `crm.task.write`                                            |
| Fatura                  | `crm.energy-bill.read`    | `crm.energy-bill.write` + `platform.document.write` (envio) |
| Cálculo da oportunidade | `calculator.session.read` | `crm.opportunity.write` + `calculator.session.create`       |
| Captação (chave)        | `platform.tenant.manage`  | `platform.tenant.manage`                                    |

O SDR qualifica, cadastra contas e calcula, mas não cria oportunidades (entrega ao vendedor).

## Dados pessoais (LGPD)

Leads e contas guardam nome, telefone, e-mail e documento. A criptografia de campos sensíveis, a retenção e a exportação por empresa entram na **Fase 8**; até lá o documento fica em texto no banco (com isolamento por empresa e auditoria). A captação pública registra o consentimento.
