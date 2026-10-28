# Previsões (Fase 12I)

Funções puras em `packages/solar-engine/src/forecast/`, com testes de séries fixas. Entram só **históricos da própria empresa**; saem números com faixa, ou `INSUFFICIENT_SAMPLE` ("dados insuficientes") quando a amostra é menor que o mínimo. **A IA não calcula:** as ferramentas `previsoes_*` devolvem estes resultados e ela os explica (premissas, amostra, faixa).

Os mínimos de amostra são **parâmetros da empresa** (`tenant.settings.analytics.minSamples`, tela de Administração → Inteligência na 12J ou `PUT /analytics/settings`). Os padrões vêm de [analitica.md](analitica.md) §amostras e **não são norma**.

| Previsão             | Mínimo (padrão)             | Parâmetro                                        |
| -------------------- | --------------------------- | ------------------------------------------------ |
| Recebimentos         | 20 parcelas pagas           | `receivablesPaid`                                |
| Fechamento do funil  | 30 oportunidades encerradas | `funnelClosed` (geral) e `groupSize`=5 por etapa |
| Atraso de instalação | 10 instalações concluídas   | `installationsDone`                              |
| Geração              | 14 dias com leitura         | `generationDays`                                 |

## 1. Recebimentos dos próximos 90 dias

- **Atraso observado** de cada parcela paga = dias entre o vencimento e o pagamento, no mínimo 0 (pagar antes não adianta a previsão).
- Cada parcela em aberto, com atraso atual `a` (0 se ainda não venceu), é datada pelos atrasos observados **maiores ou iguais a `a`** (distribuição condicionada: quem já está atrasado 20 dias não "volta" para o atraso típico de 5).
- **Cenários** (quantil por posto mais próximo, `x[⌈q·n⌉]`): melhor = P25, esperado = P50, pior = P90. São escolhas de método, não normas.
- Data = vencimento + atraso do cenário. Agrupa em semanas a partir de hoje (13 semanas). Depois do horizonte vai para "além do horizonte". Parcela mais atrasada que qualquer pagamento visto fica **sem data** (valor mostrado à parte).
- Limite: não considera inadimplência definitiva; o que ficou "sem data" é o sinal.

## 2. Fechamento do funil

- Probabilidade de uma oportunidade aberta na etapa `E` = ganhas ÷ encerradas **que passaram por `E`** (a passagem vem da linha do tempo). Etapa com menos de 5 encerradas usa a taxa geral (a etapa aparece em `stagesUsingOverallRate`).
- **Faixa:** intervalo de Wilson de 95% da proporção (`z = 1,96`).
- Valor esperado = valor da cotação mais recente × probabilidade. Quantidade esperada = soma das probabilidades. Oportunidade sem cotação conta na quantidade e é listada em `withoutValueCount`.
- **Mês:** a data esperada de fechamento, se houver; senão criação + mediana do ciclo (criação → ganho) das ganhas. Mês no passado vai para o mês atual. Sem data e sem ciclo histórico: "sem data".
- Substitui, sem apagar, a "previsão simples" do painel (que usa pesos informados pela empresa).

## 3. Atraso de instalação

- Média de dias que as instalações **concluídas** ficaram em cada situação (a partir do histórico de situações).
- Data provável = hoje + `max(0, média da situação atual − dias já decorridos)` + soma das médias das situações seguintes do caminho normal (`INSTALLATION_PATH`). `FIELD_ISSUE` usa a posição de `IN_PROGRESS` e a média própria, se existir.
- **Risco:** a instalação já está na situação atual há mais dias que a média.
- Situação sem nenhum histórico conta zero e é listada em `missingStatuses` (a data é, então, otimista).

## 4. Geração

- Esperado diário = esperado do mês (12 valores do projeto técnico aprovado) ÷ dias do mês.
- **Índice de desempenho** = Σ real ÷ Σ esperado nos dias com leitura dos últimos 30 dias (1 = igual ao esperado).
- Projeção do mês = real do mês até a última leitura + dias restantes × esperado diário × índice.
- **Sem alerta:** o desvio aceitável é regra da empresa (`ops.monitoring`); o monitoramento decide quando abrir chamado.

## Como a IA usa

Ferramentas `previsoes_recebimentos`, `previsoes_funil`, `previsoes_instalacoes` e `previsoes_geracao`: devolvem os valores já como fatos (`{{F#}}`) e, se `INSUFFICIENT_SAMPLE`, o assistente responde "não posso responder com segurança" com a amostra e o mínimo.
