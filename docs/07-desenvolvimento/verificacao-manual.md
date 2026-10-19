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
6. **Kanban** — `Oportunidades`: arraste o cartão pelo ícone (ou use "Mover para…"). Pular etapas é recusado com a lista do que é permitido; "Perdida" pede o motivo.
7. **Formulário público** — como administrador, copie o endereço de captação (Leads, no fim da página) e envie um POST com `{ "name", "phone", "consent": true }`: o lead aparece sem responsável.
8. **Perfis** — o SDR vê Leads, Contas e Tarefas (não Oportunidades) e converte só em conta; o vendedor vê as quatro áreas.
