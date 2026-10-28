import { describe, expect, it } from 'vitest';
import { median, quantile, wilson } from './common.js';
import { forecastFunnel } from './funnel.js';
import { forecastGeneration } from './generation.js';
import { forecastInstallations } from './installation.js';
import { forecastReceivables } from './receivables.js';

describe('estatística básica', () => {
  it('quantil por posto mais próximo e mediana', () => {
    expect(quantile([1, 2, 3, 4], 0.25)).toBe(1);
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2);
    expect(quantile([1, 2, 3, 4], 0.9)).toBe(4);
    expect(median([5, 1, 3])).toBe(3);
    expect(() => quantile([], 0.5)).toThrow();
  });

  it('intervalo de Wilson (95%)', () => {
    const { low, high } = wilson(8, 10);
    expect(low).toBeCloseTo(0.4902, 3);
    expect(high).toBeCloseTo(0.9433, 3);
    expect(wilson(0, 0)).toEqual({ low: 0, high: 1 });
    expect(wilson(10, 10).high).toBe(1);
  });
});

describe('recebimentos', () => {
  // 20 parcelas pagas: 10 em dia, 6 com 5 dias, 3 com 15 dias, 1 com 40 dias.
  const delays = [...Array(10).fill(0), ...Array(6).fill(5), ...Array(3).fill(15), 40] as number[];
  const paid = delays.map((d) => {
    const due = new Date(Date.UTC(2026, 0, 10));
    const paidOn = new Date(due.getTime() + d * 86_400_000);
    return { dueOn: '2026-01-10', paidOn: paidOn.toISOString().slice(0, 10) };
  });

  it('abaixo do mínimo de parcelas pagas: dados insuficientes', () => {
    expect(
      forecastReceivables({ open: [], paid: paid.slice(0, 19), today: '2026-10-01', minPaid: 20 }),
    ).toEqual({
      status: 'INSUFFICIENT_SAMPLE',
      sample: 19,
      required: 20,
    });
  });

  it('data cada parcela pelos atrasos históricos, em três cenários, por semana', () => {
    const out = forecastReceivables({
      open: [
        { amountCents: 100_000, dueOn: '2026-10-10' }, // vence em 9 dias
        { amountCents: 50_000, dueOn: '2026-09-28' }, // 3 dias de atraso
      ],
      paid,
      today: '2026-10-01',
      minPaid: 20,
    });
    if (out.status !== 'OK') throw new Error('esperava OK');
    expect(out.sample).toBe(20);
    expect(out.openCents).toBe(150_000);
    // Parcela 1 (sem atraso hoje): P25=0, P50=2º→0 (10 de 20 em dia), P90=15 dias.
    // best/expected: 10/10 (offset 9 → semana 1); worst: 25/10 (offset 24 → semana 3).
    expect(out.weeks[1]!.bestCents).toBeGreaterThanOrEqual(100_000);
    expect(out.weeks[3]!.worstCents).toBeGreaterThanOrEqual(100_000);
    // Parcela 2 (3 dias de atraso): só vale quem atrasou ≥ 3 (10 pagamentos: 6×5, 3×15, 1×40).
    // P25 → 5 dias (28/9 + 5 = 3/10, offset 2, semana 0); P50 → 5; P90 → 15 (13/10, offset 12, semana 1).
    expect(out.weeks[0]!.bestCents).toBe(50_000);
    expect(out.weeks[0]!.expectedCents).toBe(50_000);
    expect(out.weeks[1]!.worstCents).toBe(50_000);
    expect(out.withinHorizon.best).toBe(150_000);
    expect(out.unplacedCents).toBe(0);
  });

  it('parcela mais atrasada que qualquer pagamento visto fica sem data; o que passa do horizonte é separado', () => {
    const out = forecastReceivables({
      open: [
        { amountCents: 70_000, dueOn: '2026-05-01' }, // 153 dias de atraso: > 40
        { amountCents: 30_000, dueOn: '2027-03-01' }, // vence depois do horizonte
      ],
      paid,
      today: '2026-10-01',
      minPaid: 20,
    });
    if (out.status !== 'OK') throw new Error('esperava OK');
    expect(out.unplacedCents).toBe(70_000);
    expect(out.beyondHorizon.best).toBe(30_000);
    expect(out.withinHorizon.best).toBe(0);
    expect(out.weeks).toHaveLength(13);
  });
});

