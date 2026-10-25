# Roteiro para o advogado — uso de IA no Voltex SolTech

> Documento para **levar à revisão jurídica**. Escrito em linguagem simples, com os fatos técnicos conferidos até 2026-10-25. Enquanto o parecer não for registrado (`AI_LEGAL_REVIEWED_AT`), o sistema só liga a IA em empresas **de demonstração**, com dados fictícios.

## 1. O que a funcionalidade faz

Um assistente que responde perguntas em português sobre os dados da empresa no sistema (funil, financeiro, clientes, obras, pós-venda), explica indicadores, resume casos e rascunha mensagens. Ele **não toma decisão sozinho**: não altera preço, margem, crédito, contrato nem aprovação técnica, e nunca grava dado. Cada resposta traz a fonte dos valores e o aviso "gerada por IA; confira antes de decidir".

## 2. O que é enviado ao provedor de IA (e o que nunca é)

| Nunca sai do servidor                                                                                                                                           | Sai como pseudônimo                                                                                      | Sai como está                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| CPF, CNPJ, RG, e-mail, telefone, endereço, CEP, coordenadas, número da unidade consumidora, texto de contratos, documentos, fotos, assinaturas, senhas e tokens | Nome de cliente, de contato e de usuário interno (`[CLIENTE_1]`, `[USUARIO_1]`); o mapa fica no servidor | Valores, contagens, percentuais, datas, etapas e situações, cidade e UF, segmento, origem do lead, códigos de projeto, nomes de equipamento |

Há testes automáticos que falham se um desses dados aparecer na carga enviada. **Situação:** o mascaramento é a sub-fase 12B (ainda não implementada); até lá a IA só roda com dados fictícios.

**Risco residual a avaliar:** a combinação de cidade/UF, segmento e valor pode, em casos raros, permitir identificar um cliente pequeno.

## 3. Papéis (LGPD)

- Empresa cliente: **controladora**. Voltex SolTech: **operadora**. Provedor de IA: **suboperador** (hoje, Cloudflare; no futuro, possivelmente a AWS).
- Termos publicados pelo provedor (consultados em 2026-10-25, a confirmar pelo contrato): a Cloudflare declara que **não usa o conteúdo** processado pelo Workers AI para treinar modelos e que **não retém** entrada e saída em inferência simples (mantém metadados operacionais, como modelo, horário e contagem de tokens). A página consultada **não informa a região** onde a inferência roda.
- Opção descartada: API gratuita do Gemini, porque seus termos permitem uso do conteúdo para melhoria dos produtos, com leitura por pessoas, e pedem não enviar dado pessoal.

## 4. Perguntas para o parecer

1. **Transferência internacional (art. 33):** como a região da inferência é desconhecida, o enquadramento correto é cláusulas-padrão aprovadas pela ANPD, consentimento, ou o argumento de que **dado realmente mascarado deixa de ser dado pessoal**? Quais cuidados no contrato com a Cloudflare?
2. **Base legal e transparência:** o aviso no sistema, o selo "gerado por IA" e o **aceite do administrador** ao ligar a IA bastam? Há texto sugerido para a política de privacidade e os termos (esta versão já cita o provedor de e-mail, os fabricantes de inversores e o WhatsApp; falta incluir o provedor de IA)?
3. **Pseudonimização:** o método (pseudônimos por conversa, mapa só no servidor, detectores de CPF/e-mail/telefone) atende ao conceito de dado anonimizado ou continua sendo dado pessoal pseudonimizado?
4. **Retenção:** o conteúdo das conversas ficará guardado para o histórico do usuário. Qual prazo padrão e como tratar o pedido de eliminação de um titular que aparece nas conversas?
5. **Decisões automatizadas (art. 20):** como a IA só sugere e uma pessoa decide, há algum cuidado adicional?
6. **Clientes em teste:** enquanto o parecer não sai, a trava mantém a IA só em empresas de demonstração. Vale permitir clientes reais com dados mascarados mediante termo específico?
7. **Responsabilidade pelas respostas:** o aviso "confira antes de decidir" e a regra "nunca decide sozinha" bastam para os Termos de Uso?
8. **Contrato futuro (AWS/Bedrock ou outro):** requisitos mínimos de cláusulas (não treinamento, região, suboperadores, incidente).

## 5. Depois do parecer

1. Registrar a data em `AI_LEGAL_REVIEWED_AT` (isso libera a IA para empresas reais).
2. Incluir o provedor de IA e a finalidade na Política de Privacidade e nos Termos (a versão 1.1 em vigor ainda não cita IA).
3. Atualizar a landing com o que a IA faz e o que **não** faz.
