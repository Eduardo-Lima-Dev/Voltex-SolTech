# Memorial: proteções, cabos e lista de materiais (ENG-F10 a F14, F24)

**Estado: implementado na 9F.** Nada aqui tem valor normativo embutido: fatores e tabelas vêm das regras `engine.design` e `engine.cables`, revisadas pelo responsável técnico. Sem regra ativa, a etapa mostra "pendente de regra" e **bloqueia a aprovação**.

## O que o livro e o manual dão (e o que não dão)

- **EnergIF (EF-M13, M14, R12):** componentes das proteções CC e CA; **até 2 strings em paralelo sem fusível**, 3 ou mais exigem fusível em cada string; fusível pelo valor máximo da ficha do módulo (requisito do fabricante BYD, não norma).
- **CRESESB (CR-10):** seção mínima do condutor CC `S = ρ·d·I/ΔV` (d = ida e volta), `ρ(T) = ρ20·(1 + 0,0039·(T − 20))`, cobre `ρ20 = 0,01724 Ω·mm²/m`.
- **Não dão:** fator de dimensionamento de fusível/disjuntor/DPS, capacidade de condução por método de instalação, queda de tensão máxima, seção do condutor de aterramento. Vêm das **NBR 16690 e 5410 (pagas)**: o responsável técnico fornece o resumo e a tabela, e o sistema os guarda como regra com fonte.

## ENG-F10: fusível de string

`necessário = (strings em paralelo ≥ maxParallelStringsWithoutFuse + 1)`; corrente nominal do fusível `In` com `1,0·Isc(T)·k_min ≤ In ≤ I_max_fusivel_modulo`. Parâmetros de regra: `maxParallelStringsWithoutFuse` (EF-R12 sugere 2), `fuseMinFactor` (k_min, **sem valor padrão**). Item escolhido do catálogo: o menor aprovado que atende, com justificativa legível; se nenhum atende, `NO_FUSE_AVAILABLE`.

## ENG-F11: seccionadora CC, DPS CC/CA

Seccionadora: tensão nominal ≥ `Voc_frio × Ns` e corrente ≥ `Isc(T) × k`. DPS: tensão máxima de operação contínua ≥ `Voc_frio × Ns`. Parâmetros de regra, sem padrão.

## ENG-F12: disjuntor CA, DR

Disjuntor: `I_ca = P_ca / (√3 · V · cosφ)` (trifásico) ou `P_ca / (V · cosφ)`; nominal escolhido no catálogo com folga de regra (`acBreakerFactor`). DR: sensibilidade 30 mA (EF-M14) por regra.

## ENG-F13: queda de tensão

CC: `ΔV = ρ(T)·d·I / S` e `ΔV% = ΔV / V_string`. CA monofásico/trifásico: `ΔV = k·ρ·d·I/S` com `k = 2` (mono, ida e volta) ou `√3` (trifásico). Limite máximo por trecho: parâmetro da regra `engine.cables` (sem padrão). Entradas: comprimento, corrente de projeto, seção do catálogo, temperatura do condutor (premissa visível).

## ENG-F14: capacidade do cabo

Tabela `ampacity` da regra `engine.cables` (linhas por seção, método de instalação, temperatura, agrupamento, com fator de correção). **Sem tabela ativa, o resultado é `PENDING_RULE`**, nunca um valor presumido.

## ENG-F24: lista de materiais

Agrega módulos, inversores, proteções, cabos (comprimento × 1 + sobra de regra), estrutura (por módulo) e serviços, na mesma categorização da cotação do CRM (7B). Preço vem da tabela de preços com vigência (9C) ou custo de referência do catálogo; item sem preço aparece como **"sem preço"**, e a cotação fica bloqueada para esse item.

## Testes previstos

Casos de ouro à mão: queda de tensão de um trecho de 30 m, 4 mm², 12 A (CC) com a resistividade a 20 °C e a 70 °C; fusível com 2 e 3 strings; ausência de regra → `PENDING_RULE`.
