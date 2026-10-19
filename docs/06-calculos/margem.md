# Margem de contribuição (Margin Guard)

Módulo `pricing` de `@voltex/solar-engine` (`margin-1.0.0`). Funções puras, em **centavos inteiros**, sem acesso a banco. O servidor é a fonte oficial; a Web usa as mesmas funções só para a **prévia** enquanto o usuário digita.

## Modelo

```
custo direto   = materiais (lista de materiais) + frete + instalação + deslocamento + outros custos
contingência   = custo direto × taxa de contingência
comissão       = preço × taxa de comissão
impostos       = preço × alíquota efetiva informada pela empresa
custo financ.  = preço × taxa de custo financeiro

custos totais  = custo direto + contingência + comissão + impostos + custo financeiro
margem (R$)    = preço − custos totais
margem (%)     = margem (R$) ÷ preço            ← o que se compara com a política
markup (%)     = margem (R$) ÷ custos totais
```

- Cada item da lista de materiais tem categoria (módulos, inversor, estrutura, proteções, cabos, outros), descrição, quantidade e custo unitário.
- **A alíquota de impostos é uma entrada da empresa**: o regime tributário varia (Simples, presumido, real) e o motor **não presume nenhuma**. O mesmo vale para comissão, custo financeiro e contingência.
- **Preço mínimo** para uma margem alvo `m`: `(custo direto × (1 + contingência)) ÷ (1 − comissão − impostos − financeiro − m)`, arredondado para cima ao centavo. Aparece na tela da cotação quando ela está abaixo da política, para o vendedor saber o piso. Se a soma das taxas e da margem alvo chega a 100%, não existe preço que atinja a meta e o piso é omitido.

## Situação em relação à política

| Situação        | Quando                                                                  |
| --------------- | ----------------------------------------------------------------------- |
| `WITHIN_POLICY` | margem ≥ mínimo da política que vale para a oportunidade                |
| `BELOW_POLICY`  | margem < mínimo                                                         |
| `NO_POLICY`     | a empresa não definiu nenhuma política aplicável (**nada é presumido**) |

A política que vale é a **mais específica entre as ativas**: time + tipo de projeto, depois time, depois tipo de projeto, depois a geral. Empate: a mais recente. O time é o do responsável pela oportunidade.

## Exemplo conferido nos testes

Materiais R$ 8.500 (8 módulos de R$ 600, inversor R$ 2.500, estrutura R$ 1.200), frete R$ 400, instalação R$ 2.000, deslocamento R$ 200, outros R$ 100, contingência 3%, comissão 5%, impostos 6%, financeiro 2%, preço R$ 19.800:

| Linha         | Valor               |
| ------------- | ------------------- |
| Custo direto  | R$ 11.200,00        |
| Contingência  | R$ 336,00           |
| Comissão      | R$ 990,00           |
| Impostos      | R$ 1.188,00         |
| Financeiro    | R$ 396,00           |
| Custos totais | R$ 14.110,00        |
| Margem        | R$ 5.690,00 (28,7%) |

Preço mínimo para 20% de margem: R$ 17.217,93.

## Limites

- O custo de aquisição, as alíquotas e as taxas **não vêm do sistema**: são informados na cotação. Não há catálogo de preços até a Fase 9.
- A margem é **de contribuição** (preço menos custos variáveis do projeto). Não rateia despesas fixas da empresa.
