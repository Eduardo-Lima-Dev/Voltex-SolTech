# Roteiro de teste visual — Fase 11 (execução, pós-venda, portal, financeiro)

Roteiro para **ver e usar** tudo da Fase 11 no navegador, com os dados exatos a digitar. Tudo é **dado de exemplo**: nada aqui é norma, preço de mercado ou tolerância técnica.

## 0. Preparação

```bash
pnpm setup                       # só na primeira vez (dependências, Docker, migrations e seed)
pnpm db:deploy && pnpm db:seed   # se já tinha o banco: aplica as migrations novas e cria os usuários Instalador e Pós-venda
pnpm dev                         # web :5173 · API :3000 · e-mails (Mailpit) :8025
```

Em outro terminal, com a API rodando:

```bash
set -a && . ./.env && set +a
pnpm --filter @voltex/api build
TENANT_SLUG=voltex-demo node apps/api/dist/cli/seed-internal-test-rules.js   # ativa as regras de exemplo (inclui ops.commissioning e ops.monitoring)
node scripts/seed-demo-execucao.mjs                                           # cria os clientes abaixo (demora uns 3 minutos; o login limita 5 por minuto)
```

O script é seguro de repetir: o cliente que já existe é pulado.

### Usuários (senha de todos: `Voltex@2026`)

| E-mail                 | Perfil              | Use para                                       |
| ---------------------- | ------------------- | ---------------------------------------------- |
| owner@voltex.demo      | Proprietário        | ver tudo, regras, privacidade, integrações     |
| vendedor@voltex.demo   | Vendedor            | leads, oportunidades, propostas                |
| gestor@voltex.demo     | Gestor comercial    | contrato, portal do cliente                    |
| operacao@voltex.demo   | Operações           | instalações, materiais, agenda, equipes        |
| instalador@voltex.demo | Instalador          | app de campo (`/operations/campo` ou `/campo`) |
| rt@voltex.demo         | Responsável técnico | aprovar comissionamento                        |
| posvenda@voltex.demo   | O&M                 | plantas, chamados, garantias, monitoramento    |
| financeiro@voltex.demo | Financeiro          | parcelas, custos, comissões, crédito           |

### O que o script deixa pronto

| Cliente                     | Onde está                                                                                                                                                                                                        | Para testar                                                     |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| **Helena Duarte Campos**    | Jornada completa: planta ativa, 30 dias de geração (6 abaixo do esperado → **chamado automático**), 3 parcelas (1 paga, 1 **atrasada**, 1 futura), 1 custo, **portal liberado** para `helena.campos@example.com` | portal do cliente, planta, monitoramento, financeiro, garantias |
| **Maria Aparecida Souza**   | Instalação em **comissionamento** (ordem iniciada pelo instalador)                                                                                                                                               | tela de comissionamento (ensaios, reprovação, travas)           |
| **João Batista Lima**       | Material pronto e **ordem de instalação agendada** para a Equipe Alfa (amanhã)                                                                                                                                   | app de campo do instalador                                      |
| **Padaria Pão Quente Ltda** | Contrato assinado, instalação **aguardando engenharia**                                                                                                                                                          | percorrer à mão homologação → materiais → agenda                |
| 6 leads                     | Funil de leads                                                                                                                                                                                                   | pontuação e distribuição                                        |

> **Duas limitações que o teste vai mostrar (são do sistema, não do script):**
>
> 1. **Comissionamento com o modelo completo de ensaios não aprova uma venda sem projeto técnico.** Os ensaios de Voc/Isc das strings precisam dos dados elétricos do projeto do Engine para ter valor esperado; as strings acrescentadas à mão não têm. Por isso a Maria fica travada com a mensagem "7 ensaio(s) que o sistema não consegue julgar". A Helena foi aprovada com um roteiro só de conferências, ativado só durante a execução do script.
> 2. **A geração esperada da planta só nasce do projeto técnico.** A venda de demonstração não tem um; o script grava um esperado de exemplo (528 kWh/mês) direto no banco da Helena. Em planta de venda sem Engine, o gráfico real × esperado fica sem referência e o chamado por desvio nunca abre.

