import { describe, expect, it } from 'vitest';
import {
  daysInMonth,
  evaluateDeviation,
  expectedDailyKwh,
  monthPerformance,
} from './performance.js';

const june = (day: number, kwh: number) => ({
  date: `2026-06-${String(day).padStart(2, '0')}`,
  kwh,
});
const EXPECTED = Array.from({ length: 12 }, (_, i) => (i === 5 ? 600 : 900)); // junho: 600 kWh → 20 kWh/dia

describe('desempenho da planta', () => {
  it('dias do mês, inclusive fevereiro de ano bissexto', () => {
    expect(daysInMonth('2026-06')).toBe(30);
    expect(daysInMonth('2024-02')).toBe(29);
    expect(daysInMonth('2026-02')).toBe(28);
    expect(() => daysInMonth('2026-13')).toThrow();
  });

  it('esperada diária = mês ÷ dias do mês', () => {
    expect(expectedDailyKwh(600, '2026-06')).toBe(20);
  });

  it('compara o real com a esperada proporcional ao período coberto', () => {
    // 10 dias de leitura (até 10/06): esperada até a data = 600 × 10/30 = 200; real = 180 → índice 0,9.
    const daily = Array.from({ length: 10 }, (_, i) => june(i + 1, 18));
    const m = monthPerformance('2026-06', 600, daily);
    expect(m.actualKwh).toBe(180);
    expect(m.expectedToDateKwh).toBeCloseTo(200, 10);
    expect(m.performanceIndex).toBeCloseTo(0.9, 10);
    expect(m.deviationPct).toBeCloseTo(-10, 10);
    expect(m.daysWithData).toBe(10);
    expect(m.lastDataDay).toBe('2026-06-10');
  });

  it('sem esperada ou sem leitura, não há comparação', () => {
    expect(monthPerformance('2026-06', null, [june(1, 10)]).performanceIndex).toBeNull();
    expect(monthPerformance('2026-06', 600, []).performanceIndex).toBeNull();
    expect(monthPerformance('2026-06', 0, [june(1, 10)]).performanceIndex).toBeNull();
  });

  it('só considera leituras do mês pedido', () => {
    const m = monthPerformance('2026-06', 600, [june(1, 20), { date: '2026-07-01', kwh: 99 }]);
    expect(m.actualKwh).toBe(20);
  });

  describe('desvio em dias seguidos', () => {
    const rule = { thresholdPct: 20, consecutiveDays: 3 };

    it('dispara quando os últimos N dias estão abaixo do limiar', () => {
      // esperada 20/dia; limiar 20% → abaixo de 16 conta.
      const r = evaluateDeviation(
        [june(10, 20), june(11, 15), june(12, 10), june(13, 5)],
        EXPECTED,
        rule,
      );
      expect(r.streak).toBe(3);
      expect(r.alert).toBe(true);
      expect(r.days[0]).toMatchObject({ date: '2026-06-13', expectedKwh: 20, deviationPct: -75 });
    });

    it('não dispara com N-1 dias ou quando um dia está dentro do limiar', () => {
      expect(evaluateDeviation([june(12, 10), june(13, 5)], EXPECTED, rule).alert).toBe(false);
      const mid = evaluateDeviation([june(11, 15), june(12, 18), june(13, 5)], EXPECTED, rule);
      expect(mid.streak).toBe(1);
      expect(mid.alert).toBe(false);
    });

    it('dia sem leitura quebra a sequência: não se presume zero', () => {
      const r = evaluateDeviation([june(10, 1), june(12, 1), june(13, 1)], EXPECTED, rule);
      expect(r.streak).toBe(2);
      expect(r.alert).toBe(false);
    });

    it('exatamente no limiar não conta como abaixo', () => {
      expect(
        evaluateDeviation([june(13, 16)], EXPECTED, { thresholdPct: 20, consecutiveDays: 1 }).alert,
      ).toBe(false);
      expect(
        evaluateDeviation([june(13, 15.99)], EXPECTED, { thresholdPct: 20, consecutiveDays: 1 })
          .alert,
      ).toBe(true);
    });

    it('mês sem esperada interrompe a avaliação', () => {
      const none = Array<number | null>(12).fill(null);
      expect(
        evaluateDeviation([june(13, 0)], none, { thresholdPct: 20, consecutiveDays: 1 }).alert,
      ).toBe(false);
    });

    it('a sequência atravessa a virada do mês', () => {
      const daily = [
        { date: '2026-05-30', kwh: 1 },
        { date: '2026-05-31', kwh: 1 },
        { date: '2026-06-01', kwh: 1 },
      ];
      const r = evaluateDeviation(daily, EXPECTED, rule);
      expect(r.streak).toBe(3);
      expect(r.alert).toBe(true);
    });
  });
});
