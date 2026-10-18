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
- Compatibility Engine (módulo × inversor) — MVP2
- Off-Grid (perfil de carga, banco de baterias, autonomia) — MVP3

## Fontes

- [Base EnergIF 2023: regras e medidas](../referencias/energif-2023/regras-e-medidas.md) (orientação, inclinação, classificação micro/mini, módulos de referência).
- O livro **não traz** as fórmulas de dimensionamento comercial (PR, payback, custo de disponibilidade...): veja "O que o livro não fornece" no documento acima. Até a validação por especialista, as fórmulas do Calculator são **rascunho de engenharia padrão**.

## Aviso regulatório

O material técnico que fundamenta o projeto é de 2023. Conceitos físicos e elétricos são estáveis e vão para o motor de cálculo. Normas, tarifas e exigências de concessionárias **não** são constantes no código: vivem no Rules Engine, com fonte e vigência.
