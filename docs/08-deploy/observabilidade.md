# Observabilidade

## Logs

JSON estruturado em produção (pino); legível no desenvolvimento. Cada linha de requisição traz `req.id` (o **mesmo** que volta no header `x-request-id` e no corpo dos erros), `tenantId` e `userId`. `authorization` e cookies são **redigidos**. O `/health` não é registrado. Em testes o log fica silencioso.

Para rastrear um problema relatado por um usuário: peça o `requestId` do erro (aparece no corpo) e busque-o nos logs e na auditoria.

## Saúde

`GET /api/v1/health` (público): banco, Redis e armazenamento; **503** se algum estiver fora. Usado pelos healthchecks do Docker.

## Métricas (Prometheus)

Desligadas por padrão. Defina `METRICS_TOKEN` (16+ caracteres) para ligar `GET /api/v1/metrics`, que exige `Authorization: Bearer <token>` (sem token configurado, a rota responde 404). Não expõe dados de clientes.

| Métrica                                             | O que mostra                                                  |
| --------------------------------------------------- | ------------------------------------------------------------- |
| `voltex_http_requests_total{method,route,status}`   | Requisições; `route` é o padrão (`/api/v1/opportunities/:id`) |
| `voltex_http_request_duration_seconds` (histograma) | Latência por rota                                             |
| `voltex_outbox_pending_events`                      | Eventos esperando entrega                                     |
| `voltex_outbox_failed_events`                       | Eventos que esgotaram as tentativas (**precisam de atenção**) |
| `voltex_process_*`, `voltex_nodejs_*`               | CPU, memória, event loop, GC                                  |

Sugestão de alertas: `voltex_outbox_failed_events > 0`, `voltex_outbox_pending_events` crescendo por muitos minutos, taxa de `status=~"5.."`, latência p95 e `/health` fora. Em produção, coloque a rota atrás da rede interna (o nginx da web só encaminha `/api/`; restrinja `/api/v1/metrics` no proxy público se for o caso).

## O que não existe

Rastreamento distribuído (tracing), painel de métricas pronto e agregação de logs: dependem da infraestrutura escolhida (Loki/ELK, Grafana…).
