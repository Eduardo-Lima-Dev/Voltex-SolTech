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

  it('o administrador também enxerga a fila (tem todas as permissões)', async () => {
    expect((await get('/engineering/requests', admin)).status).toBe(200);
  });
});
