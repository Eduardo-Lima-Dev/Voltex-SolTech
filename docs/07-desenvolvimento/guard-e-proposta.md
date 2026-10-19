# Triagem, cotação e proposta (Fase 7B)

Módulos `products/crm/{guard,quotes,proposals}` da API; abas **Triagem**, **Cotação** e **Proposta** na oportunidade, página **Aprovações** no CRM, **Margens** em Administração e a página pública `/p/:token` na Web. Segue o [ADR-0014](../04-arquitetura/adr/0014-project-guard.md). O cálculo da margem está em [Margem de contribuição](../06-calculos/margem.md).

```
Pré-dimensionamento ──(triagem verde ou liberada)──▶ Cotação ──(margem ok ou aprovada)──▶ Proposta pronta ──▶ Enviada ──(aceite)──▶ Contrato
```

## Triagem (Project Guard)

**É triagem, não homologação.** Verde não garante aprovação nem conexão; o texto da tela e do PDF diz isso.

- `POST /opportunities/:id/guard/evaluate` junta cálculo vigente, fatura validada, levantamento do imóvel, UC e pedidos de engenharia e devolve um semáforo, os alertas e o que falta. Algoritmo `guard-1.0.0`, regras `builtin@1`. Cada avaliação guarda **de quê partiu** (snapshot da fatura e cálculo), as versões e quem avaliou.
- **Semáforo:** qualquer impedimento (`BLOCKING`) → vermelha; senão, qualquer ponto de atenção (`WARNING`) → amarela; senão, verde. `INFO` não muda a cor.
- **Só verificações não regulatórias** (RN-012, RN-017). Regra por distribuidora só entra com fonte oficial vigente, versão e revisão de especialista.

| Código                                                                     | Gravidade             | Quando                                                                             |
| -------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------- |
| `NO_CALCULATION`                                                           | impedimento           | não há cálculo vinculado                                                           |
| `CALCULATION_RED` / `CALCULATION_YELLOW`                                   | impedimento / atenção | semáforo do cálculo                                                                |
| `CALCULATION_STALE`                                                        | impedimento           | o local mudou depois do cálculo (a mensagem diz o quê: inclinação, azimute, área…) |
| `CALC_<alerta>`                                                            | a do alerta           | cada alerta do Calculator é repetido com a mesma gravidade                         |
| `BILL_NOT_VALIDATED`                                                       | atenção               | sem fatura validada                                                                |
| `CONSUMPTION_MISMATCH`                                                     | atenção               | consumo do cálculo difere mais de 30% do da fatura                                 |
| `SITE_MISSING` / `INTAKE_INCOMPLETE`                                       | atenção               | sem imóvel ou levantamento incompleto (lista os campos)                            |
| `TECHNICAL_VISIT_PENDING`                                                  | atenção               | visita técnica marcada como necessária                                             |
| `GROUNDING_INADEQUATE`                                                     | atenção               | aterramento inadequado                                                             |
| `SHADING_RELEVANT`                                                         | atenção               | sombreamento relevante                                                             |
| `UC_MISSING` / `DISTRIBUTOR_MISSING` / `PHASE_MISSING`                     | atenção               | UC sem concessionária ou ligação                                                   |
| `ENGINEERING_PENDING`                                                      | atenção               | pedido de engenharia aberto (exige revisão de engenharia)                          |
| `ENTRY_STANDARD_UNKNOWN`, `ASSUMPTIONS_OVERRIDDEN`, `TARIFF_WITHOUT_TAXES` | informação            | padrão de entrada não informado; premissas alteradas à mão; tarifa sem impostos    |

- **Reavaliar sem mudança** devolve a mesma avaliação (sem criar versão). Com mudança, cria a versão seguinte; as anteriores ficam no histórico.
- **Invalidação (RF-GUARD-006):** mudar o levantamento do imóvel, vincular outro cálculo ou confirmar a fatura de novo grava a invalidação da avaliação vigente (por evento do outbox). Além disso, a consulta calcula uma **impressão digital** das premissas e marca como `stale` na hora, sem esperar o evento. Eventos que chegam atrasados e já estavam refletidos na avaliação são ignorados.
- **Imutável no banco:** o relatório não pode ser alterado nem apagado; só se grava a invalidação, uma vez (gatilho).
- **Liberação formal (`crm.guard.review`):** amarela ou vermelha segue para a cotação com justificativa de 10+ caracteres, registrada com nome e data na auditoria, na linha do tempo e no evento `ProjectGuardOverridden`. Vale **só para aquela avaliação**: se as premissas mudarem, some. Verde não precisa. Vendedor e SDR não liberam.
- **Trava de etapa:** entrar em **Cotação** exige avaliação verde ou liberada e atualizada (`422 GUARD_REQUIRED`, com a explicação).

