# Setup Inicial — Configurações Padrão

Guia para inicializar o sistema com valores padrão e depois customizar conforme sua empresa.

## 1. Executar seed de padrões

```bash
cd packages/database
npx tsx ../api/src/cli/seed-defaults.ts
```

Isso cria:

- **Termos de garantia**: 6 fabricantes com dados padrão (SMA 10 anos, Fronius 12 anos, etc)
- **Regra comissionamento**: 20+ itens de teste (NBR 16274, exemplo)
- **Política comissão**: 5% base RECEBIDO (ajustar depois)
- **Critérios scoring**: origem 20%, consumo 30%, região 10%
- **Regra monitoramento**: limiar 15%, manutenção anual

## 2. Substituir por dados reais

### 2.1 Termos de garantia

1. Entre em **Operação → Garantias**
2. Clique em cada fabricante (ex: SMA)
3. **Substituir PDF** (campo "Documento do termo")
4. Verificar se prazos conferem (ex: SMA Solar pode ter 10 ou 12 anos)
5. **Salvar**

> **Nota:** Sem PDF oficial, o termo fica marcado como "exemplo". Cliente será avisado.

### 2.2 Checklist de comissionamento

1. Entre em **Operação → Comissionamento → Configurações**
2. Abra a regra "Comissionamento Padrão (NBR 16274)"
3. **Editar:**
   - Tolerâncias (min/max) baseadas em seu RT
   - Adicionar testes específicos do seu projeto (ex: teste de corrente residual)
   - Remover testes não aplicáveis
4. **Agendar aprovação** com RT
5. Quando aprovado, **Status: ACTIVE** (aí passa a valer para novo projeto)

Exemplo: se seu RT pede isolamento ≥ 1,5kΩ/V, edite de 1.000 para 1.500.

### 2.3 Política de comissão

1. Entre em **CRM → Vendas → Comissão**
2. Abra a política padrão
3. **Ajustar:**
   - Base: RECEBIDO ou ASSINADO?
   - % por perfil: SALESPERSON 5%, SALES_MANAGER 2%, SDR 1%?
4. **Salvar**

> **Pendência:** Só aparece uma política. Para ter múltiplas (ex: normal vs incentivo), edite direto no banco ou peça.

### 2.4 Critérios de lead scoring

1. Entre em **CRM → Leads → Scoring**
2. Edite cada critério:
   - **Origem**: qual peso para cada source (organic, paid, referral)?
   - **Consumo**: limites de high/medium/low kWh/mês?
   - **Região**: pesos por estado?
3. Ative/desative critérios conforme sua estratégia
4. **Salvar**

Exemplo: se quer focar em consumo alto, aumente peso para 50%.

### 2.5 Limiar de desvio (monitoramento)

1. Entre em **Operação → Monitoramento → Configurações**
2. Abra a regra "Monitoramento Padrão"
3. **Editar:**
   - `deviationThreshold`: 15% por padrão. Seu RT define (ex: 12%)?
   - `consecutiveDays`: quantos dias com desvio antes de alerta?
   - `maintenancePeriodicity`: anual, semestral?
4. **Salvar**

Sem regra ACTIVE, o sistema só mostra gráfico real × esperado (sem alerta automático).

## 3. Prazos de retenção (LGPD)

Valores padrão (em `packages/shared/src/constants/retention.ts`):

| Dado                 | Dias       | Motivação             |
| -------------------- | ---------- | --------------------- |
| Fotos campo          | 1095 (3a)  | Prazos de garantia    |
| Geolocalização       | 730 (2a)   | Histórico de chamados |
| Acessos portal       | 730 (2a)   | Auditoria de sessão   |
| Logs comunicação     | 365 (1a)   | Histórico de contato  |
| Audit logs           | 2555 (7a)  | Compliance fiscal     |
| Documentos assinados | 3650 (10a) | SPC (prescrição)      |
| Chamados             | 1095 (3a)  | Pós-garantia          |

**Personalizar:**

- Edite os valores em `retention.ts`
- Rebuild e redeploy
- Sistema purgará automaticamente após o prazo

> **Aviso:** Prazos recomendados por LGPD/SPC. Seu advogado pode pedir ajustes.

## 4. Disclaimer DocuSeal

Antes de ativar assinatura eletrônica:

1. Leia ADR-0025 (`docs/04-arquitetura/adr/0025-docuseal-opcional.md`)
2. **Solicite parecer jurídico** sobre validade (Lei 2.200-2/2001)
3. Se aprovado:
   - Configure credencial DocuSeal no Integration Hub
   - Teste em staging
   - Documente aprovação

> **Responsabilidade:** Validade jurídica é sua (empresa/advogado).

## 5. Checklist de aprovação

- [ ] Termos de garantia com PDFs reais
- [ ] Checklist comissionamento aprovado por RT (status ACTIVE)
- [ ] Política comissão definida
- [ ] Critérios lead scoring calibrados
- [ ] Limiar desvio aprovado por RT
- [ ] Prazos retenção confirmados com advogado
- [ ] DocuSeal com parecer jurídico (se usar)

Depois disso, sistema está pronto para produção com sua empresa.

## 6. Comandos úteis

```bash
# Executar seed
npx tsx ../api/src/cli/seed-defaults.ts

# Listar regras
SELECT * FROM rulesets WHERE tenant_id = '<seu-tenant>' ORDER BY model_id;

# Verificar retenção
SELECT * FROM "RETENTION_DEFAULTS" LIMIT 5;
```
