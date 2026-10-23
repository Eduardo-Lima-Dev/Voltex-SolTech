# Financeiro por projeto (Fase 11G)

Registro manual de recebíveis, custos, crédito e comissões. Sem gateway de pagamento.

## Estrutura

### Recebíveis (parcelas)

Criadas na ficha do projeto. Cada parcela tem:

- **Número de referência** (NF, pedido, contrato)
- **Ordem** (1ª, 2ª, parcela final)
- **Valor** (em centavos para evitar floating point)
- **Vencimento** (data)
- **Status:** OPEN → PAID (com data e forma) → OVERDUE → CANCELLED
- **Observação** (opcional)

**Fluxo:**

1. Empresa cria parcela na ficha do projeto
2. Cliente recebe boleto/trf (fora do sistema)
3. Empresa marca como PAID, informa forma de pagamento
4. Sistema calcula automaticamente: dias em atraso, margem realizada

### Custos reais

Registro de material, mão de obra, transporte, outros.

- **Categoria**: MATERIAL, LABOR, TRANSPORT, OTHER
- **Descrição**: ex. "Painéis 450W Jinko"
- **Estimado** (opcional, da cotação)
- **Realizado** (da nota fiscal)
- **Fornecedor** (opcional)
- **Data** (quando foi registrado)

**Cálculo de margem:**

```
Margem = Recebido - Custos - Comissões
Margem % = Margem / Valor do contrato * 100
```

### Crédito (simulação)

Registro de financiamento proposto/aprovado.

- **Instituição**: nome do banco
- **Status**: SIMULATED → SENT → PENDING → APPROVED/REJECTED
- **Valor**: valor financiado
- **Taxa**: anual, em %
- **Prazo**: em meses
- **Total com juros**: calculado automaticamente
- **Pendências**: lista de documentação faltando
- **Resposta em**: data de aprovação/rejeição

**Fluxo:**

1. Empresa simula financiamento para o cliente
2. Cliente aprova e empresa marca como SENT
3. Aguarda resposta (PENDING)
4. Banco aprova/rejeita (external) → empresa registra em APPROVED/REJECTED
5. Não há integração com o banco; é só acompanhamento

### Comissão

Política: base (RECEBIDO ou ASSINADO) + pesos por perfil.

- **Calculada**: quando o gatilho dispara (venda assinada ou recebimento)
- **Por**: vendedor, engenheiro, gerente (profiles)
- **Valor**: em centavos
- **Paga em**: data (registrada depois que a empresa paga)

Sem automação de cálculo ou pagamento. A empresa define a política, audita a comissão e paga.

## API

**Rotas:**

```
GET    /projects/:projectId/finance/summary
POST   /projects/:projectId/finance/receivables
GET    /projects/:projectId/finance/receivables
POST   /projects/:projectId/finance/receivables/:id/mark-paid
POST   /projects/:projectId/finance/credit-applications
POST   /projects/:projectId/finance/credit-applications/:id/status
```

**Resumo** (GET /summary):

- Valor do contrato
- Total recebido (parcelas PAID)
- Total de custos
- Total de comissões
- Margem (centavos e %)
- Contagem: parcelas, parcelas pagas, vencidas

## Telas

**Aba Financeiro** (na ficha do projeto):

- Resumo em cards: valor, recebido, custos, margem %
- Abas: Parcelas, Custos, Crédito

**Parcelas:**

- Lista com status, vencimento, dias em atraso
- Botão "Marcar como pago" (data + forma de pagamento)
- Botão "Adicionar parcela"

**Custos:**

- Lista com categoria, estimado, realizado, desvio %
- Botão "Registrar custo"

**Crédito:**

- Lista de aplicações com instituição, status, valor
- Botão "Simular crédito"
- Detalhes: taxa, prazo, total, pendências

## Considerações

- **Manual é seguro**: não há chave de cartão ou conta no sistema.
- **Auditoria**: cada registro deixa rastro em audit log (quem, quando, quê).
- **Integração futura**: quando houver gateway (Fase 13), recebíveis e crédito integram direto — esta base manual fica como fallback.
- **Relatórios**: margem, inadimplência, comissão por vendedor — todos dependem dessa entrada manual ser precisa.

## Pendências do usuário

- Política de comissão da empresa (base e pesos)
- Cronograma de parcelas típico
- Prazo padrão de inadimplência (quando OPEN vira OVERDUE)
