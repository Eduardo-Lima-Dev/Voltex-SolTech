# ADR-0027: Monitoramento de inversores — adaptadores verificados e regra da empresa

- **Status:** Aceita
- **Data:** 2026-10-23

## Contexto

O plano da Fase 11 previa adaptadores para muitas marcas. A maior parte não tem documentação técnica pública
verificável (exige login, contrato ou NDA). Escrever adaptador sem a documentação seria presumir endpoints.

## Decisão

- Há adaptador implementado só para **SolarEdge, APsystems e Fronius**, a partir da documentação pública, com respostas
  gravadas nos testes (marcadas como exemplo de documentação, **não validado com conta real**).
- Os demais provedores ficam **catalogados** como `available: false` ("Sem adaptador"): a tela não permite ligar e a
  conexão fica sem sincronizar. Nenhum endpoint é presumido.
- **Importação por planilha (CSV)** cobre qualquer marca e é a alternativa quando a API cair.
- Chamado automático por desvio de geração só existe com a regra `ops.monitoring` ativa (limiar e dias consecutivos são
  **da empresa ou do RT**). Sem regra, mostra-se a comparação real × esperado e nada é aberto.
- Adaptadores não oficiais não foram implementados.

## Consequências

- Cobertura inicial menor que a planejada, em troca de nenhum comportamento inventado.
- Quando a documentação de um provedor chegar, o adaptador entra no mesmo molde dos três existentes.

## Alternativas consideradas

- Implementar a partir de bibliotecas da comunidade: rejeitada (licença GPL e comportamento não documentado).
