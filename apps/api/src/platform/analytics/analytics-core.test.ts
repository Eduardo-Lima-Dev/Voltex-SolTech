import { describe, expect, it } from 'vitest';
import { ANALYTICS_DEFAULT_MIN_SAMPLES, type AnalyticsMinSamples } from '@voltex/shared';
import {
  billBand,
  clientMetrics,
  funnelByGroup,
  leadsOverview,
  lossReasons,
  median,
  potentialClients,
  rankClients,
  salesCycle,
  stalledOpportunities,
  tasksOverview,
  type FunnelContext,
  type LeadRow,
  type OpportunityRow,
  type PotentialClient,
} from './analytics-core';

const NOW = new Date('2026-10-25T12:00:00.000Z');
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const ago = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const min = (over: Partial<AnalyticsMinSamples> = {}): AnalyticsMinSamples => ({
  ...ANALYTICS_DEFAULT_MIN_SAMPLES,
  ...over,
});
const period = { from: d('2026-07-01'), to: NOW };

const opp = (id: string, over: Partial<OpportunityRow>): OpportunityRow => ({
  id,
  projectCode: `VLX-${id.toUpperCase()}`,
  title: `Sistema ${id}`,
  stage: 'QUALIFICATION',
  status: 'OPEN',
  projectType: 'ON_GRID',
  ownerId: 'u1',
  accountId: `acc-${id}`,
  siteId: null,
  leadId: null,
  lostReason: null,
  createdAt: d('2026-08-01'),
  stageChangedAt: ago(1),
  ...over,
});

/** Base fixa do funil: 11 oportunidades, 2 origens, 3 ganhas com contrato assinado. */
const base = (): FunnelContext => {
  const opportunities: OpportunityRow[] = [
    opp('o1', { leadId: 'l1', status: 'WON', createdAt: d('2026-08-01') }),
    opp('o2', { leadId: 'l2', status: 'WON', createdAt: d('2026-08-10') }),
    opp('o3', { leadId: 'l3', status: 'LOST', lostReason: 'Preço alto' }),
    opp('o4', { leadId: 'l4' }),
    opp('o5', { leadId: 'l5' }),
    opp('o6', { leadId: 'l6', status: 'LOST', lostReason: 'preço alto' }),
    opp('o7', { leadId: 'l7', status: 'LOST', lostReason: 'Concorrente' }),
    opp('o8', { leadId: 'l8', status: 'LOST', lostReason: null }),
    opp('o9', { leadId: 'l9', status: 'WON', createdAt: d('2026-09-01') }),
    opp('o10', { leadId: 'l10' }),
    opp('o11', { ownerId: null }),
  ];
  const sources: Record<string, string> = {
    l1: 'REFERRAL',
    l2: 'REFERRAL',
    l3: 'REFERRAL',
    l4: 'REFERRAL',
    l5: 'REFERRAL',
    l6: 'FORM',
    l7: 'FORM',
    l8: 'FORM',
    l9: 'FORM',
    l10: 'FORM',
  };
  const lead = (id: string, source: string): LeadRow => ({
    id,
    source,
    segment: null,
    state: null,
    ownerId: null,
    status: 'NEW',
    createdAt: d('2026-08-01'),
    firstContactAt: null,
    firstContactDueAt: null,
    monthlyBillCents: null,
    convertedOpportunityId: null,
  });
  return {
    opportunities,
    proposals: ['o1', 'o2', 'o3', 'o6', 'o9'].map((id) => ({
      opportunityId: id,
      sentAt: d('2026-08-20'),
      acceptedAt: ['o1', 'o2', 'o9'].includes(id) ? d('2026-08-25') : null,
    })),
    contracts: [
      { opportunityId: 'o1', valueCents: 2_000_000, signedAt: d('2026-09-01') },
      { opportunityId: 'o2', valueCents: 1_000_000, signedAt: d('2026-09-09') },
      { opportunityId: 'o9', valueCents: 3_000_000, signedAt: d('2026-09-21') },
    ],
    leads: [
      ...['l1', 'l2', 'l3'].map((id) => lead(id, 'REFERRAL')),
      ...['l6', 'l7', 'l8', 'l9'].map((id) => lead(id, 'FORM')),
    ],
    accountSegment: new Map(),
    siteState: new Map(),
    leadSource: new Map(Object.entries(sources)),
    userNames: new Map([['u1', 'Victor Vendedor']]),
  };
};