## Cotação e Margin Guard

- Cotação versionada por oportunidade: lista de materiais, custos, preço e cálculo vinculado (o mais recente, ou o escolhido). O servidor **recalcula a margem** e guarda a situação e a política usada; a tela mostra a situação pela política **de hoje**.
- **Sem política, nada é liberado.** A empresa define a margem mínima em Administração → Margens (`crm.margin-policy.manage`); o sistema não presume um mínimo.
- **Abaixo do mínimo:** o vendedor pede aprovação com justificativa; o gestor (`crm.margin.approve`) aprova ou recusa com motivo. **Segregação de funções:** quem pediu não decide o próprio pedido (exceto o proprietário). O administrador **não** aprova margem.
- **Alterar números** (itens, custos ou preço) derruba a aprovação e encerra o pedido pendente; só o título não mexe.
- **Travada ao entrar numa proposta:** a cotação não se edita nem se exclui mais (crie uma versão nova).
- Eventos: `QuoteCreated`, `QuoteChanged`, `MarginThresholdViolated`, `MarginApprovalRequested`, `MarginApprovalDecided`.

## Proposta

- Gerada com a oportunidade em Cotação (ou mais adiante), triagem liberada **e** margem liberada (dentro da política ou aprovada). De 1 a 3 cotações, cada uma vira um **cenário**; validade de 1 a 90 dias (padrão 15); condições de pagamento e observações.
- **`ProposalSnapshot` imutável** (gatilho): o conteúdo que o cliente vê, com hash. **Nunca inclui custos, margem, comissão nem a triagem interna.** Os números do cenário vêm do cálculo vinculado, com o payback **recalculado sobre o preço da cotação** (`repriceCashFlow`).
- **PDF** (pdfkit) gerado a partir do snapshot, guardado como documento; pode ser regerado (`POST /proposals/:id/pdf`) sem mexer em mais nada. Se a geração falhar, a proposta existe e o PDF é regerado depois.
- **Nova versão substitui a anterior** (que fica como histórico); a aceita permanece.
- **Envio** (`POST /proposals/:id/send`) cria o **link público** (`/p/<token>`, 256 bits; só o **hash** é guardado, então o link aparece uma única vez). Reenviar cria outro e invalida o anterior. Exige triagem em dia e validade vigente. Move a oportunidade para "Proposta enviada".
- **Página pública** (sem login, fora da casca da suíte, com limite de requisições): mostra cenários, gráficos, condições e o aviso de estimativa. A **primeira abertura** vira evento (`ProposalViewed`) e linha do tempo; as demais só contam visualizações.
- **Aceite online:** nome completo, CPF/CNPJ opcional e confirmação; registra nome, data, IP e navegador; vai a oportunidade para **Contrato**. Link expirado ou substituído responde `410`; aceita, `409`.
- **Identidade visual** (Administração → Empresa): cor principal e logo (PNG/JPEG, até 2 MB) em `tenant.settings.branding`; usadas no PDF e na página.
- As etapas "Proposta pronta" e "Proposta enviada" **só nascem pelas ações** (`PROPOSAL_REQUIRED` se tentar mover à mão).

## Permissões

| Área              | Ler                 | Escrever / decidir                                                  |
| ----------------- | ------------------- | ------------------------------------------------------------------- |
| Triagem           | `crm.guard.read`    | `crm.guard.evaluate` (avaliar); `crm.guard.review` (liberar)        |
| Cotações          | `crm.quote.read`    | `crm.quote.write`                                                   |
| Margens           | `crm.margin.read`   | `crm.margin-policy.manage` (políticas); `crm.margin.approve` (fila) |
| Propostas         | `crm.proposal.read` | `crm.proposal.write`                                                |
| Identidade visual | qualquer usuário    | `platform.tenant.manage`                                            |

O SDR não vê triagem, cotação nem proposta. Quem libera triagem: gestor comercial, responsável técnico e proprietário.

## Limites conhecidos

- A triagem não substitui análise regulatória nem de engenharia; faltam regras por distribuidora com fonte (Fase 7C traz o checklist EnergIF como dado versionado).
- Custos e alíquotas são informados na cotação; não há catálogo nem importação de preços.
- O leitor de fatura segue testado só com faturas sintéticas (ver [CRM Solar](crm.md)).
- O aceite online é um registro do cliente (nome, data, IP, navegador), **não** é assinatura eletrônica com validade jurídica; a assinatura do contrato fica para depois.
- O documento (CPF/CNPJ) do aceite fica em texto até a criptografia da Fase 8.
- Não há envio automático por e-mail ou WhatsApp: o vendedor copia o link e envia por onde preferir.
