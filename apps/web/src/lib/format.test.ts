import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatRelativeTime, shortId } from './format';

const now = new Date('2026-10-18T12:00:00Z');
const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000).toISOString();

describe('formatRelativeTime', () => {
  it('descreve tempo recente em português', () => {
    expect(formatRelativeTime(ago(10), now)).toBe('agora há pouco');
    expect(formatRelativeTime(ago(5 * 60), now)).toBe('há 5 minutos');
    expect(formatRelativeTime(ago(3 * 3600), now)).toBe('há 3 horas');
    expect(formatRelativeTime(ago(86_400), now)).toBe('ontem');
    expect(formatRelativeTime(ago(5 * 86_400), now)).toBe('há 5 dias');
  });

  it('acima de 30 dias mostra a data', () => {
    expect(formatRelativeTime(ago(60 * 86_400), now)).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
  });
});

describe('datas e ids', () => {
  it('formata no padrão brasileiro', () => {
    expect(formatDate('2026-10-18T15:00:00Z')).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    expect(formatDateTime('2026-10-18T15:30:00Z')).toMatch(/^\d{2}\/\d{2}\/\d{4},? \d{2}:\d{2}$/);
  });

  it('encurta ids', () => {
    expect(shortId('0192b0c0-0000-7000-8000-000000000001')).toBe('0192b0c0');
  });
});
