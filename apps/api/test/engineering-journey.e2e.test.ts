import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { solarPosition } from '@voltex/solar-engine';
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
import { ensureMarginPolicy } from './crm-delivery-flow';
import { tokenWithRole } from './crm-support';

const suffix = Math.random().toString(36).slice(2, 7);
const LAT = -15.78;
const LON = -47.93;

/** Série horária de 2025 (céu claro simplificado): a "resposta gravada" da Central, sem depender da internet. */
function recordedSeries() {
  const start = Date.UTC(2025, 0, 1);
  const ghi: number[] = [];
  const dhi: number[] = [];
  const temp: number[] = [];
  for (let i = 0; i < 8760; i++) {
    const at = new Date(start + i * 3_600_000);
    const el = solarPosition({ at, latitudeDegrees: LAT, longitudeDegrees: LON }).elevationDegrees;
    const g = el > 0 ? Math.round(1000 * Math.sin((el * Math.PI) / 180) ** 1.15 * 0.78) : 0;
    ghi.push(g);
    dhi.push(Math.round(g * 0.16));
    temp.push(24);
  }
  return {
    startAt: '2025-01-01T00:00:00Z',
    timeStandard: 'UTC',
    ghiWhM2: ghi,
    dhiWhM2: dhi,
    tempC: temp,
    missingHours: 0,
  };
}