---

## 1. Portal do cliente (o principal)

**Ver a conta liberada.** Entre como `gestor@voltex.demo` → **CRM → Contas** → busque `Helena` → abra. No cartão **Portal do cliente** aparece `helena.campos@example.com` como _Ativo, nunca acessou_.

**Gerar o link.** Clique **Gerar link**. Aparece o endereço `.../portal/acesso/<código>` e "Vale até ... e abre uma única vez". Abaixo, os botões de envio (e-mail, WhatsApp, copiar). Use o botão **Copiar** (ou selecione o endereço).

**Abrir como cliente.** Abra uma **janela anônima** (sem o login interno) e cole o link.

- Esperado: "Abrindo o seu portal…" e depois **Meus projetos** com o projeto da Helena e a linha do tempo de etapas (proposta, contrato, homologação, material, instalação, comissionamento, usina ativa).
- **Aceite do sistema** (quando a instalação estiver aguardando o aceite): botão **Registrar o meu aceite** → _Seu nome completo_ `Helena Duarte Campos` → confirmar.
- Cole **o mesmo link outra vez** em outra janela anônima: deve dizer _"Este link expirou ou já foi usado"_ com o botão **Pedir novo link**.

**Dentro do projeto (clique no título):** etapas concluídas, documentos liberados (relatório de comissionamento), garantias, **parcelas** (só consulta: 1 paga, 1 atrasada, 1 a vencer), resumo de monitoramento.

**Abrir um chamado como cliente.** No cartão **Chamados** do projeto, **Abrir chamado**: _Resumo_ `Inversor com luz vermelha acesa`; _Detalhes (opcional)_ `Desde ontem à noite a luz fica vermelha e o app não mostra geração.` Depois, como `posvenda@voltex.demo` → **Operação → Chamados**, abra o chamado e, em **Novo comentário**, escreva `Vamos enviar um técnico amanhã pela manhã.` (comentário não interno, para o cliente ver). Volte ao portal: a conversa mostra a resposta, e o cliente pode responder em **Sua mensagem**.

**Enviar documento pelo cliente.** No projeto, em **Documentos → Enviar um documento**, preencha _Observação do envio_ (`Comprovante de residência`) e escolha o _Arquivo para enviar_ (qualquer PDF ou imagem). Como `operacao@voltex.demo`, a revisão do envio fica em **CRM → Contas → (Helena) → Portal do cliente** (arquivos em quarentena: aceitar ou recusar).

**Pedir link sozinho.** Em janela anônima: `http://localhost:5173/portal/entrar` → e-mail `helena.campos@example.com` → a resposta é sempre a mesma ("se o e-mail estiver cadastrado, enviamos o link"). O e-mail aparece no Mailpit (`http://localhost:8025`). Com um e-mail que **não** está cadastrado, a mensagem é idêntica e nada é enviado.

**Revogar.** De volta à ficha, **Desativar**: o link e a sessão deixam de funcionar.

**Liberar para outro cliente (do zero).** Conta da Maria → _Liberar acesso para o e-mail_ `maria.souza@example.com` → **Liberar** → **Gerar link**.

---

## 2. Venda até o projeto (fazer à mão, com outro cliente)

Se quiser ver o início da cadeia, faça com um cliente novo. Dados prontos para copiar:

**Lead** — `vendedor@voltex.demo` → **CRM → Leads → Novo lead**

- Nome: `Rogério Albuquerque Neto` · Telefone: `(85) 98877-5005` · E-mail: `rogerio.neto@example.com`
- Origem: `Indicação` · Segmento: `Residencial` · Cidade: `Fortaleza` · UF: `CE`
- Conta de luz mensal (R$): `650,00` · Observações: `Indicado pela Helena.`

**Converter** → Tipo `Pessoa física`, CPF `529.982.247-25` (CPF de exemplo válido), nome mantido.

**Conta → imóvel** (aba Imóveis → Novo): Nome `Residência` · Rua `Rua dos Jasmins` · Nº `77` · Bairro `Cocó` · Cidade `Fortaleza` · UF `CE` · CEP `60192-000` · Latitude `-3,74` · Longitude `-38,49`. Levantamento: telhado `Cerâmico`, azimute `0`, inclinação `15`, sombreamento `Nenhum`, área disponível `80`, disjuntor de entrada `63 A`, aterramento adequado `Sim`.

