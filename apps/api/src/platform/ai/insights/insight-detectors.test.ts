import { describe, expect, it } from 'vitest';
import {
  breachedTickets,
  overdueInstallations,
  overdueReceivables,
  stalledOpportunities,
  warrantiesExpiring,
} from './insight-detectors';

describe('detectores de insight', () => {
  it('parcelas vencidas: só conta a partir do atraso mínimo e soma o total', () => {
    const found = overdueReceivables({
      minDays: 7,
      overdue: [
        { daysOverdue: 3, amountCents: 100_000 },
        { daysOverdue: 10, amountCents: 250_000 },
        { daysOverdue: 40, amountCents: 50_000 },
      ],
    });
    expect(found).toMatchObject({
      kind: 'OVERDUE_RECEIVABLES',
      permission: 'crm.finance.read',
      ownerId: null,
    });
    const byKey = Object.fromEntries(found!.facts.map((f) => [f.key, f.value]));
    expect(byKey).toMatchObject({ count: 2, totalCents: 300_000, oldestDays: 40 });
    expect(found!.defaultText).toMatch(
      /2 parcelas vencidas há 7 dias ou mais, somando R\$\s?3\.000,00/,
    );
  });

  it('parcelas: nada vencido o bastante, nada a avisar', () => {
    expect(
      overdueReceivables({ minDays: 7, overdue: [{ daysOverdue: 2, amountCents: 1 }] }),
    ).toBeNull();
    expect(overdueReceivables({ minDays: 7, overdue: [] })).toBeNull();
  });

  it('oportunidades paradas: um achado por dono da carteira, com e sem dono', () => {
    const list = stalledOpportunities({
      stalledAfterDays: 14,
      rows: [
        { ownerId: 'u1', withoutOpenTask: true },
        { ownerId: 'u1', withoutOpenTask: false },
        { ownerId: 'u2', withoutOpenTask: true },
        { ownerId: null, withoutOpenTask: true },
      ],
    });
    expect(list.map((c) => c.dedupeKey).sort()).toEqual([
      'STALLED_OPPORTUNITIES:empresa',
      'STALLED_OPPORTUNITIES:u1',
      'STALLED_OPPORTUNITIES:u2',
    ]);
    const u1 = list.find((c) => c.ownerId === 'u1')!;
    expect(u1.facts.find((f) => f.key === 'stalledCount')!.value).toBe(2);
    expect(u1.facts.find((f) => f.key === 'withoutTaskCount')!.value).toBe(1);
    expect(stalledOpportunities({ stalledAfterDays: 14, rows: [] })).toEqual([]);
  });

  it('instalações, garantias e chamados: sem ocorrência não há achado; garantia sem configuração também não', () => {
    expect(overdueInstallations({ overdueCount: 0, awaitingMaterialCount: 4 })).toBeNull();
    expect(overdueInstallations({ overdueCount: 2, awaitingMaterialCount: 1 })).toMatchObject({
      permission: 'ops.installation.read',
      severity: 'ATTENTION',
    });
    expect(warrantiesExpiring({ expiring: null })).toBeNull();
    expect(warrantiesExpiring({ expiring: 0 })).toBeNull();
    expect(warrantiesExpiring({ expiring: 3 })).toMatchObject({ severity: 'INFO' });
    expect(breachedTickets({ breached: 0, open: 5 })).toBeNull();
    expect(breachedTickets({ breached: 1, open: 5 })).toMatchObject({
      severity: 'CRITICAL',
      permission: 'ops.ticket.read',
    });
  });
});