describe('fechamento do funil', () => {
  const closed = (won: boolean, reached: string[], cycleDays: number | null = null) => ({
    won,
    reached,
    cycleDays: won ? cycleDays : null,
  });
  // 30 encerradas: 12 ganhas (todas passaram por PROPOSAL e NEGOTIATION), 18 perdidas (10 só até QUALIFIED).
  const history = [
    ...Array.from({ length: 12 }, () => closed(true, ['QUALIFIED', 'PROPOSAL', 'NEGOTIATION'], 40)),
    ...Array.from({ length: 8 }, () => closed(false, ['QUALIFIED', 'PROPOSAL'])),
    ...Array.from({ length: 10 }, () => closed(false, ['QUALIFIED'])),
  ];

  it('abaixo do mínimo de encerradas: dados insuficientes', () => {
    expect(
      forecastFunnel({
        open: [],
        closed: history.slice(0, 29),
        today: '2026-10-01',
        minClosed: 30,
        minStageClosed: 5,
      }),
    ).toMatchObject({ status: 'INSUFFICIENT_SAMPLE', sample: 29, required: 30 });
  });

  it('pondera cada oportunidade pela taxa da etapa dela, com faixa e mês esperado', () => {
    const out = forecastFunnel({
      open: [
        {
          stage: 'PROPOSAL',
          valueCents: 1_000_000,
          expectedCloseDate: '2026-11-15',
          createdAt: '2026-09-01',
        },
        {
          stage: 'NEGOTIATION',
          valueCents: 2_000_000,
          expectedCloseDate: null,
          createdAt: '2026-09-20',
        },
        {
          stage: 'OUTRA',
          valueCents: null,
          expectedCloseDate: '2026-08-01',
          createdAt: '2026-05-01',
        },
      ],
      closed: history,
      today: '2026-10-01',
      minClosed: 30,
      minStageClosed: 5,
    });
    if (out.status !== 'OK') throw new Error('esperava OK');
    // PROPOSAL: 12 de 20 = 60%. NEGOTIATION: 12 de 12 = 100%. OUTRA: taxa geral 12/30 = 40%.
    expect(out.overallWinRate).toBeCloseTo(0.4, 5);
    expect(out.stagesUsingOverallRate).toEqual(['OUTRA']);
    expect(out.withoutValueCount).toBe(1);
    const nov = out.months.find((m) => m.month === '2026-11')!;
    expect(nov).toMatchObject({ expectedCents: 600_000, expectedCount: 0.6 });
    expect(nov.worstCents).toBeLessThan(nov.expectedCents);
    expect(nov.bestCents).toBeGreaterThan(nov.expectedCents);
    // Sem data esperada: criação + mediana do ciclo (40 dias) → 2026-10-30 → outubro.
    const oct = out.months.find((m) => m.month === '2026-10')!;
    expect(oct.expectedCents).toBe(2_000_000);
    // Data passada vai para o mês atual; sem valor não soma dinheiro, mas conta na quantidade.
    expect(oct.expectedCount).toBeCloseTo(1.4, 5);
    expect(out.undatedCount).toBe(0);
  });

  it('sem ciclo histórico e sem data esperada, a oportunidade fica "sem data"', () => {
    const noCycle = history.map((h) => ({ ...h, cycleDays: null }));
    const out = forecastFunnel({
      open: [
        {
          stage: 'PROPOSAL',
          valueCents: 100_000,
          expectedCloseDate: null,
          createdAt: '2026-09-01',
        },
      ],
      closed: noCycle,
      today: '2026-10-01',
      minClosed: 30,
      minStageClosed: 5,
    });
    if (out.status !== 'OK') throw new Error('esperava OK');
    expect(out.undatedCount).toBe(1);
    expect(out.undatedExpectedCents).toBe(60_000);
    expect(out.months).toEqual([]);
  });
});