**Unidade consumidora**: número `71234567-0` · Distribuidora `Enel Ceará (exemplo)` · Grupo `B` · Ligação `Bifásica`.

**Oportunidade** → mover para Primeiro contato → Qualificação → Fatura pendente. **Fatura**: anexar `apps/e2e/fixtures/fatura.pdf`, **Validar** com UC `71234567-0`, grupo `B`, bifásica e consumo de `520` kWh em cada um dos 12 meses.

**Cálculo (Solar Calculator)**: HSP `5` nos 12 meses, taxa de desempenho `0,8`, custo de disponibilidade `50` kWh, módulo `550 Wp` / `2,58 m²`, tarifa `95` centavos/kWh, custo `450` centavos/Wp, área `80 m²`, azimute `0`, inclinação `15`.

**Triagem** → _Avaliar triagem_ (deve ficar verde) → etapa **Cotação**.
**Cotação**: Título `Proposta base`; itens `Módulo fotovoltaico 550 Wp` × 8 a R$ 600,00 (categoria Módulo), `Inversor string 5 kW` × 1 a R$ 2.500,00 (Inversor), `Estrutura para telhado cerâmico` × 1 a R$ 1.200,00 (Estrutura); custos: frete R$ 400, instalação R$ 2.000, deslocamento R$ 200, outros R$ 100; comissão 5%, imposto 6%, financiamento 2%, contingência 3%; **preço de venda R$ 19.800,00** (margem fica acima do mínimo de 20%; a política `Mínimo geral` é criada pelo script, ou em _Margem_ com 20%).

**Proposta**: condições de pagamento `30% de entrada + saldo em 6 parcelas` → **Enviar** → abra o link público (`/p/<código>`) em janela anônima → nome `Rogério Albuquerque Neto` → marcar ciência → **Aceitar**.

**Contrato** (`gestor@voltex.demo`): na oportunidade → **Gerar contrato** → **Registrar assinatura** anexando qualquer PDF → o negócio vira _Ganho_ e o **Projeto** é criado. A Fase 11 começa aqui: a instalação nasce em _Aguardando engenharia_.

---

## 3. Instalação, materiais, equipes e agenda (`operacao@voltex.demo`)

Use a **Padaria Pão Quente**.

1. **Operação → Instalações**: a Padaria está em _Aguardando engenharia_. Abra.
2. **Aprovar a homologação** (em **CRM → Projetos → Padaria**): marque todos os itens obrigatórios do checklist como _Concluído_; status `Protocolado` (protocolo `PROTO-2026-0001`) → `Em vistoria` → `Aprovado`. A instalação passa para _Aguardando material_ e surge a tarefa **Comprar o material**.
3. Na ficha da instalação, **Materiais → Novo item** (3 vezes): `Módulo fotovoltaico 550 Wp` / categoria `MODULE` / qtd `12` / un `un`; `Inversor string 5 kW` / `INVERTER` / `1` / `un`; `Estrutura para telhado cerâmico` / `STRUCTURE` / `1` / `cj`.
4. Em cada item: **Pedir** → fornecedor `Distribuidora Solar Nordeste`, nº do pedido `PC-2026-100`, valor pago `7.200,00` (só registra) → **Receber**. Ao receber o último, a instalação vira _Material pronto_ e surge a tarefa **Agendar a instalação**.
5. **Operação → Equipes**: já existe **Equipe Alfa** (com o Instalador). Para criar outra: _Nome da equipe_ `Equipe Beta`.
6. Na instalação, **Ordens de serviço → Nova**: Tipo `Instalação` · Título `Instalar o sistema fotovoltaico` · Equipe `Equipe Alfa` · Início/Fim: amanhã 08:00 → 16:00 · checklist (um item por linha): `Conferir os módulos recebidos`, `Fixar a estrutura`, `Instalar módulos e inversor`, `Conferir o aterramento`.
7. **Choque de horário**: crie outra ordem (Tipo `Visita`, Título `Visita de vistoria`) para a **mesma equipe** e o **mesmo horário**. O aviso _Choque de horário_ aparece na ficha e em **Operação → Agenda**.
8. **Operação → Painel**: confira instalações por situação, atrasadas, pendências de material.
9. **Pendência de campo**: na instalação, _Pendências → Nova_: Tipo `Material`, Descrição `Faltou conector MC4 de 4 mm`, marque **Bloqueia**. Resolva depois com `Conectores comprados e entregues`.

