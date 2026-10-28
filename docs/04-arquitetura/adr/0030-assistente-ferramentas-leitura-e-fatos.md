# ADR-0030: Assistente por ferramentas de leitura e fatos referenciados

- **Status:** Aceita (implementação nas sub-fases 12B a 12E)
- **Data:** 2026-10-25

## Contexto

O assistente precisa responder sobre funil, financeiro, clientes e obras **sem inventar** e **sem receber dado bruto**, respeitando o perfil de quem pergunta e a carteira do vendedor (ADR-0028).

## Decisão

1. **A IA só enxerga o que as ferramentas de leitura entregam.** Cada ferramenta chama um serviço que já existe, **com o usuário que pergunta** (mesma empresa, mesmo perfil, mesma carteira) e exige a mesma permissão do `GET` correspondente.
2. **Mascaramento:** CPF, CNPJ, e-mail, telefone, endereço, CEP, coordenadas, UC, contratos, documentos e fotos nunca saem do servidor. Nomes viram pseudônimos (`[CLIENTE_1]`) e voltam a nome real só na tela de quem pode ver.
3. **Fatos referenciados:** todo número, valor, data e código de uma resposta vem de uma tabela de fatos (`{{F3}}`) montada a partir do resultado das ferramentas. O modelo escreve só a referência; o servidor troca pelo valor formatado. Comparações, rankings e variações são calculados pelo sistema, não pelo modelo.
4. **Validador:** reprova a resposta que tiver algarismo solto, referência inexistente, pseudônimo inexistente, dado pessoal ou idioma errado. Reprovada duas vezes, o usuário recebe só os dados consultados, em tabela, nunca um texto não verificado.
5. **"Não posso responder":** formato estruturado (`ANSWER`, `CANNOT_ANSWER`, `NEEDS_CLARIFICATION`) e, quando for recusa, **texto fixo do sistema** com o motivo (`NO_DATA`, `NO_TOOL`, `ACCESS_DENIED`, `OUT_OF_SCOPE`, `INSUFFICIENT_SAMPLE`).
6. **Só leitura.** Não existe ferramenta que grave; rascunhos só viram ação pela tela normal, com a permissão normal. Texto de fora (observações, mensagens do portal, documentos) entra como dado entre delimitadores e nunca como instrução.
7. **Amostras mínimas** para análises e previsões, configuráveis (plano da Fase 12, §9.5).

## Consequências

- A qualidade depende mais do desenho (fatos, validador, ferramentas) que do modelo, o que permite trocar de modelo ou provedor.
- Respostas são mais curtas e "engessadas" que as de um chat livre: é o preço de não inventar.
- Toda ferramenta nova precisa de teste de permissão, de carteira e de vazamento.
