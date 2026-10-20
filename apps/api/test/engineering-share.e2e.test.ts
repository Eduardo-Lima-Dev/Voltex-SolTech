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

describe('Engenharia: comparação de versões e relatório público (e2e)', () => {
  let t: TestApp;
  let a: SeededTenant;
  let b: SeededTenant;
  let engineer: string;
  let adminB: string;
  let seller: string;
  let projectId = '';
  let v1 = '';
  let v2 = '';
  let other = '';
  let snapshotId = '';

  const get = (path: string, token: string) => t.http.get(`${API}${path}`).set(bearer(token));
  const post = (path: string, token: string, body: object = {}) =>
    t.http.post(`${API}${path}`).set(bearer(token)).send(body);
  const design = (tilt: number, extra: Record<string, unknown> = {}) => ({
    schemaVersion: 1,
    site: { latitude: -15.78, longitude: -47.93, city: 'Brasília', state: 'DF' },
    surfaces: [
      { id: 's1', name: 'Norte', azimuthDegrees: 0, tiltDegrees: tilt, widthM: 10, depthM: 5 },
    ],
    economics: { monthlyConsumptionKwh: 400 },
    ...extra,
  });

  beforeAll(async () => {
    t = await createTestApp();
    a = await seedTenant(t.prisma, 'shr');
    b = await seedTenant(t.prisma, 'shrb');
    engineer = (await tokenWithRole(t, a, 'ENGINEERING')).token;
    seller = await tokenFor(t.http, a.salesperson);
    adminB = await tokenFor(t.http, b.admin);
    const project = await t.prisma.system.engineeringProject.create({
      data: {
        tenantId: a.id,
        code: `ENG-SHR-${Math.random().toString(36).slice(2, 7)}`,
        name: 'Casa da Maria',
      },
    });
    projectId = project.id;
    const mk = (
      number: number,
      tilt: number,
      status: 'DRAFT' | 'APPROVED',
      modules: number,
      kwp: number,
    ) =>
      t.prisma.system.engineeringVersion.create({
        data: {
          tenantId: a.id,
          projectId,
          number,
          status,
          design: design(tilt),
          results: {
            totals: { moduleCount: modules, powerKwp: kwp, moduleAreaM2: modules * 2.6 },
            simulation: {
              energyKwh: kwp * 1500,
              performanceRatio: 0.8,
              monthlyKwh: Array.from({ length: 12 }, () => kwp * 125),
            },
            economics: {
              status: 'VALID',
              capexCents: 3_000_000,
              firstYearSavingsCents: 400_000,
              accumulatedSavingsCents: 12_000_000,
              simplePaybackYears: 6.2,
              horizonYears: 25,
              npvCents: 5_000_000,
            },
            bom: { totalCents: 3_000_000, lines: [] },
          },
        },
      });
    v1 = (await mk(1, 20, 'DRAFT', 8, 4.4)).id;
    v2 = (await mk(2, 25, 'APPROVED', 10, 5.5)).id;
    const snap = await t.prisma.system.engineeringSnapshot.create({
      data: {
        tenantId: a.id,
        projectId,
        versionId: v2,
        hash: 'h',
        content: {
          version: {
            design: design(25),
            results: (
              await t.prisma.system.engineeringVersion.findUniqueOrThrow({ where: { id: v2 } })
            ).results,
          },
          approvedAt: '2026-10-20T12:00:00.000Z',
        },
      },
    });
    snapshotId = snap.id;
    const otherProject = await t.prisma.system.engineeringProject.create({
      data: {
        tenantId: a.id,
        code: `ENG-SHR2-${Math.random().toString(36).slice(2, 7)}`,
        name: 'Outro',
      },
    });
    other = (
      await t.prisma.system.engineeringVersion.create({
        data: {
          tenantId: a.id,
          projectId: otherProject.id,
          number: 1,
          design: design(10),
          results: {},
        },
      })
    ).id;
  });
  afterAll(() => t.close());

  describe('comparação de versões', () => {
    it('mostra o que mudou no desenho e nos indicadores', async () => {
      const res = await get(`/engineering/versions/${v2}/compare?with=${v1}`, engineer);
      expect(res.status).toBe(200);
      expect(res.body.from).toMatchObject({ number: 1, status: 'DRAFT' });
      expect(res.body.to).toMatchObject({ number: 2, status: 'APPROVED' });
      expect(res.body.designChanges).toEqual([
        {
          section: 'surfaces',
          path: 'surfaces[s1].tiltDegrees',
          kind: 'CHANGED',
          before: 20,
          after: 25,
        },
      ]);
      const metrics = res.body.resultChanges.map((c: { metric: string }) => c.metric);
      expect(metrics).toEqual(expect.arrayContaining(['modules', 'powerKwp', 'energyKwh']));
      expect(
        res.body.resultChanges.find((c: { metric: string }) => c.metric === 'modules'),
      ).toMatchObject({
        before: 8,
        after: 10,
        delta: 2,
      });
    });

    it('recusa versões de projetos diferentes, exige permissão e isola empresas', async () => {
      const cross = await get(`/engineering/versions/${v2}/compare?with=${other}`, engineer);
      expect(cross.status).toBe(422);
      expect(cross.body.code).toBe('VERSIONS_FROM_DIFFERENT_PROJECTS');
      expect((await get(`/engineering/versions/${v2}/compare?with=${v1}`, seller)).status).toBe(
        403,
      );
      expect((await get(`/engineering/versions/${v2}/compare?with=${v1}`, adminB)).status).toBe(
        404,
      );
    });
  });

  describe('relatório público para o cliente', () => {
    let token = '';
    let linkId = '';

    it('só a versão aprovada gera link', async () => {
      const res = await post(`/engineering/versions/${v1}/share-links`, engineer, { validDays: 7 });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('VERSION_NOT_APPROVED');
    });

    it('cria o link (token aparece uma vez) e o cliente abre sem login, sem custos nem margem', async () => {
      const res = await post(`/engineering/versions/${v2}/share-links`, engineer, { validDays: 7 });
      expect(res.status).toBe(201);
      token = res.body.token;
      linkId = res.body.id;
      expect(res.body.path).toBe(`/r/${token}`);
      const stored = await t.prisma.system.engineeringShareLink.findUniqueOrThrow({
        where: { id: linkId },
      });
      expect(stored.tokenHash).not.toBe(token);
      expect(stored.snapshotId).toBe(snapshotId);

      const open = await t.http.get(`${API}/public/engineering/${token}`);
      expect(open.status).toBe(200);
      expect(open.body).toMatchObject({
        projectName: 'Casa da Maria',
        city: 'Brasília',
        state: 'DF',
        powerKwp: 5.5,
        moduleCount: 10,
        annualEnergyKwh: 8250,
        monthlyConsumptionKwh: 400,
        economics: { firstYearSavingsCents: 400_000, simplePaybackYears: 6.2, horizonYears: 25 },
      });
      expect(open.body.monthlyKwh).toHaveLength(12);
      const raw = JSON.stringify(open.body);
      expect(raw).not.toMatch(/capex|npv|bom|margin|cost/i);
      const after = (await get(`/engineering/versions/${v2}/share-links`, engineer)).body;
      expect(after[0]).toMatchObject({ id: linkId, viewCount: 1, revokedAt: null });
    });

    it('token inválido, link revogado e link vencido não abrem', async () => {
      expect((await t.http.get(`${API}/public/engineering/token-que-nao-existe`)).status).toBe(404);
      const second = await post(`/engineering/versions/${v2}/share-links`, engineer, {});
      await t.prisma.system.engineeringShareLink.update({
        where: { id: second.body.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      expect((await t.http.get(`${API}/public/engineering/${second.body.token}`)).status).toBe(410);

      const revoked = await post(`/engineering/share-links/${linkId}/revoke`, engineer);
      expect(revoked.status).toBe(200);
      expect(revoked.body.revokedAt).not.toBeNull();
      expect((await t.http.get(`${API}/public/engineering/${token}`)).status).toBe(404);
    });

    it('vendedor não cria link e outra empresa não revoga', async () => {
      expect((await post(`/engineering/versions/${v2}/share-links`, seller, {})).status).toBe(403);
      expect((await post(`/engineering/share-links/${linkId}/revoke`, adminB)).status).toBe(404);
    });
  });
});