---

## 4. App de campo (`instalador@voltex.demo`)

Use o **João Batista Lima** (ordem já agendada). No computador, abra `http://localhost:5173/campo` com o DevTools em modo celular (F12 → ícone de celular). Câmera e GPS reais só funcionam em HTTPS no celular.

1. Entre como `instalador@voltex.demo`. A lista mostra a ordem do João, com endereço (Avenida Beira Mar, 1200), mapa e telefone.
2. Abra a ordem **com internet**. No DevTools → Rede → **Offline**: o cabeçalho passa a mostrar _Sem internet_.
3. **Iniciar** → marque os itens do checklist → **Anotação**: `Telhado liberado; cliente acompanhou.` → **Foto** (escolha qualquer imagem) → **Pendência** que bloqueia: `Falta um disjuntor de 40 A`.
4. Veja o contador _p/ enviar_ no cabeçalho subir. Recarregue a página ainda offline: nada se perde.
5. Volte a **Online**: os itens sobem sozinhos. No escritório (`operacao@voltex.demo`) a ficha da instalação mostra a pendência e a foto; resolva a pendência.
6. **Assinatura do cliente**: antes de concluir, peça a assinatura no quadro (desenhe com o mouse) → **Concluir**. A instalação passa a _Instalada_ e é aberta a **ordem de comissionamento**.
7. Teste a recusa: no escritório, cancele a ordem (motivo `Reagendada pelo cliente`); no campo, faça uma ação e volte à rede: aparece _O sistema recusou algo_ com a mensagem.

---

## 5. Comissionamento e aceite (`operacao@voltex.demo`, `instalador@`, `rt@`)

Use a **Maria Aparecida Souza** (comissionamento em andamento, modelo completo).

1. Ficha da instalação → **Comissionamento**: ensaios agrupados (Cat. 1, Cat. 2, Extras, Start-up, Rede). O aviso mostra a regra de teste interno.
2. **Condições**: irradiância `800` W/m², temperatura do módulo `45` °C, ambiente `31` °C.
3. Marque as conferências como _Conforme_ (continuidade do aterramento, polaridade, caixas de junção, rede).
4. **Strings**: acrescente `String 1` e `String 2`. Em Voc/Isc registre `42` e `13` — o sistema mostra _Faltam os dados do módulo e da string para calcular o valor esperado_ (limitação 1 do início).
5. Como `rt@voltex.demo`: **Aprovar** → recusa com _7 ensaio(s) que o sistema não consegue julgar_. **Reprovar** pede motivo (`Strings sem dados elétricos`) e devolve a instalação a _Em instalação_.
6. Para ver o caminho **feliz**, abra a **Helena**: o comissionamento aprovado, o **Relatório (PDF)** e o aceite (`Aceite registrado no escritório`).
7. **Aceite pelo portal**: refaça o ciclo com a Padaria; depois do comissionamento, a instalação fica _Aceite do cliente_. No portal da cliente aparece o botão de aceite; o nome digitado é gravado com data, IP e navegador.

---

## 6. Planta, garantias, chamados e O&M (`posvenda@voltex.demo`)

1. **Operação → Plantas** → **Helena Duarte Campos**: ativos (módulos, inversor, estrutura vindos da lista de materiais), histórico, chamados, manutenção, contratos.
2. **Termos de garantia** (Operação → Garantias → **Novo termo**): Fabricante `Fabricante Exemplo`, Equipamento `Inversor`, Produto (anos) `5`, Desempenho (anos) `25`, Potência ao fim (%) `80`, Fonte do termo `Manual do fabricante (exemplo)`. **Salvar termo.**
   > Os números são **seus**: o sistema não traz garantia padrão. Use o PDF real do fabricante.
