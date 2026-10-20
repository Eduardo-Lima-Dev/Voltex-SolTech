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
import { tokenWithRole } from './crm-support';

const suffix = Math.random().toString(36).slice(2, 8);

const specs = {
  MODULE: {
    technology: 'MONO_SI',
    pmaxWp: 550,
    vmppV: 41.5,
    imppA: 13.25,
    vocV: 49.5,
    iscA: 14,
    betaVocPctPerC: -0.27,
    alphaIscPctPerC: 0.05,
    gammaPmaxPctPerC: -0.35,
    noctC: 45,
    lengthMm: 2278,
    widthMm: 1134,
  },
  BATTERY: {
    chemistry: 'LFP',
    nominalVoltageV: 51.2,
    capacityAh: 100,
    capacityHours: 5,
    maxDodPct: 90,
    roundTripEfficiencyPct: 95,
    cycleLife: 6000,
    cycleDodPct: 80,
    calendarLifeYears: 15,
    maxChargeCurrentA: 50,
    maxDischargeCurrentA: 100,
    maxParallel: 8,
  },
  CHARGE_CONTROLLER: {
    technology: 'MPPT',
    batteryVoltageV: 48,
    autoVoltage: true,
    ratedChargeCurrentA: 60,
    pvVocMaxV: 250,
    mpptMinV: 60,
    mpptMaxV: 230,
    pvPowerMaxW: 3200,
    efficiencyPct: 98,
  },
  OFFGRID_INVERTER: {
    topology: 'OFFGRID',
    batteryVoltageV: 48,
    pContinuousW: 3000,
    pSurgeW: 6000,
    efficiencyPct: 93,
    standbyW: 25,
    vAcV: 220,
    phases: 1,
    sineWave: true,
    generatorInput: true,
    chargerCurrentA: 40,
  },
} as const;

const GHI = [5.6, 5.8, 5.4, 5.3, 4.9, 4.7, 5.0, 5.8, 5.6, 5.8, 5.4, 5.4];
const TEMP = [24, 24, 24, 23, 22, 20, 20, 22, 24, 25, 24, 24];
const site = {
  latitude: -15.8,
  longitude: -47.9,
  state: 'DF',
  designTminC: 5,
  designTmaxAmbientC: 35,
  climate: {
    source: 'nasa-power',
    period: '2001-2020',
    fetchedAt: '2026-01-01',
    ghiKwhM2Day: GHI,
    tempMeanC: TEMP,
    tempMinC: TEMP.map((v) => v - 6),
    tempMaxC: TEMP.map((v) => v + 6),
  },
};

