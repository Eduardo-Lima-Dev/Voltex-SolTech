# ADR-0018: Central de Dados Externos (proveniência, revisão humana, global × empresa)

- **Status:** Aceita (implementação a partir da Fase 9B)
- **Data:** 2026-10-20

## Contexto

Fontes, regras, catálogos e projetos dependem de dados que existem em bases públicas (clima, equipamentos de referência, tarifas, normas). Coletar à mão não escala e deixa tudo desatualizado; coletar e aplicar sozinho colocaria dado de origem duvidosa dentro de cálculo elétrico.

## Decisão

- **Serviço de plataforma** (`platform/data-hub`) com **conectores** (PVGIS, NASA POWER, biblioteca CEC/SAM, `.PAN/.OND`, PDF de ficha, tarifas ANEEL, LexML, vigilância de páginas, preços) e fila própria (BullMQ).
- **Dado externo nunca entra direto.** Toda coleta gera uma **proposta de atualização** com origem, data, licença, hash e **diferença** em relação ao que já existe; só depois de **decisão humana** vira catálogo, tarifa, recurso solar ou **rascunho de regra** (que ainda exige o revisor para ativar). **Nenhuma regra normativa é criada automaticamente** a partir de texto da internet.
- **Global × empresa:** dado público e sem dado pessoal (clima por coordenada, equipamentos de referência, páginas vigiadas) em tabelas **globais** acessadas pelo cliente de sistema; propostas, adoções e decisões são **por empresa**. Dado de empresa nunca vaza para tabela global.
- **Licença primeiro:** cada fonte tem licença, atribuição e data da conferência dos termos registradas em [fontes externas](../referencias/fontes-externas.md); **fonte sem licença clara não é ligada**. Atribuição exibida onde o dado aparece.
- **Proveniência no snapshot:** o que um projeto aprovado usou de fonte externa (série, horizonte, coleta, versão) fica gravado.
- **Cache** de clima por coordenada arredondada para os projetos não dependerem da internet na hora de calcular; testes usam **respostas gravadas**.
- **Limites de uso** por fonte respeitados (agendamento, cache, parada ao receber 429).
- Sem painel do dono da plataforma (Fase 13), os conectores globais se configuram por variável de ambiente.

## Consequências

- Mais uma fila e tabelas, mas o sistema se mantém atualizado com revisão.
- Fontes sem API (normas de distribuidoras) ficam em **vigilância de página**: detecta mudança, avisa, entrega a diferença; extração assistida por IA fica para a Fase 12, com humano no circuito (§54).
- INMETRO sem base aberta: verificação **assistida** (link + registro conferido por pessoa), sem raspagem.

## Alternativas consideradas

Importar tudo e aplicar automaticamente (risco regulatório e de dado ruim); manter tudo manual (desatualiza); depender de API paga de terceiros (custo e vínculo).
