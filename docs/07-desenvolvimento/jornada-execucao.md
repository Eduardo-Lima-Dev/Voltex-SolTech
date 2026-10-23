# Jornada ponta a ponta — Fase 11 (Execução e Lifecycle)

Fluxo completo do cliente: da venda homologada à operação da planta.

## Pré-condições

- Proposta assinada e contrato ativo (Project status APPROVED).
- Ingenharia de projeto concluída e snapshot aprovado.
- Materiais cotados.

## Etapas

### 1. Preparação (11A–11B)

- [ ] Projeto aprovado pelo cliente.
- [ ] Material list gerada da engenharia.
- [ ] Fornecedores contatados para cotação.
- [ ] Material recebido (100%).

**Acionador:** Todas as quantidades "recebidas" → transição para MATERIAL_READY.

### 2. Agendamento e Campo (11B–11C)

- [ ] Ordem de serviço criada (tipo INSTALLATION, janela agendada).
- [ ] Equipe atribuída.
- [ ] Cliente notificado (e-mail/wa.me).
- [ ] Ordem aberta no app de campo (offline se sem rede).

**Fluxo de campo:**

- App carrega ordem com checklist.
- Técnico preenche medições, tira fotos, registra geolocalização.
- Assinatura do cliente em canvas.
- Sincronização: POST /field/sync com batch de ações.

**Acionador:** Ordem concluída no campo → transição para COMMISSIONING.

### 3. Comissionamento (11D)

- [ ] Regra de ensaios carregada (RULESET ACTIVE).
- [ ] Técnico preenche testes (continuidade, polaridade, medições por string).
- [ ] Valores esperados calculados da engenharia.
- [ ] TECHNICAL_LEAD aprova ou repova.
- [ ] Relatório PDF gerado.

**Acionador:** Comissionamento aprovado → publica COMMISSIONING_COMPLETED → abre aceite.

### 4. Aceite (11D–11E)

- [ ] Cliente assina no app de campo ou portal (link mágico).
- [ ] Aceite registrado com IP e navegador.

**Acionador:** Aceite → publica CUSTOMER_ACCEPTED → planta criada, garantias iniciadas.

### 5. Pós-venda (11E)

- [ ] Planta ativada (Plant modelo criado com ativos).
- [ ] Garantias calculadas por fabricante (termo padrão).
- [ ] Monitoramento linkado à planta (ou pendente de configuração).

**Acionador:** Garantia N dias do vencimento → tarefa REMINDER.

### 6. Monitoramento (11F)

- [ ] Integração linkada (SMA, SolarEdge, etc.).
- [ ] Dados diários importados ou consultados via API.
- [ ] Desempenho comparado: real × esperado (monthly kWh).
- [ ] Alerta se desvio > limiar configurado → abre Ticket.

**Acionador:** Desvio crítico ou alarme → publica MONITORING_ALERT_RECEIVED.

### 7. Financeiro (11G)

- [ ] Parcelas registradas (vencimentos, valores).
- [ ] Custos reais lançados (material, mão de obra).
- [ ] Recebimentos marcados conforme pagamento chega.
- [ ] Margem realizada calculada.

**Acionador:** Parcela paga → linha do tempo atualizada.

### 8. Operação (11E)

- [ ] Chamados abertos por desvio ou cliente.
- [ ] Ordem de serviço preventiva (limpeza, inspeção) gerada.
- [ ] Contrato de O&M renovado.

## Validação

Todos os status são visíveis:

- **Integrador:** Operação → Instalações (quadro, lista, ficha).
- **Cliente:** Portal → Projetos (linha do tempo, documentos, garantias, chamados).

## Teste (Playwright)

Ver `apps/e2e/tests/jornada-execucao.spec.ts`.
