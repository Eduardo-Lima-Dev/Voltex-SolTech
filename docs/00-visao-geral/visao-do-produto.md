# Visão do produto

**Voltex SolTech** é uma suíte de software para empresas que vendem, projetam, instalam, homologam e mantêm sistemas de energia fotovoltaica (integradoras). Não é apenas um CRM com Kanban: cobre o ciclo completo da operação.

## Os quatro produtos

| Produto                 | Papel                                                                          | Usuário principal                                             | Venda isolada |
| ----------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------- | ------------- |
| **CRM Solar**           | Comercial, operação, projetos, homologação, instalação, financeiro e pós-venda | Dono, gestor, SDR, vendedor, engenharia, financeiro, operação | Sim           |
| **Solar Calculator**    | Pré-viabilidade e proposta comercial rápida                                    | SDR, vendedor, consultor                                      | Sim           |
| **Solar Engine Studio** | Projeto e validação técnica fotovoltaica                                       | Engenheiro, projetista, responsável técnico                   | Sim           |
| **Off-Grid Designer**   | Cargas, geração, armazenamento e autonomia                                     | Engenheiro, projetista, integrador off-grid                   | Sim           |

A experiência mais completa acontece com todos conectados, mas o cliente deve perceber **uma suíte**: SSO único, tenant único, identidade visual única, `projectCode` global, navegação cruzada, catálogo e Rules Engine compartilhados.

## Separação de responsabilidades

- **CRM** é dono de clientes, leads, oportunidades, funis, tarefas, comunicações, propostas, contratos, financiamento, homologação, instalação, financeiro por projeto, pós-venda e O&M.
- **Calculator** é dono de sessões de cálculo rápido, premissas, estimativa de potência/geração/economia/payback e cenários rápidos.
- **Engine Studio** é dono do modelo técnico da instalação: superfícies, sombreamento, módulos, inversores, strings, MPPTs, proteções, cabos, verificações, simulação e versão aprovada.
- **Off-Grid Designer** é dono das cargas, perfil de consumo, autonomia, baterias, controlador, inversor off-grid/híbrido, gerador de backup e cenários.

Mapa completo do dono de cada dado: [módulos e source of truth](../04-arquitetura/modulos.md).

## Diferenciais (hipóteses)

1. **Regulation-as-Code** — regras por concessionária, grupo, tipo, vigência e região, versionadas; cada cálculo guarda a versão usada.
2. **Margin Guard** — margem consolidada com bloqueio e aprovação.
3. **Connection Feasibility** — triagem de demanda, injeção, Grid Zero e documentação antes da proposta definitiva.
4. **Project Digital Thread** — um `projectCode` do lead ao O&M.
5. **Evidence Pack** — documentos, fotos, checklists, seriais e relatórios organizados automaticamente.
6. **AI Workflow Operator** — IA que opera tarefas burocráticas, sem substituir o motor determinístico.

## Cinco ativos acumulativos

Base técnica de equipamentos · motor versionado de regras · histórico de projetos e decisões · dados reais de margem, execução e performance · integração contínua entre comercial e engenharia sem redigitação.

## Fora do primeiro MVP

ERP fiscal completo, emissão fiscal própria, estoque completo, telemetria nativa de centenas de fabricantes, marketplace próprio, carteira de crédito, roteirização avançada, CAD/3D maduro, simulação física avançada sem validação e app nativo para todas as personas. **Integrar antes de construir.**

## Documento-base

[Modelagem completa](modelagem-completa.md) — arquitetura funcional, fluxos, domínios, integrações e roadmap (setembro/2026). Quando este documento e a modelagem divergirem, a divergência deve ser resolvida e registrada em um [ADR](../04-arquitetura/adr/).
