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

describe('Engenharia → homologação do CRM (e2e)', () => {
  let t: TestApp;
  let a: SeededTenant;
  let manager: string;
  let engineer: string;
  let owner: string;
  let flow: Flow;
  let versionId = '';
  let opportunityId = '';
  let crmProjectId = '';

  const get = (path: string, token: string) => t.http.get(`${API}${path}`).set(bearer(token));
  const post = (path: string, token: string, body: object = {}) =>
    t.http.post(`${API}${path}`).set(bearer(token)).send(body);

  beforeAll(async () => {
    t = await createTestApp();
    a = await seedTenant(t.prisma, 'hom');
    manager = await tokenFor(t.http, a.manager);
    owner = await tokenFor(t.http, a.owner);
    engineer = (await tokenWithRole(t, a, 'ENGINEERING')).token;
    flow = {
      t,
      tenant: a,
      seller: await tokenFor(t.http, a.salesperson),
      admin: await tokenFor(t.http, a.admin),
    };
    await ensureMarginPolicy(flow, manager);
    const deal = await signedDeal(flow, manager);
    opportunityId = deal.opportunityId;
    crmProjectId = deal.projectId;
    const created = await post('/engineering/projects', engineer, {
      name: 'Projeto para homologar',
      site: { latitude: -15.78, longitude: -47.93 },
    });
    expect(created.status).toBe(201);
    versionId = created.body.versions[0].id;
    const saved = await t.http
      .put(`${API}/engineering/versions/${versionId}/design`)
      .set(bearer(engineer))
      .send({
        design: { schemaVersion: 1, site: { latitude: -15.78, longitude: -47.93 }, surfaces: [] },
      });
    expect(saved.status).toBe(200);
    await t.prisma.system.engineeringProject.update({
      where: { id: created.body.id },
      data: { opportunityId },
    });
  });
  afterAll(() => t.close());

  it('versão que não está aprovada não anexa nada', async () => {
    const res = await post(`/engineering/versions/${versionId}/attach-homologation`, engineer);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VERSION_NOT_APPROVED');
  });

  it('versão aprovada anexa memorial e unifilar aos itens do checklist, sem concluí-los', async () => {
    await t.prisma.system.engineeringVersion.update({
      where: { id: versionId },
      data: { status: 'SUBMITTED' },
    });
    await t.prisma.system.engineeringVersion.update({
      where: { id: versionId },
      data: { status: 'APPROVED' },
    });
    const res = await post(`/engineering/versions/${versionId}/attach-homologation`, engineer);
    expect(res.status).toBe(200);
    expect(res.body.projectId).toBe(crmProjectId);
    expect(res.body.attached.map((x: { code: string }) => x.code).sort()).toEqual([
      'MEMORIAL',
      'SINGLE_LINE',
    ]);

    const project = (await get(`/projects/${crmProjectId}`, owner)).body;
    for (const code of ['MEMORIAL', 'SINGLE_LINE']) {
      const item = project.checklist.find((i: { code: string }) => i.code === code);
      expect(item.documentId).toEqual(expect.any(String));
      expect(item.status).toBe('PENDING');
      expect(item.note).toMatch(/Confira e assine/);
    }
  });

  it('chamar de novo não duplica: itens com documento são ignorados', async () => {
    const res = await post(`/engineering/versions/${versionId}/attach-homologation`, engineer);
    expect(res.status).toBe(200);
    expect(res.body.attached).toEqual([]);
    expect(res.body.skipped.map((x: { code: string }) => x.code).sort()).toEqual([
      'MEMORIAL',
      'SINGLE_LINE',
    ]);
  });

  it('sem projeto de homologação, explica o que falta', async () => {
    const created = await post('/engineering/projects', engineer, {
      name: 'Sem contrato',
      site: { latitude: -15.78, longitude: -47.93 },
    });
    const v = created.body.versions[0].id;
    await t.prisma.system.engineeringProject.update({
      where: { id: created.body.id },
      data: { opportunityId: (await signedlessOpportunity()).id },
    });
    await t.prisma.system.engineeringVersion.update({
      where: { id: v },
      data: { status: 'SUBMITTED' },
    });
    await t.prisma.system.engineeringVersion.update({
      where: { id: v },
      data: { status: 'APPROVED' },
    });
    const res = await post(`/engineering/versions/${v}/attach-homologation`, engineer);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NO_CRM_PROJECT');
  });

  const signedlessOpportunity = async () => {
    const acc = (await post('/accounts', flow.seller, { name: 'Sem contrato' })).body;
    return (await post('/opportunities', flow.seller, { accountId: acc.id })).body as {
      id: string;
    };
  };
});