describe('Jornada de engenharia: pedido amarelo → projeto aprovado → cotação (e2e da API)', () => {
  let t: TestApp;
  let a: SeededTenant;
  let flow: Flow;
  let admin: string;
  let manager: string;
  let seller: string;
  let engineer: string;
  let lead: string;
  let opportunityId = '';
  let requestId = '';
  let projectId = '';
  let versionId = '';
  const ids: Record<string, string> = {};

  const get = (path: string, token: string) => t.http.get(`${API}${path}`).set(bearer(token));
  const post = (path: string, token: string, body: object = {}) =>
    t.http.post(`${API}${path}`).set(bearer(token)).send(body);
  const put = (path: string, token: string, body: object) =>
    t.http.put(`${API}${path}`).set(bearer(token)).send(body);
  const publish = async () => {
    const { OutboxPublisher } = await import('../src/platform/events/outbox-publisher.service');
    await t.app.get(OutboxPublisher).publishPending(500, a.id);
  };
  const item = async (key: string, kind: string, model: string, spec: object, cost: number) => {
    const res = await post('/catalog/items', engineer, {
      kind,
      manufacturer: `Jor ${suffix}`,
      model,
      spec,
      referenceCostCents: cost,
    });
    expect([res.status, JSON.stringify(res.body)]).toEqual([201, expect.anything()]);
    expect((await post(`/catalog/items/${res.body.id}/approve`, lead)).status).toBe(200);
    ids[key] = res.body.id;
  };
  const rule = async (key: string, definition: object) => {
    const created = await post('/rules', lead, {
      key,
      definition,
      sources: [{ type: 'INTERNAL_POLICY', reference: 'Regra de teste do roteiro' }],
    });
    expect([key, created.status, JSON.stringify(created.body)]).toEqual([
      key,
      201,
      expect.anything(),
    ]);
    expect(
      (await post(`/rules/${created.body.id}/activate`, lead, { reviewedBy: 'Eng. Teste' })).status,
    ).toBe(200);
  };
  const design = () => ({
    schemaVersion: 1,
    site: {
      latitude: LAT,
      longitude: LON,
      city: 'Brasília',
      state: 'DF',
      designTminC: 5,
      designTmaxAmbientC: 35,
      designTemperatureSource: 'Teste do roteiro',
    },
    defaultModuleId: ids.module,
    surfaces: [
      { id: 's1', name: 'Água norte', azimuthDegrees: 0, tiltDegrees: 20, widthM: 20, depthM: 10 },
    ],
    inverters: [
      {
        id: 'e1',
        inverterId: ids.inverter,
        mppts: [
          { strings: [{ id: 'g1', surfaceId: 's1', modulesInSeries: 6, parallel: 2 }] },
          { strings: [] },
        ],
      },
    ],
    cables: [
      {
        id: 'c1',
        label: 'String',
        kind: 'DC_STRING',
        inverterEntryId: 'e1',
        mpptIndex: 0,
        lengthM: 20,
        count: 2,
        installMethod: 'A',
      },
      {
        id: 'c2',
        label: 'Saída CA',
        kind: 'AC',
        inverterEntryId: 'e1',
        lengthM: 10,
        installMethod: 'A',
      },
    ],
    simulation: {
      source: 'nasa-power',
      year: 2025,
      lossPct: 14,
      inverterEfficiencyPct: 96,
      albedo: 0.2,
      comparisonWarningPct: 15,
    },
    connection: { availablePowerKw: 10, phases: 1, gridZero: false },
    economics: {
      monthlyConsumptionKwh: 900,
      tariffCentsPerKwh: 90,
      tariffSource: 'Fatura de teste do roteiro',
      horizonYears: 25,
      financing: { downPaymentPct: 30, annualRatePct: 18, termMonths: 36, system: 'PRICE' },
      scenarios: [{ name: 'Geração -10%', generationFactor: 0.9 }],
    },
  });

  beforeAll(async () => {
    t = await createTestApp();
    a = await seedTenant(t.prisma, 'jor');
    admin = await tokenFor(t.http, a.admin);
    manager = await tokenFor(t.http, a.manager);
    seller = await tokenFor(t.http, a.salesperson);
    engineer = (await tokenWithRole(t, a, 'ENGINEERING')).token;
    lead = (await tokenWithRole(t, a, 'TECHNICAL_LEAD')).token;
    flow = { t, tenant: a, seller, admin };
    await ensureMarginPolicy(flow, manager);
  });
  afterAll(() => t.close());

  it('prepara a Central (série gravada), o catálogo aprovado e as regras revisadas', async () => {
    const source = await t.prisma.system.dataSource.findUniqueOrThrow({
      where: { key: 'nasa-power' },
    });
    const collection = await t.prisma.system.dataCollection.create({
      data: { sourceId: source.id, status: 'SUCCEEDED', summary: { recorded: true } },
    });
    await t.prisma.system.weatherSeries.create({
      data: {
        sourceId: source.id,
        kind: 'HOURLY',
        latitude: LAT,
        longitude: LON,
        period: '2025',
        summary: {
          ghiKwhM2Day: Array(12).fill(5.5),
          tempMeanC: Array(12).fill(24),
          tempMinC: Array(12).fill(15),
          tempMaxC: Array(12).fill(32),
        },
        payload: gzipSync(Buffer.from(JSON.stringify(recordedSeries()))),
        collectionId: collection.id,
      },
    });
    await item(
      'module',
      'MODULE',
      'M550',
      {
        technology: 'MONO_SI',
        pmaxWp: 550,
        vmppV: 41.7,
        imppA: 13.19,
        vocV: 49.7,
        iscA: 13.98,
        betaVocPctPerC: -0.27,
        alphaIscPctPerC: 0.05,
        gammaPmaxPctPerC: -0.34,
        noctC: 45,
        maxSeriesFuseA: 25,
        lengthMm: 2278,
        widthMm: 1134,
      },
      60000,
    );
    await item(
      'inverter',
      'INVERTER',
      'INV5K',
      {
        topology: 'STRING',
        pAcNomW: 5000,
        pAcMaxW: 5500,
        pDcMaxW: 7500,
        vDcMaxV: 1100,
        vStartV: 180,
        mpptMinV: 140,
        mpptMaxV: 1000,
        mpptCount: 2,
        inputsPerMppt: 3,
        iMaxPerMpptA: 60,
        iscMaxPerMpptA: 80,
        vAcV: 220,
        phases: 1,
        iAcMaxA: 25,
      },
      400000,
    );
    await item(
      'fuse',
      'PROTECTION',
      'F20',
      { protectionKind: 'FUSE_DC', ratedCurrentA: 20, ratedVoltageV: 1000 },
      600,
    );
    await item(
      'disc',
      'PROTECTION',
      'S63',
      { protectionKind: 'DISCONNECTOR_DC', ratedCurrentA: 63, ratedVoltageV: 1000 },
      15000,
    );
    await item(
      'surge',
      'PROTECTION',
      'DPS',
      { protectionKind: 'SURGE_DC', ratedVoltageV: 600 },
      8000,
    );
    await item(
      'breaker',
      'PROTECTION',
      'D32',
      { protectionKind: 'BREAKER_AC', ratedCurrentA: 32, ratedVoltageV: 230, poles: 2 },
      4000,
    );
    await item(
      'rcd',
      'PROTECTION',
      'DR40',
      { protectionKind: 'RCD', ratedCurrentA: 40, sensitivityMa: 30 },
      3500,
    );
    await item(
      'dc6',
      'CABLE',
      'DC6',
      { cableKind: 'DC_SOLAR', crossSectionMm2: 6, voltageRatingV: 1800 },
      1000,
    );
    await item(
      'ac6',
      'CABLE',
      'AC6',
      { cableKind: 'AC', crossSectionMm2: 6, voltageRatingV: 750 },
      800,
    );
    // Valores de TESTE (não são regra de nenhuma norma).
    await rule('engine.design', {
      parameters: {
        hotCellIrradianceWm2: 1000,
        dcAcRatioMin: 0.8,
        dcAcRatioMax: 1.5,
        maxParallelStringsWithoutFuse: 2,
        fuseMinFactor: 1.25,
        dcSwitchCurrentFactor: 1.25,
        acBreakerFactor: 1.25,
        rcdSensitivityMa: 30,
      },
    });
    await rule('engine.cables', {
      parameters: {
        conductorTempC: 70,
        maxVoltageDropDcPct: 1,
        maxVoltageDropAcPct: 3,
        cableCurrentFactorDc: 1.25,
        cableCurrentFactorAc: 1,
      },
      tables: {
        ampacity: [
          { crossSectionMm2: 6, method: 'A', ampacityA: 52 },
          { crossSectionMm2: 10, method: 'A', ampacityA: 72 },
        ],
      },
    });
    await rule('engine.connection', {
      rules: [
        {
          id: 'potencia-acima-da-disponibilizada',
          when: { field: 'plant.acKw', op: '>', valueFrom: 'connection.availableKw' },
          then: {
            severity: 'BLOCKING',
            code: 'CONN_POWER_ABOVE_AVAILABLE',
            message: 'A potência CA excede a disponibilizada.',
            source: 'Regra de teste do roteiro',
          },
        },
      ],
    });
    await rule('engine.economics', { parameters: { compensationFactor: 1 } });
  });

  it('o pedido amarelo entra na fila, o engenheiro o pega e abre o projeto com os dados do CRM', async () => {
    const ready = await buildOpportunity(flow);
    opportunityId = ready.opportunityId;
    const request = await t.prisma.system.engineeringRequest.create({
      data: { tenantId: a.id, opportunityId, reason: 'Semáforo amarelo: sombreamento relevante' },
    });
    requestId = request.id;
    expect((await post(`/engineering/requests/${requestId}/assign`, engineer)).body.status).toBe(
      'IN_PROGRESS',
    );
    const project = await post(`/engineering/projects/from-request/${requestId}`, engineer, {
      latitude: LAT,
      longitude: LON,
    });
    expect(project.status).toBe(200);
    projectId = project.body.id;
    versionId = project.body.versions[0].id;
  });

  it('um desenho com potência acima da disponibilizada é recusado pela regra de conexão e não pode ser enviado', async () => {
    const bad = design();
    bad.connection.availablePowerKw = 3;
    const saved = await put(`/engineering/versions/${versionId}/design`, engineer, { design: bad });
    expect(saved.status).toBe(200);
    expect(saved.body.results.connection.status).toBe('INVALID');
    const submit = await post(`/engineering/versions/${versionId}/submit`, engineer);
    expect(submit.status).toBe(422);
  });

  it('corrigido o desenho, tudo fecha: simulação horária, comparação, economia com financiamento e cenários', async () => {
    const saved = await put(`/engineering/versions/${versionId}/design`, engineer, {
      design: design(),
    });
    expect(saved.status).toBe(200);
    const r = saved.body.results;
    expect(r.pending).toEqual([]);
    expect(r.compatibility.status).toMatch(/^VALID/);
    expect(r.protection.status).toBe('VALID');
    expect(r.cables.status).toBe('VALID');
    expect(r.connection.status).toMatch(/^VALID/);
    expect(r.simulation.energyKwh).toBeGreaterThan(5000);
    expect(r.simulation.monthlyKwh).toHaveLength(12);
    expect(r.simulation.losses.at(-1).id).toBe('AC');
    expect(r.economics.status).toBe('VALID');
    expect(r.economics.financing.system).toBe('PRICE');
    expect(r.economics.scenarios[0].name).toBe('Geração -10%');
    expect(r.economics.sensitivity).toHaveLength(6);
    expect(saved.body.ruleRefs).toHaveLength(4);
  });

  it('envia, o responsável técnico comenta; comentário aberto bloqueia; resolvido, ele aprova', async () => {
    expect((await post(`/engineering/versions/${versionId}/submit`, engineer)).body.status).toBe(
      'SUBMITTED',
    );
    const comment = await post(`/engineering/versions/${versionId}/comments`, lead, {
      section: 'strings',
      text: 'Confirmar a distância dos módulos ao inversor.',
    });
    expect(comment.status).toBe(201);
    const blocked = await post(`/engineering/versions/${versionId}/approve`, lead, {
      note: 'Aprovado após conferência',
    });
    expect(blocked.status).toBe(422);
    expect(blocked.body.message).toMatch(/comentário/);
    const open = (await get(`/engineering/versions/${versionId}/comments`, lead)).body[0];
    expect(
      (await post(`/engineering/versions/${versionId}/comments/${open.id}/resolve`, engineer))
        .status,
    ).toBeLessThan(300);
    const noSignatory = await post(`/engineering/versions/${versionId}/approve`, lead, {
      note: 'Aprovado após conferência',
    });
    expect(noSignatory.status).toBe(422);
    expect(noSignatory.body.message).toMatch(/quem assina/);
    const profile = await t.http
      .patch(`${API}/engineering/projects/${projectId}`)
      .set(bearer(engineer))
      .send({
        signatoryName: 'Maria Souza Engenheira',
        councilType: 'CREA',
        councilRegistration: 'SP-123456',
        councilState: 'sp',
        artType: 'ART',
        artNumber: '2026123456789',
        artIssuedAt: '2026-10-20',
      });
    expect(profile.status).toBe(200);
    expect(profile.body.profile.councilState).toBe('SP');
    const approved = await post(`/engineering/versions/${versionId}/approve`, lead, {
      note: 'Aprovado após conferência',
    });
    expect(approved.status).toBeLessThan(300);
    expect(approved.body.status).toBe('APPROVED');
  });

  it('a versão aprovada fica congelada, com snapshot imutável e entregáveis', async () => {
    const frozen = await put(`/engineering/versions/${versionId}/design`, engineer, {
      design: design(),
    });
    expect(frozen.status).toBe(409);
    const snapshot = await get(`/engineering/projects/${projectId}/snapshot`, engineer);
    expect(snapshot.status).toBe(200);
    expect(snapshot.body.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(snapshot.body.content.version.results.simulation.energyKwh).toBeGreaterThan(5000);
    expect(snapshot.body.content.version.ruleRefs).toHaveLength(4);
    expect(snapshot.body.content.signatory).toMatchObject({
      name: 'Maria Souza Engenheira',
      councilType: 'CREA',
      councilRegistration: 'SP-123456',
      artNumber: '2026123456789',
    });
    expect(snapshot.body.content.rulesApplied).toHaveLength(4);
    expect(snapshot.body.content.declaration).toMatch(/assume a responsabilidade técnica/);
    expect(snapshot.body.content.approvedBy.name).toEqual(expect.any(String));
    expect((await get(`/engineering/versions/${versionId}/report.pdf`, engineer)).status).toBe(200);
    expect((await get(`/engineering/versions/${versionId}/single-line.dxf`, engineer)).status).toBe(
      200,
    );
    snapshotBody = snapshot.body;
  });

  let snapshotBody: { id: string } = { id: '' };

  it('o evento encerra o pedido, grava na linha do tempo e reavalia o Guard', async () => {
    await publish();
    const request = await t.prisma.system.engineeringRequest.findUniqueOrThrow({
      where: { id: requestId },
    });
    expect(request.status).toBe('DONE');
    const timeline = await t.prisma.system.timelineEvent.findMany({
      where: { opportunityId, type: 'ENGINEERING_APPROVED' },
    });
    expect(timeline).toHaveLength(1);
  });

  it('o vendedor importa a lista de materiais aprovada na cotação (com o vínculo do snapshot)', async () => {
    const quote = await post(`/opportunities/${opportunityId}/quotes/from-engineering`, seller, {
      engineeringSnapshotId: snapshotBody.id,
      priceCents: 4_500_000,
    });
    expect(quote.status).toBe(201);
    expect(quote.body.engineeringSnapshotId).toBe(snapshotBody.id);
    const categories = quote.body.items.map((i: { category: string }) => i.category);
    expect(categories).toEqual(expect.arrayContaining(['MODULE', 'INVERTER']));
  });
});
