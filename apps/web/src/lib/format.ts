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
