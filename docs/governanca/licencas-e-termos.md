# Licenças e termos das fontes de dados

Pesquisa feita em **20/10/2026**. É um registro técnico do que as páginas oficiais dizem, **não é parecer jurídico**: antes de uso comercial amplo, um advogado deve confirmar os itens marcados como pendentes.

## Quadro

| Fonte                                                 | O que as páginas oficiais dizem                                                                                                                                                                                                                                         | Situação                                                                    | O que fazer                                                                                                                                                                                                                 |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PVGIS** (JRC, Comissão Europeia)                    | Dados de download "gratuitos para uso público se a fonte for citada" (`PVGIS © European Communities, 2001-2026`). O conjunto PVGIS 5.3 no catálogo do JRC está sob **CC BY 4.0**. Os dados-base (SARAH, NSRDB, CM SAF/ERA5) têm origem e termos próprios. Sem garantia. | **Liberada com atribuição**                                                 | Exibir a atribuição onde o dado aparece (tela do clima, memorial, relatório do cliente). Guardar data de conferência e URLs. Reler os termos das bases originais antes de campanha comercial grande.                        |
| **NASA POWER**                                        | A página de citação exige citar o POWER e a referência de dados (versão e data de acesso) e pede aviso ao projeto em publicações. **Não declara licença nem restrição comercial.** O registro AWS Open Data indica CC BY 4.0 e "sem restrições" (fonte secundária).     | **Liberada com atribuição; licença formal não confirmada**                  | Citar com versão e data de acesso no memorial. Pedir confirmação escrita (modelo abaixo) e arquivar a resposta.                                                                                                             |
| **CEC / SAM (NREL)**                                  | O código do SAM é **BSD-3-Clause**. Os CSV de `deploy/libraries` são dados da California Energy Commission e **nenhuma página consultada declara a licença dos dados**; o site da CEC não mostrou termos.                                                               | **Pendente** (ligada no ambiente de desenvolvimento por decisão do usuário) | Pedir esclarecimento ao NREL e à CEC (modelo abaixo). Até a resposta: o modelo é "adotar = a empresa copia a ficha para o próprio catálogo", sem redistribuir nem publicar a lista; mostrar a atribuição; revisão jurídica. |
| **Techlux**                                           | `robots.txt` permite o acesso. A página `/termo-de-uso` é um **texto provisório** ("Aqui fica o termo de uso"): não há termos reais. Os datasheets pertencem aos fabricantes.                                                                                           | **Pendente**                                                                | Pedir autorização por escrito (modelo abaixo). Manter o desenho atual: só título e URL são guardados; o PDF é baixado sob demanda e descartado.                                                                             |
| **ANEEL Dados Abertos**                               | Licença **ODbL** declarada no portal.                                                                                                                                                                                                                                   | Liberada                                                                    | Manter a atribuição. Conferir a licença de cada conjunto novo.                                                                                                                                                              |
| **Normas ABNT** (NBR 16690, 5410, 16612, 16149/16150) | Pagas.                                                                                                                                                                                                                                                                  | Fora do alcance do sistema                                                  | O engenheiro fornece e confere os valores com o texto que ele possui.                                                                                                                                                       |
| **Arquivos `.PAN` / `.OND` (PVsyst)**                 | Publicados por fabricantes para simulação; não há termo geral de redistribuição.                                                                                                                                                                                        | Uso interno do catálogo da empresa                                          | Não versionar os arquivos reais; só fixtures derivados com nomes trocados.                                                                                                                                                  |
| **CRESESB** (Manual 2014, SunData)                    | Publicação pública do CEPEL.                                                                                                                                                                                                                                            | Referência                                                                  | Não versionar o PDF; só a extração com página.                                                                                                                                                                              |
| **INMETRO**                                           | Sem base aberta confirmada.                                                                                                                                                                                                                                             | Assistida                                                                   | Link da consulta e registro conferido por pessoa; sem raspagem.                                                                                                                                                             |
| **Atlas INPE**                                        | CC BY-NC-ND (uso comercial vedado, sem derivados).                                                                                                                                                                                                                      | **Bloqueada**                                                               | Não usar.                                                                                                                                                                                                                   |

## Atribuições a exibir

| Onde                   | Texto                                                                                                                                                                                     |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clima por PVGIS        | `PVGIS © European Communities, 2001-2026` + nome da base de radiação usada                                                                                                                |
| Clima por NASA POWER   | `NASA POWER: these data were obtained from the NASA Langley Research Center (LaRC) POWER Project funded through the NASA Earth Science/Applied Science Program` + versão e data de acesso |
| Tarifas e GD           | `ANEEL, Dados Abertos (ODbL)`                                                                                                                                                             |
| Ficha vinda da CEC     | `Biblioteca CEC/SAM (NREL, dados da California Energy Commission)`                                                                                                                        |
| Ficha vinda da Techlux | `Documento técnico do fabricante, obtido em techlux.com.br`                                                                                                                               |

Locais: tela do clima do Engine, memorial (`engineering-report-pdf.ts`) e relatório do cliente.

## Modelos de e-mail

**NASA POWER** (para `larc-power-project@mail.nasa.gov`)

> Assunto: Confirmação de licença para uso comercial dos dados NASA POWER
>
> Somos a Voltex SolTech, que desenvolve software de dimensionamento fotovoltaico. Usamos a API do POWER (séries de irradiação e temperatura) para estimar geração em projetos de clientes, com citação do POWER e da versão dos dados. A página de citação não traz a licença. Os dados podem ser usados em produto comercial, em memoriais e relatórios entregues a clientes, desde que citados? Há restrição de volume além do limite de requisições da API? Agradecemos uma confirmação por escrito.

**NREL / SAM e CEC** (SAM Support e California Energy Commission)

> Assunto: Licença dos arquivos CSV da biblioteca de módulos e inversores (SAM / CEC)
>
> Usamos os CSV de `deploy/libraries` do repositório NREL/SAM apenas para que cada empresa copie fichas de equipamentos (módulos e inversores) para o próprio catálogo interno de projeto. O repositório declara BSD-3-Clause para o código, mas não encontramos a licença dos dados. Qual é a licença desses CSV e quem a define? Podemos usá-los em um produto comercial, com atribuição, sem redistribuir a lista completa? Agradecemos uma confirmação por escrito.

**Techlux** (contato comercial)

> Assunto: Autorização para leitura dos datasheets publicados em techlux.com.br/download
>
> Nosso software lê, a pedido de um usuário, a ficha técnica de um equipamento publicada na página de downloads para preencher o cadastro do equipamento na empresa dele. Guardamos apenas o título e o link; o PDF é lido na hora e descartado. O site não traz termos de uso preenchidos. Vocês autorizam esse uso? Querem que a atribuição apareça de outra forma?

Arquivar as respostas em `docs/governanca/evidencias/` (PDF ou e-mail exportado) e atualizar `licenseStatus` em `data-hub.registry.ts` só depois da resposta.

## Itens que dependem de advogado

- Licença formal do NASA POWER e dos CSV da CEC/SAM.
- Termos da Techlux e redistribuição de datasheets e `.PAN/.OND`.
- Prazos e obrigações da LGPD (ver `docs/08-deploy/seguranca-lgpd.md`).
- Responsabilidade técnica: a exigência de ART/TRT/RRT em microgeração é disputada (ANEEL x Crea); cada projeto segue o Crea do estado.
