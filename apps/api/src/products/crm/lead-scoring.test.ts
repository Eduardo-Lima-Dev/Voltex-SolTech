import { describe, expect, it } from 'vitest';
import type { LeadScoringConfig } from '@voltex/shared';
import { nextInRotation, scoreLead } from './lead-scoring';

const config = (criteria: LeadScoringConfig['criteria']): LeadScoringConfig => ({
  criteria,
  routing: { method: 'NONE', userIds: [], regions: [] },
});
const lead = (o: Partial<Parameters<typeof scoreLead>[1]> = {}) => ({
  source: 'REFERRAL',
  segment: 'RESIDENTIAL',
  state: 'SP',
  monthlyBillCents: 50_000,
  ...o,
});

describe('pontuação de leads', () => {
  it('sem critérios cadastrados, ninguém é pontuado', () => {
    expect(scoreLead(config([]), lead())).toEqual({ score: null, breakdown: [] });
  });

  it('média ponderada dos critérios aplicáveis', () => {
    const c = config([
      { key: 'SOURCE', weight: 20, points: { REFERRAL: 100, CAMPAIGN: 40 } },
      { key: 'SEGMENT', weight: 30, points: { RESIDENTIAL: 50 } },
      { key: 'STATE', weight: 10, points: { SP: 90 } },
      {
        key: 'MONTHLY_BILL',
        weight: 40,
        ranges: [
          { minCents: 0, points: 10 },
          { minCents: 30_000, points: 60 },
          { minCents: 100_000, points: 100 },
        ],
      },
    ]);
    // (20×100 + 30×50 + 10×90 + 40×60) / 100 = (2000 + 1500 + 900 + 2400) / 100 = 68
    const result = scoreLead(c, lead());
    expect(result.score).toBe(68);
    expect(result.breakdown).toEqual([
      { key: 'SOURCE', weight: 20, points: 100 },
      { key: 'SEGMENT', weight: 30, points: 50 },
      { key: 'STATE', weight: 10, points: 90 },
      { key: 'MONTHLY_BILL', weight: 40, points: 60 },
    ]);
  });

  it('critério sem dado no lead fica de fora (não vale zero)', () => {
    const c = config([
      { key: 'SOURCE', weight: 50, points: { REFERRAL: 80 } },
      { key: 'SEGMENT', weight: 50, points: { RESIDENTIAL: 20 } },
    ]);
    expect(scoreLead(c, lead({ segment: null })).score).toBe(80);
    // Nenhum critério aplicável: sem pontuação.
    expect(
      scoreLead(
        config([{ key: 'SEGMENT', weight: 10, points: { RESIDENTIAL: 20 } }]),
        lead({ segment: null }),
      ).score,
    ).toBeNull();
  });

  it('valor que a empresa não listou vale 0; faixa de conta usa a de maior mínimo que cabe', () => {
    const c = config([
      { key: 'SOURCE', weight: 1, points: { CAMPAIGN: 100 } },
      { key: 'MONTHLY_BILL', weight: 1, ranges: [{ minCents: 20_000, points: 70 }] },
    ]);
    expect(scoreLead(c, lead()).breakdown[0]?.points).toBe(0);
    expect(scoreLead(c, lead({ monthlyBillCents: 19_999 })).breakdown[1]?.points).toBe(0);
    expect(scoreLead(c, lead({ monthlyBillCents: 20_000 })).breakdown[1]?.points).toBe(70);
    expect(scoreLead(c, lead({ monthlyBillCents: 0 })).breakdown[1]?.points).toBe(0);
  });
});

describe('rodízio', () => {
  const now = Date.now();
  it('quem nunca recebeu vem primeiro, na ordem da lista', () => {
    expect(nextInRotation(['a', 'b', 'c'], new Map([['a', new Date(now)]]))).toBe('b');
    expect(nextInRotation(['a', 'b'], new Map())).toBe('a');
  });
  it('depois, quem recebeu há mais tempo', () => {
    const last = new Map([
      ['a', new Date(now - 1000)],
      ['b', new Date(now - 5000)],
      ['c', new Date(now - 3000)],
    ]);
    expect(nextInRotation(['a', 'b', 'c'], last)).toBe('b');
  });
  it('sem ninguém no grupo, não atribui', () => {
    expect(nextInRotation([], new Map())).toBeNull();
  });
});
