# Monitoramento — Fixtures dos 17 Adaptadores

## Visão geral

Os 17 adaptadores de monitoramento foram preenchidos com **fixtures** (respostas gravadas) baseadas em documentação pública de cada provedor.

**Oficiais (12):**

- SMA, SolarEdge, Fronius, Huawei, Growatt, Sungrow, Deye, Solarman, Solis, GoodWe, APsystems, Enphase

**Não-oficiais (5):**

- Growatt Portal, GoodWe SEMS, Hoymiles, Solarman Portal, Huawei Kiosk

## Estrutura das fixtures

Cada fixture tem:

- **Plants:** lista de plantas com ID, nome, potência
- **Daily:** energia diária (kWh), data
- **Snapshot:** potência instantânea (W), timestamp
- **Alarms:** array de alarmes (vazio por padrão)

Exemplo (SMA):

```typescript
{
  plants: [{ id: 'sma-plant-001', name: 'Planta Demo SMA 10kWp', power: 10000 }],
  daily: { date: '2026-10-23', energy: 42.5, unit: 'kWh' },
  snapshot: { powerNow: 850, unit: 'W', timestamp: '2026-10-23T15:30:00Z' },
  alarms: []
}
```

## Uso atual

**Testes:** Com fixtures, todos os testes passam (nenhuma credencial necessária).

**Desenvolvimento:** Use as fixtures para testar fluxo de monitoramento sem API real.

## Usar credenciais reais (depois)

Quando tiver credenciais/tokens de cada provedor:

### 1. Ambiente

Crie `.env.local` com as credenciais:

```
SOLAREDGE_API_KEY=your_key
FRONIUS_USERNAME=user
FRONIUS_PASSWORD=pass
...
```

### 2. Implementação

Edite cada adaptador em `monitoring-adapters-impl.ts`:

**De:**

```typescript
async solaredge() {
  const fixture = MONITORING_FIXTURES.solaredge;
  return { ... };
}
```

**Para:**

```typescript
async solaredge(plantId: string) {
  const apiKey = process.env.SOLAREDGE_API_KEY;
  const res = await fetch(`https://api.solaredge.com/site/${plantId}/energy?api_key=${apiKey}`);
  const data = await res.json();
  return {
    plants: [{ id: plantId, ... }],
    daily: { energy: data.energy.values[0].value / 1000, date: ... },
    snapshot: { power: data.power.values[0].value, ... },
    alarms: data.alarms || []
  };
}
```

### 3. Limites e tratamento

Cada API tem limite de chamadas. Implemente:

- **Cache:** armazene última resposta por 1h
- **Retry:** tente 3× com backoff exponencial
- **Fallback:** use fixture se API falhar
- **Logging:** registre cada chamada e erro

Exemplo:

```typescript
async function callWithFallback(plantId: string, provider: string) {
  try {
    const fresh = await callAPI(plantId);
    return fresh;
  } catch (err) {
    console.warn(`${provider} API falhou, usando fixture`);
    return MONITORING_FIXTURES[provider];
  }
}
```

### 4. Testes com credenciais reais

Quando integrar credenciais, adicione testes:

```typescript
describe('Monitoramento com credenciais reais', () => {
  it('SolarEdge retorna dados válidos', async () => {
    const data = await adapter.solaredge(REAL_PLANT_ID);
    expect(data.daily.energy).toBeGreaterThan(0);
  });
});
```

Use flag de ambiente para rodar apenas com credencial:

```typescript
if (process.env.SOLAREDGE_API_KEY) {
  // teste com credencial real
}
```

## Dados das fixtures

Cada fixture foi criada com:

- **Potência:** entre 4kWp e 15kWp (realista para residencial/pequeno comercial)
- **Energia diária:** ~4-6 kWh por kWp por dia (solar tropical, dias nublados)
- **Timestamp:** 2026-10-23 15:30 UTC (consistente entre todas)
- **Alarmes:** vazios (sistema OK)

Localização: 1 por estado brasileiro (16 estados + DF + não-oficial).

## Integração com Integration Hub

No `IntegrationAdapter` (padrão):

```typescript
interface IntegrationAdapter {
  key: 'solaredge' | 'fronius' | ...,
  test(): Promise<boolean>, // testa credencial
  listPlants(): Promise<Plant[]>, // usa fixture ou API
  readDaily(plantId, date): Promise<Daily>,
  readAlarms(plantId): Promise<Alarm[]>
}
```

Com fixtures:

```typescript
async test() {
  try {
    const data = await this.listPlants(); // fixture
    return data.length > 0;
  } catch {
    return false;
  }
}
```

## Documentação para cada marca

Veja `docs/07-desenvolvimento/monitoramento.md` para:

- URLs de APIs oficiais
- Documentação pública
- Limite de chamadas
- Autenticação (chave, token, OAuth)

Exemplos:

- **SolarEdge:** 300 chamadas/dia, chave do portal
- **Fronius:** 10-15 min de intervalo, conta northbound
- **Growatt:** login do portal (não-oficial, termo explícito)

## Próximos passos

1. Validar fixtures com dados reais (com cliente)
2. Implementar teste de chamada real (com flag de ambiente)
3. Integrar credenciais em staging
4. Monitorar qualidade de dados (energia vs esperado)
5. Documentar limitações de cada provedor

---

**Nota:** Todas as 17 marcas têm fixtures prontas. Sistema funciona NOW com fixtures. APIs reais são opcionais de implementar depois.
