import { createSolarResourceSchema, type CreateSolarResourceInput } from '@voltex/shared';
import { parseDecimal } from '@/features/calculator/form';

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

const normalizeHeader = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase();

/** Divide uma linha respeitando aspas ("Foz do Iguaçu, PR"). */
function splitLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]!;
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      cells.push(current);
      current = '';
    } else current += char;
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

/**
 * Lê o CSV de irradiação no navegador. Colunas: nome, uf, latitude, longitude, fonte, plano (opcional) e jan..dez.
 * Aceita `;` (decimais com vírgula) ou `,` (decimais com ponto). Cada linha passa pelo mesmo schema da API.
 */
export function parseSolarResourcesCsv(text: string): CsvParseResult {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '');
  if (lines.length < 2)
    return { rows: [], errors: ['O arquivo precisa do cabeçalho e de ao menos uma linha.'] };

  const delimiter = lines[0]!.includes(';') ? ';' : ',';
  const header = splitLine(lines[0]!, delimiter).map(normalizeHeader);
  const column = (name: string) => header.indexOf(name);

  const missing = ['nome', 'fonte', ...MONTH_KEYS].filter((name) => column(name) === -1);
  if (missing.length > 0)
    return { rows: [], errors: [`Colunas ausentes no cabeçalho: ${missing.join(', ')}.`] };
  if (lines.length - 1 > MAX_IMPORT_ROWS)
    return {
      rows: [],
      errors: [`O arquivo tem mais de ${MAX_IMPORT_ROWS} linhas. Divida em partes.`],
    };

  const rows: CreateSolarResourceInput[] = [];
  const errors: string[] = [];

  lines.slice(1).forEach((line, index) => {
    const lineNumber = index + 2;
    const cells = splitLine(line, delimiter);
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
      errors.push(
        `Linha ${lineNumber} (${candidate.name || 'sem nome'}): ${field} — ${issue.message}`,
      );
    }
  });

  return { rows, errors };
}
