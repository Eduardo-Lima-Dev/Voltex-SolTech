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

const input = (o: Record<string, unknown> = {}) => ({
  consumptionMonthlyKwh: Array<number>(12).fill(500),
  availabilityCostKwh: 30,
  hspMonthly: Array<number>(12).fill(5),
  performanceRatio: 0.8,
  modulePowerWp: 550,
  moduleAreaM2: 2.58,
  tariffCentsPerKwh: 95,
  costPerWpCents: 450,
  ...o,
});

describe('Solar Calculator, regras e dados de referência (e2e)', () => {
  let t: TestApp;
  let a: SeededTenant;
  let b: SeededTenant;
  let admin: string;
  let seller: string;
  let sdr: string;
  let manager: string;
  let adminB: string;

  const post = (path: string, token: string, body: unknown) =>
    t.http
      .post(`${API}${path}`)
      .set(bearer(token))
      .send(body as object);
  const calc = (token = seller, body: Record<string, unknown> = {}) =>
    post('/calculations/quick', token, { input: input(), ...body });

  beforeAll(async () => {
    t = await createTestApp();
    a = await seedTenant(t.prisma, 'calc');
    b = await seedTenant(t.prisma, 'calcb');
    admin = await tokenFor(t.http, a.admin);
    seller = await tokenFor(t.http, a.salesperson);
    sdr = await tokenFor(t.http, a.sdr);
    manager = await tokenFor(t.http, a.manager);
    adminB = await tokenFor(t.http, b.admin);
  });
  afterAll(() => t.close());

  describe('cálculo', () => {
    it('config padrão: regra embutida com fontes e limites', async () => {
      const res = await t.http.get(`${API}/calculations/quick/config`).set(bearer(seller));
      expect(res.status).toBe(200);
      expect(res.body.ruleSetRef).toBe('builtin@1');
      expect(res.body.thresholds).toMatchObject({
        microgenerationMaxKw: 75,
        minigenerationMaxKw: 5000,
        defaultPerformanceRatio: 0.8,
      });
      expect(res.body.availabilityCostKwh).toEqual({});
      expect(res.body.sources.length).toBeGreaterThan(0);
    });

    it('calcula no servidor (caso de referência), registra regra, autor, auditoria e evento', async () => {
      const res = await calc();
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        tenantId: a.id,
        createdById: a.salesperson.id,
        trafficLight: 'GREEN',
        algorithmVersion: 'calc-1.1.0',
        ruleSetRef: 'builtin@1',
        references: { solarResource: null, tariff: null },
      });
      expect(res.body.result).toMatchObject({
        moduleCount: 8,
        installedPowerKwp: 4.4,
        investmentCents: 1_980_000,
        generationClass: 'MICRO',
      });
      expect(res.body.result.assumptions.performanceRatioSource).toBe('INPUT');

      expect(
        await t.prisma.system.auditLog.findFirst({
          where: { tenantId: a.id, action: 'calculation.created', entityId: res.body.id },
        }),
      ).not.toBeNull();
      const event = await t.prisma.system.outboxEvent.findFirst({
        where: { tenantId: a.id, type: 'QuickCalculationCompleted' },
        orderBy: { occurredAt: 'desc' },
      });
      expect(event?.payload).toMatchObject({
        sessionId: res.body.id,
        trafficLight: 'GREEN',
        ruleSetRef: 'builtin@1',
      });
    });

    it('ignora os limites enviados pelo cliente: valem as regras do tenant', async () => {
      const res = await calc(seller, {
        input: input({ thresholds: { microgenerationMaxKw: 1, performanceRatioMin: 0.99 } }),
      });
      expect(res.status).toBe(201);
      expect(res.body.result.generationClass).toBe('MICRO');
      expect(res.body.result.assumptions.thresholds.microgenerationMaxKw).toBe(75);
      expect(res.body.trafficLight).toBe('GREEN');
    });

    it('valida a entrada com mensagens por campo em português (422)', async () => {
      const { costPerWpCents: _omit, ...noCost } = input();
      const missingCost = await calc(seller, { input: noCost });
      expect(missingCost.status).toBe(422);
      expect(missingCost.body.details.map((d: { path: string }) => d.path)).toContain(
        'input.costPerWpCents',
      );

      const badHsp = await calc(seller, { input: input({ hspMonthly: [5, 5] }) });
      expect(badHsp.status).toBe(422);
      const both = await calc(seller, { input: input({ losses: { a: 0.1 } }) });
      expect(both.status).toBe(422);
      expect(JSON.stringify(both.body)).toMatch(/não os dois/);
      expect((await calc(seller, { input: input({ consumptionMonthlyKwh: [] }) })).status).toBe(
        422,
      );
      expect((await calc(seller, { input: input({ tiltDegrees: 120 }) })).status).toBe(422);
    });

    it('semáforo e premissas: PR padrão gera aviso informativo e fica verde', async () => {
      const { performanceRatio: _pr, ...noPr } = input();
      const res = await calc(seller, { input: noPr });
      expect(res.body.result.assumptions).toMatchObject({
        performanceRatioSource: 'DEFAULT',
        performanceRatio: 0.8,
      });
      expect(res.body.result.alerts.map((x: { code: string }) => x.code)).toContain(
        'DEFAULT_PERFORMANCE_RATIO',
      );
      expect(res.body.trafficLight).toBe('GREEN');
    });

    it('vermelho e amarelo: área insuficiente e Grupo A', async () => {
      const red = await calc(seller, { input: input({ availableAreaM2: 5 }) });
      expect(red.body.trafficLight).toBe('RED');
      const yellow = await calc(seller, { input: input({ customerGroup: 'A' }) });
      expect(yellow.body.trafficLight).toBe('YELLOW');
      expect(yellow.body.result.requiresEngineering).toBe(true);
    });

    it('lista paginada com filtro por semáforo e busca', async () => {
      await calc(seller, { customerName: 'Cliente Busca Única', title: 'Residência Alfa' });
      const all = await t.http.get(`${API}/calculations/quick?pageSize=100`).set(bearer(seller));
      expect(all.body.meta.total).toBeGreaterThanOrEqual(5);
      const reds = await t.http
        .get(`${API}/calculations/quick?trafficLight=RED`)
        .set(bearer(seller));
      expect(reds.body.data.every((x: { trafficLight: string }) => x.trafficLight === 'RED')).toBe(
        true,
      );
      const search = await t.http
        .get(`${API}/calculations/quick?search=cliente%20busca`)
        .set(bearer(seller));
      expect(search.body.data).toHaveLength(1);
      expect(search.body.data[0].customerName).toBe('Cliente Busca Única');
      expect(
        (await t.http.get(`${API}/calculations/quick?pageSize=999`).set(bearer(seller))).status,
      ).toBe(422);
    });

    it('permissões: SDR calcula mas não salva snapshot; instalador não acessa', async () => {
      const created = await calc(sdr);
      expect(created.status).toBe(201);
      expect((await post(`/calculations/quick/${created.body.id}/snapshot`, sdr, {})).status).toBe(
        403,
      );
      const installer = await t.prisma.system.user.create({
        data: {
          tenantId: a.id,
          name: 'Instalador',
          email: `inst.${a.id.slice(0, 6)}@calc.test`,
          passwordHash: (
            await t.prisma.system.user.findUniqueOrThrow({ where: { id: a.owner.id } })
          ).passwordHash,
          role: 'INSTALLER',
        },
      });
      const instToken = await tokenFor(t.http, {
        id: installer.id,
        email: installer.email,
        role: 'INSTALLER',
      });
      expect((await t.http.get(`${API}/calculations/quick`).set(bearer(instToken))).status).toBe(
        403,
      );
      expect((await calc(instToken)).status).toBe(403);
      expect((await t.http.get(`${API}/calculations/quick`)).status).toBe(401);
    });
  });

  describe('snapshots imutáveis', () => {
    it('cria o snapshot com tudo o que foi usado e nunca muda', async () => {
      const session = await calc();
      const snap = await post(`/calculations/quick/${session.body.id}/snapshot`, manager, {
        note: 'Enviado ao cliente',
      });
      expect(snap.status).toBe(201);
      expect(snap.body).toMatchObject({
        sessionId: session.body.id,
        algorithmVersion: 'calc-1.1.0',
        ruleSetRef: 'builtin@1',
        note: 'Enviado ao cliente',
        createdById: a.manager.id,
        trafficLight: 'GREEN',
      });
      expect(snap.body.result.moduleCount).toBe(8);
      expect(snap.body.input.tariffCentsPerKwh).toBe(95);

      const row = await t.prisma.system.quickCalculationSnapshot.findUniqueOrThrow({
        where: { id: snap.body.id },
      });
      await expect(
        t.prisma.system.quickCalculationSnapshot.update({
          where: { id: row.id },
          data: { note: 'adulterado' },
        }),
      ).rejects.toThrow(/imutável/);
      await expect(
        t.prisma.system.quickCalculationSnapshot.delete({ where: { id: row.id } }),
      ).rejects.toThrow(/imutável/);
      await expect(
        t.prisma.system.quickCalculationSnapshot.deleteMany({ where: { tenantId: a.id } }),
      ).rejects.toThrow(/imutável/);

      const listed = await t.http
        .get(`${API}/calculations/quick/${session.body.id}/snapshots`)
        .set(bearer(seller));
      expect(listed.body).toHaveLength(1);
      expect(
        (
          await t.http
            .get(`${API}/calculations/quick/snapshots/${snap.body.id}`)
            .set(bearer(seller))
        ).body.id,
      ).toBe(snap.body.id);
      expect(
        await t.prisma.system.auditLog.findFirst({
          where: { tenantId: a.id, action: 'calculation.snapshot_created', entityId: snap.body.id },
        }),
      ).not.toBeNull();
    });

    it('mudar tarifa ou regra depois NÃO altera snapshots antigos', async () => {
      const dist = await post('/distributors', admin, {
        name: 'Distribuidora Snapshot',
        state: 'ce',
      });
      const tariff = await post('/tariffs', admin, {
        distributorId: dist.body.id,
        customerGroup: 'B',
        energyCentsPerKwh: 95,
        validFrom: '2026-01-01',
        source: 'fatura do cliente',
      });
      const session = await calc(seller, { references: { tariffId: tariff.body.id } });
      const snap = await post(`/calculations/quick/${session.body.id}/snapshot`, seller, {});
      expect(snap.body.references.tariff).toMatchObject({
        distributorName: 'Distribuidora Snapshot',
        energyCentsPerKwh: 95,
        overridden: false,
      });

      // nova tarifa + nova regra ativa
      await post('/tariffs', admin, {
        distributorId: dist.body.id,
        customerGroup: 'B',
        energyCentsPerKwh: 130,
        validFrom: '2026-06-01',
        source: 'reajuste',
      });
      const draft = await post('/rules', admin, {
        definition: { thresholds: { microgenerationMaxKw: 3 } },
        sources: [{ type: 'INTERNAL_POLICY', reference: 'teste' }],
      });
      await post(`/rules/${draft.body.id}/activate`, admin, { reviewedBy: 'Eng. Responsável' });

      const again = await t.http
        .get(`${API}/calculations/quick/snapshots/${snap.body.id}`)
        .set(bearer(seller));
      expect(again.body.ruleSetRef).toBe('builtin@1');
      expect(again.body.input.tariffCentsPerKwh).toBe(95);
      expect(again.body.result.generationClass).toBe('MICRO');
      expect(again.body.result.assumptions.thresholds.microgenerationMaxKw).toBe(75);

      const novo = await calc();
      expect(novo.body.ruleSetRef).toBe(`${draft.body.id}@1`);
      expect(novo.body.result.generationClass).toBe('MINI'); // 4,4 kWp > 3 kW pela regra nova
    });
  });

  describe('referências de local e tarifa', () => {
    it('registra o que foi usado e se o usuário alterou os valores do catálogo', async () => {
      const dist = await post('/distributors', admin, { name: 'Distribuidora Ref' });
      const tariff = await post('/tariffs', admin, {
        distributorId: dist.body.id,
        customerGroup: 'B',
        energyCentsPerKwh: 100,
        validFrom: '2026-01-01',
        source: 'ANEEL',
      });
      const resource = await post('/solar-resources', admin, {
        name: 'Local Ref',
        state: 'CE',
        hspMonthly: Array<number>(12).fill(5),
        source: 'CRESESB SunData',
      });

      const same = await calc(seller, {
        input: input({ tariffCentsPerKwh: 100 }),
        references: { tariffId: tariff.body.id, solarResourceId: resource.body.id },
      });
      expect(same.body.references.tariff.overridden).toBe(false);
      expect(same.body.references.solarResource).toMatchObject({
        name: 'Local Ref',
        source: 'CRESESB SunData',
        overridden: false,
      });

      const edited = await calc(seller, {
        input: input({ tariffCentsPerKwh: 90, hspMonthly: Array<number>(12).fill(5.5) }),
        references: { tariffId: tariff.body.id, solarResourceId: resource.body.id },
      });
      expect(edited.body.references.tariff.overridden).toBe(true);
      expect(edited.body.references.solarResource.overridden).toBe(true);
    });

    it('referência inexistente ou de outro tenant dá 404', async () => {
      const dist = await post('/distributors', adminB, { name: 'Distribuidora B' });
      const tariffB = await post('/tariffs', adminB, {
        distributorId: dist.body.id,
        customerGroup: 'B',
        energyCentsPerKwh: 100,
        validFrom: '2026-01-01',
        source: 'x1',
      });
      const resourceB = await post('/solar-resources', adminB, {
        name: 'Local B',
        hspMonthly: Array<number>(12).fill(5),
        source: 'x1',
      });
      expect((await calc(seller, { references: { tariffId: tariffB.body.id } })).status).toBe(404);
      expect(
        (await calc(seller, { references: { solarResourceId: resourceB.body.id } })).status,
      ).toBe(404);
      expect(
        (await calc(seller, { references: { tariffId: '0192b0c0-0000-7000-8000-00000000dead' } }))
          .status,
      ).toBe(404);
    });
  });

  describe('isolamento entre tenants', () => {
    it('B não vê, lê nem cria snapshot de cálculo de A; a lista só tem os seus', async () => {
      const session = await calc();
      const snap = await post(`/calculations/quick/${session.body.id}/snapshot`, seller, {});
      expect(
        (await t.http.get(`${API}/calculations/quick/${session.body.id}`).set(bearer(adminB)))
          .status,
      ).toBe(404);
      expect(
        (await post(`/calculations/quick/${session.body.id}/snapshot`, adminB, {})).status,
      ).toBe(404);
      expect(
        (
          await t.http
            .get(`${API}/calculations/quick/${session.body.id}/snapshots`)
            .set(bearer(adminB))
        ).status,
      ).toBe(404);
      expect(
        (
          await t.http
            .get(`${API}/calculations/quick/snapshots/${snap.body.id}`)
            .set(bearer(adminB))
        ).status,
      ).toBe(404);
      const list = await t.http.get(`${API}/calculations/quick?pageSize=100`).set(bearer(adminB));
      expect(list.body.data.map((x: { id: string }) => x.id)).not.toContain(session.body.id);
      expect(list.body.data.every((x: { tenantId: string }) => x.tenantId === b.id)).toBe(true);
    });

    it('regras, concessionárias e locais de A não aparecem para B', async () => {
      await post('/distributors', admin, { name: 'Só da A' });
      await post('/solar-resources', admin, {
        name: 'Só da A',
        hspMonthly: Array<number>(12).fill(5),
        source: 'x1',
      });
      const dists = await t.http.get(`${API}/distributors`).set(bearer(adminB));
      expect(dists.body.map((d: { name: string }) => d.name)).not.toContain('Só da A');
      const res = await t.http.get(`${API}/solar-resources?pageSize=100`).set(bearer(adminB));
      expect(res.body.data.map((d: { name: string }) => d.name)).not.toContain('Só da A');
      const rulesB = await t.http.get(`${API}/rules`).set(bearer(adminB));
      expect(rulesB.body).toEqual([]);
      const effB = await t.http.get(`${API}/calculations/quick/config`).set(bearer(adminB));
      expect(effB.body.ruleSetRef).toBe('builtin@1');
    });
  });
});
