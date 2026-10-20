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
const moduleSpec = {
  technology: 'MONO_SI',
  pmaxWp: 550,
  vmppV: 41.7,
  imppA: 13.19,
  vocV: 49.7,
  iscA: 13.98,
  betaVocPctPerC: -0.27,
  alphaIscPctPerC: 0.05,
  gammaPmaxPctPerC: -0.34,
  maxSeriesFuseA: 25,
  lengthMm: 2278,
  widthMm: 1134,
};
const surface = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  name: 'Água norte',
  azimuthDegrees: 0,
  tiltDegrees: 20,
  widthM: 10,
  depthM: 5,
  ...over,
});

describe('Solar Engine Studio: projetos e versões (e2e)', () => {
  let t: TestApp;
  let a: SeededTenant;
  let b: SeededTenant;
  let admin: string;
  let adminB: string;
  let seller: string;
  let engineer: string;
  let engineerId: string;
  let lead: string;
  let moduleId = '';
  let draftModuleId = '';

  const get = (path: string, token: string) => t.http.get(`${API}${path}`).set(bearer(token));
  const post = (path: string, token: string, body: object = {}) =>
    t.http.post(`${API}${path}`).set(bearer(token)).send(body);
  const put = (path: string, token: string, body: object) =>
    t.http.put(`${API}${path}`).set(bearer(token)).send(body);

  const newOpportunity = async (withSite: boolean) => {
    const acc = (
      await post('/accounts', seller, { name: `Cliente ${Math.random().toString(36).slice(2, 7)}` })
    ).body;
    const opp = (await post('/opportunities', seller, { accountId: acc.id })).body;
    if (withSite) {
      const site = await t.prisma.system.site.create({
        data: {
          tenantId: a.id,
          accountId: acc.id,
          name: 'Casa',
          city: 'Brasília',
          state: 'DF',
          latitude: -15.78,
          longitude: -47.93,
        },
      });
      await t.prisma.system.opportunity.update({
        where: { id: opp.id },
        data: { siteId: site.id },
      });
    }
    return opp as { id: string; projectCode: string };
  };
  const newRequest = async (opportunityId: string) =>
    t.prisma.system.engineeringRequest.create({
      data: { tenantId: a.id, opportunityId, reason: 'Semáforo amarelo: sombreamento relevante' },
    });

  beforeAll(async () => {
    t = await createTestApp();
    a = await seedTenant(t.prisma, 'eng');
    b = await seedTenant(t.prisma, 'engb');
    admin = await tokenFor(t.http, a.admin);
    adminB = await tokenFor(t.http, b.admin);
    seller = await tokenFor(t.http, a.salesperson);
    const e = await tokenWithRole(t, a, 'ENGINEERING');
    engineer = e.token;
    engineerId = e.id;
    lead = (await tokenWithRole(t, a, 'TECHNICAL_LEAD')).token;
    const m = await post('/catalog/items', engineer, {
      kind: 'MODULE',
      manufacturer: `Fab ${suffix}`,
      model: 'ENG-550',
      spec: moduleSpec,
    });
    moduleId = m.body.id;
    expect((await post(`/catalog/items/${moduleId}/approve`, lead)).status).toBe(200);
    const d = await post('/catalog/items', engineer, {
      kind: 'MODULE',
      manufacturer: `Fab ${suffix}`,
      model: 'ENG-DRAFT',
      spec: moduleSpec,
    });
    draftModuleId = d.body.id;
  });
  afterAll(() => t.close());

  describe('fila de pedidos', () => {
    it('lista com a oportunidade e o cliente; pegar o pedido o atribui; outro engenheiro não pega', async () => {
      const opp = await newOpportunity(true);
      const request = await newRequest(opp.id);
      const list = await get('/engineering/requests?status=PENDING', engineer);
      expect(list.status).toBe(200);
      const item = list.body.find((r: { id: string }) => r.id === request.id);
      expect(item).toMatchObject({
        projectCode: opp.projectCode,
        status: 'PENDING',
        assigneeId: null,
      });
      expect(item.customerName).toMatch(/^Cliente/);

      const taken = await post(`/engineering/requests/${request.id}/assign`, engineer);
      expect(taken.body).toMatchObject({ status: 'IN_PROGRESS', assigneeId: engineerId });
      expect(
        (await get('/engineering/requests?mine=true', engineer)).body.map(
          (r: { id: string }) => r.id,
        ),
      ).toContain(request.id);
      expect((await post(`/engineering/requests/${request.id}/assign`, lead)).status).toBe(409);
      expect((await post(`/engineering/requests/${request.id}/assign`, seller)).status).toBe(403);
    });

    it('cancelar exige motivo e encerra o pedido', async () => {
      const request = await newRequest((await newOpportunity(false)).id);
      expect((await post(`/engineering/requests/${request.id}/cancel`, engineer, {})).status).toBe(
        422,
      );
      const done = await post(`/engineering/requests/${request.id}/cancel`, engineer, {
        reason: 'Cliente desistiu',
      });
      expect(done.body).toMatchObject({ status: 'CANCELLED', resolution: 'Cliente desistiu' });
      expect(
        (await post(`/engineering/requests/${request.id}/cancel`, engineer, { reason: 'de novo' }))
          .status,
      ).toBe(409);
      expect((await post(`/engineering/requests/${request.id}/assign`, engineer)).status).toBe(409);
    });

    it('cada empresa só vê os seus pedidos', async () => {
      expect((await get('/engineering/requests', adminB)).body).toEqual([]);
    });
  });

  it('aprovação técnica encerra o pedido, registra a linha do tempo e reavalia o Guard', async () => {
    const opportunity = await newOpportunity(false);
    const project = await t.prisma.system.engineeringProject.create({
      data: {
        tenantId: a.id,
        code: `ENG-EVENT-${Math.random().toString(36).slice(2, 8)}`,
        name: 'Integração aprovada',
        opportunityId: opportunity.id,
      },
    });
    const request = await t.prisma.system.engineeringRequest.create({
      data: {
        tenantId: a.id,
        opportunityId: opportunity.id,
        projectId: project.id,
        reason: 'Aguardando aprovação técnica',
        status: 'IN_PROGRESS',
      },
    });
    const { EngineeringCrmIntegrationService } =
      await import('../src/products/engine/engineering-crm-integration.service');
    await t.app.get(EngineeringCrmIntegrationService).onApproved({
      id: 'event-test',
      type: 'EngineeringVersionApproved',
      tenantId: a.id,
      actorId: null,
      projectCode: project.code,
      schemaVersion: 1,
      occurredAt: new Date(),
      payload: { projectId: project.id, versionId: 'v-approved', snapshotHash: 'snapshot-hash' },
    });
    expect(
      (await t.prisma.system.engineeringRequest.findUniqueOrThrow({ where: { id: request.id } }))
        .status,
    ).toBe('DONE');
    const timeline = (await get(`/opportunities/${opportunity.id}/timeline`, seller)).body;
    expect(timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'ENGINEERING_APPROVED',
          data: expect.objectContaining({ snapshotHash: 'snapshot-hash' }),
        }),
        expect.objectContaining({ type: 'GUARD_EVALUATED' }),
      ]),
    );
  });

  describe('projeto a partir do pedido', () => {
    it('sem coordenadas pede o local; com o local, cria projeto, versão 1 e liga o pedido (idempotente)', async () => {
      const opp = await newOpportunity(false);
      const request = await newRequest(opp.id);
      const missing = await post(`/engineering/projects/from-request/${request.id}`, engineer);
      expect(missing.status).toBe(400);
      expect(missing.body.code).toBe('SITE_COORDINATES_MISSING');

      const ok = await post(`/engineering/projects/from-request/${request.id}`, engineer, {
        latitude: -15.78,
        longitude: -47.93,
      });
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({
        code: opp.projectCode,
        status: 'IN_PROGRESS',
        requestId: request.id,
        latestVersionNumber: 1,
        latestVersionStatus: 'DRAFT',
        responsibleId: engineerId,
      });
      expect(ok.body.opportunity).toMatchObject({ id: opp.id, projectCode: opp.projectCode });
      const stored = await t.prisma.system.engineeringRequest.findUniqueOrThrow({
        where: { id: request.id },
      });
      expect(stored).toMatchObject({
        status: 'IN_PROGRESS',
        projectId: ok.body.id,
        assigneeId: engineerId,
      });

      const again = await post(`/engineering/projects/from-request/${request.id}`, engineer);
      expect(again.body.id).toBe(ok.body.id);
      const timeline = await t.prisma.system.timelineEvent.findMany({
        where: { opportunityId: opp.id, type: 'ENGINEERING_STARTED' },
      });
      expect(timeline).toHaveLength(1);

      const version = await get(`/engineering/versions/${ok.body.versions[0].id}`, engineer);
      expect(version.body.design.site).toMatchObject({
        latitude: -15.78,
        longitude: -47.93,
        designTminC: null,
      });
      expect(version.body.status).toBe('DRAFT');
    });

    it('usa as coordenadas do local da oportunidade quando existem', async () => {
      const opp = await newOpportunity(true);
      const request = await newRequest(opp.id);
      const res = await post(`/engineering/projects/from-request/${request.id}`, engineer);
      expect(res.status).toBe(200);
      const version = await get(`/engineering/versions/${res.body.versions[0].id}`, engineer);
      expect(version.body.design.site).toMatchObject({
        latitude: -15.78,
        longitude: -47.93,
        city: 'Brasília',
        state: 'DF',
      });
    });

    it('pedido encerrado não vira projeto', async () => {
      const request = await newRequest((await newOpportunity(true)).id);
      await post(`/engineering/requests/${request.id}/cancel`, engineer, { reason: 'Cancelado' });
      expect(
        (await post(`/engineering/projects/from-request/${request.id}`, engineer)).status,
      ).toBe(409);
    });
  });

  describe('projeto avulso, lista e cancelamento', () => {
    it('cria sem CRM com código sequencial; lista com busca e filtro; cancela com motivo', async () => {
      const res = await post('/engineering/projects', engineer, {
        name: 'Usina da fazenda',
        site: { latitude: -23.5, longitude: -46.6, city: 'São Paulo', state: 'sp' },
      });
      expect(res.status).toBe(201);
      expect(res.body.code).toMatch(/^ENG-\d{4}-\d{4}$/);
      expect(res.body).toMatchObject({ opportunity: null, requestId: null, status: 'IN_PROGRESS' });
      const second = await post('/engineering/projects', engineer, {
        name: 'Outra',
        site: { latitude: -1, longitude: -48 },
      });
      expect(second.body.code).not.toBe(res.body.code);

      const list = await get('/engineering/projects?search=fazenda', engineer);
      expect(list.body.data).toHaveLength(1);
      expect(list.body.data[0]).toMatchObject({ name: 'Usina da fazenda', latestVersionNumber: 1 });
      expect(
        (await get('/engineering/projects?mine=true&pageSize=100', engineer)).body.meta.total,
      ).toBeGreaterThanOrEqual(2);

      expect(
        (await post(`/engineering/projects/${second.body.id}/cancel`, engineer, {})).status,
      ).toBe(422);
      const cancelled = await post(`/engineering/projects/${second.body.id}/cancel`, engineer, {
        reason: 'Desistência',
      });
      expect(cancelled.body.status).toBe('CANCELLED');
      expect(
        (await get('/engineering/projects?status=CANCELLED', engineer)).body.data,
      ).toHaveLength(1);
      expect(
        (
          await post(`/engineering/projects/${second.body.id}/cancel`, engineer, {
            reason: 'de novo',
          })
        ).status,
      ).toBe(409);
      expect((await get(`/engineering/projects/${res.body.id}`, adminB)).status).toBe(404);
      expect(
        (
          await post('/engineering/projects', seller, {
            name: 'X',
            site: { latitude: 0, longitude: 0 },
          })
        ).status,
      ).toBe(403);
    });
  });

  describe('versão: desenho, cálculo e congelamento', () => {
    let projectId = '';
    let versionId = '';

    const design = (over: Record<string, unknown> = {}) => ({
      schemaVersion: 1,
      site: { latitude: -15.78, longitude: -47.93 },
      defaultModuleId: moduleId,
      surfaces: [surface()],
      ...over,
    });

    it('prepara o projeto', async () => {
      const p = await post('/engineering/projects', engineer, {
        name: 'Residência Teste',
        site: { latitude: -15.78, longitude: -47.93 },
      });
      projectId = p.body.id;
      versionId = p.body.versions[0].id;
    });

    it('salva o desenho, recalcula no servidor e guarda o hash e os equipamentos usados', async () => {
      const res = await put(`/engineering/versions/${versionId}/design`, engineer, {
        design: design(),
      });
      expect(res.status).toBe(200);
      expect(res.body.results.totals).toMatchObject({ moduleCount: 8, powerKwp: 4.4 });
      expect(res.body.results.layout[0]).toMatchObject({ rows: 1, columns: 8, moduleId });
      expect(res.body.results.algorithmVersions.layout).toBe('layout-1.0.0');
      expect(res.body.fingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(res.body.equipment).toEqual([
        expect.objectContaining({
          id: moduleId,
          manufacturer: `Fab ${suffix}`,
          status: 'APPROVED',
        }),
      ]);
      const rows = await t.prisma.system.engineeringVersionEquipment.findMany({
        where: { versionId },
      });
      expect(rows).toEqual([expect.objectContaining({ equipmentId: moduleId, quantity: 8 })]);

      // O mesmo desenho dá o mesmo hash; mudar o desenho muda.
      const again = await put(`/engineering/versions/${versionId}/design`, engineer, {
        design: design(),
      });
      expect(again.body.fingerprint).toBe(res.body.fingerprint);
      const changed = await put(`/engineering/versions/${versionId}/design`, engineer, {
        design: design({ surfaces: [surface({ widthM: 12 })] }),
      });
      expect(changed.body.fingerprint).not.toBe(res.body.fingerprint);
      expect(changed.body.results.totals.moduleCount).toBe(9); // útil 11,4 m: floor(11,42 / 1,154)
    });

    it('obstáculo próximo gera perda por sombra e a carta solar', async () => {
      const wall = {
        id: 'o1',
        name: 'Prédio vizinho',
        azimuthDegrees: 0,
        distanceM: 8,
        heightM: 8,
        widthM: 40,
      };
      const res = await put(`/engineering/versions/${versionId}/design`, engineer, {
        design: design({ surfaces: [surface({ obstacles: [wall] })] }),
      });
      const shading = res.body.results.shading[0];
      expect(shading.annualLossPct).toBeGreaterThan(5);
      expect(shading.monthlyLossPct[5]).toBeGreaterThan(shading.monthlyLossPct[11]);
      expect(shading.sunPaths).toHaveLength(12);
      expect(shading.obstacles[0]).toMatchObject({ name: 'Prédio vizinho' });
    });

    it('recusa equipamento fora do catálogo aprovado e desenho inválido', async () => {
      const draft = await put(`/engineering/versions/${versionId}/design`, engineer, {
        design: design({ defaultModuleId: draftModuleId }),
      });
      expect(draft.status).toBe(422);
      expect(draft.body.code).toBe('EQUIPMENT_NOT_AVAILABLE');
      expect(draft.body.data.problems[0].message).toMatch(/não está aprovado/);
      const unknown = await put(`/engineering/versions/${versionId}/design`, engineer, {
        design: design({ defaultModuleId: '00000000-0000-4000-8000-000000000000' }),
      });
      expect(unknown.status).toBe(422);
      const bad = await put(`/engineering/versions/${versionId}/design`, engineer, {
        design: design({ surfaces: [surface({ tiltDegrees: 120, azimuthDegrees: 400 })] }),
      });
      expect(bad.status).toBe(422);
      expect(bad.body.details.length).toBeGreaterThan(0);
      expect(
        (await put(`/engineering/versions/${versionId}/design`, seller, { design: design() }))
          .status,
      ).toBe(403);
    });

    it('sem módulo escolhido o cálculo fica pendente, sem erro', async () => {
      const res = await put(`/engineering/versions/${versionId}/design`, engineer, {
        design: {
          schemaVersion: 1,
          site: { latitude: -15.78, longitude: -47.93 },
          surfaces: [surface()],
        },
      });
      expect(res.status).toBe(200);
      expect(res.body.results.pending.map((p: { code: string }) => p.code)).toEqual([
        'MODULE_NOT_SELECTED',
      ]);
      expect(res.body.results.totals.powerKwp).toBeNull();
    });

    it('recalcular não muda o desenho nem o hash', async () => {
      await put(`/engineering/versions/${versionId}/design`, engineer, { design: design() });
      const before = (await get(`/engineering/versions/${versionId}`, engineer)).body;
      const res = await post(`/engineering/versions/${versionId}/recalculate`, engineer);
      expect(res.body.fingerprint).toBe(before.fingerprint);
      expect(res.body.results.totals).toEqual(before.results.totals);
    });

    it('versão enviada é congelada: API e banco recusam edição; nova versão copia o desenho', async () => {
      expect((await post(`/engineering/versions/${versionId}/new-version`, engineer)).status).toBe(
        409,
      ); // ainda é rascunho
      await t.prisma.system.engineeringVersion.update({
        where: { id: versionId },
        data: { status: 'SUBMITTED', submittedAt: new Date() },
      });
      const edit = await put(`/engineering/versions/${versionId}/design`, engineer, {
        design: design(),
      });
      expect(edit.status).toBe(409);
      await expect(
        t.prisma.system.engineeringVersion.update({
          where: { id: versionId },
          data: { design: { x: 1 } },
        }),
      ).rejects.toThrow(/congelada/);
      await expect(
        t.prisma.system.engineeringVersion.delete({ where: { id: versionId } }),
      ).rejects.toThrow();
      await expect(
        t.prisma.system.engineeringVersion.update({
          where: { id: versionId },
          data: { status: 'DRAFT' },
        }),
      ).rejects.toThrow(/transição/);
      // Marcar como desatualizada é permitido.
      await t.prisma.system.engineeringVersion.update({
        where: { id: versionId },
        data: { stale: true, staleReasons: ['teste'] },
      });

      const v2 = await post(`/engineering/versions/${versionId}/new-version`, engineer);
      expect(v2.status).toBe(201);
      expect(v2.body).toMatchObject({ number: 2, status: 'DRAFT', stale: false });
      expect(v2.body.design.surfaces).toHaveLength(1);
      expect((await post(`/engineering/versions/${versionId}/new-version`, engineer)).status).toBe(
        409,
      ); // já há rascunho

      const project = await get(`/engineering/projects/${projectId}`, engineer);
      expect(
        project.body.versions.map((v: { number: number; status: string }) => [v.number, v.status]),
      ).toEqual([
        [2, 'DRAFT'],
        [1, 'SUBMITTED'],
      ]);
      expect(project.body).toMatchObject({ latestVersionNumber: 2, latestVersionStatus: 'DRAFT' });

      expect(
        (await t.http.delete(`${API}/engineering/versions/${versionId}`).set(bearer(engineer)))
          .status,
      ).toBe(409);
      expect(
        (await t.http.delete(`${API}/engineering/versions/${v2.body.id}`).set(bearer(engineer)))
          .status,
      ).toBe(200);
      expect((await get(`/engineering/versions/${v2.body.id}`, engineer)).status).toBe(404);
    });

    it('só uma versão aprovada por projeto (banco) e snapshot imutável', async () => {
      const p = await post('/engineering/projects', engineer, {
        name: 'Dois aprovados',
        site: { latitude: -15, longitude: -47 },
      });
      const v1 = p.body.versions[0].id;
      await t.prisma.system.engineeringVersion.update({
        where: { id: v1 },
        data: { status: 'SUBMITTED' },
      });
      await t.prisma.system.engineeringVersion.update({
        where: { id: v1 },
        data: { status: 'APPROVED' },
      });
      const v2 = (await post(`/engineering/versions/${v1}/new-version`, engineer)).body.id;
      await t.prisma.system.engineeringVersion.update({
        where: { id: v2 },
        data: { status: 'SUBMITTED' },
      });
      await expect(
        t.prisma.system.engineeringVersion.update({
          where: { id: v2 },
          data: { status: 'APPROVED' },
        }),
      ).rejects.toThrow();
      const snap = await t.prisma.system.engineeringSnapshot.create({
        data: {
          tenantId: a.id,
          projectId: p.body.id,
          versionId: v1,
          content: { ok: true },
          hash: 'x',
        },
      });
      await expect(
        t.prisma.system.engineeringSnapshot.update({ where: { id: snap.id }, data: { hash: 'y' } }),
      ).rejects.toThrow(/imutável/);
      await expect(
        t.prisma.system.engineeringSnapshot.delete({ where: { id: snap.id } }),
      ).rejects.toThrow();
    });

    it('outra empresa não acessa a versão', async () => {
      expect((await get(`/engineering/versions/${versionId}`, adminB)).status).toBe(404);
      expect(
        (await put(`/engineering/versions/${versionId}/design`, adminB, { design: design() }))
          .status,
      ).toBe(404);
    });
  });

  describe('inversores, strings e compatibilidade', () => {
    let inverterId = '';
    let versionId = '';
    let publisher: { publishPending: (n: number, tenantId: string) => Promise<unknown> };
    const inverterSpec = {
      topology: 'STRING',
      pAcNomW: 5000,
      pAcMaxW: 5500,
      pDcMaxW: 7500,
      vDcMaxV: 1100,
      vStartV: 180,
      mpptMinV: 140,
      mpptMaxV: 1000,
      mpptCount: 2,
      inputsPerMppt: 2,
      iMaxPerMpptA: 16,
      iscMaxPerMpptA: 22,
      vAcV: 220,
      phases: 1,
    };
    const strings = (n: number, parallel = 1) => ({
      strings: [{ id: `g${n}`, surfaceId: 's1', modulesInSeries: n, parallel }],
    });
    const design = (over: Record<string, unknown> = {}, site: Record<string, unknown> = {}) => ({
      schemaVersion: 1,
      site: { latitude: -15.78, longitude: -47.93, ...site },
      defaultModuleId: moduleId,
      surfaces: [surface({ widthM: 10, depthM: 5 })],
      inverters: [{ id: 'e1', inverterId, mppts: [strings(4), strings(4)] }],
      ...over,
    });

    it('prepara o inversor aprovado, o projeto e o publicador de eventos', async () => {
      const inv = await post('/catalog/items', engineer, {
        kind: 'INVERTER',
        manufacturer: `Inv ${suffix}`,
        model: 'ENG-5K',
        spec: inverterSpec,
        referenceCostCents: 400000,
      });
      inverterId = inv.body.id;
      expect((await post(`/catalog/items/${inverterId}/approve`, lead)).status).toBe(200);
      const p = await post('/engineering/projects', engineer, {
        name: 'Strings',
        site: { latitude: -15.78, longitude: -47.93 },
      });
      versionId = p.body.versions[0].id;
      const { OutboxPublisher } = await import('../src/platform/events/outbox-publisher.service');
      publisher = t.app.get(OutboxPublisher);
    });

    it('inversor fora do catálogo aprovado é recusado', async () => {
      const draft = await post('/catalog/items', engineer, {
        kind: 'INVERTER',
        manufacturer: `Inv ${suffix}`,
        model: 'RASCUNHO',
        spec: inverterSpec,
      });
      const res = await put(`/engineering/versions/${versionId}/design`, engineer, {
        design: design({ inverters: [{ id: 'e1', inverterId: draft.body.id, mppts: [] }] }),
      });
      expect(res.status).toBe(422);
      expect(res.body.data.problems[0].message).toMatch(/não está aprovado/);
      // Um módulo no lugar de inversor também.
      const wrong = await put(`/engineering/versions/${versionId}/design`, engineer, {
        design: design({ inverters: [{ id: 'e1', inverterId: moduleId, mppts: [] }] }),
      });
      expect(wrong.body.data.problems[0].message).toMatch(/não é um inversor/);
    });

    it('sem a temperatura de projeto e sem a regra engine.design, a compatibilidade fica INCOMPLETA (sem erro inventado)', async () => {
      const res = await put(`/engineering/versions/${versionId}/design`, engineer, {
        design: design(),
      });
      expect(res.status).toBe(200);
      const c = res.body.results.compatibility;
      expect(c.status).toBe('INCOMPLETE');
      expect(c.pending.map((x: { code: string }) => x.code)).toEqual([
        'TMIN_MISSING',
        'TMAX_MISSING',
        'RULE_HOT_CELL_IRRADIANCE',
        'RULE_DC_AC_RATIO',
      ]);
      expect(res.body.rules.engineDesign).toEqual({ ref: null, parameters: {} });
      expect(res.body.ruleRefs).toEqual([]);
      const rows = await t.prisma.system.engineeringVersionEquipment.findMany({
        where: { versionId },
      });
      expect(rows.map((r) => [r.kind, r.quantity]).sort()).toEqual([
        ['INVERTER', 1],
        ['MODULE', 8],
      ]);
    });

    it('com a regra ativada pelo responsável técnico e a temperatura informada, calcula e registra a referência da regra', async () => {
      const rule = await post('/rules', lead, {
        key: 'engine.design',
        // Valores de TESTE (não são regra de nenhuma norma).
        definition: {
          parameters: { hotCellIrradianceWm2: 1000, dcAcRatioMin: 0.95, dcAcRatioMax: 1.35 },
        },
        sources: [{ type: 'INTERNAL_POLICY', reference: 'Regra de teste' }],
      });
      expect(rule.status).toBe(201);
      expect(
        (await post(`/rules/${rule.body.id}/activate`, lead, { reviewedBy: 'Eng. Teste' })).status,
      ).toBe(200);

      const res = await put(`/engineering/versions/${versionId}/design`, engineer, {
        design: design(
          {},
          { designTminC: 5, designTmaxAmbientC: 35, designTemperatureSource: 'Teste' },
        ),
      });
      const c = res.body.results.compatibility;
      expect(c.pending).toEqual([]);
      expect(res.body.ruleRefs).toEqual([`${rule.body.id}@${rule.body.version}`]);
      expect(res.body.rules.engineDesign.parameters.dcAcRatioMax).toBe(1.35);
      // 8 módulos em 2 strings de 4 (4,4 kWp) num inversor de 5 kW: tensão baixa (partida), mas válido.
      expect(c.inverters[0].metrics).toMatchObject({
        modulesConnected: 8,
        dcPowerKwp: 4.4,
        dcAcRatio: 0.88,
        mpptUsed: 2,
      });
      expect(c.thermal[0]).toMatchObject({ vocColdV: 52.384, cellHotC: expect.any(Number) });
      expect(
        c.inverters[0].checks.find((x: { code: string }) => x.code === 'DC_AC_RATIO_OUT_OF_POLICY'),
      ).toMatchObject({ outcome: 'FAIL', severity: 'WARNING' });
      expect(c.status).toBe('VALID_WITH_WARNINGS');
      expect(res.body.results.algorithmVersions.compatibility).toBe('compat-1.0.0');
    });

    it('erro físico não impede salvar, mas deixa a versão INVÁLIDA e explicada', async () => {
      const res = await put(`/engineering/versions/${versionId}/design`, engineer, {
        design: design(
          {
            surfaces: [surface({ widthM: 40, depthM: 10 })],
            inverters: [{ id: 'e1', inverterId, mppts: [strings(21)] }],
          },
          { designTminC: 5, designTmaxAmbientC: 35 },
        ),
      });
      expect(res.status).toBe(200);
      const c = res.body.results.compatibility;
      expect(c.status).toBe('INVALID');
      const voc = c.inverters[0].checks.find(
        (x: { code: string }) => x.code === 'VOC_COLD_EXCEEDS_MAX',
      );
      expect(voc).toMatchObject({
        outcome: 'FAIL',
        severity: 'ERROR',
        limit: 1100,
        formula: expect.stringContaining('Voc(Tmín)'),
      });
      expect(voc.value).toBeGreaterThan(1100);
    });

    it('gera configurações do catálogo aprovado: sugestão válida, determinística e com custo', async () => {
      const body = {
        surfaceId: 's1',
        targetKwp: 6.6,
        design: design(
          { surfaces: [surface({ widthM: 20, depthM: 10 })], inverters: [] },
          { designTminC: 5, designTmaxAmbientC: 35 },
        ),
      };
      const res = await post(`/engineering/versions/${versionId}/configurations`, engineer, body);
      expect(res.status).toBe(200);
      expect(res.body.pending).toEqual([]);
      const best = res.body.configurations[0];
      expect(best).toMatchObject({
        moduleId,
        inverterId,
        moduleCount: 12,
        modulesInSeries: 6,
        totalStrings: 2,
        status: 'VALID',
      });
      expect(best.costCents).toBeNull(); // o módulo de teste não tem custo de referência
      expect(best.unpriced.length).toBeGreaterThan(0);
      expect(best.entries[0].inverterId).toBe(inverterId);
      const again = await post(`/engineering/versions/${versionId}/configurations`, engineer, body);
      expect(again.body).toEqual(res.body);

      // Usar a sugestão: a configuração entra no desenho e passa na compatibilidade.
      // A superfície passa a usar só os módulos da configuração (o resto da área fica livre).
      const used = await put(`/engineering/versions/${versionId}/design`, engineer, {
        design: {
          ...body.design,
          surfaces: [{ ...body.design.surfaces[0], moduleCount: best.moduleCount }],
          inverters: best.entries,
        },
      });
      expect(used.body.results.compatibility.status).toBe('VALID');
    });

    it('sem a temperatura de projeto, a geração explica o que falta em vez de chutar', async () => {
      const res = await post(`/engineering/versions/${versionId}/configurations`, engineer, {
        surfaceId: 's1',
        targetKwp: 6.6,
        design: design({ inverters: [] }),
      });
      expect(res.body.configurations).toEqual([]);
      expect(res.body.pending.map((p: { code: string }) => p.code)).toEqual([
        'TMIN_MISSING',
        'TMAX_MISSING',
      ]);
      expect(
        (
          await post(`/engineering/versions/${versionId}/configurations`, seller, {
            surfaceId: 's1',
            targetKwp: 1,
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await post(`/engineering/versions/${versionId}/configurations`, engineer, {
            surfaceId: 's1',
            targetKwp: -1,
          })
        ).status,
      ).toBe(422);
    });

    it('aposentar o módulo marca como desatualizadas as versões que o usam (a aprovada segue intacta)', async () => {
      const m = await post('/catalog/items', engineer, {
        kind: 'MODULE',
        manufacturer: `Fab ${suffix}`,
        model: 'ENG-IMPACTO',
        spec: moduleSpec,
      });
      await post(`/catalog/items/${m.body.id}/approve`, lead);
      const p = await post('/engineering/projects', engineer, {
        name: 'Impacto',
        site: { latitude: -15, longitude: -47 },
      });
      const v = p.body.versions[0].id;
      await put(`/engineering/versions/${v}/design`, engineer, {
        design: {
          schemaVersion: 1,
          site: { latitude: -15, longitude: -47 },
          defaultModuleId: m.body.id,
          surfaces: [surface()],
          inverters: [],
        },
      });
      expect((await get(`/engineering/versions/${v}`, engineer)).body.stale).toBe(false);
      expect((await post(`/catalog/items/${m.body.id}/retire`, lead)).status).toBe(200);
      await publisher.publishPending(500, a.id);
      const after = (await get(`/engineering/versions/${v}`, engineer)).body;
      expect(after.stale).toBe(true);
      expect(after.staleReasons[0]).toMatch(/foi aposentado/);
      // Recalcular o rascunho com o módulo aposentado é recusado: troque o módulo.
      expect((await post(`/engineering/versions/${v}/recalculate`, engineer)).status).toBe(422);
    });

    it('ativar nova versão da regra marca as versões que usavam a anterior', async () => {
      const saved = (await get(`/engineering/versions/${versionId}`, engineer)).body;
      expect(saved.stale).toBe(false);
      const next = await post('/rules', lead, {
        key: 'engine.design',
        definition: {
          parameters: { hotCellIrradianceWm2: 1000, dcAcRatioMin: 0.8, dcAcRatioMax: 1.4 },
        },
        sources: [{ type: 'INTERNAL_POLICY', reference: 'Regra de teste v2' }],
      });
      await post(`/rules/${next.body.id}/activate`, lead, { reviewedBy: 'Eng. Teste' });
      await publisher.publishPending(500, a.id);
      const after = (await get(`/engineering/versions/${versionId}`, engineer)).body;
      expect(after.stale).toBe(true);
      expect(after.staleReasons.join(' ')).toMatch(/engine\.design foi atualizada/);
      // Recalcular usa a regra nova e limpa a marca.
      const recalculated = await post(`/engineering/versions/${versionId}/recalculate`, engineer);
      expect(recalculated.body.stale).toBe(false);
      expect(recalculated.body.rules.engineDesign.ref).toBe(`${next.body.id}@${next.body.version}`);
    });
  });

  describe('proteções, cabos e lista de materiais', () => {
    let versionId = '';
    let inverterId = '';
    let pricedModuleId = '';
    const ids = {} as Record<'fuse' | 'disc' | 'surge' | 'breaker' | 'rcd' | 'dc6' | 'ac6', string>;
    let publisher: { publishPending: (n: number, tenantId: string) => Promise<unknown> };
    const item = async (
      key: keyof typeof ids,
      kind: string,
      model: string,
      spec: object,
      cost: number,
    ) => {
      const res = await post('/catalog/items', engineer, {
        kind,
        manufacturer: `Prot ${suffix}`,
        model,
        spec,
        referenceCostCents: cost,
      });
      expect(res.status).toBe(201);
      expect((await post(`/catalog/items/${res.body.id}/approve`, lead)).status).toBe(200);
      ids[key] = res.body.id;
    };
    const activate = async (key: string, definition: object) => {
      const rule = await post('/rules', lead, {
        key,
        definition,
        sources: [{ type: 'INTERNAL_POLICY', reference: 'Regra de teste' }],
      });
      expect(rule.status).toBe(201);
      expect(
        (await post(`/rules/${rule.body.id}/activate`, lead, { reviewedBy: 'Eng. Teste' })).status,
      ).toBe(200);
      return `${rule.body.id}@${rule.body.version}`;
    };
    // Valores de TESTE (não são regra de nenhuma norma).
    const designParameters = {
      hotCellIrradianceWm2: 1000,
      dcAcRatioMin: 0.5,
      dcAcRatioMax: 1.5,
      maxParallelStringsWithoutFuse: 2,
      fuseMinFactor: 1.25,
      dcSwitchCurrentFactor: 1.25,
      acBreakerFactor: 1.25,
      rcdSensitivityMa: 30,
    };
    const cableParameters = {
      conductorTempC: 70,
      maxVoltageDropDcPct: 1,
      maxVoltageDropAcPct: 3,
      cableCurrentFactorDc: 1.25,
      cableCurrentFactorAc: 1,
    };
    const ampacity = [
      { crossSectionMm2: 4, method: 'A', ampacityA: 40 },
      { crossSectionMm2: 6, method: 'A', ampacityA: 52 },
      { crossSectionMm2: 10, method: 'A', ampacityA: 72 },
    ];
    const design = (over: Record<string, unknown> = {}) => ({
      schemaVersion: 1,
      site: {
        latitude: -15.78,
        longitude: -47.93,
        designTminC: 5,
        designTmaxAmbientC: 35,
        designTemperatureSource: 'Teste',
      },
      defaultModuleId: pricedModuleId,
      surfaces: [surface({ widthM: 20, depthM: 10 })],
      inverters: [
        {
          id: 'e1',
          inverterId,
          mppts: [
            { strings: [{ id: 'g1', surfaceId: 's1', modulesInSeries: 6, parallel: 3 }] },
            { strings: [] },
          ],
        },
      ],
      cables: [
        {
          id: 'c1',
          label: 'String 1',
          kind: 'DC_STRING',
          inverterEntryId: 'e1',
          mpptIndex: 0,
          lengthM: 20,
          count: 3,
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
      ...over,
    });

    it('prepara catálogo aprovado (com custo de referência), regras ativas e projeto', async () => {
      const module = await post('/catalog/items', engineer, {
        kind: 'MODULE',
        manufacturer: `Prot ${suffix}`,
        model: 'MOD-550',
        spec: moduleSpec,
        referenceCostCents: 50000,
      });
      pricedModuleId = module.body.id;
      expect((await post(`/catalog/items/${pricedModuleId}/approve`, lead)).status).toBe(200);
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
      const inv = await post('/catalog/items', engineer, {
        kind: 'INVERTER',
        manufacturer: `Prot ${suffix}`,
        model: 'INV-5K',
        referenceCostCents: 400000,
        spec: {
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
      });
      inverterId = inv.body.id;
      expect((await post(`/catalog/items/${inverterId}/approve`, lead)).status).toBe(200);
      await activate('engine.design', { parameters: designParameters });
      const p = await post('/engineering/projects', engineer, {
        name: 'Proteções',
        site: { latitude: -15.78, longitude: -47.93 },
      });
      versionId = p.body.versions[0].id;
      const { OutboxPublisher } = await import('../src/platform/events/outbox-publisher.service');
      publisher = t.app.get(OutboxPublisher);
    });

    it('sem a regra engine.cables: proteções calculadas, cabos pendentes de regra e a lista sem os cabos escolhidos', async () => {
      const res = await put(`/engineering/versions/${versionId}/design`, engineer, {
        design: design(),
      });
      expect(res.status).toBe(200);
      const r = res.body.results;
      expect(r.protection.status).toBe('VALID');
      const fuse = r.protection.items.find((i: { role: string }) => i.role === 'STRING_FUSE');
      expect(fuse).toMatchObject({ quantity: 3, outcome: 'OK' });
      expect(fuse.chosen.equipmentId).toBe(ids.fuse);
      expect(r.cables.status).toBe('INCOMPLETE');
      expect(r.cables.pending.map((x: { code: string }) => x.code)).toContain(
        'RULE_CONDUCTOR_TEMP',
      );
      expect(res.body.rules.engineCables).toEqual({ ref: null, parameters: {}, tables: {} });
      expect(res.body.candidates.map((c: { id: string }) => c.id)).toEqual(
        expect.arrayContaining([ids.fuse, ids.dc6, ids.ac6]),
      );
    });

    it('com a regra: seleciona proteção e cabo, soma a lista com o custo de referência e sincroniza o impacto', async () => {
      const cablesRef = await activate('engine.cables', {
        parameters: cableParameters,
        tables: { ampacity },
      });
      const res = await put(`/engineering/versions/${versionId}/design`, engineer, {
        design: design(),
      });
      const r = res.body.results;
      expect(res.body.ruleRefs).toHaveLength(2);
      expect(res.body.ruleRefs).toContain(cablesRef);
      expect(res.body.rules.engineCables.ref).toBe(cablesRef);
      expect(r.cables.status).toBe('VALID');
      expect(
        r.cables.runs.map((x: { chosen: { equipmentId: string } }) => x.chosen.equipmentId),
      ).toEqual([ids.dc6, ids.ac6]);
      const bom = r.bom;
      expect(bom.unpricedCount).toBe(0);
      const line = (id: string) =>
        bom.lines.find((l: { equipmentId: string }) => l.equipmentId === id);
      // Fusíveis: 3 strings; cabo CC: 20 m × 3 strings × 2 condutores = 120 m.
      expect(line(ids.fuse)).toMatchObject({
        quantity: 3,
        totalCents: 1800,
        priceSource: 'REFERENCE',
      });
      expect(line(ids.dc6)).toMatchObject({ quantity: 120, unit: 'm', totalCents: 120000 });
      expect(line(ids.ac6)).toMatchObject({ quantity: 20, unit: 'm', totalCents: 16000 });
      expect(line(inverterId)).toMatchObject({ quantity: 1, totalCents: 400000 });
      const rows = await t.prisma.system.engineeringVersionEquipment.findMany({
        where: { versionId },
      });
      expect(rows.find((x) => x.equipmentId === ids.dc6)).toMatchObject({
        kind: 'CABLE',
        quantity: 120,
      });
      expect(rows.find((x) => x.equipmentId === ids.fuse)).toMatchObject({
        kind: 'PROTECTION',
        quantity: 3,
      });

      const report = await get(`/engineering/versions/${versionId}/report.pdf`, engineer);
      expect(report.status).toBe(200);
      expect(report.headers['content-type']).toContain('application/pdf');
      expect(Buffer.isBuffer(report.body)).toBe(true);
      expect(report.body.subarray(0, 4).toString()).toBe('%PDF');

      const singleLinePdf = await get(
        `/engineering/versions/${versionId}/single-line.pdf`,
        engineer,
      );
      expect(singleLinePdf.status).toBe(200);
      expect(singleLinePdf.headers['content-type']).toContain('application/pdf');
      expect(singleLinePdf.body.subarray(0, 4).toString()).toBe('%PDF');
    });

    it('preço vigente da tabela vence o custo de referência', async () => {
      const price = await t.http
        .post(`${API}/catalog/prices/import`)
        .set(bearer(engineer))
        .attach(
          'file',
          Buffer.from(
            `fabricante;modelo;descricao;fornecedor;sku;preco_reais;vigencia_inicio;vigencia_fim\nProt ${suffix};F20;;Distribuidor Teste;;7,50;01/01/2020;\n`,
          ),
          'precos.csv',
        );
      expect(price.status).toBe(200);
      expect(price.body).toMatchObject({ created: 1, errors: [], unmatched: [] });
      const res = await post(`/engineering/versions/${versionId}/recalculate`, engineer);
      const l = res.body.results.bom.lines.find(
        (x: { equipmentId: string }) => x.equipmentId === ids.fuse,
      );
      expect(l).toMatchObject({ unitCostCents: 750, priceSource: 'PRICE_LIST', totalCents: 2250 });
    });

    it('troca manual: item aprovado que serve é aceito; que não serve reprova; cabo rascunho ou de outro tipo é recusado', async () => {
      const small = await post('/catalog/items', engineer, {
        kind: 'PROTECTION',
        manufacturer: `Prot ${suffix}`,
        model: 'S32',
        spec: { protectionKind: 'DISCONNECTOR_DC', ratedCurrentA: 32, ratedVoltageV: 1000 },
      });
      await post(`/catalog/items/${small.body.id}/approve`, lead);
      const bad = await put(`/engineering/versions/${versionId}/design`, engineer, {
        design: design({
          protectionOverrides: [
            {
              id: 'o1',
              role: 'DC_DISCONNECTOR',
              inverterEntryId: 'e1',
              mpptIndex: 0,
              equipmentId: small.body.id,
            },
          ],
        }),
      });
      expect(bad.status).toBe(200);
      expect(bad.body.results.protection.status).toBe('INVALID');
      const disc = bad.body.results.protection.items.find(
        (i: { role: string }) => i.role === 'DC_DISCONNECTOR',
      );
      expect(disc).toMatchObject({ manual: true, outcome: 'OVERRIDE_FAILS' });

      const draft = await post('/catalog/items', engineer, {
        kind: 'CABLE',
        manufacturer: `Prot ${suffix}`,
        model: 'RASCUNHO',
        spec: { cableKind: 'DC_SOLAR', crossSectionMm2: 10 },
      });
      const withDraft = design();
      withDraft.cables[0] = { ...withDraft.cables[0], cableId: draft.body.id } as never;
      const refused = await put(`/engineering/versions/${versionId}/design`, engineer, {
        design: withDraft,
      });
      expect(refused.status).toBe(422);
      expect(refused.body.code).toBe('EQUIPMENT_NOT_AVAILABLE');
      expect(refused.body.data.problems[0].message).toMatch(/não está aprovado/);

      const wrongKind = design();
      wrongKind.cables[0] = { ...wrongKind.cables[0], cableId: ids.fuse } as never;
      const wrong = await put(`/engineering/versions/${versionId}/design`, engineer, {
        design: wrongKind,
      });
      expect(wrong.status).toBe(422);
      expect(wrong.body.data.problems[0].message).toMatch(/não é um cabo/);
    });

    it('nova regra engine.cables deixa a versão desatualizada; aposentar o cabo também', async () => {
      await put(`/engineering/versions/${versionId}/design`, engineer, { design: design() });
      await activate('engine.cables', {
        parameters: { ...cableParameters, maxVoltageDropDcPct: 2 },
        tables: { ampacity },
      });
      await publisher.publishPending(500, a.id);
      const stale = (await get(`/engineering/versions/${versionId}`, engineer)).body;
      expect(stale.stale).toBe(true);
      expect(stale.staleReasons.join(' ')).toMatch(/engine\.cables foi atualizada/);
      await post(`/engineering/versions/${versionId}/recalculate`, engineer);
      await post(`/catalog/items/${ids.ac6}/retire`, lead);
      await publisher.publishPending(500, a.id);
      const after = (await get(`/engineering/versions/${versionId}`, engineer)).body;
      expect(after.stale).toBe(true);
      expect(after.staleReasons.join(' ')).toMatch(/foi aposentado/);
    });
  });

  it('o administrador também enxerga a fila (tem todas as permissões)', async () => {
    expect((await get('/engineering/requests', admin)).status).toBe(200);
  });
});
