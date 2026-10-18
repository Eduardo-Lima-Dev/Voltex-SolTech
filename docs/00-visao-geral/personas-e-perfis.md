# Personas e perfis de acesso

Perfis sugeridos na seção 46 da modelagem. Serão mapeados para permissões granulares (`<produto>.<recurso>.<ação>`, por exemplo `crm.lead.read`, `calculator.session.create`) em `@voltex/shared`.

| Perfil              | Permissões principais                           |
| ------------------- | ----------------------------------------------- |
| Owner               | Tudo                                            |
| Admin               | Configuração, usuários, integrações             |
| Gestor comercial    | Leads, oportunidades, equipe, margem autorizada |
| SDR                 | Leads, contatos e qualificação                  |
| Vendedor            | Oportunidades, Calculator, propostas            |
| Engenharia          | Engine Studio, Off-Grid, documentos técnicos    |
| Responsável técnico | Aprovação/congelamento técnico                  |
| Operação            | Projetos, agenda, instalação                    |
| Instalador          | Work orders e checklists atribuídos             |
| Financeiro          | Custos, recebíveis, comissões, margem           |
| O&M                 | Plantas, monitoramento, tickets                 |
| Parceiro            | Escopo restrito por projeto                     |
| Cliente final       | Portal do cliente                               |

## Aprovações obrigatórias

Desconto acima do limite · margem abaixo do mínimo · proposta com alerta técnico · projeto fora de política · alteração de versão aprovada · substituição de equipamento após venda · alteração contratual · estorno · encerramento de projeto com pendência. Ver [regras de negócio](../01-requisitos/regras-de-negocio.md).

## As quatro "portas de entrada" comerciais

1. Empresa que quer apenas CRM.
2. Vendedor que quer apenas cálculo rápido.
3. Projetista que quer engenharia.
4. Especialista rural/off-grid que quer dimensionamento autônomo.
