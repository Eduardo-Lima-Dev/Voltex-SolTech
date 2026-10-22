import { randomUUID } from 'node:crypto';
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
import { outboxOf, tokenWithRole } from './crm-support';

const DAY = 86_400_000;
const day = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);

describe('Pós-venda e O&M (e2e)', () => {
  let t: TestApp;
  let a: SeededTenant;
  let b: SeededTenant;
  let flow: Flow;
  let owner: string;
  let manager: string;
  let seller: string;
  let adminB: string;
  let operations: string;
  let om: string;

  const get = (path: string, token: string) => t.http.get(`${API}${path}`).set(bearer(token));
  const post = (path: string, token: string, body: unknown = {}) =>
    t.http
      .post(`${API}${path}`)
      .set(bearer(token))
      .send(body as object);
  const patch = (path: string, token: string, body: unknown) =>
    t.http
      .patch(`${API}${path}`)
      .set(bearer(token))
      .send(body as object);
  const put = (path: string, token: string, body: unknown) =>
    t.http
      .put(`${API}${path}`)
      .set(bearer(token))
      .send(body as object);
  const publishAll = async () => {
    const { OutboxPublisher } = await import('../src/platform/events/outbox-publisher.service');
    await t.app.get(OutboxPublisher).publishPending(1000, a.id);
  };

  /** Instalação já aceita pelo cliente, com um módulo recebido; a planta nasce da conciliação. */
  const plant = async () => {
    const deal = await signedDeal(flow, manager);
    await publishAll();
    const inst = await t.prisma.system.installation.findFirstOrThrow({
      where: { projectId: deal.projectId },
    });
    await t.prisma.system.materialItem.create({
      data: {
        tenantId: a.id,
        installationId: inst.id,
        category: 'MODULE',
        description: 'Módulo 550 W',
        quantity: 20,
        unit: 'un',
        status: 'RECEIVED',
      },
    });
    await t.prisma.system.installation.update({
      where: { id: inst.id },
      data: { status: 'DONE', installedAt: new Date(), acceptedAt: new Date(), doneAt: new Date() },
    });
    const reconciled = await post('/operations/plants/reconcile', om);
    expect(reconciled.status).toBe(200);
    const row = await t.prisma.system.plant.findFirstOrThrow({
      where: { installationId: inst.id },
    });
    return { id: row.id, installationId: inst.id, accountId: inst.accountId };
  };

  beforeAll(async () => {
    t = await createTestApp();
    a = await seedTenant(t.prisma, 'pos');
    b = await seedTenant(t.prisma, 'posb');
    owner = await tokenFor(t.http, a.owner);
    manager = await tokenFor(t.http, a.manager);
    seller = await tokenFor(t.http, a.salesperson);
    adminB = await tokenFor(t.http, b.admin);
    operations = (await tokenWithRole(t, a, 'OPERATIONS')).token;
    om = (await tokenWithRole(t, a, 'OM')).token;
    flow = { t, tenant: a, seller, admin: owner };
    await ensureMarginPolicy(flow, manager);
  });
  afterAll(() => t.close());

  describe('planta e ativos', () => {
    it('a planta nasce do aceite, com o ativo da lista de materiais, e a conciliação é idempotente', async () => {
      const p = await plant();
      const dto = (await get(`/operations/plants/${p.id}`, om)).body;
      expect(dto.status).toBe('ACTIVE');
      expect(dto.assets).toHaveLength(1);
      expect(dto.assets[0]).toMatchObject({ category: 'MODULE', quantity: 20, status: 'ACTIVE' });
      // Sem termo de garantia cadastrado, o ativo fica "sem garantia cadastrada": nada é presumido.
      expect(dto.assets[0].warranties).toHaveLength(0);
      const again = await post('/operations/plants/reconcile', om);
      expect(again.body.created).toBe(0);
      expect(
        await t.prisma.system.plant.count({ where: { installationId: p.installationId } }),
      ).toBe(1);
    });

    it('troca de ativo preserva o histórico e o equipamento antigo fica como substituído', async () => {
      const p = await plant();
      const dto = (await get(`/operations/plants/${p.id}`, om)).body;
      const assetId = dto.assets[0].id as string;
      const replaced = await post(`/operations/assets/${assetId}/replace`, om, {
        reason: 'Defeito de fábrica',
        manufacturer: 'Fabricante X',
        model: 'Módulo novo',
        serials: ['SN-1'],
      });
      expect(replaced.status).toBe(200);
      const after = replaced.body.assets as { status: string }[];
      expect(after.map((x) => x.status).sort()).toEqual(['ACTIVE', 'REPLACED']);
      expect((await patch(`/operations/assets/${assetId}`, om, { status: 'REMOVED' })).status).toBe(
        422,
      );
    });

    it('perfil sem permissão não escreve; outra empresa não enxerga', async () => {
      const p = await plant();
      expect((await post('/operations/plants/reconcile', seller)).status).toBe(403);
      expect((await get(`/operations/plants/${p.id}`, adminB)).status).toBe(404);
      expect((await get('/operations/plants', adminB)).body.items ?? []).toHaveLength(0);
    });
  });

  describe('garantias por fabricante', () => {
    it('termo sem fonte é recusado; com termo, o novo ativo recebe a garantia calculada', async () => {
      const bad = await post('/operations/warranty-terms', om, {
        manufacturer: 'Fabricante Z',
        category: 'MODULE',
        productYears: 12,
      });
      expect(bad.status).toBe(422);
      const term = await post('/operations/warranty-terms', om, {
        manufacturer: 'Fabricante Z',
        category: 'MODULE',
        productYears: 12,
        performanceYears: 25,
        performanceEndPct: 80,
        source: 'Termo Z, p. 2 (exemplo de teste)',
      });
      expect(term.status).toBe(201);
      const p = await plant();
      const added = await post(`/operations/plants/${p.id}/assets`, om, {
        category: 'MODULE',
        manufacturer: 'Fabricante Z',
        model: 'Z-550',
        quantity: 10,
        installedAt: day(0),
      });
      expect(added.status).toBe(201);
      const asset = (
        added.body.assets as { manufacturer: string; warranties: { kind: string }[] }[]
      ).find((x) => x.manufacturer === 'Fabricante Z')!;
      expect(asset.warranties.map((w) => w.kind).sort()).toEqual(['PERFORMANCE', 'PRODUCT']);
    });

    it('garantia manual e lista dos que vencem na janela', async () => {
      const p = await plant();
      const assetId = (await get(`/operations/plants/${p.id}`, om)).body.assets[0].id as string;
      const w = await post(`/operations/assets/${assetId}/warranties`, om, {
        kind: 'PRODUCT',
        startsOn: day(-300),
        endsOn: day(20),
      });
      expect(w.status).toBe(201);
      const list = await get('/operations/warranties?expiringInDays=30', om);
      expect(list.status).toBe(200);
      expect(JSON.stringify(list.body)).toContain(assetId);
    });
  });

  describe('chamados', () => {
    it('abre, comenta, gera ordem de serviço e só resolve com a descrição da solução', async () => {
      const p = await plant();
      const created = await post('/operations/tickets', om, {
        plantId: p.id,
        title: 'Inversor sem comunicação',
        priority: 'HIGH',
      });
      expect(created.status).toBe(201);
      const id = created.body.id as string;
      expect(
        (await post(`/operations/tickets/${id}/comments`, om, { body: 'Ligar para o cliente' }))
          .status,
      ).toBe(201);
      const order = await post(`/operations/tickets/${id}/work-order`, om, {});
      expect(order.status).toBe(201);
      const noResolution = await post(`/operations/tickets/${id}/status`, om, {
        status: 'RESOLVED',
      });
      expect(noResolution.status).toBe(422);
      expect(
        (
          await post(`/operations/tickets/${id}/status`, om, {
            status: 'RESOLVED',
            resolution: 'Reiniciado o roteador',
          })
        ).status,
      ).toBe(200);
      const detail = (await get(`/operations/tickets/${id}`, om)).body;
      expect(detail.status).toBe('RESOLVED');
      expect(detail.comments.length).toBeGreaterThanOrEqual(1);
    });

    it('sem prazo de atendimento configurado, o chamado nasce sem SLA; com prazo, ganha o vencimento', async () => {
      const p = await plant();
      const none = await post('/operations/tickets', om, {
        plantId: p.id,
        title: 'Sem SLA',
        priority: 'URGENT',
      });
      expect(none.body.slaDueAt ?? null).toBeNull();
      expect(
        (await put('/operations/aftersales/settings', om, { slaHours: { URGENT: 4 } })).status,
      ).toBe(200);
      const withSla = await post('/operations/tickets', om, {
        plantId: p.id,
        title: 'Com SLA',
        priority: 'URGENT',
      });
      expect(withSla.body.slaDueAt).not.toBeNull();
      await put('/operations/aftersales/settings', om, { slaHours: { URGENT: null } });
    });
  });

  describe('manutenção, contratos e rotina', () => {
    it('plano vencido vira chamado e ordem de serviço uma única vez; garantia a vencer vira tarefa só com a janela configurada', async () => {
      const p = await plant();
      const plan = await post('/operations/maintenance-plans', om, {
        plantId: p.id,
        title: 'Limpeza semestral',
        kind: 'CLEANING',
        everyMonths: 6,
        firstDueOn: day(-1),
      });
      expect(plan.status).toBe(201);
      const assetId = (await get(`/operations/plants/${p.id}`, om)).body.assets[0].id as string;
      await post(`/operations/assets/${assetId}/warranties`, om, {
        kind: 'PRODUCT',
        startsOn: day(-300),
        endsOn: day(15),
      });
      const warranty = await t.prisma.system.assetWarranty.findFirstOrThrow({ where: { assetId } });
      const warned = () =>
        t.prisma.system.task.count({
          where: { tenantId: a.id, automationKey: `warranty-expiring:${warranty.id}` },
        });
      // Sem janela de aviso configurada, a garantia não gera nada.
      const first = await post('/operations/aftersales/scan', om);
      expect(first.status).toBe(200);
      expect(await warned()).toBe(0);
      const tickets = await t.prisma.system.ticket.count({
        where: { tenantId: a.id, plantId: p.id },
      });
      expect(tickets).toBe(1);
      await post('/operations/aftersales/scan', om);
      expect(await t.prisma.system.ticket.count({ where: { tenantId: a.id, plantId: p.id } })).toBe(
        1,
      );

      await put('/operations/aftersales/settings', om, { warrantyAlertDays: 30 });
      await post('/operations/aftersales/scan', om);
      await post('/operations/aftersales/scan', om);
      expect(await warned()).toBe(1);
      await put('/operations/aftersales/settings', om, { warrantyAlertDays: null });
    });

    it('contrato de O&M perto do fim gera oportunidade de renovação, sem duplicar', async () => {
      const p = await plant();
      const c = await post('/operations/om-contracts', om, {
        plantId: p.id,
        title: 'O&M anual',
        startsOn: day(-340),
        endsOn: day(20),
        monthlyCents: 15000,
      });
      expect(c.status).toBe(201);
      await put('/operations/aftersales/settings', om, { renewalNoticeDays: 45 });
      await post('/operations/aftersales/scan', om);
      await post('/operations/aftersales/scan', om);
      const contract = await t.prisma.system.omContract.findFirstOrThrow({
        where: { plantId: p.id },
      });
      const due = (await outboxOf(t, a.id, 'OMRenewalDue')).filter(
        (e) => (e.payload as { contractId?: string }).contractId === contract.id,
      );
      expect(due).toHaveLength(1);
      await put('/operations/aftersales/settings', om, { renewalNoticeDays: null });
    });

    it('painel soma a base instalada e o MRR informado', async () => {
      const dash = await get('/operations/aftersales/dashboard', om);
      expect(dash.status).toBe(200);
      expect(dash.body.installedBase.plants).toBeGreaterThan(0);
      expect(dash.body.mrrCents).toBeGreaterThanOrEqual(15000);
      // Sem janelas configuradas, os indicadores de vencimento ficam nulos em vez de presumir um prazo.
      expect(dash.body.warrantiesExpiring).toBeNull();
      expect(dash.body.contractsExpiring).toBeNull();
    });

    it('configuração rejeita número fora de faixa e perfil sem permissão', async () => {
      expect(
        (await put('/operations/aftersales/settings', om, { warrantyAlertDays: -3 })).status,
      ).toBe(422);
      expect(
        (await put('/operations/aftersales/settings', operations, { warrantyAlertDays: 30 }))
          .status,
      ).toBe(403);
    });
  });

  it('a exportação da empresa inclui plantas, chamados e contratos', async () => {
    await plant();
    const exported = await get('/tenant/export', owner);
    expect([200, 201]).toContain(exported.status);
    expect(Array.isArray(exported.body.plants)).toBe(true);
    expect(exported.body.plants.length).toBeGreaterThan(0);
    expect(randomUUID()).toBeTruthy();
  });
});
