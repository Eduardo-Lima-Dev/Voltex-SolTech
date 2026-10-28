import type { InsightKind, InsightSeverity, Permission } from '@voltex/shared';
import { formatFact, type FactType } from '../privacy/facts';

/**
 * Detectores de insight (Fase 12G, plano §12). Funções PURAS: recebem números já lidos do sistema e devolvem o achado.
 * A IA não participa da detecção; só redige a frase depois (e, sem ela, vale o texto padrão daqui).
 */

export interface InsightFactInput {
  key: string;
  label: string;
  type: FactType;
  value: number | string;
}

export interface InsightCandidate {
  kind: InsightKind;
  severity: InsightSeverity;
  /** Chave estável do achado: o mesmo problema não vira dois insights. */
  dedupeKey: string;
  /** Dono da carteira, se o achado é de um vendedor; `null` = da empresa. */
  ownerId: string | null;
  permission: Permission;
  facts: InsightFactInput[];
  defaultText: string;
  link: string;
}

const money = (key: string, label: string, value: number): InsightFactInput => ({
  key,
  label,
  type: 'MONEY',
  value,
});
const count = (key: string, label: string, value: number): InsightFactInput => ({
  key,
  label,
  type: 'COUNT',
  value,
});
const text = (f: InsightFactInput): string => formatFact(f);
const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

export function overdueReceivables(input: {
  minDays: number;
  overdue: readonly { daysOverdue: number; amountCents: number }[];
}): InsightCandidate | null {
  const late = input.overdue.filter((r) => r.daysOverdue >= input.minDays);
  if (late.length === 0) return null;
  const total = late.reduce((acc, r) => acc + r.amountCents, 0);
  const oldest = Math.max(...late.map((r) => r.daysOverdue));
  const facts = [
    count('count', 'Parcelas vencidas', late.length),
    money('totalCents', 'Total vencido', total),
    count('oldestDays', 'Maior atraso (dias)', oldest),
    count('minDays', 'Atraso mínimo considerado (dias)', input.minDays),
  ];
  const [n, t, o, m] = facts.map(text);
  return {
    kind: 'OVERDUE_RECEIVABLES',
    severity: 'ATTENTION',
    dedupeKey: 'OVERDUE_RECEIVABLES',
    ownerId: null,
    permission: 'crm.finance.read',
    facts,
    defaultText: `${plural(late.length, `Há ${n} parcela vencida`, `Há ${n} parcelas vencidas`)} há ${m} dias ou mais, somando ${t}. O maior atraso é de ${o} dias.`,
    link: '/operations/financeiro',
  };
}

export function stalledOpportunities(input: {
  stalledAfterDays: number;
  rows: readonly { ownerId: string | null; withoutOpenTask: boolean }[];
}): InsightCandidate[] {
  const byOwner = new Map<string | null, { stalled: number; noTask: number }>();
  for (const row of input.rows) {
    const cur = byOwner.get(row.ownerId) ?? { stalled: 0, noTask: 0 };
    cur.stalled += 1;
    if (row.withoutOpenTask) cur.noTask += 1;
    byOwner.set(row.ownerId, cur);
  }
  return [...byOwner.entries()].map(([ownerId, v]) => {
    const facts = [
      count('stalledCount', 'Oportunidades paradas', v.stalled),
      count('withoutTaskCount', 'Sem tarefa aberta', v.noTask),
      count('stalledAfterDays', 'Parada a partir de (dias)', input.stalledAfterDays),
    ];
    const [s, w, d] = facts.map(text);
    return {
      kind: 'STALLED_OPPORTUNITIES' as const,
      severity: 'ATTENTION' as const,
      dedupeKey: `STALLED_OPPORTUNITIES:${ownerId ?? 'empresa'}`,
      ownerId,
      permission: 'crm.opportunity.read' as const,
      facts,
      defaultText: `${plural(v.stalled, `${s} oportunidade está parada`, `${s} oportunidades estão paradas`)} na mesma etapa há ${d} dias ou mais; ${w} sem tarefa aberta.`,
      link: '/crm/oportunidades',
    };
  });
}

export function overdueInstallations(input: {
  overdueCount: number;
  awaitingMaterialCount: number;
}): InsightCandidate | null {
  if (input.overdueCount === 0) return null;
  const facts = [
    count('overdueCount', 'Instalações atrasadas', input.overdueCount),
    count('awaitingMaterialCount', 'Aguardando material', input.awaitingMaterialCount),
  ];
  const [o, a] = facts.map(text);
  return {
    kind: 'OVERDUE_INSTALLATIONS',
    severity: 'ATTENTION',
    dedupeKey: 'OVERDUE_INSTALLATIONS',
    ownerId: null,
    permission: 'ops.installation.read',
    facts,
    defaultText: `${plural(input.overdueCount, `${o} instalação está atrasada`, `${o} instalações estão atrasadas`)}; ${a} aguardam material.`,
    link: '/operations/instalacoes',
  };
}

/** `expiring` é `null` quando a empresa não configurou o aviso de garantia: sem configuração, sem insight. */
export function warrantiesExpiring(input: { expiring: number | null }): InsightCandidate | null {
  if (!input.expiring) return null;
  const facts = [count('expiringCount', 'Garantias a vencer', input.expiring)];
  const [e] = facts.map(text);
  return {
    kind: 'WARRANTIES_EXPIRING',
    severity: 'INFO',
    dedupeKey: 'WARRANTIES_EXPIRING',
    ownerId: null,
    permission: 'ops.warranty.manage',
    facts,
    defaultText: `${plural(input.expiring, `${e} garantia está`, `${e} garantias estão`)} perto do vencimento, dentro do prazo de aviso da empresa.`,
    link: '/operations/garantias',
  };
}

export function breachedTickets(input: {
  breached: number;
  open: number;
}): InsightCandidate | null {
  if (input.breached === 0) return null;
  const facts = [
    count('breachedCount', 'Chamados fora do prazo', input.breached),
    count('openCount', 'Chamados abertos', input.open),
  ];
  const [b, o] = facts.map(text);
  return {
    kind: 'BREACHED_TICKETS',
    severity: 'CRITICAL',
    dedupeKey: 'BREACHED_TICKETS',
    ownerId: null,
    permission: 'ops.ticket.read',
    facts,
    defaultText: `${plural(input.breached, `${b} chamado passou`, `${b} chamados passaram`)} do prazo de atendimento, entre ${o} abertos.`,
    link: '/operations/chamados',
  };
}
