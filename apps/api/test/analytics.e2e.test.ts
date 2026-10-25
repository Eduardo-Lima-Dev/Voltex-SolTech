import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  API,
  bearer,
  createTestApp,
  seedTenant,
  tokenFor,
  type SeededTenant,
  type TestApp,
} from './helpers';
import { buildOpportunity, type Flow } from './crm-flow';
import { ensureMarginPolicy, signedDeal, type SignedDeal } from './crm-delivery-flow';
import { tokenWithRole } from './crm-support';

/**
 * Camada analítica (Fase 12C): contas conferidas contra uma base montada pela API, carteira do vendedor,
 * dados financeiros só para quem pode vê-los, amostra mínima e isolamento entre empresas.
 */
describe('Camada analítica (e2e)', () => {
  let t: TestApp;
  let a: SeededTenant;
  let b: SeededTenant;
  let manager: string;
  let admin: string;
  let adminOther: string;
  let finance: string;
  let installer: string;
  let sellerA: { token: string; id: string };
  let sellerB: { token: string; id: string };
  let dealA1: SignedDeal;
  let dealA2: SignedDeal;
  let dealB1: SignedDeal;
  let valueA1 = 0;

  const get = (path: string, token: string) => t.http.get(`${API}${path}`).set(bearer(token));
  const post = (path: string, token: string, body: unknown = {}) =>
    t.http
      .post(`${API}${path}`)
      .set(bearer(token))
      .send(body as object);
  const put = (path: string, token: string, body: unknown) =>
    t.http
      .put(`${API}${path}`)
      .set(bearer(token))
      .send(body as object);

  /** Lança a parcela, dá baixa e registra um custo realizado (a margem real sai daí). */
  const settle = async (deal: SignedDeal, paidCents: number, costCents: number) => {
    const base = `/projects/${deal.projectId}/finance`;
    const parcel = await post(`${base}/receivables`, finance, {
      referenceId: `NF-${deal.projectId.slice(0, 6)}`,
      order: 1,
      amountCents: paidCents,
      dueOn: '2026-12-01',
    });
    expect(parcel.status).toBe(201);
    expect(
      (await post(`${base}/receivables/${parcel.body.id}/pay`, finance, { paymentMethod: 'PIX' }))
        .status,
    ).toBe(200);
    expect(
      (
        await post(`${base}/costs`, finance, {
          category: 'MATERIAL',
          description: 'Materiais',
          actualCents: costCents,
        })
      ).status,
    ).toBe(201);
  };

  beforeAll(async () => {
    t = await createTestApp();
    a = await seedTenant(t.prisma, 'analitica');
    b = await seedTenant(t.prisma, 'analiticab');
    manager = await tokenFor(t.http, a.manager);
    admin = await tokenFor(t.http, a.admin);
    adminOther = await tokenFor(t.http, b.admin);
    finance = (await tokenWithRole(t, a, 'FINANCE')).token;
    installer = (await tokenWithRole(t, a, 'INSTALLER')).token;
    sellerA = await tokenWithRole(t, a, 'SALESPERSON');
    sellerB = await tokenWithRole(t, a, 'SALESPERSON');
    const flowA: Flow = { t, tenant: a, seller: sellerA.token, admin };
    const flowB: Flow = { t, tenant: a, seller: sellerB.token, admin };
    await ensureMarginPolicy(flowA, manager);
    dealA1 = await signedDeal(flowA, manager, { name: 'Cliente A1' });
    dealA2 = await signedDeal(flowA, manager, { name: 'Cliente A2' });
    dealB1 = await signedDeal(flowB, manager, { name: 'Cliente B1' });
    valueA1 = (await t.prisma.system.project.findUniqueOrThrow({ where: { id: dealA1.projectId } }))
      .valueCents;
    await settle(dealA1, 1_000_000, 400_000); // margem 600.000 (60%)
    await settle(dealA2, 500_000, 450_000); // margem 50.000 (10%)
    await settle(dealB1, 800_000, 200_000); // margem 600.000 (75%)
  });
  afterAll(() => t.close());

  describe('clientes', () => {
    it('ranking por margem real: recebido − custos − comissões, com a margem em pontos percentuais', async () => {
      const res = await get('/analytics/clients?sortBy=margin', admin);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ financeIncluded: true, clientsCount: 3, note: null });
      const byName = Object.fromEntries(
        res.body.rows.map((r: { accountName: string }) => [r.accountName, r]),
      );
      expect(byName['Cliente A1']).toMatchObject({
        receivedCents: 1_000_000,
        costsCents: 400_000,
        commissionsCents: 0,
        marginRealCents: 600_000,
        marginRealPct: 60,
        contractedCents: valueA1,
        projectsCount: 1,
      });
      expect(byName['Cliente A2']).toMatchObject({ marginRealCents: 50_000, marginRealPct: 10 });
      expect(res.body.rows[res.body.rows.length - 1].accountName).toBe('Cliente A2'); // a menor margem fica por último
    });

    it('sem acesso ao financeiro, nenhum valor financeiro sai e ordenar por margem avisa', async () => {
      const res = await get('/analytics/clients?sortBy=margin', sellerA.token);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ financeIncluded: false, rows: [] });
      expect(res.body.note).toMatch(/não tem acesso aos dados financeiros/);
      const byContract = await get('/analytics/clients?sortBy=contracted', sellerA.token);
      expect(byContract.body.rows.length).toBeGreaterThan(0);
      for (const row of byContract.body.rows)
        expect([row.receivedCents, row.marginRealCents, row.overdueCents]).toEqual([
          null,
          null,
          null,
        ]);
    });

    it('a carteira vale: cada vendedor analisa só os seus clientes; a gestão, todos', async () => {
      const mine = await get('/analytics/clients?sortBy=contracted&limit=50', sellerA.token);
      expect(mine.body.rows.map((r: { accountName: string }) => r.accountName).sort()).toEqual([
        'Cliente A1',
        'Cliente A2',
      ]);
      const other = await get('/analytics/clients?sortBy=contracted&limit=50', sellerB.token);
      expect(other.body.rows.map((r: { accountName: string }) => r.accountName)).toEqual([
        'Cliente B1',
      ]);
      const all = await get('/analytics/clients?sortBy=contracted&limit=50', manager);
      expect(all.body.clientsCount).toBe(3);
    });

    it('o perfil Financeiro enxerga as contas e analisa os clientes com os valores', async () => {
      const res = await get('/analytics/clients?sortBy=margin&limit=50', finance);
      expect(res.status).toBe(200);
      expect(res.body.financeIncluded).toBe(true);
      expect(res.body.clientsCount).toBe(3);
      expect(res.body.rows[0]).toMatchObject({ marginRealCents: 600_000 });
      expect((await get('/accounts?pageSize=5', finance)).status).toBe(200);
    });

    it('perfil de um cliente: o dele sim, o de outra carteira 404, conta inexistente 404', async () => {
      expect((await get(`/analytics/clients/${dealA1.accountId}`, sellerA.token)).status).toBe(200);
      expect((await get(`/analytics/clients/${dealB1.accountId}`, sellerA.token)).status).toBe(404);
      const detail = await get(`/analytics/clients/${dealA1.accountId}`, admin);
      expect(detail.body).toMatchObject({ marginRealCents: 600_000, receivedCents: 1_000_000 });
      expect(
        (await get('/analytics/clients/00000000-0000-4000-8000-000000000000', manager)).status,
      ).toBe(404);
    });

    it('permissões: instalador não acessa análises de clientes nem de funil', async () => {
      for (const path of ['/analytics/clients', '/analytics/funnel', '/analytics/leads'])
        expect((await get(path, installer)).status, path).toBe(403);
    });
  });

  describe('funil', () => {
    it('conta oportunidades, propostas e ganhos por origem; a taxa de conversão não sai com poucas encerradas', async () => {
      const res = await get('/analytics/funnel?groupBy=owner', manager);
      expect(res.status).toBe(200);
      expect(res.body.overall).toMatchObject({
        opportunitiesCount: 3,
        wonCount: 3,
        closedCount: 3,
        proposalsSentCount: 3,
        proposalsAcceptedCount: 3,
        smallSample: true,
        winRate: null,
      });
      expect(res.body.conversionNote).toMatchObject({
        code: 'INSUFFICIENT_SAMPLE',
        sampleCount: 3,
        minimumCount: 30,
      });
      expect(res.body.rows).toHaveLength(2);
      for (const row of res.body.rows) expect(row.winRate).toBeNull();
      const a1 = res.body.rows.find((r: { group: string }) => r.group === sellerA.id);
      expect(a1).toMatchObject({ opportunitiesCount: 2, wonCount: 2 });
      expect(a1.wonValueCents).toBeGreaterThan(0);
      expect(a1.averageTicketCents).toBe(Math.round(a1.wonValueCents / 2));
    });

    it('vendedor enxerga o funil só da própria carteira', async () => {
      const res = await get('/analytics/funnel?groupBy=owner', sellerB.token);
      expect(res.body.overall.opportunitiesCount).toBe(1);
      expect(res.body.rows.map((r: { group: string }) => r.group)).toEqual([sellerB.id]);
    });

    it('agrupamentos aceitos e o inválido é recusado', async () => {
      for (const by of ['source', 'segment', 'state', 'owner', 'projectType'])
        expect((await get(`/analytics/funnel?groupBy=${by}`, manager)).status, by).toBe(200);
      expect((await get('/analytics/funnel?groupBy=cor', manager)).status).toBe(422);
    });

    it('ciclo de venda precisa de amostra: com 3 contratos não devolve média', async () => {
      const res = await get('/analytics/sales-cycle', manager);
      expect(res.body).toMatchObject({ signedCount: 3, averageDays: null, medianDays: null });
      expect(res.body.note).toMatchObject({ minimumCount: 5 });
    });

    it('motivos de perda e oportunidades paradas', async () => {
      const flow: Flow = { t, tenant: a, seller: sellerA.token, admin };
      const lost = await buildOpportunity(flow, { name: 'Cliente que desistiu' });
      const stage = await post(`/opportunities/${lost.opportunityId}/stage`, sellerA.token, {
        stage: 'LOST',
        lostReason: 'Preço alto',
      });
      expect(stage.status).toBe(200);
      const open = await buildOpportunity(flow, { name: 'Cliente em negociação' });
      const reasons = (await get('/analytics/loss-reasons', manager)).body;
      expect(reasons).toMatchObject({ lostCount: 1, withoutReasonCount: 0 });
      expect(reasons.reasons[0]).toMatchObject({ reason: 'Preço alto', count: 1, shareRate: 1 });
      const stalled = (await get('/analytics/stalled-opportunities', manager)).body;
      expect(stalled.stalledAfterDays).toBe(14);
      const row = stalled.rows.find((r: { withoutOpenTask: boolean }) => r.withoutOpenTask);
      expect(row).toBeTruthy();
      expect(stalled.withoutOpenTaskCount).toBeGreaterThanOrEqual(1);
      expect(open.opportunityId).toBeTruthy();
      // A carteira vale: o outro vendedor não vê essa oportunidade parada.
      const other = (await get('/analytics/stalled-opportunities', sellerB.token)).body;
      expect(other.openCount).toBe(0);
    });

    it('leads e tarefas', async () => {
      await post('/leads', sellerA.token, { name: 'Lead do A', phone: '(85) 98111-7001' });
      const leads = (await get('/analytics/leads', sellerA.token)).body;
      expect(leads.totalCount).toBeGreaterThanOrEqual(1);
      expect(leads.bySource[0]).toHaveProperty('label');
      expect(leads.conversionRate === null || typeof leads.conversionRate === 'number').toBe(true);
      await post('/tasks', sellerA.token, { title: 'Ligar', dueAt: '2020-01-01' });
      const tasks = (await get('/analytics/tasks', sellerA.token)).body;
      expect(tasks.overdueCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe('clientes com mais potencial', () => {
    it('exige o financeiro (a margem decide quem é "melhor")', async () => {
      expect((await get('/analytics/clients/potential', sellerA.token)).status).toBe(403);
      expect((await get('/analytics/clients/potential', installer)).status).toBe(403);
    });

    it('com poucos clientes, não responde e diz a amostra', async () => {
      const res = await get('/analytics/clients/potential', admin);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('INSUFFICIENT_SAMPLE');
      expect(res.body.insufficient).toMatchObject({ sampleCount: 3, minimumCount: 25 });
      expect(res.body.insufficient.message).toMatch(/pelo menos 25/);
    });

    it('a empresa ajusta o mínimo; os melhores e a explicação aparecem, com o aviso de que não é chance de fechar', async () => {
      expect((await get('/analytics/settings', admin)).body).toMatchObject({
        usingDefaults: true,
      });
      const updated = await put('/analytics/settings', admin, {
        minSamples: { potentialClients: 3, groupSize: 3 },
        bestClientShare: 0.34,
        bestClientCriterion: 'MARGIN',
        stalledDays: 14,
      });
      expect(updated.status).toBe(200);
      expect(updated.body).toMatchObject({ usingDefaults: false, bestClientShare: 0.34 });
      expect(updated.body.minSamples.potentialClients).toBe(3);
      expect(updated.body.minSamples.funnelClosed).toBe(30); // o que não foi ajustado fica no padrão

      const res = await get('/analytics/clients/potential?limit=5', admin);
      expect(res.body.status).toBe('OK');
      expect(res.body.data).toMatchObject({ clientsCount: 3, bestCount: 2, criterion: 'MARGIN' });
      expect(res.body.data.disclaimer).toMatch(/Não é a chance de o cliente fechar/);
      for (const c of res.body.data.candidates) {
        expect(c.explanations.length).toBeGreaterThan(0);
        expect(typeof c.scoreRate).toBe('number');
      }
    });

    it('configuração: valores fora do limite e perfil sem permissão são recusados', async () => {
      expect(
        (await put('/analytics/settings', admin, { minSamples: { potentialClients: 1 } })).status,
      ).toBe(422);
      expect((await put('/analytics/settings', admin, { bestClientShare: 0.9 })).status).toBe(422);
      expect((await put('/analytics/settings', sellerA.token, { stalledDays: 10 })).status).toBe(
        403,
      );
      const audit = await t.prisma.system.auditLog.findMany({
        where: { tenantId: a.id, action: 'analytics.settings_updated' },
      });
      expect(audit.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('isolamento entre empresas', () => {
    it('administrador de outra empresa vê tudo zerado', async () => {
      const clients = await get('/analytics/clients?sortBy=contracted', adminOther);
      expect(clients.body).toMatchObject({ clientsCount: 0, rows: [] });
      const funnel = await get('/analytics/funnel?groupBy=owner', adminOther);
      expect(funnel.body.overall.opportunitiesCount).toBe(0);
      expect((await get(`/analytics/clients/${dealA1.accountId}`, adminOther)).status).toBe(404);
      expect((await get('/analytics/settings', adminOther)).body.usingDefaults).toBe(true);
    });
  });
});
