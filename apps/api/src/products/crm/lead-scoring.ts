import type { LeadScoreBreakdownItem, LeadScoringConfig } from '@voltex/shared';

export interface ScorableLead {
  source: string;
  segment: string | null;
  state: string | null;
  monthlyBillCents: number | null;
}

export interface LeadScore {
  /** `null`: sem critérios cadastrados ou nenhum se aplica a este lead. */
  score: number | null;
  breakdown: LeadScoreBreakdownItem[];
}

/**
 * Pontuação do lead pelos critérios DA EMPRESA: média dos pontos de cada critério aplicável, ponderada pelos pesos.
 * Critério sem dado no lead (ex.: lead sem segmento) fica de fora, em vez de valer zero. Valor que a empresa não
 * listou na tabela de pontos vale 0 (ela escolheu o que premiar). Sem critério aplicável, o lead não é pontuado.
 */
export function scoreLead(config: LeadScoringConfig, lead: ScorableLead): LeadScore {
  const breakdown: LeadScoreBreakdownItem[] = [];
  for (const criterion of config.criteria) {
    let points: number | null = null;
    switch (criterion.key) {
      case 'SOURCE':
        points = criterion.points[lead.source as keyof typeof criterion.points] ?? 0;
        break;
      case 'SEGMENT':
        if (lead.segment)
          points = criterion.points[lead.segment as keyof typeof criterion.points] ?? 0;
        break;
      case 'STATE':
        if (lead.state) points = criterion.points[lead.state.toUpperCase()] ?? 0;
        break;
      case 'MONTHLY_BILL':
        if (lead.monthlyBillCents !== null) {
          const bill = lead.monthlyBillCents;
          const range = [...criterion.ranges]
            .sort((a, b) => b.minCents - a.minCents)
            .find((r) => r.minCents <= bill);
          points = range?.points ?? 0;
        }
        break;
    }
    if (points !== null) breakdown.push({ key: criterion.key, weight: criterion.weight, points });
  }
  const totalWeight = breakdown.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight === 0) return { score: null, breakdown: [] };
  const weighted = breakdown.reduce((sum, item) => sum + item.weight * item.points, 0);
  return { score: Math.round(weighted / totalWeight), breakdown };
}

/**
 * Próximo do rodízio: quem nunca recebeu lead, na ordem da lista; depois, quem recebeu há mais tempo.
 * `lastAssigned`: quando cada pessoa recebeu o último lead (ausente = nunca).
 */
export function nextInRotation(
  pool: readonly string[],
  lastAssigned: ReadonlyMap<string, Date>,
): string | null {
  if (pool.length === 0) return null;
  let best: string | null = null;
  let bestTime = Infinity;
  for (const id of pool) {
    const last = lastAssigned.get(id);
    if (!last) return id;
    if (last.getTime() < bestTime) {
      best = id;
      bestTime = last.getTime();
    }
  }
  return best;
}
