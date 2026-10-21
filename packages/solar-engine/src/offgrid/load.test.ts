import { describe, expect, it } from 'vitest';
import { offgridLoadSchema } from '@voltex/shared';
import { inWindow, loadWhAt, loadsAt, profileLoads, windowLength } from './load.js';

const load = (patch: Record<string, unknown>) =>
  offgridLoadSchema.parse({ id: 'x', name: 'Carga', powerW: 100, hoursPerDay: 4, ...patch });

describe('janela de uso', () => {
  it('mede a janela simples, a que atravessa a meia-noite e o dia todo', () => {
    expect(windowLength(load({ windowStartHour: 8, windowEndHour: 12 }))).toBe(4);
    expect(windowLength(load({ windowStartHour: 22, windowEndHour: 6 }))).toBe(8);
    expect(windowLength(load({}))).toBe(24);
    expect(windowLength(load({ windowStartHour: 5, windowEndHour: 5 }))).toBe(24);
  });

  it('diz se a hora está dentro da janela', () => {
    const day = load({ windowStartHour: 8, windowEndHour: 12 });
    expect(inWindow(day, 8)).toBe(true);
    expect(inWindow(day, 12)).toBe(false);
    const night = load({ windowStartHour: 22, windowEndHour: 6 });
    expect(inWindow(night, 23)).toBe(true);
    expect(inWindow(night, 3)).toBe(true);
    expect(inWindow(night, 12)).toBe(false);
    expect(inWindow(load({ windowStartHour: 5, windowEndHour: 5 }), 9)).toBe(true);
  });
});

describe('energia da carga', () => {
  it('espalha as horas por dia na janela (duty) e respeita dia da semana e sazonalidade', () => {
    const l = load({
      powerW: 200,
      quantity: 2,
      hoursPerDay: 2,
      windowStartHour: 18,
      windowEndHour: 22,
      daysOfWeek: [6],
      seasonality: [1, 0.5, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    });
    expect(loadWhAt(l, 0, 6, 19)).toBeCloseTo(200);
    expect(loadWhAt(l, 1, 6, 19)).toBeCloseTo(100);
    expect(loadWhAt(l, 0, 1, 19)).toBe(0);
    expect(loadWhAt(l, 0, 6, 10)).toBe(0);
  });

  it('limita o duty a 1 quando as horas excedem a janela', () => {
    const l = load({ powerW: 100, hoursPerDay: 10, windowStartHour: 8, windowEndHour: 10 });
    expect(loadWhAt(l, 0, 0, 8)).toBe(100);
  });

  it('separa CA, CC e críticas', () => {
    const sum = loadsAt(
      [
        load({ powerW: 100, hoursPerDay: 24 }),
        load({ id: 'y', kind: 'DC', powerW: 30, hoursPerDay: 24, critical: true }),
      ],
      0,
      0,
      0,
      2,
    );
    expect(sum).toEqual({ acWh: 200, dcWh: 60, criticalWh: 60 });
  });
});

describe('perfil de carga', () => {
  const loads = [
    load({ id: 'a', powerW: 100, hoursPerDay: 24, critical: true }),
    load({
      id: 'b',
      powerW: 500,
      hoursPerDay: 2,
      windowStartHour: 18,
      windowEndHour: 22,
      surgeFactor: 4,
    }),
    load({
      id: 'c',
      kind: 'DC',
      powerW: 50,
      hoursPerDay: 24,
      seasonality: [2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    }),
  ];

  it('calcula energia diária, pico, surto e mês crítico', () => {
    const p = profileLoads(loads);
    expect(p.criticalMonthIndex).toBe(0);
    expect(p.dailyAcWh).toBeCloseTo(100 * 24 + 500 * 2, 0);
    expect(p.dailyDcWh).toBeCloseTo(50 * 24 * 2, 0);
    expect(p.dailyWh).toBeCloseTo(p.dailyAcWh + p.dailyDcWh, 0);
    expect(p.criticalDailyWh).toBeCloseTo(2400, 0);
    expect(p.peakW).toBe(650);
    expect(p.surgeW).toBe(650 + 500 * 3);
    expect(p.installedW).toBe(650);
    expect(p.hourlyWh).toHaveLength(24);
    expect(p.nightFraction).toBeGreaterThan(0.4);
    expect(p.monthlyDailyWh).toHaveLength(12);
  });

  it('devolve zeros sem cargas', () => {
    const p = profileLoads([]);
    expect(p.dailyWh).toBe(0);
    expect(p.peakW).toBe(0);
    expect(p.nightFraction).toBe(0);
  });

  it('ignora no pico a carga fora de uso no mês (sazonalidade zero)', () => {
    const p = profileLoads([
      load({ powerW: 1000, hoursPerDay: 24, seasonality: Array(12).fill(0) }),
      load({ id: 'o', powerW: 100, hoursPerDay: 24 }),
    ]);
    expect(p.peakW).toBe(100);
  });
});
