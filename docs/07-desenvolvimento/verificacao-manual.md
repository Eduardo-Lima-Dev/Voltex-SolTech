# Verificação manual

Roteiro para ver e testar o sistema no navegador. Os testes automatizados cobrem tudo isto; aqui está o caminho de quem quer **ver** funcionando.

## Subir

```bash
pnpm setup   # primeira vez: dependências, Docker de infra, banco e seed
pnpm dev     # infra + API (:3000) + Web (:5173)
```

- Web: <http://localhost:5173> · Swagger: <http://localhost:3000/api/docs> · e-mails de convite (Mailpit): <http://localhost:8025>.
- Usuários do seed e senha (`Voltex@2026`): [banco de dados](banco-de-dados.md#seed-de-demonstração). Use `owner@voltex.demo` para ver tudo.
- O login limita 5 tentativas por minuto; errar a senha várias vezes bloqueia por um minuto (comportamento esperado).

## Fase 6 — Solar Calculator

1. **Regras** — `Administração → Regras`: mostra a regra em vigor (`builtin@1`), os limites e as fontes (EnergIF), e que o custo de disponibilidade não está definido.
2. **Irradiação** — `Administração → Irradiação`: o sistema **não traz HSP pronto**. Cadastre um local (ou importe CSV; "Baixar modelo" gera o cabeçalho) com a **fonte** (ex.: CRESESB SunData). Sem fonte, não salva.
3. **Tarifas** — `Administração → Tarifas`: cadastre a concessionária e uma tarifa (R$/kWh) com vigência e origem (ex.: "fatura do cliente").
4. **Calcular** — `Solar Calculator → Novo cálculo`: 4 etapas. Escolha o local e a tarifa cadastrados (ou digite o HSP e a tarifa) e acompanhe o **resultado em tempo real** ao lado.
   - Caso de referência: consumo 500 kWh em todos os meses, custo de disponibilidade 30 kWh, HSP 5, PR 0,80, módulo 550 Wp / 2,58 m², tarifa R$ 0,95, custo R$ 4,50/Wp → **8 módulos, 4,4 kWp, R$ 19.800,00, semáforo verde**.
   - Provoque alertas: área disponível pequena (vermelho), Grupo A (amarelo), inclinação abaixo de 10° e PR em branco (informativos).
5. **Resultado** — indicadores, alertas com explicação, gráficos (geração × consumo e fluxo de caixa), premissas e a origem dos dados (com "Alterado" quando você mudou o valor do cadastro).
6. **Snapshot** — "Salvar snapshot" congela o cálculo. Depois mude a tarifa ou ative outra regra: o snapshot antigo continua igual.
7. **Perfis** — entre como `sdr@voltex.demo` (calcula, mas não salva snapshot) e `engenharia@voltex.demo` (só consulta; vê "Regras", não "Tarifas").

## API direto (Swagger)

Faça `POST /auth/login`, clique em **Authorize** com o `accessToken` e teste `GET /calculations/quick/config` e `POST /calculations/quick`. Corpo mínimo de `input`: `consumptionMonthlyKwh` (1 a 12 valores), `availabilityCostKwh`, `hspMonthly` (12 valores), `modulePowerWp`, `moduleAreaM2`, `tariffCentsPerKwh` e `costPerWpCents` (ou `systemCostCents`).

## Fase 7A — CRM

1. **Tarifas** — `Administração → Tarifas → Importar da ANEEL` (leva uns 2 minutos): cadastra as 116 distribuidoras e a tarifa residencial vigente de cada uma, **sem impostos**.
2. **Lead** — `CRM Solar → Leads → Novo lead` (tente cadastrar o mesmo telefone de novo: o sistema avisa e abre o lead existente). Qualifique pelo menu e **converta**: nasce a conta, o contato e a oportunidade com Project ID.
3. **Conta** — adicione um **imóvel** com o levantamento técnico (azimute, inclinação, sombreamento, área) e uma **UC** com a concessionária; na oportunidade, "Editar" para vincular os dois.
4. **Fatura** — aba **Fatura → Enviar fatura** (PDF com texto). Em **Revisar**, os campos de baixa confiança aparecem destacados; ajuste e **Confirmar**. A oportunidade sai de "Fatura pendente".
5. **Cálculo** — aba **Cálculos → Novo cálculo**: já vem com o consumo da fatura (no mês certo), a tarifa e os dados do imóvel. Um cliente do **Grupo A** gera semáforo amarelo, abre um pedido de engenharia e move a etapa.
6. **Kanban** — `Oportunidades`: arraste o cartão (ou use a alça/"Mover para…"); confira o total por coluna, a busca por cliente e os filtros de situação e vendedor. Pular etapas é recusado com a lista do que é permitido; "Perdida" pede o motivo.
7. **Formulário público** — como administrador, copie o endereço de captação (Leads, no fim da página) e envie um POST com `{ "name", "phone", "consent": true }`: o lead aparece sem responsável.
8. **Perfis** — o SDR vê Leads, Contas e Tarefas (não Oportunidades) e converte só em conta; o vendedor vê as quatro áreas.

## Fase 7B — Triagem, cotação e proposta

Use a oportunidade da 7A (com fatura validada e cálculo) ou crie outra.

1. **Margem mínima** — `Administração → Margens → Nova política` (ex.: 20%). Sem política, nenhuma cotação é liberada. Em `Administração → Empresa`, defina a cor (e a logo) das propostas.
2. **Triagem** — aba **Triagem → Avaliar triagem**. Com tudo em ordem fica **verde**. Para ver o resto: mude o azimute do imóvel (Conta → Imóvel) e a avaliação aparece **desatualizada**; sem fatura validada, fica **amarela** e o gestor pode **Liberar mesmo assim** com justificativa.
3. **Cotação** — mova para **Cotação** (a trava exige triagem verde ou liberada). Aba **Cotação → Nova cotação**: preencha materiais, custos e preço; a **prévia da margem** muda ao digitar. Com preço baixo a cotação fica **abaixo do mínimo** e mostra o preço mínimo.
4. **Aprovação** — **Pedir aprovação** (com justificativa). Entre como **gestor** (`gestor@voltex.demo`) em `CRM → Aprovações` e aprove ou recuse. Quem pediu não decide o próprio pedido (o proprietário pode).
5. **Proposta** — aba **Proposta → Gerar proposta** (escolha a cotação liberada), depois **Enviar**: o link público aparece **uma vez**. Baixe o **PDF**.
6. **Cliente** — abra o link numa janela anônima: vê cenários, gráficos e condições (nunca custos nem margem). **Aceitar proposta** pede nome completo e confirmação; a oportunidade vai para **Contrato** e a linha do tempo registra o aceite. Abrir o link de novo mostra "aceita"; uma versão nova da proposta torna o link antigo "substituído".
7. **Perfis** — o vendedor não vê Aprovações nem Margens; o SDR não vê Triagem, Cotação nem Proposta.

## Fase 7C — Contrato, projeto, automações e painel

Continue da proposta aceita pelo cliente (a oportunidade vai para **Contrato**).

1. **Modelo** — `Administração → Contratos`: o modelo-base avisa que não tem revisão jurídica. Edite, use só as variáveis listadas (uma desconhecida bloqueia) e **Publique**. `Administração → Homologação`: veja a base EnergIF 2023 (sem revisão) e, se quiser, **Publique regras** com fonte.
2. **Contrato** — aba **Contrato → Gerar contrato** (complete CPF/CNPJ). Veja o texto, baixe o PDF. Para trocar algo, **Cancele o rascunho** e gere outro.
3. **Assinatura** — **Registrar assinatura**: anexe um PDF. A oportunidade vira **Ganho** e aparece **Abrir o projeto**.
4. **Projeto** — marque os documentos como **Concluído** (dispensar pede observação). **Protocolar** sem completar é recusado com a lista do que falta; com tudo pronto, informe o protocolo: aparece o prazo do parecer **com a fonte** ("confirme na regulação vigente").
5. **Painel** — `CRM → Painel`: leads por origem, funil, propostas, ticket médio e previsão (sem total ponderado até definir pesos).
6. **Automações** — deixe um lead sem contato além do prazo, ou uma oportunidade em "Fatura pendente" por mais de 24 h: em até 1 minuto nasce a tarefa (veja em **Tarefas**). Abra o link de uma proposta enviada: o responsável recebe a tarefa de follow-up.
7. **Perfis** — o vendedor lê contratos e projetos mas não gera nem assina; o financeiro vê o painel; operação e engenharia atualizam o projeto.

## Fase 9 — Solar Engine Studio

Pré-requisitos: um módulo e um inversor **aprovados** no catálogo (Engine → Catálogo), regras `engine.design`, `engine.cables`, `engine.connection` e `engine.economics` **ativadas por quem revisa** (use valores reais do responsável técnico; os dos testes são de exemplo) e a série horária do local em cache (Administração → Fontes de dados, com a fonte ligada em `DATA_HUB_ENABLED_SOURCES` depois da conferência de licença).

1. **Engenheiro** — `Engine → Pedidos`: pegue o pedido amarelo e abra o projeto (informe latitude e longitude se faltarem). Em cada etapa confira o resultado: compatibilidade com a fórmula de cada verificação; proteções e cabos com a justificativa; simulação (gráficos mensal, dia típico e cascata de perdas, comparação com PVGIS/Calculator); conexão (regras da distribuidora); economia (financiamento, cenários, tornado).
2. **Pendências** — remova uma regra ou deixe um campo vazio: a etapa mostra "pendente" e **Enviar para revisão** é recusado. Nada é presumido.
3. **Enviar** — **Enviar para revisão** congela a versão.
4. **Responsável técnico** — comente por seção; **Aprovar** é recusado enquanto houver comentário aberto; resolva e aprove com justificativa. A versão fica congelada e nasce o snapshot.
5. **Entregáveis** — baixe memorial e unifilar (PDF/SVG/DXF). **Comparar com outra versão** mostra o que mudou.
6. **Cliente** — **Gerar link** e abra em janela anônima: nenhum custo ou margem aparece. **Revogar** derruba o link.
7. **CRM** — a linha do tempo da oportunidade registra a aprovação, o pedido vai para "Concluído" e a cotação pode **importar a lista de materiais** do snapshot. **Anexar à homologação** coloca memorial e unifilar no checklist do projeto (depois do contrato).

### Fase 9K — gestão do pedido e do projeto

1. **Pedido** — `Engine → Pedidos → Ver pedido`: confira o contexto do CRM; mude para **Aguardando visita** (pede motivo); use **Pedir informação ao vendedor** (o vendedor recebe uma tarefa no CRM); como coordenador, defina **Prioridade e prazo** e veja o atraso na lista.
2. **Projeto** — abra o projeto: preencha a **Ficha** (potência-alvo muda a classe; informe a ART) e veja o pacote em **Documentos** mudar entre micro e mini.
3. **Levantamento** — preencha em **Levantamento**; **Concluir** só é aceito com os dados mínimos; ao concluir, o pedido volta a "Em andamento". Entre como instalador: ele acessa só o levantamento.
4. **Carga** e **Histórico** — conferir consumo, cargas e a linha do tempo do pedido e do projeto. **Painel** (coordenador): totais e carga por engenheiro.
