const DAY = 86_400_000;

/** Data de calendário (sem hora) em UTC a partir de uma data/hora ou texto `AAAA-MM-DD`. */
export function dateOnly(input: Date | string): Date {
  const d = typeof input === 'string' ? new Date(`${input.slice(0, 10)}T00:00:00.000Z`) : input;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Soma meses preservando o dia; se o mês de destino é mais curto, vai para o último dia dele (31/01 + 1 mês = 28/02). */
export function addMonths(date: Date, months: number): Date {
  const base = dateOnly(date);
  const target = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(base.getUTCDate(), lastDay));
  return target;
}

/** Prazo em anos (pode ser fracionário) somado a uma data, em meses inteiros. */
export const addYears = (date: Date, years: number): Date =>
  addMonths(date, Math.round(years * 12));

/** Dias entre hoje e uma data de calendário (negativo = já passou). */
export function daysLeft(until: Date, now: Date = new Date()): number {
  return Math.round((dateOnly(until).getTime() - dateOnly(now).getTime()) / DAY);
}

export const isoDay = (d: Date): string => d.toISOString().slice(0, 10);
