# Roadmap

Plano de implementação por fases. Cada fase termina em um checkpoint verificável. A ordem segue a seção 76 da modelagem: CRM + Calculator primeiro, depois Engine, Off-Grid e, por fim, execução e lifecycle.

| Fase | Entrega                                                                                                                                                                                                                                  | Status                                                       |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 0    | Bootstrap do monorepo (pnpm, Turborepo, TS, ESLint, Prettier, Husky, commitlint)                                                                                                                                                         | ✅ Concluída                                                 |
| 1    | Documentação (`docs/`)                                                                                                                                                                                                                   | ✅ Concluída                                                 |
| 2    | Pacotes compartilhados (`shared`, `solar-engine`, `ui`)                                                                                                                                                                                  | ✅ Concluída                                                 |
| 3    | Infra Docker (dev/prod) + banco (Prisma, migrations, seed)                                                                                                                                                                               | ✅ Concluída                                                 |
| 4    | API NestJS: auth, RBAC, multi-tenant, auditoria, eventos, documentos                                                                                                                                                                     | ✅ Concluída                                                 |
| 5    | Web React: casca da suíte, login, navegação, admin                                                                                                                                                                                       | ✅ Concluída                                                 |
| 6    | **MVP1** — Solar Calculator + Rules Engine base (premissas rastreáveis, snapshot)                                                                                                                                                        | ✅ Concluída                                                 |
| 7A   | **MVP1** — CRM essencial: leads, oportunidades, pipeline, tarefas, fatura com OCR e integração com o Calculator                                                                                                                          | ✅ Concluída                                                 |
| 7B   | **MVP1** — **Project Guard** → Margin Guard → proposta com snapshot e rastreabilidade ([ADR-0014](../04-arquitetura/adr/0014-project-guard.md))                                                                                          | ✅ Concluída                                                 |
| 7C   | **MVP1** — Contrato, projeto automático e homologação básica, automações e painel comercial                                                                                                                                              | ✅ Concluída                                                 |
| 8    | Qualidade, CI/CD, imagens de produção, e2e, LGPD                                                                                                                                                                                         | ✅ Concluída                                                 |
| 9    | **MVP2** — Solar Engine Studio                                                                                                                                                                                                           | 🚧 (9A a 9J implementadas; pendências de governança abertas) |
| 10   | **MVP3** — Off-Grid Designer (módulo próprio com pedidos e projetos; isolado e híbrido sem injeção)                                                                                                                                      | ✅ ([guia](../07-desenvolvimento/offgrid.md))                |
| 11   | Execução e lifecycle (WhatsApp, field, instalação, comissionamento, O&M, portal)                                                                                                                                                         | 🚧 (11A entregue)                                            |
| 12   | Inteligência e ecossistema (IA, procurement, previsões)                                                                                                                                                                                  | ⏳                                                           |
| 13   | _(backlog, só se for desenvolvida)_ Backoffice do dono da plataforma: empresas clientes, planos, cobrança, uso e suporte                                                                                                                 | ⏳                                                           |
| 14   | _(backlog, talvez)_ Funil com regras próprias por empresa: criar etapas novas e definir quem pode ir para onde, hoje fixo no sistema (a personalização atual só renomeia, esconde e cria colunas que seguem as regras de uma etapa-base) | ⏳                                                           |

> **Notas da Fase 3:** (1) o Prisma é o 7.x e o armazenamento S3 local é o RustFS — ver [ADR-0009](../04-arquitetura/adr/0009-prisma-7.md) e [ADR-0010](../04-arquitetura/adr/0010-rustfs-no-lugar-do-minio.md); (2) o `compose.prod.yml` traz infraestrutura + `migrate`, e os serviços `api`/`web` entram na Fase 8; (3) o pipeline padrão entra no seed junto das tabelas do CRM (Fase 7).

> **Notas da Fase 4:** (1) NestJS **11** (o 12 ainda não é suportado pelo `nestjs-zod`) — ver [API](../07-desenvolvimento/api.md); (2) o worker do outbox é um _poller_ com `FOR UPDATE SKIP LOCKED`; as filas BullMQ entram com as automações (Fase 7); (3) o registro de contas e o MFA ficam para depois: usuários entram por convite; (4) testes e2e rodam em banco `voltex_test` próprio (`pnpm test:e2e`).

> **Notas da Fase 5:** (1) React Router **8** (a API de rotas é a da v7) e Vite 8 — ver [ADR-0013](../04-arquitetura/adr/0013-arquitetura-do-front-end.md) e [Web](../07-desenvolvimento/web.md); (2) os quatro produtos aparecem no menu e no painel, cada um com uma página "em desenvolvimento" até a sua fase; (3) a identidade visual oficial (logo e paleta) foi aplicada antes da fase — ver [identidade visual](../00-visao-geral/identidade-visual.md); (4) i18n: textos em pt-BR centralizados em `i18n/labels.ts` (sem biblioteca de i18n por ora).

