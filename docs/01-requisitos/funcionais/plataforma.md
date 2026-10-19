# Requisitos funcionais — Plataforma compartilhada

Épicos `EPIC-PLAT-*`. Serviços transversais usados por todos os produtos.

| ID          | Requisito                                                                                            | Fase |
| ----------- | ---------------------------------------------------------------------------------------------------- | ---- |
| RF-PLAT-001 | Login por e-mail e senha com sessão (access token curto + refresh token rotativo)                    | MVP1 |
| RF-PLAT-002 | SSO único e navegação entre os quatro produtos sem novo login                                        | MVP1 |
| RF-PLAT-003 | Cadastro da empresa (tenant), filiais e times                                                        | MVP1 |
| RF-PLAT-004 | Cadastro de usuários, convites e desativação                                                         | MVP1 |
| RF-PLAT-005 | Perfis e permissões granulares (RBAC) conforme [personas](../../00-visao-geral/personas-e-perfis.md) | MVP1 |
| RF-PLAT-006 | Isolamento lógico de dados por tenant em todas as consultas                                          | MVP1 |
| RF-PLAT-007 | Audit log de ações críticas (quem, quando, o quê, antes/depois)                                      | MVP1 |
| RF-PLAT-008 | Upload, versionamento e download seguro de documentos (S3)                                           | MVP1 |
| RF-PLAT-009 | Event bus interno com outbox transacional                                                            | MVP1 |
| RF-PLAT-010 | Rules Engine versionado (regra, vigência, fonte, versão aplicada) — base                             | MVP1 |
| RF-PLAT-011 | Rules Engine completo com impacto em projetos existentes                                             | MVP2 |
| RF-PLAT-012 | Catálogo técnico compartilhado (módulos, inversores, baterias, controladores)                        | MVP2 |
| RF-PLAT-013 | Feature flags e limites por plano                                                                    | F11  |
| RF-PLAT-014 | MFA                                                                                                  | F11  |
| RF-PLAT-015 | Integration Hub (adaptadores, retry, DLQ, health status)                                             | F11  |
| RF-PLAT-016 | Cobrança unificada da suíte                                                                          | F11  |
| RF-PLAT-017 | AI Orchestrator com human-in-the-loop                                                                | F12  |
| RF-PLAT-018 | Analytics / data platform                                                                            | F12  |