3. Na planta → **Ativos e garantias → Adicionar ativo**: Categoria `Inversor`, Fabricante `Fabricante Exemplo`, Modelo `INV-5K`, Quantidade `1`. A garantia aparece calculada. Para garantia a vencer, ajuste a data de instalação para perto do prazo e veja em **Garantias que vencem em até 90 dias**.
4. **Chamados → Novo chamado**: Planta `Helena Duarte Campos`, Assunto `Limpeza dos módulos`, Descrição `Acúmulo de poeira após o período seco.`, Tipo `Preventivo`, Prioridade `Média`. Abra o chamado → **Gerar ordem de serviço** → mude a situação até **Resolvido** (a solução é obrigatória: `Módulos lavados com água desmineralizada`).
5. O **chamado automático** `Geração abaixo do esperado há 6 dia(s) seguidos` já está lá (vem do monitoramento, seção 7).
6. **O&M e manutenção**: em _Prazos e gatilhos da empresa_ defina `Aviso de garantia (dias)` `90`, `Aviso de renovação (dias)` `60`, `Antecedência de manutenção (dias)` `15` → **Salvar** → **Executar a rotina agora**. Plano de manutenção e contrato de O&M são criados pela ficha da planta (periodicidade e valor são **seus**).

---

## 7. Monitoramento (`posvenda@voltex.demo`)

Na planta da Helena, seção **Monitoramento**:

- Gráfico **geração diária**: 24 dias a ~17,8 kWh e os 6 últimos a 9,5 kWh, contra o esperado de 528 kWh/mês.
- **Importar planilha de geração**: cole o conteúdo abaixo (separador `;`, vírgula decimal) e importe; as linhas recusadas, se houver, aparecem listadas:

```
data;kwh
2026-10-01;18,2
2026-10-02;17,9
2026-10-03;18,4
```

- **Vincular** a uma API de fabricante só existe para **SolarEdge, APsystems e Fronius**, exige credencial real sua e que `INTEGRATIONS_ENABLED_PROVIDERS` inclua o provedor no `.env`. **Administração → Integrações** mostra os demais provedores como _Sem adaptador_, com o botão Ligar desabilitado.
- **Regra do desvio**: **Administração → Regras → ops.monitoring**. A de exemplo abre chamado após **5 dias seguidos 30% abaixo** do esperado. Sem regra ativa, o gráfico aparece e nenhum chamado é aberto.

---

## 8. Financeiro (`financeiro@voltex.demo`)

