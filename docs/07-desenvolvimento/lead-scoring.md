# Lead Scoring e Roteamento

Pontuação automática de leads com base em critérios da empresa e roteamento para vendedor.

## Critérios

Cada critério tem:

- **Nome**: ex. "Consumo alto"
- **Peso**: 0-100, relativo (não é percentual)
- **Tipo**: origin, consumption, profile, region
- **Valores**: lookup por valor do campo

Exemplo (consumo):

```json
{
  "name": "Consumo",
  "weight": 30,
  "type": "consumption",
  "values": {
    "high": 100,
    "medium": 50,
    "low": 10
  }
}
```

Exemplo (origem):

```json
{
  "name": "Lead Quality",
  "weight": 20,
  "type": "origin",
  "values": {
    "organic": 100,
    "paid": 70,
    "referral": 80
  }
}
```

## Cálculo

Score = Σ(critério × peso) / Σ(peso), normalizado 0-100.

Se nenhum critério se aplica, score é 0.

## Roteamento

Método:

- **roundRobin**: vendedores em ordem circular
- **region**: vendedor por estado (config: `{ "SP": "user-id-1", "RJ": "user-id-2" }`)
- **availability**: por horas de trabalho ou tickets abertos

Configurável por empresa. O sistema tenta roteamento configurado; se falhar, cai para roundRobin.

## Fluxo

1. Lead entra no sistema.
2. Sistema calcula score com critérios ativos.
3. Roteador escolhe vendedor (se policy ativa).
4. Lead é atribuído.

## Pendências da empresa

- Critérios: quais campos, pesos, valores por tipo
- Política de roteamento: qual método, configuração por region/horário
