const LOCALE = 'pt-BR';

const brl = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: 'BRL' });
const decimal = (digits: number) =>
  new Intl.NumberFormat(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits });
const percent = (digits: number) =>
  new Intl.NumberFormat(LOCALE, {
    style: 'percent',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

/** Formata um valor em centavos como moeda BRL. */
export const formatBrlFromCents = (cents: number): string => brl.format(cents / 100);

export const formatKwh = (kwh: number, digits = 0): string => `${decimal(digits).format(kwh)} kWh`;

export const formatKwp = (kwp: number, digits = 2): string => `${decimal(digits).format(kwp)} kWp`;

/** Formata uma fração (0,25) como porcentagem ("25%"). */
export const formatPercent = (fraction: number, digits = 0): string =>
  percent(digits).format(fraction);

export const formatYears = (years: number | null, digits = 1): string =>
  years === null ? '—' : `${decimal(digits).format(years)} anos`;
export * from './normalize.js';
