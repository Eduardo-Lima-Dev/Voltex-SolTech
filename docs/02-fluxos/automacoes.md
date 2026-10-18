# Automações

Automações previstas nas seções 42–45 da modelagem. Serão executadas via filas (BullMQ) reagindo a eventos de domínio (ver [catálogo de eventos](../04-arquitetura/eventos.md)). O que está marcado como **MVP1** entra na Fase 7.

| Grupo     | Gatilho                            | Ação                          | Fase                |
| --------- | ---------------------------------- | ----------------------------- | ------------------- |
| Comercial | Lead novo sem contato em X minutos | Alertar responsável           | MVP1                |
| Comercial | Fatura solicitada e não recebida   | Tarefa de follow-up           | MVP1                |
| Comercial | Proposta visualizada               | Criar tarefa para o vendedor  | MVP1                |
| Comercial | Proposta não aberta                | Enviar mensagem diferente     | Pós-MVP1 (WhatsApp) |
| Comercial | Negociação parada                  | Notificar gestor              | MVP1                |
| Comercial | Margem abaixo do limite            | Exigir aprovação              | MVP1                |
| Comercial | Contrato assinado                  | Criar projeto automaticamente | MVP1                |
| Técnica   | Calculator em amarelo              | Criar `EngineeringRequest`    | MVP1                |
| Técnica   | Alteração de módulo                | Revalidar strings             | MVP2                |
| Técnica   | Atualização de regra               | Identificar projetos afetados | MVP2                |
| Técnica   | Configuração inválida              | Bloquear aprovação            | MVP2                |
| Técnica   | Documento faltante                 | Criar pendência               | MVP1                |
| Técnica   | Versão aprovada                    | Congelar snapshot             | MVP2                |
| Execução  | Homologação aprovada               | Liberar compra/agendamento    | Fase 11             |
| Execução  | Material entregue                  | Criar tarefa de instalação    | Fase 11             |
| Execução  | Instalação finalizada              | Abrir comissionamento         | Fase 11             |
| Execução  | Comissionamento aprovado           | Solicitar aceite do cliente   | Fase 11             |
| Execução  | Aceite                             | Ativar planta e garantia      | Fase 11             |
| Pós-venda | Contrato O&M vencendo              | Oportunidade de renovação     | Fase 11             |
| Pós-venda | Garantia próxima do vencimento     | Notificar                     | Fase 11             |
| Pós-venda | Geração abaixo da expectativa      | Abrir ticket                  | Fase 11             |
| Pós-venda | Cliente com perfil adequado        | Oferta de bateria             | Fase 12             |
| Pós-venda | Aumento de consumo                 | Oportunidade de expansão      | Fase 12             |
| Pós-venda | Veículo elétrico cadastrado        | Oferta de carregador          | Fase 12             |