describe('funil por grupo (base fixa)', () => {
  it('conta, taxa de ganho, ticket e ciclo por origem, com amostra mínima do grupo reduzida para o teste', () => {
    const out = funnelByGroup(
      'source',
      base(),
      NOW,
      period,
      min({ groupSize: 3, funnelClosed: 7 }),
    );
    const referral = out.rows.find((r) => r.group === 'REFERRAL')!;
    expect(referral).toMatchObject({
      label: 'Indicação',
      leadsCount: 3,
      opportunitiesCount: 5,
      proposalsSentCount: 3,
      proposalsAcceptedCount: 2,
      wonCount: 2,
      lostCount: 1,
      closedCount: 3,
      winRate: 0.67,
      wonValueCents: 3_000_000,
      averageTicketCents: 1_500_000,
      averageCycleDays: 30.5,
      smallSample: false,
    });
    const form = out.rows.find((r) => r.group === 'FORM')!;
    expect(form).toMatchObject({
      label: 'Formulário',
      leadsCount: 4,
      opportunitiesCount: 5,
      proposalsSentCount: 2,
      wonCount: 1,
      lostCount: 3,
      winRate: 0.25,
      averageTicketCents: 3_000_000,
      averageCycleDays: 20,
    });
    expect(out.overall).toMatchObject({
      opportunitiesCount: 11,
      closedCount: 7,
      winRate: 0.43,
      wonCount: 3,
    });
    expect(out.conversionNote).toBeNull();
  });

  it('com os mínimos padrão, taxa fica nula e o aviso de amostra aparece (nada de percentual chutado)', () => {
    const out = funnelByGroup('source', base(), NOW, period, min());
    for (const row of out.rows) {
      expect(row.winRate, row.group).toBeNull();
      expect(row.smallSample).toBe(true);
    }
    expect(out.overall.winRate).toBeNull();
    expect(out.conversionNote).toMatchObject({
      code: 'INSUFFICIENT_SAMPLE',
      sampleCount: 7,
      minimumCount: 30,
    });
    expect(out.conversionNote!.message).toMatch(/pelo menos 30/);
    // As contagens continuam disponíveis.
    expect(out.rows.find((r) => r.group === 'REFERRAL')!.wonCount).toBe(2);
    expect(out.smallGroupsCount).toBe(2);
  });

  it('oportunidade sem lead de origem cai em "Sem origem registrada"', () => {
    const out = funnelByGroup('source', base(), NOW, period, min());
    const row = out.rows.find((r) => r.group === 'SEM_ORIGEM')!;
    expect(row.label).toBe('Sem origem registrada');
    expect(row.opportunitiesCount).toBe(1);
  });

  it('agrupa por vendedor com o nome e por tipo de projeto (sem contagem de leads)', () => {
    const byOwner = funnelByGroup('owner', base(), NOW, period, min());
    expect(byOwner.rows.find((r) => r.group === 'u1')!.label).toBe('Victor Vendedor');
    expect(byOwner.rows.find((r) => r.group === 'SEM_RESPONSAVEL')!.label).toBe('Sem responsável');
    const byType = funnelByGroup('projectType', base(), NOW, period, min());
    expect(byType.rows[0]!.leadsCount).toBeNull();
    expect(byType.overall.leadsCount).toBeNull();
    expect(byType.rows[0]).toMatchObject({ group: 'ON_GRID', label: 'On-grid' });
  });

  it('base vazia não quebra', () => {
    const empty: FunnelContext = {
      ...base(),
      opportunities: [],
      proposals: [],
      contracts: [],
      leads: [],
    };
    const out = funnelByGroup('source', empty, NOW, period, min());
    expect(out.rows).toEqual([]);
    expect(out.overall).toMatchObject({
      opportunitiesCount: 0,
      winRate: null,
      averageTicketCents: null,
    });
  });
});

