# Monitoramento de inversores

Guia de uso e de manutenção. Decisão: [ADR-0027](../04-arquitetura/adr/0027-monitoramento-adaptadores-e-regra.md).

## Como entra o dado

1. **Planilha (CSV)** — qualquer marca. Colunas de data e kWh; a tela de monitoramento da planta mostra a prévia e
   as linhas recusadas antes de gravar.
2. **API do fabricante** — só onde há adaptador (SolarEdge, APsystems, Fronius). Admin → Integrações: cadastrar a
   credencial, testar e ligar. O provedor também precisa estar em `INTEGRATIONS_ENABLED_PROVIDERS`.

Provedores sem adaptador aparecem com o aviso "Sem adaptador" e não podem ser ligados.

## Real × esperado

A geração esperada vem do projeto técnico aprovado (`designRef`). O índice de desempenho é kWh real ÷ kWh esperado do
mês. Memorial de cálculo: `docs/06-calculos/desempenho-planta.md` (a fazer, ver pendências).

## Chamado por desvio

Só com a regra `ops.monitoring` ativa e versionada (limiar de desvio e dias consecutivos). **Esses números são da
empresa ou do responsável técnico; o sistema não traz padrão.** Sem a regra, nada é aberto sozinho.

## Pendências declaradas

- Formatos de SolarEdge, APsystems e Fronius não foram validados com conta real.
- Demais provedores: aguardam documentação oficial.
