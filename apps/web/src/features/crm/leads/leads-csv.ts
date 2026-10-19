import {
  CustomerSegment,
  LeadSource,
  createLeadSchema,
  type CreateLeadInput,
} from '@voltex/shared';
import { LEAD_SOURCE_LABELS, SEGMENT_LABELS } from '@/i18n/labels';
import { normalizeHeader, readCsv } from '@/lib/csv';

export const MAX_LEAD_ROWS = 500;

export const LEADS_CSV_TEMPLATE = `${['nome', 'telefone', 'email', 'documento', 'segmento', 'cidade', 'uf', 'origem', 'observacoes'].join(';')}\n`;

export interface LeadsCsvResult {
  rows: CreateLeadInput[];
  errors: string[];
}

const SEGMENTS = new Map<string, CustomerSegment>([
  ...Object.values(CustomerSegment).map((v) => [normalizeHeader(v), v] as const),
  ...Object.entries(SEGMENT_LABELS).map(
    ([k, label]) => [normalizeHeader(label), k as CustomerSegment] as const,
  ),
]);
const SOURCES = new Map<string, LeadSource>([
  ...Object.values(LeadSource).map((v) => [normalizeHeader(v), v] as const),
  ...Object.entries(LEAD_SOURCE_LABELS).map(
    ([k, label]) => [normalizeHeader(label), k as LeadSource] as const,
  ),
]);

const FIELD_NAMES: Record<string, string> = {
  name: 'nome',
  email: 'e-mail',
  phone: 'telefone',
  state: 'uf',
  segment: 'segmento',
  source: 'origem',
};

/**
 * Lê o CSV de leads no navegador. Colunas: nome (obrigatória), telefone, email, documento, segmento, cidade, uf, origem,
 * observacoes. Cada linha passa pelo mesmo schema da API; a deduplicação é feita pelo servidor.
 */
export function parseLeadsCsv(text: string): LeadsCsvResult {
  const table = readCsv(text);
  if (table.rows.length === 0)
    return { rows: [], errors: ['O arquivo precisa do cabeçalho e de ao menos uma linha.'] };
  const column = (name: string) => table.header.indexOf(name);
  if (column('nome') === -1) return { rows: [], errors: ['Coluna ausente no cabeçalho: nome.'] };
  if (table.rows.length > MAX_LEAD_ROWS)
    return {
      rows: [],
      errors: [`O arquivo tem mais de ${MAX_LEAD_ROWS} linhas. Divida em partes.`],
    };

  const rows: CreateLeadInput[] = [];
  const errors: string[] = [];
  for (const { line, cells } of table.rows) {
    const cell = (name: string) => {
      const index = column(name);
      return index === -1 ? '' : (cells[index] ?? '');
    };
    const segmentRaw = cell('segmento');
    const sourceRaw = cell('origem');
    const segment = segmentRaw ? SEGMENTS.get(normalizeHeader(segmentRaw)) : undefined;
    const source = sourceRaw ? SOURCES.get(normalizeHeader(sourceRaw)) : undefined;
    if (segmentRaw && !segment) {
      errors.push(
        `Linha ${line} (${cell('nome') || 'sem nome'}): segmento “${segmentRaw}” não existe`,
      );
      continue;
    }
    if (sourceRaw && !source) {
      errors.push(
        `Linha ${line} (${cell('nome') || 'sem nome'}): origem “${sourceRaw}” não existe`,
      );
      continue;
    }
    const candidate = {
      name: cell('nome'),
      phone: cell('telefone') || undefined,
      email: cell('email') || undefined,
      document: cell('documento') || undefined,
      segment,
      city: cell('cidade') || undefined,
      state: cell('uf') || undefined,
      source,
      notes: cell('observacoes') || undefined,
    };
    const parsed = createLeadSchema.safeParse(candidate);
    if (parsed.success) rows.push(candidate as CreateLeadInput);
    else {
      const issue = parsed.error.issues[0]!;
      const field = FIELD_NAMES[String(issue.path[0])] ?? String(issue.path[0] ?? 'linha');
      errors.push(`Linha ${line} (${candidate.name || 'sem nome'}): ${field} — ${issue.message}`);
    }
  }
  return { rows, errors };
}