describe('ciclo de venda', () => {
  const opps = base().opportunities;
  const contracts = base().contracts;
  it('média e mediana, quando há amostra', () => {
    const out = salesCycle(opps, contracts, NOW, period, min({ simpleAverage: 3 }));
    expect(out).toMatchObject({ signedCount: 3, averageDays: 27, medianDays: 30, note: null });
  });
  it('com poucos contratos, não calcula', () => {
    const out = salesCycle(opps, contracts, NOW, period, min());
    expect(out).toMatchObject({ signedCount: 3, averageDays: null, medianDays: null });
    expect(out.note).toMatchObject({ minimumCount: 5, sampleCount: 3 });
  });
  it('mediana de lista par e vazia', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe('motivos de perda', () => {
  it('junta variações de maiúsculas e acento e conta quem não informou', () => {
    const lost = base().opportunities.filter((o) => o.status === 'LOST');
    lost.push(opp('o12', { status: 'LOST', lostReason: 'Preco Alto' }));
    const out = lossReasons(lost, NOW, period);
    expect(out.lostCount).toBe(5);
    expect(out.withoutReasonCount).toBe(1);
    expect(out.reasons[0]).toMatchObject({ reason: 'Preço alto', count: 3, shareRate: 0.6 });
    expect(out.reasons[1]).toMatchObject({ reason: 'Concorrente', count: 1, shareRate: 0.2 });
  });
});

describe('oportunidades paradas', () => {
  it('sem tarefa aberta ou sem movimento além do limite, da mais antiga à mais nova', () => {
    const open = [
      opp('o4', { stageChangedAt: ago(10) }),
      opp('o5', { stageChangedAt: ago(20) }),
      opp('o10', { stageChangedAt: ago(3) }),
      opp('o11', { stageChangedAt: ago(30), ownerId: null }),
    ];
    const out = stalledOpportunities(
      open,
      new Set(['o4', 'o5']),
      new Map([['u1', 'Victor']]),
      NOW,
      14,
      10,
    );
    expect(out).toMatchObject({
      stalledAfterDays: 14,
      openCount: 4,
      stalledCount: 3,
      withoutOpenTaskCount: 2,
      noMovementCount: 2,
    });
    expect(out.rows.map((r) => [r.projectCode, r.daysInStageDays, r.withoutOpenTask])).toEqual([
      ['VLX-O11', 30, true],
      ['VLX-O5', 20, false],
      ['VLX-O10', 3, true],
    ]);
    expect(out.rows[1]).toMatchObject({ ownerName: 'Victor', stageLabel: 'Qualificação' });
    expect(out.rows[0]!.ownerName).toBeNull();
  });
  it('respeita o limite de linhas', () => {
    const open = Array.from({ length: 6 }, (_, i) => opp(`x${i}`, { stageChangedAt: ago(20 + i) }));
    expect(stalledOpportunities(open, new Set(), new Map(), NOW, 14, 3).rows).toHaveLength(3);
  });
});

describe('tarefas e leads', () => {
  it('tarefas abertas e atrasadas por responsável', () => {
    const out = tasksOverview(
      [
        { assigneeId: 'u1', status: 'OPEN', dueAt: ago(2) },
        { assigneeId: 'u1', status: 'OPEN', dueAt: ago(-2) },
        { assigneeId: 'u2', status: 'OPEN', dueAt: ago(5) },
        { assigneeId: 'u2', status: 'DONE', dueAt: ago(9) },
        { assigneeId: null, status: 'OPEN', dueAt: ago(-1) },
      ],
      new Map([
        ['u1', 'Victor'],
        ['u2', 'Valéria'],
      ]),
      NOW,
    );
    expect(out).toMatchObject({ openCount: 4, overdueCount: 2 });
    expect(out.byAssignee.map((a) => [a.name, a.openCount, a.overdueCount])).toEqual([
      ['Victor', 2, 1],
      ['Valéria', 1, 1],
      [null, 1, 0],
    ]);
  });

  it('leads por origem, SLA estourado e conversão (só com leads suficientes)', () => {
    const lead = (id: string, over: Partial<LeadRow>): LeadRow => ({
      id,
      source: 'FORM',
      segment: 'RESIDENTIAL',
      state: 'CE',
      ownerId: null,
      status: 'NEW',
      createdAt: ago(3),
      firstContactAt: null,
      firstContactDueAt: ago(1),
      monthlyBillCents: null,
      convertedOpportunityId: null,
      ...over,
    });
    const leads = [
      lead('a', {}),
      lead('b', { firstContactDueAt: ago(-1) }),
      lead('c', { status: 'CONVERTED', firstContactAt: ago(2) }),
      lead('d', { source: 'REFERRAL', status: 'CONTACTED', firstContactAt: ago(2) }),
      lead('e', { source: 'REFERRAL', status: 'CONVERTED', firstContactAt: ago(2) }),
    ];
    const out = leadsOverview(leads, NOW, period, min());
    expect(out).toMatchObject({
      totalCount: 5,
      slaBreachedCount: 1,
      convertedCount: 2,
      conversionRate: 0.4,
    });
    expect(out.bySource.map((s) => [s.label, s.count])).toEqual([
      ['Formulário', 3],
      ['Indicação', 2],
    ]);
    expect(leadsOverview(leads.slice(0, 3), NOW, period, min()).conversionRate).toBeNull();
  });
});

describe('métricas por cliente (base fixa)', () => {
  const input = () => ({
    accounts: [
      { id: 'A', name: 'Cliente A', segment: 'COMMERCIAL' },
      { id: 'B', name: 'Cliente B', segment: 'RESIDENTIAL' },
      { id: 'C', name: 'Cliente C', segment: null },
      { id: 'Z', name: 'Sem projeto', segment: null },
    ],
    accountState: new Map([['A', 'CE']]),
    projects: [
      { id: 'P1', accountId: 'A', opportunityId: 'oA', valueCents: 2_000_000 },
      { id: 'P2', accountId: 'B', opportunityId: 'oB', valueCents: 1_000_000 },
      { id: 'P3', accountId: 'C', opportunityId: 'oC', valueCents: 500_000 },
    ],
    receivables: [
      { projectId: 'P1', amountCents: 1_000_000, status: 'PAID', dueAt: ago(60) },
      { projectId: 'P1', amountCents: 500_000, status: 'PAID', dueAt: ago(40) },
      { projectId: 'P1', amountCents: 500_000, status: 'OPEN', dueAt: ago(10) },
      { projectId: 'P2', amountCents: 1_000_000, status: 'PAID', dueAt: ago(30) },
      { projectId: 'P3', amountCents: 500_000, status: 'OPEN', dueAt: ago(-20) },
      { projectId: 'P3', amountCents: 100_000, status: 'CANCELLED', dueAt: ago(5) },
    ],
    costs: [
      { projectId: 'P1', actualCents: 600_000 },
      { projectId: 'P2', actualCents: 900_000 },
    ],
    commissions: [
      { projectId: 'P1', amountCents: 100_000 },
      { projectId: 'P2', amountCents: 50_000 },
    ],
    plants: [{ accountId: 'A' }],
    tickets: [
      { accountId: 'A', status: 'OPEN', resolvedAt: null },
      { accountId: 'A', status: 'RESOLVED', resolvedAt: ago(1) },
    ],
    omContracts: [
      { accountId: 'A', status: 'ACTIVE', endsOn: ago(-100) },
      { accountId: 'A', status: 'EXPIRED', endsOn: ago(10) },
    ],
    saleCycleDays: new Map([
      ['oA', 40],
      ['oB', 20],
    ]),
    origin: new Map(),
  });

  it('receita, margem real, inadimplência e relacionamento por cliente', () => {
    const rows = clientMetrics(input(), NOW, true);
    expect(rows.map((r) => r.accountId)).toEqual(['A', 'B', 'C']); // quem não tem projeto não aparece
    const a = rows.find((r) => r.accountId === 'A')!;
    expect(a).toMatchObject({
      segment: 'COMMERCIAL',
      state: 'CE',
      projectsCount: 1,
      contractedCents: 2_000_000,
      receivedCents: 1_500_000,
      costsCents: 600_000,
      commissionsCents: 100_000,
      marginRealCents: 800_000,
      marginRealPct: 53.3,
      overdueCents: 500_000,
      overdueCount: 1,
      maxOverdueDays: 10,
      plantsCount: 1,
      ticketsCount: 2,
      openTicketsCount: 1,
      omContractsActiveCount: 1,
      saleCycleDays: 40,
    });
    const b = rows.find((r) => r.accountId === 'B')!;
    expect(b).toMatchObject({ marginRealCents: 50_000, marginRealPct: 5, overdueCents: 0 });
    const c = rows.find((r) => r.accountId === 'C')!;
    // Parcela aberta com vencimento no futuro não é inadimplência; cancelada nem entra.
    expect(c).toMatchObject({
      receivedCents: 0,
      marginRealCents: 0,
      marginRealPct: null,
      overdueCents: 0,
      saleCycleDays: null,
    });
  });

  it('sem acesso ao financeiro, nenhum valor financeiro sai (só contratado e relacionamento)', () => {
    const rows = clientMetrics(input(), NOW, false);
    for (const r of rows)
      expect([
        r.receivedCents,
        r.costsCents,
        r.commissionsCents,
        r.marginRealCents,
        r.marginRealPct,
        r.overdueCents,
        r.overdueCount,
        r.maxOverdueDays,
      ]).toEqual(Array(8).fill(null));
    expect(rows[0]!.contractedCents).toBe(2_000_000);
    expect(rankClients(rows, 'margin', 'desc', 10)).toEqual([]);
    expect(rankClients(rows, 'contracted', 'desc', 10).map((r) => r.accountId)).toEqual([
      'A',
      'B',
      'C',
    ]);
  });

  it('ranking por margem, recebido, inadimplência, em ordem crescente e com limite', () => {
    const rows = clientMetrics(input(), NOW, true);
    expect(rankClients(rows, 'margin', 'desc', 10).map((r) => r.accountId)).toEqual([
      'A',
      'B',
      'C',
    ]);
    expect(rankClients(rows, 'margin', 'asc', 2).map((r) => r.accountId)).toEqual(['C', 'B']);
    expect(rankClients(rows, 'overdue', 'desc', 1).map((r) => r.accountId)).toEqual(['A']);
    expect(rankClients(rows, 'tickets', 'desc', 1)[0]!.accountId).toBe('A');
  });
});

describe('clientes com mais potencial', () => {
  /** 30 clientes: os 6 melhores são todos comerciais do CE; dos outros 24, 6 comerciais e 18 residenciais. */
  const clients = (): PotentialClient[] =>
    Array.from({ length: 30 }, (_, i) => ({
      accountId: `c${i}`,
      attrs: {
        segment: i < 12 ? 'COMMERCIAL' : 'RESIDENTIAL',
        state: 'CE',
        source: null,
        billBand: null,
      },
      marginRealCents: (30 - i) * 10_000,
      receivedCents: (30 - i) * 20_000,
      projectsCount: 1,
      omContractsActiveCount: 0,
    }));
  const cand = (id: string, segment: string | null, state: string | null = 'CE') => ({
    kind: 'LEAD' as const,
    id,
    name: `Lead ${id}`,
    attrs: { segment, state, source: null, billBand: null },
  });

  it('abaixo de 25 clientes com valor recebido: não responde, e diz o tamanho da amostra', () => {
    const out = potentialClients(
      clients().slice(0, 24),
      [cand('x', 'COMMERCIAL')],
      'MARGIN',
      0.2,
      min(),
      NOW,
      10,
    );
    expect(out.status).toBe('INSUFFICIENT_SAMPLE');
    if (out.status === 'INSUFFICIENT_SAMPLE')
      expect(out.insufficient).toMatchObject({ sampleCount: 24, minimumCount: 25 });
  });

  it('só entram clientes com algo recebido', () => {
    const list = clients().map((c, i) => (i < 6 ? { ...c, receivedCents: 0 } : c));
    expect(potentialClients(list, [], 'MARGIN', 0.2, min(), NOW, 10).status).toBe(
      'INSUFFICIENT_SAMPLE',
    );
  });

  it('nota = média de "quantas vezes mais comum entre os melhores", com a explicação de cada atributo', () => {
    const out = potentialClients(
      clients(),
      [cand('com', 'COMMERCIAL'), cand('res', 'RESIDENTIAL'), cand('semdado', null, null)],
      'MARGIN',
      0.2,
      min(),
      NOW,
      10,
    );
    expect(out.status).toBe('OK');
    if (out.status !== 'OK') return;
    expect(out.data).toMatchObject({
      criterion: 'MARGIN',
      clientsCount: 30,
      bestCount: 6,
      bestShareRate: 0.2,
    });
    expect(out.data.candidates.map((c) => c.id)).toEqual(['com', 'res']); // sem atributo conhecido, fica fora
    const com = out.data.candidates[0]!;
    expect(com.scoreRate).toBe(1.75); // (2,5 do segmento + 1 da UF) / 2
    expect(com.usedAttributesCount).toBe(2);
    expect(com.explanations[0]).toMatchObject({
      attribute: 'segment',
      value: 'COMMERCIAL',
      valueLabel: 'Comercial',
      liftRate: 2.5,
      bestShareRate: 1,
      allShareRate: 0.4,
    });
    expect(out.data.candidates[1]!.scoreRate).toBe(0.5);
    expect(out.data.disclaimer).toMatch(/Não é a chance de o cliente fechar/);
  });

  it('valor raro (menos clientes que o mínimo do grupo) não gera nota', () => {
    const list = clients();
    list[29] = { ...list[29]!, attrs: { ...list[29]!.attrs, segment: 'INDUSTRIAL' } };
    const out = potentialClients(
      list,
      [cand('ind', 'INDUSTRIAL', null)],
      'MARGIN',
      0.2,
      min(),
      NOW,
      10,
    );
    expect(out.status === 'OK' && out.data.candidates).toEqual([]);
  });

  it('o critério muda quem são os melhores', () => {
    const list = clients().map((c, i) => ({ ...c, projectsCount: i >= 24 ? 5 : 1 }));
    const byMargin = potentialClients(
      list,
      [cand('com', 'COMMERCIAL')],
      'MARGIN',
      0.2,
      min(),
      NOW,
      10,
    );
    const byProjects = potentialClients(
      list,
      [cand('com', 'COMMERCIAL')],
      'PROJECTS',
      0.2,
      min(),
      NOW,
      10,
    );
    expect(byMargin.status === 'OK' && byMargin.data.candidates[0]!.scoreRate).toBe(1.75);
    // Os 6 com mais projetos são residenciais (índices 24–29): comercial deixa de ser "parecido com os melhores".
    expect(byProjects.status === 'OK' && byProjects.data.candidates[0]!.scoreRate).toBe(0.5);
  });

  it('faixa de conta de luz', () => {
    expect(billBand(29_999)).toBe('B0');
    expect(billBand(30_000)).toBe('B1');
    expect(billBand(299_999)).toBe('B2');
    expect(billBand(300_000)).toBe('B3');
    expect(billBand(null)).toBeNull();
  });
});