1. **CRM → Projetos → Helena** → seção **Financeiro**: parcelas (a #2 está **atrasada**), custo, crédito, comissões.
2. **Nova parcela**: Referência `CT-0001`, Parcela nº `4`, Vencimento `2030-01-15`, Valor `500,00` → **Lançar parcela**.
3. Na parcela atrasada → **Receber** → forma `PIX`, data de hoje → **Confirmar recebimento**.
4. **Cobrança**: o botão de lembrete abre o texto pronto para e-mail ou WhatsApp (`wa.me`); o envio é **manual** e fica registrado.
5. **Novo custo**: Categoria `Mão de obra`, Descrição `Equipe de instalação`, Valor real `1.800,00`, Previsto na cotação `2.000,00`, Fornecedor `Equipe Alfa` → **Lançar custo**. A margem real se atualiza.
6. **Simulação de crédito**: Instituição `Banco Exemplo`, Valor financiado `12.000,00`, Taxa anual `18` (%), Prazo `36` → **Registrar**; depois mude a situação para _Enviado_ → _Aprovado_ (ou _Pendente_ com as pendências, uma por linha).
7. **Política de comissão** (**Operação → Financeiro**): Base `Recebido`, Vale a partir de hoje, Vendedor `3` (%) → **Publicar nova política**. Volte à Helena e use **Recalcular pela política vigente**.
   > Não há comissão padrão: sem política, nada é calculado.
8. **Operação → Financeiro**: parcelas vencidas de todos os projetos, inadimplência e comissões.

---

## 9. Pontuação e distribuição de leads (`gestor@voltex.demo`)

Os 6 leads criados pelo script têm origens, segmentos e contas de luz diferentes. Em **CRM → Pontuação**:

- **Critério Origem** — Peso `40`; pontos: Indicação `100`, Formulário `70`, WhatsApp `60`, Página de captura `60`, Campanha `30`, Manual `20`.
- **Critério Segmento** — Peso `30`; Industrial `100`, Comercial `80`, Rural `60`, Residencial `50`.
- **Critério Conta de luz mensal** — Peso `30`; faixas _A partir de (R$)_ `0` → `20` pontos, `300` → `50`, `1.000` → `80`, `3.000` → `100`.
- **Distribuição**: Regra `Rodízio` (ou por região, com estados `CE`, `PE`).
- **Salvar configuração** → **Pontuar de novo os leads em aberto** → em **CRM → Leads**, ordene por **maior pontuação**: a Metalúrgica (industrial, conta alta) fica no topo; o "Sítio Recanto Verde" (sem conta de luz) é pontuado só pelos critérios que se aplicam.
  > Sem critérios cadastrados, nenhum lead é pontuado. Os pesos acima são exemplo.

---

## 10. Segurança em duas etapas (qualquer usuário)

1. Menu da conta → **Segurança** (`/conta/seguranca`).
2. **Verificação em duas etapas → Ativar**: escaneie o QR com um aplicativo autenticador (Google Authenticator, Authy, 1Password…). Digite o código de 6 dígitos. **Guarde os códigos de recuperação** (aparecem uma vez).
3. Saia e entre de novo: depois da senha, pede o **código do aplicativo**. Teste também um **código de recuperação** (cada um vale uma vez).
4. Como `owner@voltex.demo`, em **Política da empresa**, ligue _Exigir a verificação em duas etapas_ e **Salvar política**: quem ainda não ativou é levado a ativar no próximo acesso.
5. **Desativar** pede a senha e um código.

---

## 11. LGPD (`owner@voltex.demo`)

**Administração → Privacidade**:

- **Prazos de guarda dos dados**: Leads não convertidos `24` meses; fotos de campo e geolocalização em branco (a regra é do seu advogado); contratos assinados nunca abaixo de `60`. **Salvar prazos.**
- **Atender um pedido de eliminação**: escolha uma pessoa (ex.: o lead _Ana Paula Ferreira_), "De onde veio o pedido" `E-mail do titular`, motivo `Pedido do titular pela LGPD`. **Eliminar os dados desta pessoa.** O histórico guarda só as iniciais. Para uma conta com execução (ex.: Helena) a eliminação inclui fotos, assinaturas, localização, acessos e sessões do portal e chamados.

---

## 12. Integrações e assinatura eletrônica (`owner@voltex.demo`)

- **Administração → Integrações**: provedores de monitoramento (SolarEdge, APsystems, Fronius com adaptador; os demais **Sem adaptador**) e de assinatura.
- **DocuSeal** aparece catalogado e indisponível: a assinatura continua sendo pelo **registro do PDF assinado** no contrato (seção 2). A integração automática depende da documentação oficial do DocuSeal (ver ADR-0027 e `docs/07-desenvolvimento/integracoes.md`).
- Para testar uma API real de inversor: preencha a credencial, **Testar** e **Ligar**. Os formatos das três APIs foram escritos da documentação pública e **não foram validados com conta real**.

---

## Quando algo não aparece

| Sintoma                                | Causa provável                                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Erro "coluna não existe" no log da API | `pnpm db:deploy` pendente                                                                         |
| Falta Instalador/Pós-venda para entrar | `pnpm db:seed` não rodou depois da atualização                                                    |
| Instalação não passa de estado         | Os eventos são publicados a cada segundo, mais o tempo da fila; espere alguns segundos e atualize |
| 429 ao entrar                          | Limite de 5 logins por minuto; espere 1 minuto                                                    |
| Comissionamento não aprova             | Veja a limitação 1 no início                                                                      |
| Gráfico sem referência                 | Veja a limitação 2 no início                                                                      |
