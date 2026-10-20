# Memorial: conexão com a rede (ENG-F22)

**Estado: projeto (implementação na 9G).** O código só calcula grandezas físicas; **toda exigência de distribuidora vive em dados** (regra `engine.connection` por escopo) com a norma citada. Regra por distribuidora só entra com **a norma vigente em mãos** (RN-012, RN-017).

## Cálculos (físicos)

- **Potência de injeção máxima:** `P_inj = min(P_ca_nom_total, limitação de exportação)`; com Grid Zero, a injeção alvo é 0 e o sistema limita pela carga instantânea.
- **Classe:** micro/minigeração pela potência instalada (limites como parâmetros: 75 kW e 5 MW, EF-M06, a confirmar com a regulação vigente; reaproveita `classifyGeneration`).
- **Relação com a potência disponibilizada/demanda contratada:** `P_ca_nom_total` ÷ disponibilizada, para conferência (parâmetro de regra define o limite).
- **Inversão de fluxo:** só sinaliza quando, **com perfil horário de carga** informado, a injeção supera a carga em algum período; sem perfil, apenas o aviso genérico.
- **Qualidade de energia (informativo):** tempos de desconexão por tensão e frequência, harmônicos e fator de potência são **certificação do inversor** (NBR 16149; EF-M17..M19). O Engine exibe o dado do catálogo e **não** o recalcula. A tabela de fator de potência do livro tem erros (EF-I02/M20): não usar.

## Regras (dados)

Condições do avaliador ENG-F26 sobre o contexto `{plant, connection, distributor, customer}` com saída `{severidade, código, mensagem, fonte}`. Exemplo (**fictício, só para formato**): se `plant.acKw > connection.availableKw` então `WARNING CONN_ABOVE_AVAILABLE` com fonte da norma. Cada regra aponta para a fonte vigiada (`sourceWatchIds`): quando a página da norma muda, nasce proposta de revisão ao responsável técnico.

## Checklist de acesso

Reaproveita o checklist de homologação da 7C (EF-R15: ART de projeto e execução, proteções do PRODIST módulo 3, localização da UC).

## Limites

Sem estudo de fluxo de potência, sem dimensionamento de transformador, sem simulação da rede. Fora do MVP2.
