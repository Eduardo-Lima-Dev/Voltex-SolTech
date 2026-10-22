# ADR-0022: Comissionamento com regra versionada, modelo provisório e aprovação travada

- **Status:** Aceita (implementação a partir da Fase 11D)
- **Data:** 2026-10-22

## Contexto

O comissionamento (ensaios depois da instalação) decide se a obra pode ser entregue. O livro-base (EnergIF 2023, p. 193–196) descreve a **estrutura** dos ensaios (categorias 1 e 2, ensaios adicionais, start-up) e não traz **nenhum critério numérico**; a norma (NBR 16274) é paga. O responsável técnico é quem define o que aprova. Embutir uma tolerância no código seria inventar uma regra técnica.

## Decisão

- **A regra define os ensaios e os limites** (`ops.commissioning`, versionada, com fonte por ensaio e **revisada por engenheiro com registro no conselho** para ativar), no mesmo mecanismo das regras do Engine ([ADR-0016](0016-regras-por-chave-escopo-e-avaliador.md)).
- **Modelo-base provisório:** sem regra ativa, vale um modelo com a estrutura do livro, **sem tolerância nem limite**. Dá para registrar os ensaios, mas as medições ficam "sem regra para julgar" e **a aprovação fica travada**. O registro marca a regra usada (`<id>@<versão>` ou a base) e o modelo **congelado**.
- **O sistema calcula, não presume.** O valor esperado de Voc e Isc por string vem do projeto técnico aprovado (ficha do módulo, strings por MPPT) e das condições medidas (irradiância e temperatura do módulo). A comparação usa só a tolerância e os limites da regra. Faltando dado, o resultado é "sem dado" e trava.
- **Aprovar é do responsável técnico** (`ops.commissioning.approve`) e exige: regra não provisória, nenhum ensaio reprovado, todos os obrigatórios registrados e nenhum sem juízo. Reprovar exige o motivo, devolve a instalação a "em instalação" e a próxima tentativa abre um registro novo; o histórico das tentativas fica.
- **Fluxo:** o técnico registra no app de campo (medições e conferências são ações idempotentes do [ADR-0021](0021-campo-offline-pwa.md), com a prévia do julgamento no aparelho); **concluir a ordem de comissionamento envia o registro para revisão** (recusado se faltar obrigatório); o relatório em PDF nasce da aprovação. O relatório não é ART nem laudo.
- **Aceite do cliente** é um **registro** (nome, canal, data e, se houver, a assinatura colhida em campo), não uma assinatura eletrônica. Só abre com o comissionamento aprovado e **finaliza** a instalação; não dá para pular nenhuma das duas travas pela mudança manual de situação.
- **Seed de teste interno** (11J) cria uma regra de exemplo marcada "TESTE INTERNO", que o sistema sinaliza no relatório e na tela.

## Consequências

- Enquanto o responsável técnico não publicar a regra, nenhuma obra é aprovada no sistema: é a trava pretendida, e a pendência fica explícita na tela.
- A lista de ensaios do modelo-base é uma **proposta** (o ensaio de Voc, por exemplo, é do sistema, não literal do livro) e precisa de conferência com a norma.
- O sistema não valida a calibração dos instrumentos nem a faixa de irradiância das medições: isso é critério da regra e do responsável técnico.

## Alternativas consideradas

Tolerâncias padrão no código (inventa regra técnica); lista de ensaios fixa no código (a norma muda e cada empresa tem rotina); aprovação automática quando tudo passa (a decisão é do responsável técnico); aceite por assinatura eletrônica (fora de escopo por decisão do usuário).
