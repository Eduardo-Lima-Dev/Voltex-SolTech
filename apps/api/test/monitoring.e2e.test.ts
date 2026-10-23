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

/** Respostas gravadas do SolarEdge, montadas do contrato público (não validadas com conta real). */
const SOLAREDGE = {
  sites: { sites: { count: 1, site: [{ id: 4711, name: 'Casa da Maria', status: 'Active' }] } },
  energy: (from: string, to: string) => ({
    energy: {
      timeUnit: 'DAY',
      unit: 'Wh',
      measuredBy: 'INVERTER',
      values: [
        { date: `${from} 00:00:00`, value: 21_500 },
        { date: `${to} 00:00:00`, value: null },
      ],
    },
  }),
  overview: { overview: { lastUpdateTime: '2026-10-23 12:00:00', currentPower: { power: 3200 } } },
};

describe('Monitoramento de inversores (e2e)', () => {
  let t: TestApp;
  let a: SeededTenant;
  let b: SeededTenant;
  let flow: Flow;
  let manager: string;
  let seller: string;
  let admin: string;
  let om: string;
  let lead: string;
  let adminB: string;
  let calls: string[] = [];

  const get = (path: string, token: string) => t.http.get(`${API}${path}`).set(bearer(token));
  const post = (path: string, token: string, body: unknown = {}) =>
    t.http
      .post(`${API}${path}`)
      .set(bearer(token))
      .send(body as object);
  const del = (path: string, token: string) => t.http.delete(`${API}${path}`).set(bearer(token));

  /** Planta ativa (instalação aceita), com geração esperada de 900 kWh por mês quando `expected`. */
  const plant = async (expected = true) => {
    const deal = await signedDeal(flow, manager);
    const { OutboxPublisher } = await import('../src/platform/events/outbox-publisher.service');
    await t.app.get(OutboxPublisher).publishPending(1000, a.id);
    const inst = await t.prisma.system.installation.findFirstOrThrow({
      where: { projectId: deal.projectId },
    });
    await t.prisma.system.materialItem.create({
      data: {
        tenantId: a.id,
        installationId: inst.id,
        category: 'MODULE',
        description: 'Módulo 550 W',
        quantity: 10,
        unit: 'un',
        status: 'RECEIVED',
      },
    });
    await t.prisma.system.installation.update({
      where: { id: inst.id },
      data: { status: 'DONE', installedAt: new Date(), acceptedAt: new Date(), doneAt: new Date() },
    });
    expect((await post('/operations/plants/reconcile', om)).status).toBe(200);
    const row = await t.prisma.system.plant.findFirstOrThrow({
      where: { installationId: inst.id },
    });
    if (expected)
      await t.prisma.system.plant.update({
        where: { id: row.id },
        data: { expectedMonthlyKwh: Array(12).fill(900) },
      });
    return row.id;
  };

  const csvLow = (days: number) =>
    ['data;kwh', ...Array.from({ length: days }, (_, i) => `${day(-(i + 1))};1`)].join('\n');

  const activateMonitoringRule = async () => {
    const created = await post('/rules', lead, {
      key: 'ops.monitoring',
      definition: {
        deviation: { thresholdPct: 20, consecutiveDays: 3 },
        alarmTicketSeverities: ['CRITICAL'],
      },
      sources: [{ type: 'INTERNAL_POLICY', reference: 'Política de monitoramento de teste' }],
    });
    expect(created.status).toBe(201);
    const activated = await post(`/rules/${created.body.id}/activate`, lead, {
      reviewedBy: 'Eng. Teste',
      reviewedByRegistration: 'CREA-DF 123456',
    });
    expect(activated.status).toBe(200);
  };

  const tickets = (plantId: string) =>
    t.prisma.system.ticket.findMany({
      where: { plantId, automationKey: { startsWith: 'monitoring-' } },
    });

  beforeAll(async () => {
    t = await createTestApp({ INTEGRATIONS_ENABLED_PROVIDERS: 'solaredge,apsystems,fronius,sma' });
    a = await seedTenant(t.prisma, 'mon');
    b = await seedTenant(t.prisma, 'monb');
    manager = await tokenFor(t.http, a.manager);
    seller = await tokenFor(t.http, a.salesperson);
    admin = await tokenFor(t.http, a.admin);
    adminB = await tokenFor(t.http, b.admin);
    om = (await tokenWithRole(t, a, 'OM')).token;
    lead = (await tokenWithRole(t, a, 'TECHNICAL_LEAD')).token;
    flow = { t, tenant: a, seller, admin: await tokenFor(t.http, a.owner) };
    await ensureMarginPolicy(flow, manager);

    const { IntegrationHttp } = await import('../src/platform/integrations/integration-http');
    const http = t.app.get(IntegrationHttp) as unknown as {
      request: (i: { url: string }) => Promise<unknown>;
    };
    http.request = (input) => {
      calls.push(input.url);
      const url = new URL(input.url);
      const json = (body: unknown) =>
        Promise.resolve({ status: 200, headers: {}, text: '', json: body });
      if (url.hostname !== 'monitoringapi.solaredge.com')
        return Promise.resolve({ status: 404, headers: {}, text: '', json: null });
      if (url.searchParams.get('api_key') !== 'chave-solaredge-123')
        return Promise.resolve({ status: 403, headers: {}, text: '', json: null });
      if (url.pathname === '/sites/list') return json(SOLAREDGE.sites);
      if (url.pathname.endsWith('/energy'))
        return json(
          SOLAREDGE.energy(
            url.searchParams.get('startDate') ?? '',
            url.searchParams.get('endDate') ?? '',
          ),
        );
      if (url.pathname.endsWith('/overview')) return json(SOLAREDGE.overview);
      return Promise.resolve({ status: 404, headers: {}, text: '', json: null });
    };
  });
  afterAll(() => t.close());

  describe('catálogo de provedores', () => {
    it('lista os 17 provedores; só os com contrato de API documentado podem ser ligados', async () => {
      const res = await get('/integrations/providers', admin);
      expect(res.status).toBe(200);
      const monitoring = (
        res.body as { key: string; kind: string; available: boolean; official: boolean }[]
      ).filter((p) => p.kind === 'MONITORING');
      expect(monitoring).toHaveLength(17);
      expect(
        monitoring
          .filter((p) => p.available)
          .map((p) => p.key)
          .sort(),
      ).toEqual(['apsystems', 'fronius', 'solaredge']);
      expect(monitoring.filter((p) => !p.official)).toHaveLength(5);
      const signature = (res.body as { key: string; kind: string; available: boolean }[]).find(
        (p) => p.kind === 'SIGNATURE',
      );
      expect(signature).toMatchObject({ key: 'docuseal', available: false });
    });

    it('provedor sem adaptador aceita o cadastro, mas não liga nem testa', async () => {
      const created = await post('/integrations/connections', admin, {
        provider: 'sma',
        label: 'SMA da empresa',
        credentials: { clientId: 'id-1', clientSecret: 'segredo-1' },
      });
      expect(created.status).toBe(201);
      const activate = await post(
        `/integrations/connections/${created.body.id}/activate`,
        admin,
        {},
      );
      expect(activate.status).toBe(422);
      expect(activate.body.code).toBe('PROVIDER_NOT_AVAILABLE');
      const test = await post(`/integrations/connections/${created.body.id}/test`, admin);
      expect(test.body.ok).toBe(false);
      expect(test.body.message).toMatch(/não implementado/);
    });
  });

  describe('planilha de geração', () => {
    it('importa as linhas válidas, devolve as ruins com o motivo e alimenta o desempenho', async () => {
      const id = await plant();
      const csv = [
        'data;kwh',
        `${day(-1)};25,5`,
        `${day(-2)};30`,
        '31/02/2026;4',
        `${day(-3)};abc`,
      ].join('\n');
      const res = await post(`/operations/plants/${id}/monitoring/import`, om, { csv });
      expect(res.status).toBe(200);
      expect(res.body.imported).toBe(2);
      expect(res.body.rejected).toHaveLength(2);
      expect(res.body.rejected[0]).toMatchObject({ line: 4 });

      const page = (await get(`/operations/plants/${id}/monitoring`, om)).body;
      expect(page.hasExpected).toBe(true);
      expect(page.daily.map((d: { kwh: number }) => d.kwh)).toEqual([30, 25.5]);
      const current = page.months.at(-1);
      expect(current.expectedKwh).toBe(900);
      // Sem regra ativa: compara, mas não avalia desvio.
      expect(page.deviationRule).toBeNull();
      expect(page.deviation).toBeNull();
    });

    it('planilha sem nenhuma linha válida é recusada; vendedor não importa', async () => {
      const id = await plant();
      const bad = await post(`/operations/plants/${id}/monitoring/import`, om, { csv: 'abc;def' });
      expect(bad.status).toBe(422);
      expect(bad.body.code).toBe('CSV_EMPTY');
      expect(
        (await post(`/operations/plants/${id}/monitoring/import`, seller, { csv: 'x' })).status,
      ).toBe(403);
    });

    it('outra empresa não enxerga a planta', async () => {
      const id = await plant();
      expect((await get(`/operations/plants/${id}/monitoring`, adminB)).status).toBe(404);
    });
  });

  describe('desvio de geração e regra ops.monitoring', () => {
    it('sem regra ativa nenhum chamado abre sozinho; com a regra, abre um só e não repete', async () => {
      const id = await plant();
      const imported = await post(`/operations/plants/${id}/monitoring/import`, om, {
        csv: csvLow(4),
      });
      expect(imported.status).toBe(200);
      expect(await tickets(id)).toHaveLength(0);

      await activateMonitoringRule();
      // Importar de novo dispara a avaliação com a regra em vigor.
      await post(`/operations/plants/${id}/monitoring/import`, om, { csv: csvLow(4) });
      const opened = await tickets(id);
      expect(opened).toHaveLength(1);
      expect(opened[0]).toMatchObject({ origin: 'SYSTEM', type: 'CORRECTIVE' });
      expect(opened[0]?.title).toMatch(/abaixo do esperado/);

      await post(`/operations/plants/${id}/monitoring/import`, om, { csv: csvLow(5) });
      expect(await tickets(id)).toHaveLength(1);

      const page = (await get(`/operations/plants/${id}/monitoring`, om)).body;
      expect(page.deviation.alert).toBe(true);
      expect(page.deviationRule).toMatchObject({ thresholdPct: 20, consecutiveDays: 3 });
      const events = await t.prisma.system.outboxEvent.findMany({
        where: { tenantId: a.id, type: 'MonitoringAlertReceived' },
      });
      expect(events.some((e) => (e.payload as { plantId?: string }).plantId === id)).toBe(true);
    });

    it('dia sem leitura quebra a sequência: não abre chamado', async () => {
      const id = await plant();
      const csv = ['data;kwh', `${day(-1)};1`, `${day(-2)};1`, `${day(-4)};1`].join('\n');
      await post(`/operations/plants/${id}/monitoring/import`, om, { csv });
      expect(await tickets(id)).toHaveLength(0);
    });

    it('planta sem projeto aprovado (sem geração esperada) não é avaliada', async () => {
      const id = await plant(false);
      await post(`/operations/plants/${id}/monitoring/import`, om, { csv: csvLow(5) });
      expect(await tickets(id)).toHaveLength(0);
      const page = (await get(`/operations/plants/${id}/monitoring`, om)).body;
      expect(page.hasExpected).toBe(false);
      expect(page.deviation).toBeNull();
    });
  });

  describe('provedor SolarEdge (respostas gravadas)', () => {
    let connectionId: string;
    let plantId: string;

    it('cadastra, testa, lista as usinas da conta, vincula e sincroniza', async () => {
      const created = await post('/integrations/connections', admin, {
        provider: 'solaredge',
        label: 'SolarEdge da empresa',
        credentials: { apiKey: 'chave-solaredge-123' },
      });
      expect(created.status).toBe(201);
      connectionId = created.body.id;
      const tested = await post(`/integrations/connections/${connectionId}/test`, admin);
      expect(tested.body).toMatchObject({ ok: true });
      expect(
        (await post(`/integrations/connections/${connectionId}/activate`, admin, {})).status,
      ).toBe(200);

      plantId = await plant();
      const options = (await get(`/operations/plants/${plantId}/monitoring/connections`, om)).body;
      expect(options.find((o: { id: string }) => o.id === connectionId)).toMatchObject({
        provider: 'solaredge',
        canListPlants: true,
      });
      const external = await get(
        `/operations/plants/${plantId}/monitoring/external-plants?connectionId=${connectionId}`,
        om,
      );
      expect(external.body).toEqual([{ id: '4711', name: 'Casa da Maria' }]);

      const linked = await post(`/operations/plants/${plantId}/monitoring/links`, om, {
        connectionId,
        externalPlantId: '4711',
      });
      expect(linked.status).toBe(201);
      expect(linked.body).toMatchObject({ provider: 'solaredge', externalPlantId: '4711' });

      calls = [];
      const sync = await post(`/integrations/connections/${connectionId}/sync`, admin);
      expect(sync.body.status).toBe('SUCCEEDED');
      expect(sync.body.summary).toMatchObject({ plants: 1, days: 1, errors: [] });
      expect(calls.some((u) => u.includes('/energy?timeUnit=DAY'))).toBe(true);

      const page = (await get(`/operations/plants/${plantId}/monitoring`, om)).body;
      expect(page.daily).toHaveLength(1);
      expect(page.daily[0]).toMatchObject({ kwh: 21.5, source: 'solaredge' });
      expect(page.snapshot).toMatchObject({ powerKw: 3.2, status: 'ONLINE' });
    });

    it('a mesma usina do provedor não vai para duas plantas', async () => {
      const other = await plant();
      const res = await post(`/operations/plants/${other}/monitoring/links`, om, {
        connectionId,
        externalPlantId: '4711',
      });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('EXTERNAL_PLANT_ALREADY_LINKED');
    });

    it('credencial recusada vira falha da execução e conta na saúde da conexão', async () => {
      const bad = await post('/integrations/connections', admin, {
        provider: 'solaredge',
        label: 'SolarEdge com chave errada',
        credentials: { apiKey: 'chave-errada-999' },
      });
      const tested = await post(`/integrations/connections/${bad.body.id}/test`, admin);
      expect(tested.body.ok).toBe(false);
      expect(tested.body.message).toMatch(/credenciais recusadas/);
    });

    it('desvincular remove o vínculo e para a leitura', async () => {
      const page = (await get(`/operations/plants/${plantId}/monitoring`, om)).body;
      const linkId = page.links[0].id as string;
      expect(
        (await del(`/operations/plants/${plantId}/monitoring/links/${linkId}`, om)).status,
      ).toBe(204);
      expect((await get(`/operations/plants/${plantId}/monitoring`, om)).body.links).toHaveLength(
        0,
      );
    });
  });

  describe('alarmes do provedor', () => {
    it('alarme crítico aberto abre chamado só com a regra e fecha quando o provedor não o informa mais', async () => {
      const id = await plant();
      const { MonitoringIngestService } =
        await import('../src/products/operations/aftersales/monitoring/monitoring-ingest.service');
      const { RequestContext } = await import('../src/common/context/request-context');
      const ingest = t.app.get(MonitoringIngestService);
      const ctx = t.app.get(RequestContext);
      const openedAt = new Date(Date.now() - 3_600_000);
      await ctx.run({ tenantId: a.id }, async () => {
        const first = await ingest.syncAlarms(id, [
          { code: 'E-101', text: 'Falha de isolamento', severity: 'CRITICAL', openedAt },
        ]);
        expect(first).toEqual({ opened: 1, closed: 0 });
        const repeat = await ingest.syncAlarms(id, [
          { code: 'E-101', text: 'Falha de isolamento', severity: 'CRITICAL', openedAt },
        ]);
        expect(repeat).toEqual({ opened: 0, closed: 0 });
        await ingest.evaluate(id);
        await ingest.evaluate(id);
      });
      const opened = await tickets(id);
      expect(opened).toHaveLength(1);
      expect(opened[0]).toMatchObject({ priority: 'HIGH' });
      const page = (await get(`/operations/plants/${id}/monitoring`, om)).body;
      expect(page.openAlarms).toHaveLength(1);

      await ctx.run({ tenantId: a.id }, async () => {
        expect(await ingest.syncAlarms(id, [])).toEqual({ opened: 0, closed: 1 });
      });
      expect((await get(`/operations/plants/${id}/monitoring`, om)).body.openAlarms).toHaveLength(
        0,
      );
    });
  });
});
