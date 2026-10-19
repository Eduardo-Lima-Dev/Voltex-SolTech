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
import { acceptedDeal, ensureMarginPolicy, signedDeal } from './crm-delivery-flow';
import { tokenWithRole } from './crm-support';
import type { Flow } from './crm-flow';

describe('CRM · Painel comercial (e2e)', () => {
  let t: TestApp;
  let a: SeededTenant;
  let b: SeededTenant;
  let owner: string;
  let manager: string;
  let seller: string;
  let sdr: string;
  let finance: string;
  let adminB: string;
  let flow: Flow;
  let openOpportunityId: string;

  const dash = (token: string, query = '') =>
    t.http.get(`${API}/dashboard/commercial${query}`).set(bearer(token));
  const post = (path: string, token: string, body: unknown = {}) =>
    t.http
      .post(`${API}${path}`)
      .set(bearer(token))
      .send(body as object);

  beforeAll(async () => {
    t = await createTestApp();
    a = await seedTenant(t.prisma, 'dash');
    b = await seedTenant(t.prisma, 'dashb');
    owner = await tokenFor(t.http, a.owner);
    manager = await tokenFor(t.http, a.manager);
    seller = await tokenFor(t.http, a.salesperson);
    sdr = await tokenFor(t.http, a.sdr);
    adminB = await tokenFor(t.http, b.admin);
    finance = (await tokenWithRole(t, a, 'FINANCE')).token;
    flow = { t, tenant: a, seller, admin: await tokenFor(t.http, a.admin) };
    await ensureMarginPolicy(flow, manager);

    // Leads por origem.
    for (const [i, source] of (['FORM', 'FORM', 'REFERRAL', 'MANUAL'] as const).entries()) {
      const lead = (
        await post('/leads', seller, {
          name: `Lead ${i}`,
          phone: `(85) 9${String(i).padStart(4, '0')}-${String(i + 1).padStart(4, '0')}`,
          segment: 'RESIDENTIAL',
        })
      ).body;
      await t.prisma.system.lead.update({ where: { id: lead.id }, data: { source } });
    }
    // Dois negócios ganhos, um com proposta enviada e visualizada (aberta), um aceito sem contrato.
    await signedDeal(flow, manager);
    await signedDeal(flow, manager);
    const viewed = await acceptedDeal(flow, { accept: false });
    await t.http.get(`${API}/public/proposals/${viewed.token}`);
    await acceptedDeal(flow);
    // Oportunidade aberta com cotação e data de fechamento esperada.
    const open = await acceptedDeal(flow, { accept: false });
    openOpportunityId = open.opportunityId;
    await t.prisma.system.opportunity.update({
      where: { id: open.opportunityId },
      data: { expectedCloseDate: new Date('2026-12-15T12:00:00Z') },
    });
  });
  afterAll(() => t.close());

  it('leads por origem no período', async () => {
    const res = await dash(manager);
    expect(res.status).toBe(200);
    expect(res.body.totalLeads).toBe(4);
    expect(res.body.leadsBySource).toEqual([
      { source: 'FORM', count: 2 },
      expect.objectContaining({ count: 1 }),
      expect.objectContaining({ count: 1 }),
    ]);
  });

  it('funil: quantas oportunidades chegaram a cada etapa e a conversão sobre a anterior', async () => {
    const { funnel } = (await dash(manager)).body;
    const reached = Object.fromEntries(
      funnel.map((f: { stage: string; reached: number }) => [f.stage, f.reached]),
    );
    expect(reached).toMatchObject({
      NEW_LEAD: 5,
      QUOTING: 5,
      PROPOSAL_SENT: 5,
      NEGOTIATION: 0,
      CONTRACT: 3,
      WON: 2,
    });
    const conv = Object.fromEntries(
      funnel.map((f: { stage: string; conversionFromPrevious: number | null }) => [
        f.stage,
        f.conversionFromPrevious,
      ]),
    );
    expect(conv.NEW_LEAD).toBeNull();
    expect(conv.FIRST_CONTACT).toBeCloseTo(1);
    expect(conv.CONTRACT).toBeCloseTo(3 / 5); // negociação (opcional) não zera a conta
    expect(conv.WON).toBeCloseTo(2 / 3);
    expect(funnel.map((f: { stage: string }) => f.stage)).not.toContain('LOST');
  });

  it('propostas geradas, enviadas, visualizadas e aceitas', async () => {
    const { proposals } = (await dash(manager)).body;
    expect(proposals).toEqual({ generated: 5, sent: 5, viewed: 1, accepted: 3 });
  });

  it('ticket médio e total vêm dos contratos assinados', async () => {
    const { won } = (await dash(manager)).body;
    expect(won).toEqual({ count: 2, totalCents: 3_960_000, averageTicketCents: 1_980_000 });
  });

  it('previsão simples: pipeline aberto por mês esperado, sem pesos inventados', async () => {
    const { forecast } = (await dash(manager)).body;
    expect(forecast.openCount).toBe(3); // aceita sem contrato + enviada visualizada + enviada aberta
    expect(forecast.openTotalCents).toBe(3 * 1_980_000);
    expect(forecast.byMonth).toEqual([{ month: '2026-12', count: 1, totalCents: 1_980_000 }]);
    expect(forecast.withoutExpectedDateCount).toBe(2);
    expect(forecast.withoutValueCount).toBe(0);
    expect(forecast.weightedTotalCents).toBeNull();
  });

  it('com pesos por etapa definidos pela empresa, calcula o total ponderado', async () => {
    await t.prisma.system.tenant.update({
      where: { id: a.id },
      data: { settings: { forecastWeights: { PROPOSAL_SENT: 0.5, CONTRACT: 0.9 } } },
    });
    const { forecast } = (await dash(manager)).body;
    // 2 em Proposta enviada (50%) + 1 em Contrato (90%).
    expect(forecast.weightedTotalCents).toBe(Math.round(1_980_000 * (0.5 * 2 + 0.9)));
    await t.prisma.system.tenant.update({ where: { id: a.id }, data: { settings: {} } });
    expect(openOpportunityId).toBeTruthy();
  });

  it('período: fora da janela tudo zera; datas inválidas são recusadas', async () => {
    const past = (await dash(manager, '?from=2020-01-01T00:00:00.000Z&to=2020-02-01T00:00:00.000Z'))
      .body;
    expect(past.totalLeads).toBe(0);
    expect(past.won).toEqual({ count: 0, totalCents: 0, averageTicketCents: null });
    expect(past.funnel.every((f: { reached: number }) => f.reached === 0)).toBe(true);
    expect((await dash(manager, '?from=ontem')).status).toBe(422);
  });

  it('permissões e isolamento: gestor, financeiro e proprietário veem; vendedor e SDR não; outra empresa vê o que é dela', async () => {
    for (const token of [manager, finance, owner]) expect((await dash(token)).status).toBe(200);
    expect((await dash(seller)).status).toBe(403);
    expect((await dash(sdr)).status).toBe(403);
    expect((await t.http.get(`${API}/dashboard/commercial`)).status).toBe(401);
    const other = (await dash(adminB)).body;
    expect(other.totalLeads).toBe(0);
    expect(other.proposals.generated).toBe(0);
    expect(other.forecast.openCount).toBe(0);
  });
});
