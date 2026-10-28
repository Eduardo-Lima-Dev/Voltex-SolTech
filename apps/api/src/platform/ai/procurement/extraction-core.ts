import { extractedPriceRowSchema, type ExtractedPriceRow } from '@voltex/shared';
import { parseDate } from '../../catalog/price-list.service';

/**
 * Núcleo puro do procurement assistido (Fase 12H): prepara o texto para a IA, lê a resposta dela e só aceita linhas
 * que se confirmam no próprio documento. O modelo extrai; quem decide o que entra na lista de preços é a pessoa.
 */

/** Quebra o texto em pedaços por linha (a tabela não é cortada no meio de uma linha). */
export function chunkText(
  text: string,
  maxChars: number,
  maxChunks: number,
): { chunks: string[]; truncated: boolean } {
  const chunks: string[] = [];
  let current = '';
  let truncated = false;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const piece = line.length > maxChars ? line.slice(0, maxChars) : line;
    if (current.length + piece.length + 1 > maxChars && current) {
      chunks.push(current);
      current = '';
    }
    if (chunks.length >= maxChunks) {
      truncated = true;
      break;
    }
    current += (current ? '\n' : '') + piece;
  }
  if (current && chunks.length < maxChunks) chunks.push(current);
  else if (current) truncated = true;
  return { chunks, truncated };
}

/** Lê o JSON da resposta do modelo (aceita cercas de código e texto em volta). */
export function parseRowsJson(raw: string): unknown[] {
  const text = raw.trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as { rows?: unknown };
    return Array.isArray(parsed.rows) ? parsed.rows : [];
  } catch {
    return [];
  }
}

/** Números que aparecem num trecho, nos formatos 1.234,50 / 1234,50 / 1,234.50 / 1234.5. */
export function numbersIn(text: string): number[] {
  const found: number[] = [];
  for (const token of text.match(/\d[\d.,]*/g) ?? []) {
    const clean = token.replace(/[.,]+$/, '');
    const lastComma = clean.lastIndexOf(',');
    const lastDot = clean.lastIndexOf('.');
    const decimalAt = Math.max(lastComma, lastDot);
    const digitsAfter = decimalAt >= 0 ? clean.length - decimalAt - 1 : 0;
    // Com 1 ou 2 algarismos depois do último separador, ele é o decimal; com 3, é separador de milhar.
    const value =
      decimalAt >= 0 && digitsAfter <= 2
        ? Number(`${clean.slice(0, decimalAt).replace(/[.,]/g, '')}.${clean.slice(decimalAt + 1)}`)
        : Number(clean.replace(/[.,]/g, ''));
    if (Number.isFinite(value)) found.push(value);
  }
  return found;
}

const squash = (text: string): string =>
  text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

/** A linha só vale se o trecho citado está no documento E o preço está no trecho. */
export function confirmsInSource(row: ExtractedPriceRow, source: string): boolean {
  if (row.excerpt.length < 3) return false;
  if (!squash(source).includes(squash(row.excerpt))) return false;
  return numbersIn(row.excerpt).some((n) => Math.abs(n - row.priceReais) < 0.005);
}

/** `dd/mm/aaaa` ou `aaaa-mm-dd` → `dd/mm/aaaa`; vazio se não for uma data válida. */
export function normalizeDate(raw: string): string {
  const date = parseDate(raw);
  if (!date) return '';
  const d = String(date.getUTCDate()).padStart(2, '0');
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${d}/${m}/${date.getUTCFullYear()}`;
}

export interface ValidatedRows {
  rows: ExtractedPriceRow[];
  discarded: number;
}

/** Valida cada linha do modelo (formato e trecho no documento) e junta o que veio de vários pedaços, sem repetir. */
export function validateRows(raw: readonly unknown[], source: string): ValidatedRows {
  const rows: ExtractedPriceRow[] = [];
  const seen = new Set<string>();
  let discarded = 0;
  for (const item of raw) {
    const parsed = extractedPriceRowSchema.safeParse(item);
    if (!parsed.success || !confirmsInSource(parsed.data, source)) {
      discarded += 1;
      continue;
    }
    const row = {
      ...parsed.data,
      validFrom: normalizeDate(parsed.data.validFrom),
      validTo: normalizeDate(parsed.data.validTo),
    };
    const key = squash(
      `${row.manufacturer}|${row.model}|${row.sku}|${row.description}|${row.priceReais}`,
    );
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(row);
  }
  return { rows, discarded };
}

const cell = (value: string): string => `"${value.replace(/"/g, '""').replace(/[\r\n;]+/g, ' ')}"`;

/** CSV no modelo da importação de preços existente (`PRICE_TEMPLATE`), separado por ponto e vírgula. */
export function toPriceCsv(
  rows: readonly Pick<
    ExtractedPriceRow,
    | 'manufacturer'
    | 'model'
    | 'description'
    | 'supplier'
    | 'sku'
    | 'priceReais'
    | 'validFrom'
    | 'validTo'
  >[],
): string {
  const header =
    'fabricante;modelo;descricao;fornecedor;sku;preco_reais;vigencia_inicio;vigencia_fim';
  const lines = rows.map((r) =>
    [
      cell(r.manufacturer),
      cell(r.model),
      cell(r.description),
      cell(r.supplier),
      cell(r.sku),
      r.priceReais.toFixed(2).replace('.', ','),
      r.validFrom,
      r.validTo,
    ].join(';'),
  );
  return `${header}\n${lines.join('\n')}\n`;
}
