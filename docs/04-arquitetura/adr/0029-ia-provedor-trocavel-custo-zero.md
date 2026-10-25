# ADR-0029: IA com provedor trocável, custo zero e dados mascarados

- **Status:** Aceita
- **Data:** 2026-10-25

## Contexto

A IA é um ponto de venda do produto e precisa estar no sistema durante os testes com clientes, **sem custo mensal** e sem ferir a LGPD. O sistema roda em Render, Vercel, Supabase e Upstash (sem GPU); a migração para a AWS está prevista.

Avaliamos as opções:

- **Gemini (API gratuita):** os termos permitem usar o conteúdo para melhorar produtos, com leitura por revisores, e pedem não enviar dado pessoal ou confidencial. O plano que não treina exige faturamento. Descartado para dado da empresa.
- **Modelo local ou próprio:** exige GPU e operação; adiado.
- **Cloudflare Workers AI, plano grátis:** 10.000 _neurons_ por dia por conta; passando disso, a chamada **falha em vez de cobrar**. Não treina com o conteúdo e não guarda entrada e saída em inferência simples. A página consultada não informa a região da inferência.
- **Amazon Bedrock:** é o caminho da AWS; em São Paulo, os modelos Claude hoje só aparecem por inferência entre regiões.

Teste de qualidade em 2026-10-25 (dados fictícios, 7 modelos): todos chamaram ferramentas; os melhores em português foram `llama-4-scout` e `mistral-small-3.1`. Medida real depois, pelo adaptador: o `mistral-small` responde em 0,5 a 2 s (custo de 1 a 5 _neurons_ por chamada simples), e o `llama-4-scout` levou 13 a 18 s em chamadas pequenas.

## Decisão

1. **Interface única** `AiProvider` (`platform/ai/ai-provider.ts`). Toda a IA do sistema passa por ela; trocar de provedor é escrever outra classe e mudar a configuração.
2. **Provedor inicial:** `CloudflareAiProvider`. Modelo padrão `@cf/mistralai/mistral-small-3.1-24b-instruct` (rápido); reserva `@cf/meta/llama-4-scout-17b-16e-instruct`. `FakeAiProvider` para testes e desenvolvimento, **recusado em produção**.
3. **Custo zero por construção**, em camadas: o plano grátis falha em vez de cobrar; o sistema conta os _neurons_ de cada chamada (`AiUsage`) e **para antes de chamar** quando a cota não comporta mais uma resposta (estimativa de 15 _neurons_): teto da plataforma (9.000), cota por empresa (1.500), por usuário (300) e dos insights (150, à parte). Nenhum cartão deve ser cadastrado na conta do provedor.
4. **Nunca deixar esperando:** prazo de 15 s por chamada e 30 s no total; uma tentativa no modelo reserva; disjuntor (3 falhas em 60 s pausam por 60 s); toda falha vira um código e uma **mensagem pronta em português** (`AI_UNAVAILABLE_MESSAGES`), inclusive "IA desligada neste ambiente", "limite de hoje atingido" e "indisponível no momento".
5. **Portão de acesso** antes de qualquer chamada: ambiente ligado (`AI_ENABLED`), plano da empresa (`features.ai`), parecer jurídico ou empresa de demonstração, empresa ligou a IA (administrador aceita os termos, registrado e auditado).
6. **Trava jurídica:** enquanto `AI_LEGAL_REVIEWED_AT` estiver vazio, só empresas marcadas como demonstração (dados fictícios) usam a IA.
7. **O que fica guardado:** só totais por dia (`AiUsage`). O conteúdo de perguntas e respostas **não** vai para essa tabela.

## Consequências

- A capacidade grátis é pequena (centenas de respostas por dia para a conta inteira). Serve para demonstração e poucos clientes de teste; crescimento exige provedor pago, trocado pela interface.
- O modelo padrão pode mudar de catálogo: a avaliação automática (12E) deve rodar a cada troca.
- A região da inferência é desconhecida: o conteúdo enviado é sempre mascarado (ADR-0030) e o tema vai ao advogado (`docs/governanca/ia-roteiro-juridico.md`).
- Modelos "de raciocínio" respondem vazio com poucos tokens: o adaptador trata resposta vazia como falha tentável no modelo reserva.

## Alternativas consideradas

- Gemini grátis, modelo próprio na primeira etapa e agregador de modelos gratuitos: descartados pelas razões acima.
