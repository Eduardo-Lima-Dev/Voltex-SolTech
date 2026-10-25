/**
 * Previsões determinísticas (Fase 12I, memorial `docs/06-calculos/previsoes.md`). Funções puras: o que entra é
 * histórico da própria empresa; o que sai é um número com faixa, ou `INSUFFICIENT_SAMPLE` quando a amostra é menor
 * que o mínimo (parâmetro da empresa). A IA só explica o resultado; ela nunca calcula.
 */

export interface InsufficientSample {
  status: 'INSUFFICIENT_SAMPLE';
  sample: number;
  required: number;
}

export type Forecast<T extends object> =
  ({ status: 'OK'; sample: number; required: number } & T) | InsufficientSample;

export const insufficient = (sample: number, required: number): InsufficientSample => ({
  status: 'INSUFFICIENT_SAMPLE',
  sample,
  required,
});

const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` (ou ISO completo) → dia em UTC, em ms. */
export const dayMs = (iso: string): number => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Date.UTC(y as number, (m as number) - 1, d as number);
};

export const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
export const addDays = (ms: number, days: number): number => ms + days * DAY_MS;
export const daysBetween = (fromMs: number, toMs: number): number =>
  Math.round((toMs - fromMs) / DAY_MS);

/** Quantil por posto mais próximo (nearest-rank) de uma lista já ordenada. */
export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) throw new Error('quantil de lista vazia');
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil(q * sorted.length)));
  return sorted[rank - 1] as number;
}

export const median = (values: readonly number[]): number =>
  quantile(
    [...values].sort((a, b) => a - b),
    0.5,
  );

/** Intervalo de Wilson para uma proporção (z = 1,96 → 95%). */
export function wilson(wins: number, n: number, z = 1.96): { low: number; high: number } {
  if (n === 0) return { low: 0, high: 1 };
  const p = wins / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { low: Math.max(0, center - half), high: Math.min(1, center + half) };
}
