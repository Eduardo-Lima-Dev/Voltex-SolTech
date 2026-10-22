# Integration Hub e comunicações (Fase 11A)

Base das integrações da Fase 11. Decisão em [ADR-0019](../04-arquitetura/adr/0019-integration-hub.md).

## O que existe

| Peça                    | O que é                                                                                                     |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- |
| `IntegrationAdapter`    | Um provedor externo (monitoramento, assinatura). Declarado no código; todos nascem **desligados**           |
| `IntegrationConnection` | Conta de uma empresa num provedor. Credenciais **cifradas**, saúde, última sincronização, aceite dos termos |
| `IntegrationRun`        | Cada teste ou sincronização, com resultado e erro                                                           |
| `IntegrationDeadLetter` | Trabalho que esgotou as tentativas; espera uma pessoa                                                       |
| `CommunicationLog`      | Histórico de e-mail, link do WhatsApp e link copiado                                                        |
| `PlanService`           | Recursos e limites do plano da empresa (`tenant.settings.plan`)                                             |

Nesta fase entram só a infraestrutura e os testes com adaptadores falsos. Os adaptadores de monitoramento chegam na 11F e o de assinatura na 11I.

## Ligar um provedor

1. Conferir os termos de uso do provedor e registrar em [licenças e termos](../governanca/licencas-e-termos.md).
2. Incluir a chave em `INTEGRATIONS_ENABLED_PROVIDERS` (ex.: `solaredge,growatt`) e reiniciar a API. Vazio = nada consulta a internet.
3. Em **Admin → Integrações → Nova conexão**, a empresa informa as credenciais. Elas são cifradas e não voltam para a tela.
4. **Testar** confere a credencial sem contar falha. **Ligar** ativa a sincronização; um endpoint **não oficial** pede o aceite dos termos, que fica registrado com nome e data.

Variáveis:

| Variável                           | Padrão          | Para quê                                                                   |
| ---------------------------------- | --------------- | -------------------------------------------------------------------------- |
| `INTEGRATIONS_ENABLED_PROVIDERS`   | vazio           | Provedores que podem consultar a internet                                  |
| `INTEGRATIONS_SYNC_INTERVAL_MS`    | 900000 (15 min) | Varredura que agenda as sincronizações; 0 desliga                          |
| `INTEGRATIONS_ALLOW_PRIVATE_HOSTS` | false           | Libera provedor em rede privada (ex.: assinatura auto-hospedada no Docker) |

## Falhas, saúde e fila de falhas

- Cada sincronização falha ou passa; a **fila** repete até 3 vezes com recuo exponencial. Só a última tentativa que falha **conta** uma falha e cria a entrada na fila de falhas.
- Falhas seguidas: 1–2 = **instável** (amarelo), 3 ou mais = **com falha** (vermelho); ao chegar a 5 a conexão é **pausada**.
- **Reprocessar** (na tela) reativa a conexão e tenta de novo; se passar, a falha é dada como resolvida. **Descartar** só a tira da fila.
- **Orçamento de chamadas:** o adaptador declara um teto por dia ou por mês (ex.: SolarEdge, 300 por dia); esgotado, a execução fica "não executada" e nada é consultado.

## Comunicações

- `GET /communications/templates`: modelos (proposta, acesso ao portal, instalação agendada, lembrete de parcela) e suas variáveis.
- `POST /communications/email`: envia pelo SMTP e registra. Se o envio falhar, **nada é registrado**.
- `POST /communications/whatsapp-link`: devolve o link `https://wa.me/55…?text=…` com a mensagem pronta e registra. **O servidor não envia nada**: o usuário abre o link no próprio WhatsApp e revisa o texto. Telefone com DDD, Brasil.
- `POST /communications/copied-link`: registra que um link (ex.: do portal) foi copiado.
- Permissão `platform.communication.send` (vendedor, gestor, operação, O&M, financeiro; SDR não).

## Plano da empresa

`tenant.settings.plan` = `{ name, features: { recurso: false }, limits: { users, monitoringConnections, storageMb } }`. Recurso ausente = liberado; sem plano = tudo liberado e sem limites. Define-se pelo operador:

```bash
TENANT_SLUG=sol-do-nordeste PLAN='{"name":"Básico","features":{"monitoring":false},"limits":{"monitoringConnections":3}}' \
  node apps/api/dist/cli/set-tenant-plan.js
TENANT_SLUG=sol-do-nordeste PLAN=none node apps/api/dist/cli/set-tenant-plan.js   # remove o plano
```

A empresa **não** altera o plano pela API: o `PATCH /tenant` preserva `settings.plan`. A rota protegida por plano usa `@RequireFeature('recurso')`; o limite de conexões de monitoramento já vale na criação. O limite de usuários e de armazenamento são **declarados**, mas ainda não aplicados (o convite e o envio de arquivo não consultam o plano).

## Testes

`apps/api/test/integrations.e2e.test.ts` (adaptadores falsos): credencial cifrada e nunca devolvida, aceite de termos, saúde, pausa, fila de falhas, retentativa da fila, orçamento, varredura, isolamento entre empresas, bloqueio de endereço interno, plano e comunicações. Web: `features/admin/integrations/integrations.test.tsx`.

## Limites desta fase

- Sem adaptador real ainda; a validação com conta de verdade de cada provedor é pendência declarada (11F e 11I).
- Limite de usuários e de armazenamento do plano não é aplicado.
- Os modelos de mensagem são fixos no código; a empresa não os edita.
