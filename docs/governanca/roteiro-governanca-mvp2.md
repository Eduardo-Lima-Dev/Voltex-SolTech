# Roteiro de governança do MVP2 (Solar Engine Studio)

O código do Engine (9A–9L) está pronto. O MVP2 só fecha quando as pendências abaixo, que dependem de pessoas, estiverem resolvidas e registradas. Este roteiro diz **quem faz o quê, em que ordem e como saber que acabou**.

**Princípio:** quem assina é o **engenheiro de cada local**, não a Voltex. O sistema registra quem assinou, com qual registro e com quais regras. A empresa mantém as regras; cada engenheiro as confere e as assume ao assinar o projeto.

## Papéis

| Papel                               | Responsabilidade                                                                 |
| ----------------------------------- | -------------------------------------------------------------------------------- |
| Engenheiro responsável técnico (RT) | Conferir e ativar regras; assinar cada projeto (nome, CREA/CFT/CAU, ART/TRT/RRT) |
| Jurídico                            | Licenças, termos, LGPD, redação de contrato                                      |
| Financeiro                          | Conferir o método econômico (compensação, Fio B por ano, financiamento, VPL/TIR) |
| Dados / catálogo                    | Arquivos `.PAN/.OND`, fichas, normas das distribuidoras                          |
| Desenvolvimento                     | Mudanças de código da fase 2 e 3, auditoria dos arquivos, documentação           |

## Ordem

1. **Licenças** (jurídico, dados) → [licencas-e-termos.md](licencas-e-termos.md): enviar os três e-mails, exibir atribuições, arquivar respostas.
2. **Modelo do engenheiro por projeto** (desenvolvimento): signatário no projeto e no snapshot de aprovação, trava `SIGNATORY_MISSING`.
3. **Regras reais** (RT + desenvolvimento) → [matriz-regras.md](matriz-regras.md): importar os rascunhos, conferir cada valor na norma, completar queda de tensão e ampacidade, ativar.
4. **Normas das distribuidoras** (dados + RT): um bloco por distribuidora.
5. **Arquivos `.PAN/.OND`** (dados + desenvolvimento) → [pan-ond-auditoria.md](pan-ond-auditoria.md).
6. **Validação financeira** (financeiro).
7. **Fechamento**: jornada de ponta a ponta com regras ativas e signatário; atualizar roadmap.

## 1. Licenças (jurídico e dados)

- [ ] Enviar o e-mail ao NASA POWER, ao NREL/CEC e à Techlux (modelos em `licencas-e-termos.md`).
- [ ] Arquivar cada resposta em `docs/governanca/evidencias/` com a data.
- [ ] Ajustar `licenseStatus` em `data-hub.registry.ts` conforme a resposta (`CLEARED` ou `BLOCKED`).
- [ ] Conferir que as atribuições aparecem na tela do clima, no memorial e no relatório do cliente.
- [ ] Revisão do advogado nos itens listados no fim de `licencas-e-termos.md`.

**Aceite:** cada fonte ligada tem licença registrada com data, ou está marcada pendente e desligada em produção.

## 2. Engenheiro por projeto (desenvolvimento)

- [ ] Campos do signatário no projeto: nome, conselho (CREA/CFT/CAU), registro, UF, tipo e número da ART/TRT/RRT, data.
- [ ] Aprovar versão exige signatário completo (`SIGNATORY_MISSING`).
- [ ] O snapshot grava o signatário, as regras aplicadas (chave, versão, escopo, fontes, revisor) e a declaração do engenheiro, dentro do conteúdo que gera o hash.
- [ ] Memorial e relatório mostram o signatário e o aviso de que o documento não substitui a ART.
- [ ] Ativar regra exige nome e registro do revisor.
- [ ] Aprovação: o engenheiro aprova; a segunda revisão por outro engenheiro é opcional por projeto (como a revisão obrigatória de um PR) e o envio pode pedir a revisão de alguém.

**Aceite:** versão aprovada sem signatário é recusada; o snapshot aprovado mostra quem assinou e com quais regras.

## 3. Regras reais (engenheiro RT)

Para cada chave de [matriz-regras.md](matriz-regras.md):

1. Importar o rascunho de `regras/<chave>.json` (`POST /rules`).
2. Conferir **cada valor** no texto da norma (ABNT) ou no ato oficial; corrigir o que divergir; anotar o item e a edição na fonte.
3. Completar o que ficou sem valor: queda de tensão CC e CA, `acBreakerFactor`, tabela de ampacidade.
4. Ativar informando nome e registro.
5. Em cada projeto, conferir as regras aplicadas ao assinar.

**Aceite:** `engine.design`, `engine.cables`, `engine.economics` e `engine.connection` ativas, cada uma com fonte, versão e revisor identificado.

## 4. Normas das distribuidoras (bloco repetível)

Para cada distribuidora: (1) achar a norma vigente no site oficial; (2) cadastrar a URL em **Fontes de dados** para vigiar mudanças; (3) extrair cada exigência; (4) escrever a regra condicional em `engine.connection` com `source` (norma, versão, seção); (5) o RT revisa e ativa. Ordem: CEMIG-D, COPEL, COELBA, CPFL Paulista, RGE Sul, Equatorial/EMT, depois Energisa, Neoenergia, EDP e Enel.

**Aceite:** pelo menos as distribuidoras onde a empresa tem projetos têm regra com fonte ativa; as demais mostram "pendente de regra".

## 5. Arquivos `.PAN` e `.OND`

Seguir [pan-ond-auditoria.md](pan-ond-auditoria.md). **Aceite:** 95% ou mais dos arquivos lidos sem erro físico e com os campos obrigatórios.

## 6. Validação financeira (financeiro)

- [ ] Receber a planilha independente gerada pelo desenvolvimento (compensação, Fio B por ano, financiamento Price/SAC, VPL, TIR, payback).
- [ ] Rodar 3 casos reais e comparar com o motor.
- [ ] Registrar a conferência (nome, data, casos).

**Aceite:** diferença abaixo de 1% nos três casos, ou divergência explicada e corrigida.

## 7. Fechamento

- [ ] Jornada Playwright de ponta a ponta com regras ativas e signatário.
- [ ] `docs/09-roadmap/roadmap.md` e `hand-off-fase-9.md`: MVP2 como entregue **somente** com os aceites acima.

## O que o sistema nunca faz

- Ativar regra sozinho.
- Assinar por uma pessoa.
- Usar fonte sem licença registrada.
- Redistribuir arquivos de fabricante.
