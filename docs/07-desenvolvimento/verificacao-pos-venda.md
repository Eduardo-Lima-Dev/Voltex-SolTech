# Verificação manual da Fase 11E (Pós-venda)

Teste visual no navegador das funcionalidades de plantas, ativos, garantias, chamados e O&M.

## Preparação

### 1. Populate dados de teste

```bash
./scripts/seed-aftersales.sh sol-do-nordeste
```

Isso cria:

- Termos de garantia de exemplo (SMA, Fronius, Huawei, Growatt, Sungrow, JinkoSolar)
- Configurações de O&M com prazos e SLA de exemplo
- Marca tudo como TESTE INTERNO

### 2. Inicie a aplicação

```bash
pnpm run dev
```

Acessa em `http://localhost:5173` (web) e `http://localhost:3000/api` (API).

## Fluxo de teste

### Passo 1: Criar um projeto até o aceite

A planta só nasce quando o cliente aceita a instalação. Siga este caminho:

#### Em **CRM** (novo projeto):

- Clique em "Nova cotação"
- Preencha os dados básicos (cliente, endereco, consumo, etc)
- Clique em "Aprovar proposta"
- Clique em "Gerar contrato"
- Clique em "Assinar contrato"
- Clique em "Gerar venda"

#### Em **Engenharia** (projeto criado):

- O projeto automaticamente entrou em engenharia
- Faça o design (ou aceite o design automático)
- Clique em "Homologação"
- Clique em "Aprovar" (isso cria a `Installation` em `AWAITING_ENGINEERING`)

#### Em **Operação → Instalações**:

- Clique na instalação que foi criada
- Marque os materiais como "Recebido" → muda para `MATERIAL_READY`
- Crie uma ordem de serviço de instalação:
  - Clique em "Criar ordem de trabalho"
  - Tipo: INSTALLATION
  - Data e horário
  - Equipe
  - Clique em "Criar"
- Abra a ordem e clique em "Concluir" → muda para `INSTALLED`
- Agora o cliente pode aceitar

#### No **Portal do cliente** ou **App de campo**:

- Gere um link mágico na ficha do projeto ou em Admin → Integrações
- Abra o portal com o link
- Vá até "Comissionamento"
- Clique em "Aceitar instalação"

**Resultado:** A planta é criada automaticamente com:

- Dados do projeto (potência, local, geração esperada)
- Ativos da lista de materiais
- Garantias (se houver termo para o fabricante)

### Passo 2: Teste as telas de Operação

#### **Operação → Plantas**

- Clique na planta que acabou de nascer
- Veja:
  - **Aba Ficha:** dados da planta, potência, geração esperada
  - **Aba Ativos:** equipamentos com fabricante, modelo, serial, posição
  - **Aba Garantias:** garantias por ativo (devem aparecer se o termo está cadastrado)
  - **Aba Chamados:** lista de chamados (crie um novo para testar)
  - **Aba O&M:** planos e contratos

#### **Operação → Garantias**

- Vá em **Operação → Garantias**
- Vê a lista de termos cadastrados (alguns de TESTE INTERNO)
- Clique em um termo para ver os detalhes
- Para substituir por um termo real:
  - Clique em "Novo termo"
  - Preencha os dados do fabricante (dos PDFs reais)
  - Suba o PDF do documento
  - Clique em "Revisar e ativar"

#### **Operação → Chamados**

- Clique em "Novo chamado"
- Preencha:
  - Planta: a planta que você criou
  - Tipo: Corretivo
  - Prioridade: Urgente
  - Descrição: "Painel com sujeira excessiva"
- Clique em "Criar"
- O chamado abre com SLA (se configurado):
  - Se prioridade = Urgente → SLA = 4h (de teste)
  - O prazo começa a contar **imediatamente**
  - Se o chamado ficar em "Aguardando cliente", o SLA **pausa**
- Clique em "Gerar ordem de serviço" para agendar uma manutenção
- Marque como "Resolvido" (obriga a descrever a solução)

#### **Operação → O&M e manutenção**

- Vá em **Operação → O&M e manutenção**
- Vá na aba "Prazos e gatilhos"
- Vê as configurações de teste:
  - Aviso de garantia: 90 dias antes do fim
  - Aviso de O&M: 30 dias antes da renovação
  - Antecedência de manutenção: 7 dias
  - SLA por prioridade (Urgente 4h, Alta 8h, Normal 48h, Baixa 120h)
  - Gatilho de expansão: consumo > 50 kWh, 3 meses
- Para ajustar, clique em "Editar" e mude os valores para os reais da empresa

#### **Operação → O&M e manutenção → Painel**

- Vê o dashboard com:
  - **Base instalada:** total de plantas, potência total, MRR de O&M
  - **Garantias vencendo:** próximos 90 dias
  - **Chamados em aberto:** por prioridade e MTTR

### Passo 3: Teste a rotina automática

#### Crie dados para a rotina processar:

1. **Plano de manutenção vencido:**
   - Na ficha da planta, aba O&M
   - Clique em "Novo plano"
   - Periodicidade: Mensalmente
   - Data de início: 30 dias atrás
   - Clique em "Criar"

2. **Garantia vencendo:**
   - A garantia da planta vence em (produto + performance), ex: 5 + 25 = 30 anos
   - Para testar rápido, você pode editar a data diretamente no banco (ou aguardar)

3. **Contrato de O&M vencendo:**
   - Na ficha da planta, aba O&M
   - Clique em "Novo contrato"
   - Preencha: duração em meses, valor mensal
   - Data de início: 30 dias atrás
   - Marque "Renovação automática" se quiser testar renovação

#### Execute a rotina:

- Em **Operação → O&M e manutenção**
- Clique em "Executar a rotina agora"
- A rotina vai:
  - Abrir chamados preventivos para planos vencidos
  - Criar tarefas para garantias na janela de aviso
  - Avisar sobre renovações de O&M
  - Criar oportunidades de expansão (se o gatilho disparar)

### Passo 4: Ajuste os dados de teste para dados reais

Quando tiver dados da empresa:

1. **Substituir termos de garantia:**
   - Em **Garantias**, clique em "Novo termo"
   - Suba o PDF real do fabricante
   - Insira os prazos e % corretos
   - Revise com o responsável técnico

2. **Ajustar prazos e SLA:**
   - Em **O&M e manutenção → Prazos e gatilhos**
   - Clique em "Editar"
   - Atualize os valores reais da empresa

3. **Validar o gatilho de expansão:**
   - Use faturas reais de clientes existentes
   - Ajuste o gatilho (`upsellGridKwh`, `upsellMinBills`) conforme necessário

## Checklist

- [ ] Planta criada após aceite do cliente
- [ ] Ativos aparecem com dados corretos
- [ ] Garantias aparecem (se termo cadastrado)
- [ ] Chamado criado com SLA exibido
- [ ] Chamado resolvido exige descrição
- [ ] Plano de manutenção vencido abre chamado preventivo
- [ ] Painel exibe base instalada, garantias vencendo, chamados
- [ ] Rotina executa sem erros
- [ ] Termos de teste marcados como TESTE INTERNO

## Pendências do usuário

- PDFs de termos de garantia dos fabricantes
- Prazos reais de aviso, SLA, periodicidade de manutenção
- Gatilho de expansão validado
- Revisor técnico para as garantias reais
