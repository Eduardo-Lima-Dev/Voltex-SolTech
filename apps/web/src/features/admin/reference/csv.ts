import { createSolarResourceSchema, type CreateSolarResourceInput } from '@voltex/shared';
import { parseDecimal } from '@/features/calculator/form';
import { readCsv } from '@/lib/csv';

export const MAX_IMPORT_ROWS = 500;
const MONTH_KEYS = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
];

/** Modelo para download: só o cabeçalho. Nenhum valor de exemplo, para não circular dado sem fonte. */
export const SOLAR_RESOURCES_CSV_TEMPLATE = `${['nome', 'uf', 'latitude', 'longitude', 'fonte', 'plano', ...MONTH_KEYS].join(';')}\n`;

/** Nome da coluna do CSV (em português) para cada campo do schema, nas mensagens de erro. */
const COLUMN_NAMES: Record<string, string> = {
  name: 'nome',
  state: 'uf',
  latitude: 'latitude',
  longitude: 'longitude',
  source: 'fonte',
  plane: 'plano',
};

export interface CsvParseResult {
  rows: CreateSolarResourceInput[];
  errors: string[];
}

/**
 * Lê o CSV de irradiação no navegador. Colunas: nome, uf, latitude, longitude, fonte, plano (opcional) e jan..dez.
 * Aceita `;` (decimais com vírgula) ou `,` (decimais com ponto). Cada linha passa pelo mesmo schema da API.
 */
export function parseSolarResourcesCsv(text: string): CsvParseResult {
  const table = readCsv(text);
  if (table.rows.length === 0)
    return { rows: [], errors: ['O arquivo precisa do cabeçalho e de ao menos uma linha.'] };

  const column = (name: string) => table.header.indexOf(name);
  const missing = ['nome', 'fonte', ...MONTH_KEYS].filter((name) => column(name) === -1);
  if (missing.length > 0)
    return { rows: [], errors: [`Colunas ausentes no cabeçalho: ${missing.join(', ')}.`] };
  if (table.rows.length > MAX_IMPORT_ROWS)
    return {
      rows: [],
      errors: [`O arquivo tem mais de ${MAX_IMPORT_ROWS} linhas. Divida em partes.`],
    };

  const rows: CreateSolarResourceInput[] = [];
  const errors: string[] = [];

  for (const { line, cells } of table.rows) {
    const cell = (name: string) => cells[column(name)] ?? '';
    const optional = (name: string) => {
      const raw = cell(name);
      return raw === '' ? undefined : parseDecimal(raw);
    };

    const candidate = {
      name: cell('nome'),
      state: cell('uf') || undefined,
      latitude: optional('latitude'),
      longitude: optional('longitude'),
      source: cell('fonte'),
      plane: cell('plano') || undefined,
      hspMonthly: MONTH_KEYS.map((month) => parseDecimal(cell(month)) ?? Number.NaN),
    };
    const parsed = createSolarResourceSchema.safeParse(candidate);
    if (parsed.success) rows.push(candidate as CreateSolarResourceInput);
    else {
      const issue = parsed.error.issues[0]!;
      const field =
        issue.path[0] === 'hspMonthly' && typeof issue.path[1] === 'number'
          ? `mês ${MONTH_KEYS[issue.path[1]]}`
          : (COLUMN_NAMES[String(issue.path[0])] ?? 'linha');
      errors.push(`Linha ${line} (${candidate.name || 'sem nome'}): ${field} — ${issue.message}`);
    }
  }

  return { rows, errors };
}
