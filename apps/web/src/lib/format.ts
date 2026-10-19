const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const date = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });
const relative = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });

export const formatDateTime = (iso: string | Date): string => dateTime.format(new Date(iso));
export const formatDate = (iso: string | Date): string => date.format(new Date(iso));

/** "há 5 minutos", "ontem". Acima de ~30 dias mostra a data. */
export function formatRelativeTime(iso: string | Date, now: Date = new Date()): string {
  const target = new Date(iso);
  const seconds = Math.round((target.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return 'agora há pouco';
  if (abs < 3600) return relative.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return relative.format(Math.round(seconds / 3600), 'hour');
  if (abs < 30 * 86_400) return relative.format(Math.round(seconds / 86_400), 'day');
  return formatDate(target);
}

export const shortId = (id: string): string => id.slice(0, 8);

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const brlCompact = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  notation: 'compact',
  maximumFractionDigits: 1,
});

/** Valores monetários trafegam em centavos; aqui viram "R$ 1.234,56". */
export const formatCents = (cents: number): string => brl.format(cents / 100);
export const formatCentsCompact = (cents: number): string => brlCompact.format(cents / 100);

export const formatNumber = (value: number, digits = 1): string =>
  value.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: digits });
export const formatKwh = (value: number, digits = 0): string =>
  `${formatNumber(value, digits)} kWh`;
export const formatKwp = (value: number): string => `${formatNumber(value, 2)} kWp`;
export const formatPercent = (ratio: number, digits = 0): string =>
  `${formatNumber(ratio * 100, digits)}%`;
export const formatYears = (years: number | null): string =>
  years === null ? 'Sem retorno no horizonte' : `${formatNumber(years, 1)} anos`;
