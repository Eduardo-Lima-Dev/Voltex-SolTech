# Central de Dados Externos (Fase 9B)

Serviço de plataforma que traz dados de bases públicas, vigia páginas de normas e entrega tudo como **proposta** para uma pessoa decidir. Decisão de arquitetura: [ADR-0018](../04-arquitetura/adr/0018-central-de-dados-externos.md). Licenças e termos: [fontes externas](../referencias/fontes-externas.md).

## Regra de ouro

**Dado externo nunca entra direto.** Há duas exceções claras, e as duas são **leitura**, não decisão:

- **Clima** (NASA POWER, PVGIS): vai para um cache global por coordenada e é só consultado por quem projeta. Não vira regra, tarifa nem catálogo.
- **Horizonte** (PVGIS): idem.

Tarifas, mudanças em normas e (nas próximas fases) equipamentos viram **`UpdateProposal`** com origem, data, licença, hash e diferença. Aprovar aplica; descartar exige motivo; tudo é auditado e publica evento.

## O que a 9B entrega

| Parte                                                                                                                          | Onde                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Leitores puros (sem rede) de NASA POWER e PVGIS, resumo mensal, texto/diferença de páginas                                     | `packages/solar-engine/src/io/` (`weather.ts`, `watch.ts`)                                       |
| Tabelas globais `DataSource`, `DataCollection`, `WeatherSeries`, `HorizonProfile`; por empresa `SourceWatch`, `UpdateProposal` | `packages/database/prisma/schema/data-hub.prisma`, migration `20261020200000`                    |
| Módulo da API                                                                                                                  | `apps/api/src/platform/data-hub/`                                                                |
| Telas                                                                                                                          | Administração → **Fontes de dados** e **Atualizações** (`apps/web/src/features/admin/data-hub/`) |
| Fila BullMQ `data-hub`                                                                                                         | `data-hub.queue.ts`: `watch-all` (semanal), `tariff-scan` (mensal)                               |

## Fontes ligadas e desligadas

Cada fonte está registrada no código (`data-hub.registry.ts`) com licença, atribuição e situação dos termos (`PENDING_REVIEW`, `CLEARED`, `BLOCKED`). **Uma fonte só consulta a internet se estiver na variável `DATA_HUB_ENABLED_SOURCES`** do servidor (ex.: `nasa-power,pvgis,aneel-tariffs`). Vazio (padrão) = nada é buscado. O que já está em cache continua servido.

Hoje: `aneel-tariffs` com termos conferidos (ODbL); **`nasa-power` e `pvgis` com termos NÃO conferidos para uso comercial**. Ligar essas duas é uma decisão sua depois da conferência; as respostas já saem com o aviso e com a atribuição.

## Clima e horizonte

- `GET /data-hub/weather?latitude&longitude[&source=nasa-power|pvgis][&kind=climatology|hourly][&year][&refresh=true]`
- `GET /data-hub/horizon?latitude&longitude`

Coordenadas arredondadas a **2 casas** (~1 km) formam a chave do cache. Cada coleta (`DataCollection`) guarda início, fim, situação, hash do conteúdo e erro. A série horária fica comprimida (gzip) em `WeatherSeries.payload`; o resumo mensal fica em `summary`.

**Cuidados que a resposta repete em `warnings`:**

- A série horária da NASA POWER está em **hora solar local (LST)**; a do PVGIS em UTC.
- **A temperatura mínima da fonte não é a temperatura de projeto.** Em Brasília, a climatologia da NASA indica mínima mensal de 7,6 °C e a série horária de 2024 tem mínimo de 10,7 °C: dados de grade suavizam os extremos. A Tmin usada no Voc frio é definida e assinada pelo responsável técnico (ver [memorial](../06-calculos/engine-compatibilidade.md)).
- O PVGIS só entra como **série horária no plano horizontal** neste conector (a transposição para o plano do arranjo é cálculo nosso, ENG-F18). A climatologia mensal vem da NASA POWER.

## Vigilância de fontes

Cada empresa cadastra os endereços (página ou PDF) de normas, resoluções e leis. A coleta:

1. baixa o conteúdo (só endereços **públicos**: localhost, IPs privados e nomes que resolvem para eles são recusados, contra SSRF);
2. extrai o texto (HTML sem scripts/estilos; PDF com `unpdf`), normaliza e calcula o hash;
3. **primeira coleta = referência** (`BASELINE`), sem proposta;
4. hash igual = `UNCHANGED`; hash diferente = `CHANGED`, com **diferença por linhas** (o que entrou e o que saiu), proposta `WATCH_CHANGE` e evento `ExternalSourceChanged`;
5. página fora do ar, PDF ilegível ou sem texto = `ERROR`, registrado em `lastError`, sem derrubar as outras fontes.

A proposta tem chave única por fato (`watch:<id>:<hash>`): repetir a coleta não duplica. **Nada altera regra sozinho.** O responsável técnico lê a diferença e, se for o caso, cria a nova versão da regra (ADR-0016).

Limites: diferença por linhas ignora a ordem (suficiente para avisar); PDF escaneado não tem texto; páginas que mudam a cada acesso (data/hora, contador) geram propostas falsas, e a solução é vigiar o PDF oficial.

## Tarifas da ANEEL

`POST /data-hub/tariffs/scan` (e o agendamento mensal, para todas as empresas) lê o arquivo de Dados Abertos **uma vez** e compara com as concessionárias de cada empresa. Para cada tarifa residencial B1 nova ou alterada cria uma proposta `TARIFF` com valor, vigência, resolução e o valor atual na diferença. **Aprovar** cria ou atualiza a tarifa da concessionária com a fonte; **descartar** não toca em nada. Empresa sem aquela concessionária não recebe proposta.

## Testes

Sem internet: `DataHubHttp` e `AneelSource` são trocados por **respostas gravadas** (fixtures reais em `packages/solar-engine/src/io/fixtures/`). Cobrem cache e arredondamento, falhas da fonte (500, 429, formato novo), fonte desligada, SSRF, vigilância (referência, igual, mudou, erro), decisão, isolamento entre empresas, tarifas (propor, aprovar, repropor, descartar) e a fila.

## Pendências

- Conferência dos termos de PVGIS e NASA POWER (e CEC/SAM, 9C) antes de ligar em produção.
- Painel do dono da plataforma (Fase 13): hoje as fontes globais se ligam por variável de ambiente.
- Vigilância por **empresa**: duas empresas vigiando a mesma página baixam duas vezes (decisão de simplicidade; um cache por URL pode vir depois).
- LexML e as demais fontes do plano (CEC, `.PAN/.OND`, INMETRO, preços) entram nas fases seguintes.