> **Notas da Fase 6:** (1) o Rules Engine é uma **base**: um `RuleSet` versionado com `definition` em JSON (limites e custo de disponibilidade), fonte, revisor e imutabilidade após ativar — não há ainda as tabelas `Rule` nem o avaliador de condições ([Rules Engine](../04-arquitetura/rules-engine.md)); (2) concessionárias, tarifas e irradiação são **por empresa** e **sem dado embutido**: HSP, tarifas e custo de disponibilidade vêm do cadastro/importação com fonte (nada foi inventado); (3) o cálculo oficial é o do servidor, e o resultado em tempo real do wizard usa o mesmo motor e os mesmos limites; (4) criar e ativar regras ainda é pela API (a tela de regras é somente leitura); (5) `calc-1.1.0` traz PR/perdas, orientação, inclinação recomendada, classe de geração e premissas ([memorial](../06-calculos/calculator.md)) — fórmulas ainda são rascunho até validação com Pinho & Galdino/CRESESB; (6) roteiro de teste no navegador: [verificação manual](../07-desenvolvimento/verificacao-manual.md).

> **Backlog (decisão pendente do usuário, fora das Fases 1–8):** **backoffice da plataforma** — um CRM/painel para o dono da Voltex gerenciar as **empresas clientes** (tenants): planos e contratos, cobrança/MRR, uso, suporte e saúde de cada empresa. Hoje só existe a administração **dentro** de cada empresa. Precisa de um perfil acima do tenant e acesso entre tenants com auditoria própria; vale um ADR antes de planejar.

> **Notas da Fase 7A:** (1) a leitura da fatura é uma **heurística de PDF com camada de texto** (`unpdf`), testada só com faturas sintéticas: a revisão humana é obrigatória e faltam amostras reais para medir a taxa de acerto e decidir sobre OCR/IA (a interface `BillParserProvider` já comporta); (2) a **importação de tarifas da ANEEL** entrou aqui (dados abertos, 116 distribuidoras, tarifa residencial B1 vigente, **sem impostos**); (3) o Kanban arrasta pelo ícone e tem seletor alternativo; (4) as travas de etapa (triagem e margem) entram na 7B por `OpportunitiesService.registerGate`; (5) o documento (CPF/CNPJ) segue em texto até a Fase 8 (criptografia); (6) as automações (SLA estourado → alerta, fatura não recebida → tarefa) entram na 7C; (7) detalhes em [CRM Solar](../07-desenvolvimento/crm.md).

> **Notas da Fase 7B:** (1) a triagem usa só verificações **não regulatórias** e é **triagem, não homologação**; regra por distribuidora aguarda fonte oficial e especialista (o responsável técnico das regras ainda não foi definido); (2) **sem política de margem a proposta fica bloqueada** — o sistema não presume um mínimo; (3) **mudar a cotação não invalida a triagem** (invalida a aprovação de margem) — desvio documentado no [ADR-0014](../04-arquitetura/adr/0014-project-guard.md); (4) a alíquota de impostos, comissão e custo financeiro são **entradas da empresa** na cotação; (5) o aceite online é um **registro** (nome, data, IP, navegador), não assinatura eletrônica; (6) o link público só aparece uma vez (guarda-se o hash); (7) o envio do link por e-mail/WhatsApp não existe: o vendedor copia; (8) detalhes em [Triagem, cotação e proposta](../07-desenvolvimento/guard-e-proposta.md) e [Margem](../06-calculos/margem.md).

> **Notas da Fase 7C:** (1) o **contrato-base não tem revisão jurídica** e a **assinatura é um registro** do arquivo assinado, não assinatura eletrônica; (2) assinar o contrato fecha o ganho e cria o projeto **na mesma transação** (desvio: não passa pela fila BullMQ, por ser tudo ou nada); (3) o checklist de homologação é **dado versionado com fonte** — a base EnergIF 2023 (EF-R03 a R06) **não está revisada** e não é a lista vigente de nenhuma distribuidora; prazos são **sugestões**; o responsável técnico das regras segue indefinido; (4) as automações (SLA de lead, fatura não recebida, proposta visualizada) geram **tarefas e eventos**, sem notificação; (5) o painel tem previsão **sem pesos inventados** (total ponderado só com pesos da empresa, ainda sem tela); (6) gerar/assinar contrato é de gestor comercial, administrador e proprietário (o vendedor só lê) — decisão de perfis a confirmar; (7) detalhes em [Contrato, projeto e automações](../07-desenvolvimento/contrato-projeto-automacoes.md).