describe('Off-Grid Designer (e2e)', () => {
  let t: TestApp;
  let a: SeededTenant;
  let b: SeededTenant;
  let adminB: string;
  let seller: string;
  let engineer: string;
  let lead: string;
  const ids: Record<string, string> = {};

  const get = (path: string, token: string) => t.http.get(`${API}${path}`).set(bearer(token));
  const post = (path: string, token: string, body: object = {}) =>
    t.http.post(`${API}${path}`).set(bearer(token)).send(body);
  const put = (path: string, token: string, body: object) =>
    t.http.put(`${API}${path}`).set(bearer(token)).send(body);
  const patch = (path: string, token: string, body: object) =>
    t.http.patch(`${API}${path}`).set(bearer(token)).send(body);

  const design = (over: Record<string, unknown> = {}) => ({
    schemaVersion: 1,
    systemType: 'OFFGRID',
    site,
    systemVoltageV: 48,
    loads: [
      { id: 'l1', name: 'Geladeira', powerW: 120, hoursPerDay: 12, surgeFactor: 4, critical: true },
      {
        id: 'l2',
        name: 'Iluminação',
        powerW: 10,
        quantity: 10,
        hoursPerDay: 5,
        windowStartHour: 18,
        windowEndHour: 24,
      },
      { id: 'l3', name: 'TV', powerW: 120, hoursPerDay: 5, windowStartHour: 18, windowEndHour: 23 },
    ],
    arrays: [
      {
        id: 'a1',
        name: 'Telhado',
        moduleId: ids.MODULE,
        modulesInSeries: 4,
        parallelStrings: 1,
        azimuthDegrees: 0,
        tiltDegrees: 16,
      },
    ],
    bank: { batteryId: ids.BATTERY, seriesCount: 1, parallelCount: 2 },
    controllerId: ids.CHARGE_CONTROLLER,
    inverterId: ids.OFFGRID_INVERTER,
    stress: { enabled: false },
    ...over,
  });

  const rule = async () => {
    const created = await post('/rules', lead, {
      key: 'offgrid.design',
      definition: {
        parameters: {
          red1Default: 0.75,
          red2Default: 0.9,
          batteryEfficiencyDefault: 0.86,
          inverterEfficiencyMin: 0.85,
          autonomyMinDays: 2,
          dodMaxLeadFlooded: 50,
          dodMaxLeadVrla: 50,
          dodMaxStationary: 80,
          dodMaxLithium: 80,
          controllerCurrentFactor: 1.25,
          vocColdFactor: 1,
          inverterSurgeMargin: 0.25,
          maxBatteriesParallel: 4,
          maxChargeCRate: 0.2,
          lolpMaxPct: 5,
          chargeVoltageFactor: 1.2,
          pvOtherLossFactor: 0.95,
        },
      },
      sources: [{ type: 'INTERNAL_POLICY', reference: 'Regra de teste off-grid' }],
    });
    expect([created.status, JSON.stringify(created.body)]).toEqual([201, expect.anything()]);
    expect(
      (await post(`/rules/${created.body.id}/activate`, lead, { reviewedBy: 'Eng. Teste' })).status,
    ).toBe(200);
  };

  beforeAll(async () => {
    t = await createTestApp();
    a = await seedTenant(t.prisma, 'ofg');
    b = await seedTenant(t.prisma, 'ofgb');
    adminB = await tokenFor(t.http, b.admin);
    seller = await tokenFor(t.http, a.salesperson);
    engineer = (await tokenWithRole(t, a, 'ENGINEERING')).token;
    lead = (await tokenWithRole(t, a, 'TECHNICAL_LEAD')).token;
    for (const [kind, spec] of Object.entries(specs)) {
      const res = await post('/catalog/items', engineer, {
        kind,
        manufacturer: `Off ${suffix}`,
        model: `${kind}-1`,
        spec,
        referenceCostCents: kind === 'BATTERY' ? 1_200_000 : 100_000,
      });
      expect([kind, res.status, JSON.stringify(res.body)]).toEqual([kind, 201, expect.anything()]);
      expect((await post(`/catalog/items/${res.body.id}/approve`, lead)).status).toBe(200);
      ids[kind] = res.body.id;
    }
  });
  afterAll(() => t.close());

  it('o catálogo aceita os novos tipos e recusa ficha incoerente', async () => {
    const bad = await post('/catalog/items', engineer, {
      kind: 'BATTERY',
      manufacturer: 'X',
      model: `bad-${suffix}`,
      spec: { ...specs.BATTERY, cycleLife: 100, cycleDodPct: 99 },
    });
    expect(bad.status).toBe(201);
    expect((await post(`/catalog/items/${bad.body.id}/approve`, lead)).status).toBe(422);
    const list = await get('/catalog/items?kind=GENERATOR', engineer);
    expect(list.status).toBe(200);
  });

  describe('pedido → projeto', () => {
    let requestId = '';
    let projectId = '';
    let versionId = '';

    it('cria o pedido, que aparece na fila, e rejeita permissão indevida', async () => {
      const created = await post('/offgrid/requests', seller, { title: 'Sítio sem rede' });
      expect(created.status).toBe(403);
      const ok = await post('/offgrid/requests', engineer, {
        title: 'Chalé isolado',
        systemType: 'OFFGRID',
        priority: 'HIGH',
      });
      expect(ok.status).toBe(201);
      requestId = ok.body.id;
      expect(
        (await get('/offgrid/requests?status=PENDING', engineer)).body.map(
          (r: { id: string }) => r.id,
        ),
      ).toContain(requestId);
      expect((await get('/offgrid/requests', adminB)).body).toEqual([]);
    });

    it('transições do pedido seguem a máquina de estados', async () => {
      expect(
        (await patch(`/offgrid/requests/${requestId}`, engineer, { status: 'IN_REVIEW' })).status,
      ).toBe(409);
      const moved = await patch(`/offgrid/requests/${requestId}`, engineer, {
        status: 'IN_PROGRESS',
        priority: 'URGENT',
        note: 'Peguei',
      });
      expect(moved.body).toMatchObject({ status: 'IN_PROGRESS', priority: 'URGENT' });
      const commented = await post(`/offgrid/requests/${requestId}/comments`, engineer, {
        text: 'Visita marcada',
      });
      expect(commented.body.events.map((e: { type: string }) => e.type)).toContain('COMMENT');
    });

    it('cria o projeto a partir do pedido com a primeira versão em rascunho', async () => {
      const project = await post('/offgrid/projects', engineer, {
        name: 'Chalé do Vale',
        site: { latitude: -15.8, longitude: -47.9, state: 'DF' },
        requestId,
      });
      expect([project.status, JSON.stringify(project.body)]).toEqual([201, expect.anything()]);
      expect(project.body.code).toMatch(/^OFG-\d{4}-\d{4}$/);
      projectId = project.body.id;
      versionId = project.body.versions[0].id;
      expect((await get(`/offgrid/requests/${requestId}`, engineer)).body.project.id).toBe(
        projectId,
      );
      expect(
        (
          await post('/offgrid/projects', engineer, {
            name: 'Outro',
            site: { latitude: -15, longitude: -47 },
            requestId,
          })
        ).status,
      ).toBe(409);
      expect((await get(`/offgrid/projects/${projectId}`, adminB)).status).toBe(404);
      expect((await get('/offgrid/projects?search=Chal%C3%A9', engineer)).body.total).toBe(1);
    });

    it('sem regra o cálculo é provisório e a versão não pode ser enviada', async () => {
      const saved = await put(`/offgrid/versions/${versionId}/design`, engineer, {
        design: design(),
      });
      expect([saved.status, JSON.stringify(saved.body).slice(0, 300)]).toEqual([
        200,
        expect.anything(),
      ]);
      expect(saved.body.results.pending.map((p: { code: string }) => p.code)).toContain(
        'RULE_PARAMETERS_MISSING',
      );
      expect(saved.body.results.simulation.lolpPct).toBe(0);
      expect((await post(`/offgrid/versions/${versionId}/submit`, engineer)).status).toBe(422);
    });

    it('equipamento fora do catálogo ou de tipo errado é recusado ao salvar', async () => {
      const wrongKind = await put(`/offgrid/versions/${versionId}/design`, engineer, {
        design: design({ inverterId: ids.BATTERY }),
      });
      expect(wrongKind.status).toBe(422);
      expect(wrongKind.body.code).toBe('EQUIPMENT_NOT_AVAILABLE');
      const unknown = await put(`/offgrid/versions/${versionId}/design`, engineer, {
        design: design({ controllerId: '00000000-0000-4000-8000-00000000dead' }),
      });
      expect(unknown.status).toBe(422);
    });

    it('com a regra ativa o cálculo fecha, sugere configurações e vai para revisão', async () => {
      await rule();
      const recalculated = await post(`/offgrid/versions/${versionId}/recalculate`, engineer);
      expect(recalculated.status).toBe(201);
      expect(recalculated.body.results.pending).toEqual([]);
      expect(recalculated.body.ruleRefs.length).toBe(1);
      expect(recalculated.body.results.economics.capexCents).toBeGreaterThan(0);

      const suggestions = await post(`/offgrid/versions/${versionId}/suggest`, engineer, {
        limit: 3,
      });
      expect(suggestions.status).toBe(201);
      expect(suggestions.body.length).toBeGreaterThan(0);
      expect(suggestions.body[0].moduleId).toBe(ids.MODULE);

      const submitted = await post(`/offgrid/versions/${versionId}/submit`, engineer);
      expect(submitted.body.status).toBe('SUBMITTED');
      expect((await get(`/offgrid/requests/${requestId}`, engineer)).body.status).toBe('IN_REVIEW');
      expect(
        (await put(`/offgrid/versions/${versionId}/design`, engineer, { design: design() })).status,
      ).toBe(409);
    });

    it('comentário aberto bloqueia a aprovação; só o responsável técnico decide', async () => {
      expect(
        (await post(`/offgrid/versions/${versionId}/approve`, engineer, { note: 'ok' })).status,
      ).toBe(403);
      const comment = await post(`/offgrid/versions/${versionId}/comments`, lead, {
        section: 'bank',
        text: 'Conferir a autonomia',
      });
      expect(comment.status).toBe(201);
      const blocked = await post(`/offgrid/versions/${versionId}/approve`, lead, {
        note: 'Aprovado',
      });
      expect(blocked.status).toBe(422);
      expect(blocked.body.message).toContain('comentário');
      expect(
        (await post(`/offgrid/versions/${versionId}/comments/${comment.body.id}/resolve`, engineer))
          .body.status,
      ).toBe('RESOLVED');
      expect((await get(`/offgrid/versions/${versionId}/comments`, engineer)).body).toHaveLength(1);
    });

    it('aprovar gera o snapshot imutável, conclui o pedido e congela a versão', async () => {
      const approved = await post(`/offgrid/versions/${versionId}/approve`, lead, {
        note: 'Aprovado pelo RT',
      });
      expect([approved.status, JSON.stringify(approved.body).slice(0, 200)]).toEqual([
        201,
        expect.anything(),
      ]);
      expect(approved.body.status).toBe('APPROVED');
      const snapshot = await t.prisma.system.offgridSnapshot.findUniqueOrThrow({
        where: { versionId },
      });
      expect(snapshot.hash).toHaveLength(64);
      expect(
        (await t.prisma.system.offgridRequest.findUniqueOrThrow({ where: { id: requestId } }))
          .status,
      ).toBe('DONE');
      expect((await get(`/offgrid/projects/${projectId}`, engineer)).body.status).toBe('APPROVED');
      await expect(
        t.prisma.system.offgridSnapshot.update({ where: { versionId }, data: { hash: 'x' } }),
      ).rejects.toThrow();
      await expect(
        t.prisma.system.offgridVersion.update({ where: { id: versionId }, data: { design: {} } }),
      ).rejects.toThrow();
      const event = await t.prisma.system.outboxEvent.findFirst({
        where: { type: 'OffGridScenarioApproved', tenantId: a.id },
      });
      expect(event).not.toBeNull();
    });

    it('nova versão copia o desenho; PDF do memorial é gerado; painel conta', async () => {
      const next = await post(`/offgrid/versions/${versionId}/new-version`, engineer);
      expect(next.status).toBe(201);
      expect(next.body.number).toBe(2);
      expect((await post(`/offgrid/versions/${versionId}/new-version`, engineer)).status).toBe(409);
      const pdf = await get(`/offgrid/versions/${versionId}/report.pdf`, engineer)
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        });
      expect(pdf.status).toBe(200);
      expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
      expect((await delete_(next.body.id)).status).toBe(204);
      const dash = await get('/offgrid/dashboard', engineer);
      expect(dash.body.projects.APPROVED).toBe(1);
    });

    const delete_ = (id: string) =>
      t.http.delete(`${API}/offgrid/versions/${id}`).set(bearer(engineer));
  });

  it('recusar devolve o pedido e mantém o histórico', async () => {
    const project = await post('/offgrid/projects', engineer, {
      name: 'Recusado',
      systemType: 'HYBRID',
      site: { latitude: -15.8, longitude: -47.9, state: 'DF' },
    });
    const versionId = project.body.versions[0].id;
    expect(
      (await post(`/offgrid/versions/${versionId}/reject`, lead, { note: 'xxx' })).status,
    ).toBe(409);
    await put(`/offgrid/versions/${versionId}/design`, engineer, { design: design() });
    // Sem o submit possível (inversor não é híbrido), força o estado para testar a recusa.
    await t.prisma.system.$executeRawUnsafe(
      `UPDATE offgrid_versions SET status = 'SUBMITTED', submitted_at = now() WHERE id = '${versionId}'`,
    );
    const rejected = await post(`/offgrid/versions/${versionId}/reject`, lead, {
      note: 'Refazer o banco',
    });
    expect(rejected.body).toMatchObject({ status: 'REJECTED', decisionNote: 'Refazer o banco' });
    expect((await post(`/offgrid/versions/${versionId}/new-version`, engineer)).status).toBe(201);
  });
});
