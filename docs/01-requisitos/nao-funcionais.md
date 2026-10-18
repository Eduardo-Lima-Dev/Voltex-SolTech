# Requisitos não funcionais

Baseados nas seções 58–62 e 83–84 da modelagem.

## Segurança e LGPD

| ID          | Requisito                                                                                            |
| ----------- | ---------------------------------------------------------------------------------------------------- |
| RNF-SEG-001 | TLS em todo tráfego externo                                                                          |
| RNF-SEG-002 | Senhas com hash forte (argon2); nunca registradas em log                                             |
| RNF-SEG-003 | Secrets somente por variáveis de ambiente / gestor de secrets; nunca versionados                     |
| RNF-SEG-004 | RBAC em toda rota; permissão negada por padrão                                                       |
| RNF-SEG-005 | Rate limiting e Helmet na API                                                                        |
| RNF-SEG-006 | Audit log imutável para ações críticas                                                               |
| RNF-SEG-007 | Criptografia em repouso (banco/volumes) e de campos sensíveis (documento pessoal) com chave dedicada |
| RNF-SEG-008 | Backups do banco com política de retenção documentada                                                |
| RNF-SEG-009 | Exportação e exclusão de dados do titular quando aplicável (LGPD)                                    |
| RNF-SEG-010 | Minimização de dados: coletar progressivamente apenas o necessário                                   |
| RNF-SEG-011 | MFA disponível para usuários internos (F11)                                                          |

Dados sensíveis tratados: documentos pessoais, conta de energia, endereço, dados financeiros, contratos, conversas, fotos do imóvel, geolocalização e consumo.

## Multi-tenancy

| ID          | Requisito                                                                                                                  |
| ----------- | -------------------------------------------------------------------------------------------------------------------------- |
| RNF-TEN-001 | `tenantId` obrigatório em toda tabela de negócio                                                                           |
| RNF-TEN-002 | Isolamento aplicado na camada de acesso a dados (extensão do Prisma) e coberto por testes automatizados entre dois tenants |
| RNF-TEN-003 | Políticas, feature flags e limites por tenant                                                                              |
| RNF-TEN-004 | Arquitetura que permita isolamento físico futuro (plano Enterprise)                                                        |

## Qualidade e confiabilidade de cálculo

| ID           | Requisito                                                                                                              |
| ------------ | ---------------------------------------------------------------------------------------------------------------------- |
| RNF-CALC-001 | Todo cálculo é função pura, determinística, com unidades explícitas e validação de faixa                               |
| RNF-CALC-002 | Todo cálculo tem versão de algoritmo, testes automatizados, tolerâncias documentadas e comparação com casos conhecidos |
| RNF-CALC-003 | Cobertura de testes do `@voltex/solar-engine` ≥ 90%                                                                    |
| RNF-CALC-004 | Cálculo crítico só vai a produção após revisão por especialista                                                        |
| RNF-CALC-005 | Regras regulatórias são dados versionados, nunca constantes no código                                                  |

## Desempenho e operação

| ID          | Requisito                                                                                 |
| ----------- | ----------------------------------------------------------------------------------------- |
| RNF-OPS-001 | Preview do Calculator responde em tempo imperceptível (cálculo no cliente)                |
| RNF-OPS-002 | Endpoints de leitura comuns respondem em p95 < 500 ms com paginação obrigatória em listas |
| RNF-OPS-003 | Logs estruturados em JSON com `requestId` e `tenantId`                                    |
| RNF-OPS-004 | Health checks de API, banco e Redis                                                       |
| RNF-OPS-005 | Integrações externas com timeout, retry, idempotência e fallback manual                   |
| RNF-OPS-006 | Ambiente reproduzível por Docker; build de produção totalmente containerizado             |

## Usabilidade

| ID         | Requisito                                                                                    |
| ---------- | -------------------------------------------------------------------------------------------- |
| RNF-UX-001 | Experiência de suíte única: identidade visual, SSO, navegação cruzada e `projectCode` global |
| RNF-UX-002 | Cadastro progressivo (evitar formulários longos no início)                                   |
| RNF-UX-003 | Interface em pt-BR com formatação BRL/kWh/kWp centralizada                                   |
| RNF-UX-004 | Responsivo; acessível (WCAG AA como meta)                                                    |
