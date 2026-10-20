# Memorial: gerador de configurações (ENG-F25)

**Estado: projeto (implementação na 9E).** Busca **determinística** (sem IA) no catálogo aprovado da empresa; sempre **sugestão a confirmar**, nunca decisão.

## Problema

Dada a potência-alvo (kWp), o local (Tmin, Tmax de célula) e as restrições (fase, tipo de projeto), listar combinações **módulo × inversor × nº de módulos por string × nº de strings por MPPT** que passam em **todas** as verificações de compatibilidade (F02–F09, [memorial](engine-compatibilidade.md)).

## Algoritmo

1. Para cada par (módulo aprovado, inversor aprovado): calcular `Voc_frio`, `Vmpp_quente/frio` (F02, F03) e os limites `Nmin..Nmax` (F06). Par inviável é descartado com o motivo.
2. Para cada `Ns` em `Nmin..Nmax` e cada distribuição de strings pelos MPPT (respeitando corrente máxima e curto-circuito, F07): montar a configuração, calcular a potência CC e a relação CC/CA (F08) e descartar as fora da política.
3. Rodar `evaluateCompatibility` completo; só `VALID` e `VALID_WITH_WARNINGS` seguem.
4. **Ordenação** (critérios fixos, desempate estável): custo total (preço vigente) → desvio da potência-alvo → relação CC/CA mais perto do centro da política → folga de tensão (Voc frio vs. máximo) → menor nº de inversores.
5. Devolver as N primeiras (padrão 10), cada uma com **por que passou** (valores × limites) e avisos.

## Garantias

Mesma entrada → mesma saída (sem aleatoriedade, ordenação total). Equipamento não aprovado nunca entra. Regra `engine.design` ausente → o gerador devolve "pendente de regra" em vez de lista.

## Limites

Uma superfície por configuração no MVP2; várias superfícies são combinadas manualmente no editor. Microinversor entra com regra própria de entrada por módulo.

## Testes previstos

Caso de referência com catálogo pequeno (3 módulos, 3 inversores) e resposta esperada calculada à mão; teste de determinismo (ordem estável).