describe('instalações', () => {
  const done = Array.from({ length: 10 }, () => ({
    AWAITING_MATERIAL: 10,
    MATERIAL_READY: 2,
    SCHEDULING: 4,
    CREW_ASSIGNED: 3,
    IN_PROGRESS: 2,
    INSTALLED: 1,
    COMMISSIONING: 5,
    CUSTOMER_ACCEPTANCE: 6,
  }));

  it('abaixo do mínimo de concluídas: dados insuficientes', () => {
    expect(
      forecastInstallations({
        done: done.slice(0, 9),
        current: [],
        today: '2026-10-01',
        minDone: 10,
      }),
    ).toMatchObject({
      status: 'INSUFFICIENT_SAMPLE',
    });
  });

  it('soma o que falta na situação atual e as médias seguintes; avisa o que passou do normal', () => {
    const out = forecastInstallations({
      done,
      current: [
        { id: 'a', status: 'SCHEDULING', enteredAt: '2026-09-29' }, // 2 dias de 4
        { id: 'b', status: 'CREW_ASSIGNED', enteredAt: '2026-09-20' }, // 11 dias de 3: passou
        { id: 'c', status: 'AWAITING_ENGINEERING', enteredAt: '2026-10-01' },
        { id: 'd', status: 'FIELD_ISSUE', enteredAt: '2026-09-30' },
        { id: 'e', status: 'CANCELLED', enteredAt: '2026-09-30' },
      ],
      today: '2026-10-01',
      minDone: 10,
    });
    if (out.status !== 'OK') throw new Error('esperava OK');
    expect(out.averageDaysByStatus.AWAITING_MATERIAL).toBe(10);
    const by = Object.fromEntries(out.installations.map((i) => [i.id, i]));
    // a: (4−2) + 3 + 2 + 1 + 5 + 6 = 19 dias
    expect(by.a).toMatchObject({ daysInStatus: 2, atRisk: false, estimatedDoneOn: '2026-10-20' });
    // b: 0 + 2 + 1 + 5 + 6 = 14 dias
    expect(by.b).toMatchObject({ atRisk: true, estimatedDoneOn: '2026-10-15' });
    // c: sem histórico em AWAITING_ENGINEERING (conta zero e é listado) + 10+2+4+3+2+1+5+6 = 33
    expect(by.c).toMatchObject({
      estimatedDoneOn: '2026-11-03',
      missingStatuses: ['AWAITING_ENGINEERING'],
    });
    // d: desvio de campo usa a posição de IN_PROGRESS e não tem média própria.
    expect(by.d!.missingStatuses).toEqual(['FIELD_ISSUE']);
    expect(by.d!.estimatedDoneOn).toBe('2026-10-13');
    expect(by.e).toBeUndefined();
  });
});

describe('geração', () => {
  const expected = [900, 900, 900, 900, 900, 900, 900, 900, 900, 3100, 900, 900]; // outubro: 3.100 kWh = 100/dia
  const readings = (kwhPerDay: number, days: number) =>
    Array.from({ length: days }, (_, i) => ({
      date: `2026-10-${String(i + 1).padStart(2, '0')}`,
      kwh: kwhPerDay,
    }));

  it('sem leituras suficientes (ou sem esperado), dados insuficientes', () => {
    expect(
      forecastGeneration({
        expectedMonthlyKwh: expected,
        readings: readings(100, 13),
        today: '2026-10-13',
        minDays: 14,
      }),
    ).toMatchObject({ status: 'INSUFFICIENT_SAMPLE', sample: 13, required: 14 });
    expect(
      forecastGeneration({
        expectedMonthlyKwh: [],
        readings: readings(100, 20),
        today: '2026-10-20',
        minDays: 14,
      }),
    ).toMatchObject({ status: 'INSUFFICIENT_SAMPLE' });
  });

  it('índice de desempenho e projeção do mês', () => {
    const out = forecastGeneration({
      expectedMonthlyKwh: expected,
      readings: readings(80, 20), // 80% do esperado (100/dia)
      today: '2026-10-20',
      minDays: 14,
    });
    if (out.status !== 'OK') throw new Error('esperava OK');
    expect(out.performanceRatio).toBeCloseTo(0.8, 5);
    expect(out.monthToDateKwh).toBe(1600);
    // 11 dias restantes × 100 × 0,8 = 880 → 2.480
    expect(out.monthProjectedKwh).toBeCloseTo(2480, 5);
    expect(out.lastReadingOn).toBe('2026-10-20');
    expect(out.monthExpectedKwh).toBe(3100);
  });
});
