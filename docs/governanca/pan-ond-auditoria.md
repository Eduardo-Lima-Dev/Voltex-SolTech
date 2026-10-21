# Auditoria dos arquivos `.PAN` e `.OND`

Objetivo: medir o quanto o leitor ([`packages/solar-engine/src/io/pvsyst.ts`](../../packages/solar-engine/src/io/pvsyst.ts)) lê corretamente os arquivos reais da empresa, antes de importar em lote para o catálogo.

## Método

1. **Cópia isolada.** Os arquivos vêm de uma pasta local e são tratados como não confiáveis: copiar para um diretório novo e vazio **fora do repositório**; ler como texto; nunca executar nada dali.
2. **Auditoria.** O script `tools/pan-ond-audit` lê cada arquivo com `parsePvsystFile` e emite um relatório (Markdown e CSV) por arquivo: campos lidos, ausentes, avisos e coerência física.
3. **Coerência física verificada:** `Pmax ≈ Vmpp·Impp` (tolerância de 2%), `Vmpp < Voc`, `Impp < Isc`, coeficientes de temperatura com sinal e unidade plausíveis, dimensões e peso, potência CA e tensões do inversor, faixa MPPT.
4. **Ajuste do leitor.** Cada chave não lida que importe (NOCT, coeficientes, dimensões, garantia; no OND: tensão de partida, topologia, MPPT, curva de eficiência) é incorporada, com teste.
5. **Fixtures.** Para cada tecnologia nova, um arquivo derivado com nomes de fabricante e modelo trocados, em `packages/solar-engine/src/io/fixtures/`. Os arquivos reais **não** são versionados.
6. **Importação em lote** pelo catálogo (prévia, aprovação em um clique) e comparação com a ficha em PDF de 3 a 5 produtos.

## Critério de aceite

95% ou mais dos arquivos lidos sem erro físico e com todos os campos obrigatórios; os demais com motivo registrado.

## Resultado

Primeira rodada em 21/10/2026, com **4 arquivos** da empresa (3 `.OND` e 1 `.PAN`), copiados para um diretório isolado e lidos com `node tools/pan-ond-audit/audit.mjs <pasta>`.

| Arquivo                           | Resultado                             | Observação                                                                                                                               |
| --------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Módulo Renesola 555 W (`.PAN`)    | Lido, 17 campos                       | Fabricante gravou `muVocSpec` **positivo**; o leitor guardava +0,29 %/°C (Voc a frio subestimado). Corrigido: sempre negativo, com aviso |
| Inversor Elgin 3,6 kW (`.OND`)    | Lido, 14 campos                       | O modelo cita "2 mppt" mas o arquivo traz `NbMPPT=1`: aviso para conferir na ficha                                                       |
| Inversor Sofar 10,5 kW (`.OND`)   | Lido, 14 campos                       | Corrente por MPPT é a total dividida pelos MPPT (confiança baixa, avisado)                                                               |
| Inversor Hopewind 100 kW (`.OND`) | Lido, 13 campos; falta `iMaxPerMpptA` | O arquivo não traz `IMaxDC`: o campo fica em branco para preencher pela ficha (nunca inventado)                                          |

**Taxa: 3 de 4 (75%) com todos os campos obrigatórios; o quarto não traz a corrente CC máxima no arquivo.** A amostra é pequena; o critério de 95% só vale com mais arquivos.

Correções feitas no leitor por causa desta rodada (`pvsyst.ts`):

1. Coeficiente de Voc sempre negativo (segurança do Voc a frio).
2. Aviso de divergência entre o número de MPPT do nome do modelo e o arquivo.
3. Aviso quando `Pmax` difere de `Vmp × Imp` em mais de 2%.
4. Leitura tolerante a codificação: UTF-8 (com ou sem BOM) e, com byte inválido, Windows-1252.

Os arquivos reais não foram versionados. Os fixtures `voc-positivo.pan`, `nome-com-2-mppt.ond` e `sem-corrente-por-mppt.ond` são derivados, com fabricante e modelo trocados.

**Falta:** importar em lote pelo catálogo e comparar 3 a 5 produtos com a ficha em PDF (conferência humana).

## Direitos

Os arquivos pertencem aos fabricantes. O uso é interno, no catálogo da empresa. Não há termo geral de redistribuição: não publicar nem versionar os originais.