> **Notas da Fase 8:** (1) imagens de produção da API e da web (sem root), compose completo validado de ponta a ponta e CLI do primeiro proprietário; (2) o **workflow de CI foi escrito e conferido localmente, mas ainda não rodou no GitHub**; (3) CPF/CNPJ **cifrados** por empresa (chave-mestra `DATA_ENCRYPTION_KEY`, **perdê-la = perder os dados**; **sem rodízio de chave ainda**), busca por documento só pelo número completo; (4) exportação de dados por empresa (LGPD); **não** há purga por retenção nem eliminação a pedido do titular, e o texto dos contratos/PDFs não é cifrado; (5) Playwright cobre os fluxos críticos com banco próprio; (6) métricas Prometheus opcionais; sem tracing; (7) detalhes em [Segurança e LGPD](../08-deploy/seguranca-lgpd.md), [Observabilidade](../08-deploy/observabilidade.md), [Docker](../08-deploy/docker.md) e [Testes](../07-desenvolvimento/testes.md).

> **Notas das pendências de LGPD (pós-Fase 8):** (1) **rodízio de chave** de criptografia sem parar o sistema (`rotate-encryption-key`) e texto do contrato cifrado; (2) **eliminação a pedido do titular** e **política de retenção** com rotina diária, piso de 5 anos para contratos assinados e registro imutável sem dado pessoal; o histórico de auditoria **não** é eliminado; (3) **modelo de contrato em Word** enviado pela empresa; (4) criptografia em repouso dos arquivos fica por conta do armazenamento (`S3_SERVER_SIDE_ENCRYPTION`); (5) prazos legais **pesquisados em fontes secundárias: confirmar com advogado**; (6) detalhes em [Segurança e LGPD](../08-deploy/seguranca-lgpd.md).

> **Base técnica:** o desenvolvimento até a **Fase 8** usa o livro EnergIF 2023 como referência ([regras e medidas](../referencias/energif-2023/regras-e-medidas.md)); o que as Fases 6 a 8 extraem dele está mapeado na seção 6 desse documento. O restante fica inventariado para as Fases 9 a 12.

> **Escopo atual: até a Fase 8.** As Fases 9 a 12 permanecem no plano, mas fora de escopo por enquanto. A prioridade do MVP1 segue o [adendo de reestruturação](../00-visao-geral/adendo-reestruturacao-priorizacao.md): _fatura → cálculo → triagem → margem → proposta_. O estado de cada item está no [diagnóstico](diagnostico-mvp1.md) e as fontes a obter, em [fontes oficiais](../referencias/fontes-oficiais.md). Decisões: contrato/projeto/homologação ficam como etapa final 7C; o primeiro Guard usa só verificações não regulatórias.

### Fluxo prioritário do MVP1

```mermaid
flowchart TD
    A[Lead no CRM] --> B[Fatura recebida e validada]
    B --> C[Solar Calculator]
    C --> D[Project Guard: triagem preliminar]
    D --> E{Resultado}
    E -->|Verde| F[Margin Guard]
    E -->|Amarelo| G[Revisão humana / engenharia]
    E -->|Vermelho| H[Corrigir dados ou inconsistências]
    G --> D
    H --> D
    F --> I{Margem dentro da política?}
    I -->|Sim| J[Proposta preliminar + snapshot]
    I -->|Não| K[Revisar preço/custos ou solicitar aprovação]
    K --> F
```

## Fase 0 — Descoberta (negócio, paralela ao desenvolvimento)

Da seção 63: entrevistar 10–15 integradores, mapear processos reais, coletar exemplos anonimizados de contas e propostas, mapear concessionárias e fornecedores prioritários, escolher o ICP e identificar 5 clientes piloto. Resultado alimenta os dados iniciais de tarifas, HSP e parser de fatura.

## Critério do MVP1

O vendedor consegue sair de **lead + fatura para proposta preliminar** rapidamente: Lead → fatura → OCR validado → cálculo → cotação com margem → proposta PDF/web → aceite → contrato → projeto criado.

## Fora do MVP1

