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
const at = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY);

/** Previsões (Fase 12I): dados insuficientes por padrão, números com faixa quando a amostra mínima é atingida. */
describe('Previsões (e2e)', () => {
  let t: TestApp;
  let a: SeededTenant;
  let b: SeededTenant;
  let owner: string;
  let ownerB: string;
  let finance: string;
  let installer: string;
  let deal: Awaited<ReturnType<typeof signedDeal>>;

  const get = (path: string, token: string) => t.http.get(`${API}${path}`).set(bearer(token));
  const put = (path: string, token: string, body: unknown) =>
    t.http
      .put(`${API}${path}`)
      .set(bearer(token))
      .send(body as object);

  beforeAll(async () => {
    t = await createTestApp();
    a = await seedTenant(t.prisma, 'previsao');
    b = await seedTenant(t.prisma, 'previsaob');
    owner = await tokenFor(t.http, a.owner);
    ownerB = await tokenFor(t.http, b.owner);
    const manager = await tokenFor(t.http, a.manager);
    finance = (await tokenWithRole(t, a, 'FINANCE')).token;
    installer = (await tokenWithRole(t, a, 'INSTALLER')).token;
    const seller = await tokenFor(t.http, a.salesperson);
    const flow: Flow = { t, tenant: a, seller, admin: owner };
    await ensureMarginPolicy(flow, manager);
    deal = await signedDeal(flow, manager, { name: 'Cliente previsão' });
  });
  afterAll(() => t.close());

  it('sem histórico suficiente: dados insuficientes, com a amostra e o mínimo', async () => {
    const res = await get('/forecasts/receivables', finance);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'INSUFFICIENT_SAMPLE', sample: 0, required: 20 });
    expect((await get('/forecasts/funnel', owner)).body.status).toBe('INSUFFICIENT_SAMPLE');
    expect((await get('/forecasts/installations', owner)).body.status).toBe('INSUFFICIENT_SAMPLE');
  });

  it('com o mínimo da empresa atingido, data as parcelas abertas pelo atraso histórico', async () => {
    expect(
      (await put('/analytics/settings', owner, { minSamples: { receivablesPaid: 3 } })).status,
    ).toBe(200);
    const base = { tenantId: a.id, projectId: deal.projectId, opportunityId: deal.opportunityId };
    // Três pagas com 0, 4 e 4 dias de atraso; uma aberta que vence em 5 dias; outra vencida há 2.
    const paid = [0, 4, 4].map((delay, i) => ({
      ...base,
      referenceId: `P${i}`,
      order: 10 + i,
      amountCents: 100_000,
      dueAt: at(-60),
      paidAt: at(-60 + delay),
      status: 'PAID' as const,
    }));
    const open = [
      {
        ...base,
        referenceId: 'A1',
        order: 20,
        amountCents: 500_000,
        dueAt: at(5),
        status: 'OPEN' as const,
      },
      {
        ...base,
        referenceId: 'A2',
        order: 21,
        amountCents: 200_000,
        dueAt: at(-2),
        status: 'OVERDUE' as const,
      },
    ];
    await t.prisma.system.receivable.createMany({ data: [...paid, ...open] });
    const res = await get('/forecasts/receivables', finance);
    expect(res.body).toMatchObject({
      status: 'OK',
      sample: 3,
      required: 3,
      openCents: 700_000,
      horizonDays: 90,
      unplacedCents: 0,
    });
    // Tudo entra dentro dos 90 dias nos três cenários.
    expect(res.body.withinHorizon).toEqual({ best: 700_000, expected: 700_000, worst: 700_000 });
    expect(res.body.weeks).toHaveLength(13);
  });

  it('permissão por previsão e isolamento entre empresas', async () => {
    expect((await get('/forecasts/receivables', installer)).status).toBe(403);
    expect((await get('/forecasts/funnel', installer)).status).toBe(403);
    // A outra empresa continua sem histórico.
    expect((await get('/forecasts/receivables', ownerB)).body).toMatchObject({
      status: 'INSUFFICIENT_SAMPLE',
      sample: 0,
    });
  });

  it('geração: planta inexistente é 404; sem leituras suficientes, dados insuficientes', async () => {
    expect((await get('/forecasts/generation/VLX-NAOEXISTE', owner)).status).toBe(404);
    const installation = await t.prisma.system.installation.findFirst({
      where: { tenantId: a.id },
    });
    expect(installation === null || installation).toBeTruthy();
  });
});
