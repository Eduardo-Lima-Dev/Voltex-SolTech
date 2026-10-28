# ADR-0028: Carteira do vendedor (escopo por responsável)

- **Status:** Aceita
- **Data:** 2026-10-25

## Contexto

Até a Fase 11, o vendedor enxergava tudo o que era da empresa: leads, oportunidades, contas e projetos de todos. A Fase 12 (assistente de IA) usa as mesmas consultas das telas, então o que o vendedor pode ver passa a ser também o que a IA pode contar a ele. A decisão do produto é que o vendedor trabalhe **só com a própria carteira**.

## Decisão

- **Quem é restrito:** `SALESPERSON` (vendedor) e `SDR`. Gestão, administração, engenharia, operação, financeiro e demais perfis não mudam.
- **O que cada um vê:**
  - Vendedor: leads e oportunidades em que é o responsável; contas dele ou com oportunidade dele (e seus contatos, imóveis e unidades); tarefas atribuídas a ele, criadas por ele ou ligadas às oportunidades dele; faturas, triagens, cotações, propostas, contratos, projetos, cálculos e linha do tempo dessas oportunidades; só a própria comissão.
  - SDR: os leads e as contas dele **e os sem responsável**, para poder distribuí-los; suas tarefas e seus cálculos. Não vê oportunidades.
- **Onde a regra vive:** numa extensão do cliente do Prisma (`prisma.db`), depois do filtro de tenant, aplicando um filtro extra em **toda** leitura, contagem, agregação, alteração e exclusão (`platform/prisma/ownership-scope.ts`). Assim vale também para o que um serviço esquecer. Registro de outro responsável responde **404**, como se não existisse.
- **Sem perfil, sem restrição:** filas, eventos e rotinas rodam sem usuário no contexto e enxergam tudo.
- **Exceções controladas** (`RequestContext.withoutOwnership`), só para perguntas que devolvem apenas um sim ou não, nunca o dado:
  - duplicidade de lead e de conta: o usuário é avisado de que já existe, sem ver de quem é nem o nome;
  - o rodízio de distribuição de leads, que olha a data do último lead de cada vendedor.
- **Responsável da conta:** novo campo `Account.ownerId`, preenchido na migração com o dono da primeira oportunidade da conta. Conta nova nasce na carteira de quem a cria.
- **Redistribuir é da gestão:** o vendedor não passa lead, oportunidade nem conta para outra pessoa (403). O SDR pode passar leads e contas, porque é quem distribui.
- **Documentos:** pela API de documentos, vendedor e SDR alcançam só os que eles enviaram; os documentos de proposta, contrato etc. chegam a eles pelas rotas das próprias entidades, já filtradas.
- **Cálculos:** `CalculationSession` ganhou a relação com a oportunidade, para a carteira alcançar os cálculos feitos por outras pessoas para as oportunidades dele.

## Consequências

- O lead que chega por formulário público sem regra de distribuição fica **sem responsável**: só o SDR e a gestão o veem, até alguém passá-lo a um vendedor. Para não ficarem parados, a empresa deve configurar a distribuição (rodízio ou por região).
- O painel comercial segue restrito à gestão (o vendedor não tem essa permissão).
- Quem muda de função ou sai da empresa deixa registros na carteira dele; a gestão os redistribui.
- Toda tela e toda ferramenta da IA herdam a regra sem código novo.

## Alternativas consideradas

- **Filtrar em cada serviço:** mais código e fácil de esquecer um ponto; descartado.
- **Segurança por linha no PostgreSQL (RLS):** forte, mas exige o usuário em cada conexão do pool e uma reescrita da camada de acesso; descartado por enquanto.
