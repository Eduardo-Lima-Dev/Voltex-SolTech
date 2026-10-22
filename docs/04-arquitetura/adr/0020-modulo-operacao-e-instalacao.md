# ADR-0020: Módulo Operação e máquina de estados da instalação

- **Status:** Aceita (implementação a partir da Fase 11B)
- **Data:** 2026-10-22

## Contexto

Depois da homologação o sistema parava: o `Project` chegava a `APPROVED` e nada mais acontecia. A Fase 11 leva o fio do lead ao O&M (`projectCode` único, RN-003), e a primeira parte é a execução em campo: material, equipe, agenda, instalação e as pendências que aparecem na obra.

## Decisão

- **Módulo próprio** (`products/operations`, menu **Operação**), no mesmo molde do Off-Grid: não incha o CRM e usa as permissões `ops.*`. Reaproveita a linha do tempo da oportunidade, as tarefas e o outbox de eventos do CRM.
- **`Installation` é 1:1 com `Project`** e guarda a execução. O `Project` continua sendo o fio e a homologação; a instalação não substitui nenhum dos dois. Nasce no evento `ProjectCreated`; um endpoint de reconciliação cria as dos projetos anteriores à fase.
- **Máquina de estados no servidor** (`installation-transitions.ts`), com os 11 estados do diagrama mais `CANCELLED`. Toda mudança passa por `InstallationsService.transition`, que valida o passo e grava, **na mesma transação**, o histórico imutável, a linha do tempo, a auditoria e o evento de domínio. Voltar uma etapa e cancelar exigem motivo.
- **Estados guiados pelos fatos, não por cliques:** o último item de material recebido leva a "material separado"; ordem de instalação com data e equipe (ou técnico) leva a "equipe designada"; iniciar a ordem leva a "em instalação"; pendência de campo que bloqueia leva a "pendência de campo" e resolver a última devolve; concluir a ordem leva a "instalação concluída" e abre a ordem de comissionamento. A mudança manual continua possível, com as mesmas pré-condições.
- **Materiais:** a lista nasce do snapshot técnico aprovado (a mesma `engineeringSnapshotId` da cotação do contrato) ou é lançada à mão quando a venda não teve projeto técnico. O pedido de compra é **só registro** (fornecedor, número, valor pago): o sistema não compra nada nem integra com fornecedor. A comparação de preços lê as tabelas de preços vigentes do catálogo.
- **Ordens de serviço** (`WorkOrder`) servem à instalação agora e à manutenção depois (a planta entra na 11E). **Choque de horário** (mesma equipe ou mesmo técnico, horários sobrepostos) é **aviso**, nunca bloqueio; ordem sem fim presume 4 h só para esse cálculo.
- **Execução em campo com escopo:** quem tem `ops.workorder.write` age em qualquer ordem; o técnico (`ops.field.execute`) só age nas ordens em que está escalado, direto ou pela equipe. Essa checagem é do serviço, não do decorator.
- **Avisos ao cliente são manuais:** agendar a instalação cria uma **tarefa** "avisar o cliente" (e-mail ou link do WhatsApp, [ADR-0019](0019-integration-hub.md)); o sistema não manda mensagem sozinho.

## Consequências

- O projeto técnico pode faltar (cotação direta ou off-grid, que ainda não gera cotação a partir do snapshot): a lista de materiais é manual nesses casos, e isso é um limite declarado, não uma falha.
- A comissão do comissionamento e o aceite do cliente ficam como passos manuais na 11B; a 11D os liga à aprovação do ensaio e ao aceite registrado.
- Mais um conjunto de tabelas por empresa (instalação, histórico, material, equipe, ordem, pendência), todas no isolamento por tenant.

## Alternativas consideradas

Estender o `Project` com os estados de execução (mistura homologação com obra e quebra o 1:1 com a oportunidade); aplicar as transições só na tela (a regra tem de valer para a API e para o app de campo); bloquear o choque de agenda (a operação real reagenda e encaixa, o aviso basta).
