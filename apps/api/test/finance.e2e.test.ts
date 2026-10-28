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
import { ensureMarginPolicy, signedDeal } from './crm-delivery-flow';
import type { Flow } from './crm-flow';
import { tokenWithRole } from './crm-support';

const DAY = 86_400_000;
const day = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);

describe('Financeiro por projeto (e2e)', () => {
  let t: TestApp;
  let a: SeededTenant;
  let b: SeededTenant;
  let flow: Flow;
  let manager: string;
  let seller: string;
  let finance: string;
  let adminB: string;

  const get = (path: string, token: string) => t.http.get(`${API}${path}`).set(bearer(token));
  const post = (path: string, token: string, body: unknown = {}) =>
    t.http
      .post(`${API}${path}`)
      .set(bearer(token))
      .send(body as object);

  /** Um projeto novo (contrato assinado) e o valor do contrato. */
  const project = async () => {
    const deal = await signedDeal(flow, manager);
    const row = await t.prisma.system.project.findUniqueOrThrow({ where: { id: deal.projectId } });
    return { id: deal.projectId, valueCents: row.valueCents, opportunityId: deal.opportunityId };
  };

  beforeAll(async () => {
    t = await createTestApp();
    a = await seedTenant(t.prisma, 'fin');
    b = await seedTenant(t.prisma, 'finb');
    manager = await tokenFor(t.http, a.manager);
    seller = await tokenFor(t.http, a.salesperson);
    adminB = await tokenFor(t.http, b.admin);
    finance = (await tokenWithRole(t, a, 'FINANCE')).token;
    flow = { t, tenant: a, seller, admin: await tokenFor(t.http, a.owner) };
    await ensureMarginPolicy(flow, manager);
  });
  afterAll(() => t.close());

  describe('parcelas', () => {
    it('cria, lista e baixa uma parcela; a baixa entra na linha do tempo e no resumo', async () => {
      const p = await project();
      const created = await post(`/projects/${p.id}/finance/receivables`, finance, {
        referenceId: 'NF-001',
        order: 1,
        amountCents: Math.floor(p.valueCents / 2),
        dueOn: day(10),
      });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ status: 'OPEN', daysOverdue: 0, paidOn: null });

      const paid = await post(
        `/projects/${p.id}/finance/receivables/${created.body.id}/pay`,
        finance,
        { paymentMethod: 'PIX', paidOn: day(0) },
      );
      expect(paid.status).toBe(200);
      expect(paid.body).toMatchObject({ status: 'PAID', paymentMethod: 'PIX', paidOn: day(0) });

      const summary = (await get(`/projects/${p.id}/finance/summary`, finance)).body;
      expect(summary.totalReceivedCents).toBe(Math.floor(p.valueCents / 2));
      expect(summary.receivablesPaidCount).toBe(1);
      expect(summary.marginCents).toBe(Math.floor(p.valueCents / 2));

      const timeline = await t.prisma.system.timelineEvent.findMany({
        where: { opportunityId: p.opportunityId, type: 'RECEIVABLE_PAID' },
      });
      expect(timeline).toHaveLength(1);
      const audits = await t.prisma.system.auditLog.count({
        where: { tenantId: a.id, action: 'finance.receivable_paid' },
      });
      expect(audits).toBeGreaterThan(0);
    });

    it('valida o corpo, a ordem repetida e a soma acima do contrato', async () => {
      const p = await project();
      const url = `/projects/${p.id}/finance/receivables`;
      expect((await post(url, finance, { referenceId: '', order: 0 })).status).toBe(422);
      const ok = await post(url, finance, {
        referenceId: 'NF-A',
        order: 1,
        amountCents: 1000,
        dueOn: day(5),
      });
      expect(ok.status).toBe(201);
      const dup = await post(url, finance, {
        referenceId: 'NF-B',
        order: 1,
        amountCents: 1000,
        dueOn: day(5),
      });
      expect(dup.status).toBe(422);
      expect(dup.body.code).toBe('RECEIVABLE_ORDER_EXISTS');
      const over = await post(url, finance, {
        referenceId: 'NF-C',
        order: 2,
        amountCents: p.valueCents,
        dueOn: day(5),
      });
      expect(over.status).toBe(422);
      expect(over.body.code).toBe('RECEIVABLES_EXCEED_CONTRACT');
    });

    it('parcela paga ou cancelada não volta a ser baixada ou cancelada', async () => {
      const p = await project();
      const rec = await post(`/projects/${p.id}/finance/receivables`, finance, {
        referenceId: 'NF-1',
        order: 1,
        amountCents: 1000,
        dueOn: day(3),
      });
      const id = rec.body.id as string;
      expect(
        (
          await post(`/projects/${p.id}/finance/receivables/${id}/cancel`, finance, {
            reason: 'Renegociada',
          })
        ).status,
      ).toBe(200);
      const again = await post(`/projects/${p.id}/finance/receivables/${id}/pay`, finance, {
        paymentMethod: 'PIX',
      });
      expect(again.status).toBe(422);
      expect(again.body.code).toBe('RECEIVABLE_CLOSED');
    });

    it('parcela vencida aparece como vencida e a rotina diária cria uma única tarefa de cobrança', async () => {
      const p = await project();
      const rec = await post(`/projects/${p.id}/finance/receivables`, finance, {
        referenceId: 'NF-V',
        order: 1,
        amountCents: 1000,
        dueOn: day(-5),
      });
      expect(rec.body).toMatchObject({ status: 'OVERDUE', daysOverdue: 5 });

      const { FinanceScanService } =
        await import('../src/products/crm/finance/finance-scan.service');
      const { RequestContext } = await import('../src/common/context/request-context');
      const scan = t.app.get(FinanceScanService);
      const ctx = t.app.get(RequestContext);
      const first = await ctx.run({ tenantId: a.id }, () => scan.scanTenant());
      expect(first.overdue).toBeGreaterThan(0);
      await ctx.run({ tenantId: a.id }, () => scan.scanTenant());
      const tasks = await t.prisma.system.task.findMany({
        where: { automationKey: `receivable-overdue:${rec.body.id}` },
      });
      expect(tasks).toHaveLength(1);
      const stored = await t.prisma.system.receivable.findUniqueOrThrow({
        where: { id: rec.body.id },
      });
      expect(stored.status).toBe('OVERDUE');

      const overview = (await get('/finance/overview', finance)).body;
      expect(overview.totalOverdueCents).toBeGreaterThanOrEqual(1000);
      expect(overview.overdue.some((r: { id: string }) => r.id === rec.body.id)).toBe(true);
    });
  });

  describe('custos e margem', () => {
    it('lança custos, calcula a margem e o desvio sobre o previsto, e permite remover', async () => {
      const p = await project();
      const rec = await post(`/projects/${p.id}/finance/receivables`, finance, {
        referenceId: 'NF-1',
        order: 1,
        amountCents: 100_000,
        dueOn: day(1),
      });
      await post(`/projects/${p.id}/finance/receivables/${rec.body.id}/pay`, finance, {
        paymentMethod: 'Boleto',
      });
      const cost = await post(`/projects/${p.id}/finance/costs`, finance, {
        category: 'MATERIAL',
        description: 'Módulos',
        estimatedCents: 40_000,
        actualCents: 50_000,
      });
      expect(cost.status).toBe(201);
      const summary = (await get(`/projects/${p.id}/finance/summary`, finance)).body;
      expect(summary.totalCostsCents).toBe(50_000);
      expect(summary.marginCents).toBe(50_000);
      expect(summary.marginPct).toBeCloseTo(50, 5);
      expect(summary.costDeviationPct).toBeCloseTo(25, 5);

      const del = await t.http
        .delete(`${API}/projects/${p.id}/finance/costs/${cost.body.id}`)
        .set(bearer(finance));
      expect(del.status).toBe(204);
      expect((await get(`/projects/${p.id}/finance/summary`, finance)).body.totalCostsCents).toBe(
        0,
      );
    });
  });

  describe('crédito', () => {
    it('simula, respeita as transições e registra a resposta da instituição', async () => {
      const p = await project();
      const base = `/projects/${p.id}/finance/credit-applications`;
      const credit = await post(base, finance, {
        institution: 'Banco Exemplo',
        amountCents: 1_000_000,
        annualRatePct: 12,
        termMonths: 24,
      });
      expect(credit.status).toBe(201);
      expect(credit.body).toMatchObject({ status: 'SIMULATED', totalCents: 1_240_000 });
      const skip = await post(`${base}/${credit.body.id}/status`, finance, { status: 'APPROVED' });
      expect(skip.status).toBe(422);
      expect(skip.body.code).toBe('INVALID_CREDIT_TRANSITION');
      await post(`${base}/${credit.body.id}/status`, finance, { status: 'SENT' });
      const pending = await post(`${base}/${credit.body.id}/status`, finance, {
        status: 'PENDING',
        pendencies: ['Comprovante de renda'],
      });
      expect(pending.body.pendencies).toEqual(['Comprovante de renda']);
      const approved = await post(`${base}/${credit.body.id}/status`, finance, {
        status: 'APPROVED',
      });
      expect(approved.body.status).toBe('APPROVED');
      expect(approved.body.respondedAt).not.toBeNull();
    });
  });

  describe('comissões', () => {
    it('sem política nada é calculado; com política, calcula sobre o recebido e não mexe no que já foi pago', async () => {
      const p = await project();
      const rec1 = await post(`/projects/${p.id}/finance/receivables`, finance, {
        referenceId: 'NF-1',
        order: 1,
        amountCents: 100_000,
        dueOn: day(1),
      });
      await post(`/projects/${p.id}/finance/receivables/${rec1.body.id}/pay`, finance, {
        paymentMethod: 'PIX',
      });
      expect(
        (await get(`/projects/${p.id}/finance/summary`, finance)).body.commissions,
      ).toHaveLength(0);

      const policy = await post('/finance/commission-policies', finance, {
        base: 'RECEIVED',
        weights: { SALESPERSON: 5 },
        validFrom: day(-1),
      });
      expect(policy.status).toBe(201);
      const overlap = await post('/finance/commission-policies', finance, {
        base: 'SIGNED',
        weights: { SALESPERSON: 3 },
        validFrom: day(-2),
      });
      expect(overlap.body.code).toBe('POLICY_DATE_OVERLAP');

      const calc = await post(`/projects/${p.id}/finance/commissions/recalculate`, finance);
      expect(calc.body).toHaveLength(1);
      expect(calc.body[0]).toMatchObject({ amountCents: 5000, paidAt: null });
      const again = await post(`/projects/${p.id}/finance/commissions/recalculate`, finance);
      expect(again.body).toHaveLength(1);

      const paid = await post(
        `/projects/${p.id}/finance/commissions/${calc.body[0].id}/pay`,
        finance,
        {},
      );
      expect(paid.body.paidAt).not.toBeNull();

      const rec2 = await post(`/projects/${p.id}/finance/receivables`, finance, {
        referenceId: 'NF-2',
        order: 2,
        amountCents: 100_000,
        dueOn: day(2),
      });
      await post(`/projects/${p.id}/finance/receivables/${rec2.body.id}/pay`, finance, {
        paymentMethod: 'PIX',
      });
      const summary = (await get(`/projects/${p.id}/finance/summary`, finance)).body;
      const amounts = summary.commissions.map((c: { amountCents: number }) => c.amountCents).sort();
      expect(amounts).toEqual([5000, 5000]);
      expect(summary.totalCommissionsCents).toBe(10_000);
      expect(summary.marginCents).toBe(200_000 - 10_000);
    });
  });

  describe('permissões e isolamento', () => {
    it('vendedor não lê nem escreve; outra empresa recebe 404', async () => {
      const p = await project();
      expect((await get(`/projects/${p.id}/finance/summary`, seller)).status).toBe(403);
      expect(
        (
          await post(`/projects/${p.id}/finance/receivables`, seller, {
            referenceId: 'X',
            order: 1,
            amountCents: 1,
            dueOn: day(1),
          })
        ).status,
      ).toBe(403);
      expect((await get(`/projects/${p.id}/finance/summary`, adminB)).status).toBe(404);
    });
  });
});