WhatsApp oficial (EPIC-CRM-004) e financiamento integrado (EPIC-CRM-010, no MVP1 apenas registro manual de status). Ver [o que evitar inicialmente](../00-visao-geral/visao-do-produto.md#fora-do-primeiro-mvp).

## Métricas de sucesso

- **CRM:** tempo até o primeiro valor, primeira proposta válida, conversão, ciclo de venda, negócios sem próxima tarefa, margem protegida, retrabalho, atraso de homologação.
- **Calculator:** tempo de cálculo, taxa de conclusão, correções manuais, % encaminhado ao Engine, diferença entre estimativa inicial e projeto final.
- **Engine:** tempo de projeto, revisões, incompatibilidades detectadas antes da obra, erros pós-aprovação, reutilização do catálogo, aprovação na primeira submissão.
- **Off-Grid:** tempo de dimensionamento, cenários comparados, consumo previsto × real, autonomia observada × projetada.

## Riscos

| Risco                                                    | Mitigação                                          |
| -------------------------------------------------------- | -------------------------------------------------- |
| Escopo amplo demais                                      | Produtos separados + fases                         |
| Cálculo técnico incorreto                                | Motor determinístico + testes + revisão técnica    |
| Regra desatualizada                                      | Rules Engine versionado                            |
| IA alucinar                                              | Human-in-the-loop                                  |
| API externa quebrar                                      | Integration Hub + fallback                         |
| Usuário abandonar o CRM                                  | Automação + UX + time-to-value                     |
| Dados duplicados entre sistemas                          | Source of truth + eventos + IDs globais            |
| Datasheet de equipamento errado                          | Governança de catálogo                             |
| Copiar concorrentes sem diferenciação                    | Foco em compliance + margem + engenharia conectada |
| Competir com software de engenharia completo cedo demais | Validação/integração antes de CAD avançado         |

> **Notas da Fase 9 (em andamento):** o plano está em 10 sub-fases (9A a 9J). **9A (fundações):** regras por chave e escopo com avaliador de condições, unidades, temperatura, strings e posição solar (casos de ouro do pvlib), memoriais, ADRs 0015 a 0018, extração do EnergIF e do Manual CRESESB. **9B (Central de Dados Externos):** clima (NASA POWER, PVGIS) e horizonte em cache, vigilância de normas com diferença, tarifas da ANEEL como propostas e a caixa de atualizações com decisão humana ([guia](../07-desenvolvimento/central-de-dados.md)). PVGIS e NASA POWER estão liberadas por evidência oficial, com cache e atribuição; CEC/SAM permanece bloqueada até a licença específica dos dados. **9C (catálogo técnico):** módulos, inversores, proteções e cabos por empresa com revisões e aprovação do responsável técnico, importação conferida (CSV, `.PAN`, `.OND`, ficha em PDF), INMETRO assistido, tabelas de preço e adoção de referências externas ([guia](../07-desenvolvimento/catalogo-tecnico.md)). **9E (strings e compatibilidade):** inversores e strings por MPPT, Compatibility Engine com fórmula e fonte em cada verificação (pendente de dado/regra em vez de presumir), gerador de configurações determinístico e impacto por regra/equipamento. **9D (projeto técnico):** fila de pedidos, projetos e versões congeladas, editor com local/clima, superfícies, layout (prévia 2D) e sombreamento (carta solar), integrado à aba Engenharia do CRM ([guia](../07-desenvolvimento/engine.md)).

> **Notas 9F–9I:** proteções, cabos, lista de materiais e preços vigentes; simulação horária com série da Central, sombra, temperatura e clipping; conexão dirigida por regras; fluxo econômico com VPL/TIR/LCOE; revisão técnica, snapshot imutável, evento de aprovação e unifilar SVG/DXF preliminar. A validação externa das regras normativas e da metodologia econômica segue obrigatória antes de uso em obra ou decisão comercial.

> **Notas da Fase 10 (entregue):** módulo próprio **Off-Grid Designer** com fila de pedidos, projetos, versões congeladas e snapshot, reaproveitando catálogo, regras, Central de Dados e permissões `offgrid.*`. Quatro tipos novos no catálogo (bateria, controlador de carga, inversor off-grid/híbrido, gerador); regra `offgrid.design`; motor puro com perfil de carga, recurso solar (série horária ou ano sintético), dimensionamento pelo mês crítico (CRESESB), verificações elétricas, despacho horário com gerador e rede (híbrido sem injeção), estresse sazonal, vida do banco, custo e cenários; sugestor a partir do catálogo aprovado; editor em 9 etapas e memorial em PDF ([guia](../07-desenvolvimento/offgrid.md)). Limites: leitura de PDF dos novos tipos, cotação a partir do snapshot off-grid, unifilar e SIGFI ficam para depois.

> **Notas da Fase 11 (em andamento):** plano em 11A–11J. **11A (fundações):** Integration Hub com conexões por empresa, credenciais cifradas, fila de falhas e adaptadores desligados por padrão ([ADR-0019](../04-arquitetura/adr/0019-integration-hub.md)), comunicações (e-mail e link `wa.me`, sem API de WhatsApp) e plano da empresa com recursos e limites ([guia](../07-desenvolvimento/integracoes.md)). Decisões: monitoramento com adaptadores oficiais **e** não oficiais (estes com aceite de termos), sem gateway de pagamento, portal do cliente por link mágico, termos de garantia por fabricante e assinatura DocuSeal opcional.
