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

_A preencher após a execução (caminho da pasta, total de arquivos, taxa de sucesso, campos ajustados, produtos conferidos com a ficha)._

## Direitos

Os arquivos pertencem aos fabricantes. O uso é interno, no catálogo da empresa. Não há termo geral de redistribuição: não publicar nem versionar os originais.
