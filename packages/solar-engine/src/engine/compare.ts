import type { EngineeringResults } from '@voltex/shared';

/** Comparação entre duas versões do projeto (desenho e resultados), para a revisão do responsável técnico. */
export const COMPARE_ALGORITHM_VERSION = 'compare-1.0.0';

export interface DesignChange {
  /** Seção do desenho (primeiro nível: `site`, `surfaces`, `inverters`, `cables`...). */
  section: string;
  /** Caminho legível, com `id` dos itens de lista quando existir (ex.: `surfaces[s1].tiltDegrees`). */
  path: string;
  kind: 'ADDED' | 'REMOVED' | 'CHANGED';
  before: unknown;
  after: unknown;
}

export interface ResultChange {
  metric: string;
  label: string;
  before: number | string | null;
  after: number | string | null;
  /** Diferença absoluta para números; nula para texto ou valores ausentes. */
  delta: number | null;
}

export interface VersionComparison {
  designChanges: DesignChange[];
  resultChanges: ResultChange[];
  /** Verdadeiro se a lista de mudanças do desenho foi cortada em `MAX_DESIGN_CHANGES`. */
  truncated: boolean;
  algorithmVersion: string;
}

export const MAX_DESIGN_CHANGES = 300;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function walk(before: unknown, after: unknown, path: string, section: string, out: DesignChange[]) {
  if (same(before, after)) return;
  if (isObject(before) && isObject(after)) {
    for (const key of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort())
      walk(before[key], after[key], path ? `${path}.${key}` : key, section || key, out);
    return;
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    const keyOf = (item: unknown, index: number): string =>
      isObject(item) && typeof item.id === 'string' ? item.id : String(index);
    const beforeMap = new Map(before.map((item, i) => [keyOf(item, i), item]));
    const afterMap = new Map(after.map((item, i) => [keyOf(item, i), item]));
    for (const key of [...new Set([...beforeMap.keys(), ...afterMap.keys()])])
      walk(beforeMap.get(key), afterMap.get(key), `${path}[${key}]`, section, out);
    return;
  }
  out.push({
    section,
    path,
    kind: before === undefined ? 'ADDED' : after === undefined ? 'REMOVED' : 'CHANGED',
    before,
    after,
  });
}

const METRICS: { metric: string; label: string; read: (r: EngineeringResults) => unknown }[] = [
  { metric: 'modules', label: 'Módulos', read: (r) => r.totals.moduleCount },
  { metric: 'powerKwp', label: 'Potência (kWp)', read: (r) => r.totals.powerKwp },
  { metric: 'compatibility', label: 'Compatibilidade', read: (r) => r.compatibility?.status },
  { metric: 'protection', label: 'Proteções', read: (r) => r.protection?.status },
  { metric: 'cables', label: 'Cabos', read: (r) => r.cables?.status },
  {
    metric: 'bomTotal',
    label: 'Custo da lista de materiais (centavos)',
    read: (r) => r.bom?.totalCents,
  },
  { metric: 'energyKwh', label: 'Geração anual (kWh)', read: (r) => r.simulation?.energyKwh },
  { metric: 'performanceRatio', label: 'PR', read: (r) => r.simulation?.performanceRatio },
  { metric: 'connection', label: 'Conexão', read: (r) => r.connection?.status },
  { metric: 'capex', label: 'CAPEX (centavos)', read: (r) => r.economics?.capexCents },
  { metric: 'npv', label: 'VPL (centavos)', read: (r) => r.economics?.npvCents },
  { metric: 'payback', label: 'Payback (anos)', read: (r) => r.economics?.simplePaybackYears },
  { metric: 'irr', label: 'TIR (%)', read: (r) => r.economics?.irrPct },
];

const scalar = (value: unknown): number | string | null =>
  typeof value === 'number' || typeof value === 'string' ? value : null;

export function compareVersions(
  before: { design: unknown; results: EngineeringResults | null },
  after: { design: unknown; results: EngineeringResults | null },
): VersionComparison {
  const changes: DesignChange[] = [];
  walk(before.design, after.design, '', '', changes);
  const resultChanges: ResultChange[] = [];
  for (const { metric, label, read } of METRICS) {
    const a = before.results ? scalar(read(before.results)) : null;
    const b = after.results ? scalar(read(after.results)) : null;
    if (a === b) continue;
    resultChanges.push({
      metric,
      label,
      before: a,
      after: b,
      delta:
        typeof a === 'number' && typeof b === 'number' ? Math.round((b - a) * 1e6) / 1e6 : null,
    });
  }
  return {
    designChanges: changes.slice(0, MAX_DESIGN_CHANGES),
    resultChanges,
    truncated: changes.length > MAX_DESIGN_CHANGES,
    algorithmVersion: COMPARE_ALGORITHM_VERSION,
  };
}
