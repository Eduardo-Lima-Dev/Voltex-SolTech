# ADR-0019: Integration Hub (conexões por empresa, credenciais cifradas, adaptadores desligados por padrão)

- **Status:** Aceita (implementação a partir da Fase 11A)
- **Data:** 2026-10-22

## Contexto

A Fase 11 liga o sistema a serviços de terceiros que exigem credencial **da empresa** (monitoramento de inversores, assinatura eletrônica auto-hospedada). Isso é diferente da Central de Dados ([ADR-0018](0018-central-de-dados-externos.md)), que consulta bases **públicas** e guarda o resultado em cache global. Aqui há segredo, limite de chamadas por conta, falha parcial e, no caso de endpoints não oficiais, risco jurídico.

## Decisão

- **Serviço de plataforma** (`platform/integrations`) com um **adaptador por provedor**, declarado no código (`IntegrationAdapter`): tipo, se é oficial, licença, campos de credencial, orçamento de chamadas, intervalo mínimo, `test()` e `sync()`.
- **Conexão por empresa** (`IntegrationConnection`): a empresa só informa as credenciais. Elas ficam **cifradas** pela extensão de criptografia do Prisma (chave por empresa, [seguranca-lgpd](../../08-deploy/seguranca-lgpd.md)) e **nunca voltam pela API**: a tela mostra só "configurado" e os campos que não são segredo. A auditoria e a exportação da empresa também omitem as credenciais.
- **Desligado por padrão:** um provedor só consulta a internet se estiver em `INTEGRATIONS_ENABLED_PROVIDERS` no servidor, depois de conferidos os termos (mesma regra de `DATA_HUB_ENABLED_SOURCES`). Ligar a conexão é decisão separada, da empresa.
- **Não oficial exige aceite:** um adaptador `official: false` (endpoint usado pelos apps do fabricante) só liga com o aceite explícito do administrador, registrado com nome e data. A tela e a API avisam que pode violar os termos e parar sem aviso.
- **Execução observável:** toda sincronização, teste ou reprocessamento grava uma `IntegrationRun`. Falhas seguidas mudam a **saúde** (amarela, depois vermelha) e, ao atingir o limite, **pausam** a conexão e mandam o trabalho para a **fila de falhas** (`IntegrationDeadLetter`), que uma pessoa reprocessa ou descarta.
- **Fila BullMQ** `integrations`: uma varredura periódica enfileira uma sincronização por conexão vencida, com retentativa e recuo exponencial; só a última tentativa que falha conta como falha e vai para a fila de falhas. Sem Redis nos testes: o processamento é chamado direto.
- **Orçamento de chamadas** por provedor (por dia ou por mês), contado pelas execuções da conexão; esgotado, a execução é registrada como "não executada".
- **HTTP abstrato** (`IntegrationHttp`) para trocar por **respostas gravadas** nos testes, com bloqueio de endereços internos (SSRF), exceto liberação explícita (`INTEGRATIONS_ALLOW_PRIVATE_HOSTS`) para provedor auto-hospedado em rede privada.
- **Plano da empresa** (`tenant.settings.plan`, RF-PLAT-013): recursos e limites definidos pelo operador da plataforma (CLI `set-tenant-plan`); a empresa não o altera pela API.
- **Comunicações** (`platform/notifications`): e-mail pelo SMTP da plataforma e **link `wa.me`** que o usuário abre no próprio aparelho; toda saída grava o histórico. Nenhuma API de WhatsApp.

## Consequências

- Adicionar um provedor é escrever um adaptador e um arquivo de respostas gravadas; a infraestrutura de credencial, fila, saúde e tela já existe.
- Sem credencial real, a validação de cada adaptador fica **pendente** e declarada: os testes provam o tratamento do formato documentado, não a conta de um cliente.
- O custo é uma fila a mais e quatro tabelas (conexão, execução, falha, histórico de comunicação).

## Alternativas consideradas

Usar a Central de Dados para tudo (mistura dado público com segredo de empresa e não tem retentativa por conta); guardar credencial em variável de ambiente (não é por empresa); chamar os provedores direto do front-end (expõe a credencial); API paga de WhatsApp (fora do escopo por decisão do usuário).
