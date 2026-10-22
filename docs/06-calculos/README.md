# Memorial de cálculos

Cada função do pacote `@voltex/solar-engine` tem um memorial aqui, com: fórmula, unidades, premissas, faixas válidas, versão do algoritmo, tolerâncias e casos de teste. Um cálculo só é considerado **pronto** quando cumpre a definição de pronto abaixo (seção 83 da modelagem).

## Definição de pronto de um cálculo

- inputs persistidos;
- unidade de medida explícita;
- validação de faixa;
- versão do algoritmo;
- testes automatizados;
- tolerâncias documentadas;
- premissas visíveis;
- snapshot;
- comparação com casos conhecidos;
- revisão por especialista antes da liberação produtiva.

## Índice

- [Solar Calculator](calculator.md) — MVP1
- [Margem de contribuição](margem.md) — MVP1 (Margin Guard)
- Solar Engine Studio — MVP2 (Fase 9). Estado: 9A entregou temperatura, strings e posição solar; o resto é memorial de projeto
  - [Temperatura, strings e compatibilidade](engine-compatibilidade.md) — **implementado** (F01–F06)
  - [Posição solar e sombreamento](engine-posicao-solar-sombreamento.md) — **implementados** (F16, F17)
  - [Layout dos módulos](engine-layout.md) — **implementado** (F15)
  - [Configurador](engine-configurador.md) — projeto (9E)
  - [Proteções, cabos e lista de materiais](engine-protecoes-cabos.md) — projeto (9F)
  - [Irradiação no plano e simulação horária](engine-irradiacao-simulacao.md) — projeto (9G)
  - [Conexão com a rede](engine-conexao.md) — projeto (9G)
  - [Viabilidade econômica](engine-economia.md) — projeto (9H)
- Off-Grid (Fase 10):
  - [Perfil de carga](offgrid-carga.md)
  - [Recurso solar e dimensionamento](offgrid-dimensionamento.md)
  - [Verificação do que foi escolhido](offgrid-compatibilidade.md)
  - [Despacho horário, gerador, rede e estresse](offgrid-despacho.md)
  - [Custo](offgrid-economia.md)
  - [Projeto visual do terreno e cabos](offgrid-layout.md)

- Operação (Fase 11):
  - [Comissionamento: valor esperado e julgamento dos ensaios](comissionamento.md)

## Fontes

- [Manual CRESESB 2014: extração com página](../referencias/cresesb-2014/README.md) (temperatura, strings, cabos, PR).
- [Fontes externas: licenças e termos](../referencias/fontes-externas.md).
- [Base EnergIF 2023: regras e medidas](../referencias/energif-2023/regras-e-medidas.md) (orientação, inclinação, classificação micro/mini, módulos de referência).
- O livro **não traz** as fórmulas de dimensionamento comercial (PR, payback, custo de disponibilidade...): veja "O que o livro não fornece" no documento acima. Até a validação por especialista, as fórmulas do Calculator são **rascunho de engenharia padrão**.

## Aviso regulatório

O material técnico que fundamenta o projeto é de 2023. Conceitos físicos e elétricos são estáveis e vão para o motor de cálculo. Normas, tarifas e exigências de concessionárias **não** são constantes no código: vivem no Rules Engine, com fonte e vigência.
