import { describe, expect, it } from 'vitest';
import { addMonths, addYears, dateOnly, daysLeft, isoDay } from './dates';

describe('datas de calendário do pós-venda', () => {
  it('soma meses preservando o dia e ajustando ao fim de mês mais curto', () => {
    expect(isoDay(addMonths(new Date('2026-01-15T10:00:00Z'), 3))).toBe('2026-04-15');
    expect(isoDay(addMonths(new Date('2026-01-31T00:00:00Z'), 1))).toBe('2026-02-28');
    expect(isoDay(addMonths(new Date('2024-01-31T00:00:00Z'), 1))).toBe('2024-02-29'); // bissexto
    expect(isoDay(addMonths(new Date('2026-11-30T00:00:00Z'), 3))).toBe('2027-02-28');
    expect(isoDay(addMonths(new Date('2026-03-10T00:00:00Z'), 12))).toBe('2027-03-10');
  });

  it('prazo em anos (inclusive fracionário) vira meses inteiros', () => {
    expect(isoDay(addYears(new Date('2026-06-01T00:00:00Z'), 12))).toBe('2038-06-01');
    expect(isoDay(addYears(new Date('2026-06-01T00:00:00Z'), 2.5))).toBe('2028-12-01');
    expect(isoDay(addYears(new Date('2026-06-01T00:00:00Z'), 0.5))).toBe('2026-12-01');
  });

  it('dia de calendário ignora a hora', () => {
    expect(isoDay(dateOnly(new Date('2026-10-22T23:59:59Z')))).toBe('2026-10-22');
    expect(isoDay(dateOnly('2026-10-22'))).toBe('2026-10-22');
  });

  it('dias que faltam: hoje é 0, amanhã 1, ontem −1', () => {
    const now = new Date('2026-10-22T15:00:00Z');
    expect(daysLeft(new Date('2026-10-22T00:00:00Z'), now)).toBe(0);
    expect(daysLeft(new Date('2026-10-23T00:00:00Z'), now)).toBe(1);
    expect(daysLeft(new Date('2026-10-21T00:00:00Z'), now)).toBe(-1);
    expect(daysLeft(new Date('2027-10-22T00:00:00Z'), now)).toBe(365);
  });
});
