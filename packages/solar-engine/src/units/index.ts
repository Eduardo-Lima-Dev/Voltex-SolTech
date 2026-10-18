/**
 * Unidades e conversões. Todas as grandezas do motor carregam a unidade no nome
 * (`powerKwp`, `energyKwh`, `areaM2`...). Dinheiro é sempre inteiro em centavos.
 */

export type Kwh = number;
export type Kwp = number;
export type Wp = number;
export type Cents = number;
/** Fração (0,25 = 25%). */
export type Ratio = number;

/** Dias de cada mês em ano não bissexto (jan → dez). */
export const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;
export const DAYS_IN_YEAR = 365;

export const wpToKwp = (wp: Wp): Kwp => wp / 1000;
export const kwpToWp = (kwp: Kwp): Wp => kwp * 1000;
export const brlToCents = (brl: number): Cents => Math.round(brl * 100);
export const centsToBrl = (cents: Cents): number => cents / 100;

export const roundTo = (value: number, digits: number): number => {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};

export const sum = (values: readonly number[]): number => values.reduce((acc, v) => acc + v, 0);

export const mean = (values: readonly number[]): number => {
  if (values.length === 0) throw new RangeError('mean: lista vazia');
  return sum(values) / values.length;
};
