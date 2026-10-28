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
import { ensureMarginPolicy, signedDeal, type SignedDeal } from './crm-delivery-flow';
import type { Flow } from './crm-flow';
import { tokenWithRole } from './crm-support';

/**
 * Carteira do vendedor (Fase 12.0, ADR-0028): dois vendedores na mesma empresa. Cada um só enxerga o que é dele;
 * a gestão enxerga tudo; o SDR enxerga os leads e as contas dele e os sem responsável.
 */
describe('Carteira do vendedor (e2e)', () => {
  let t: TestApp;
  let a: SeededTenant;
  let b: SeededTenant;
  let manager: string;
  let admin: string;
  let adminOther: string;
  let sdr: string;
  let sellerA: { token: string; id: string };
  let sellerB: { token: string; id: string };
  let dealA: SignedDeal;
  let dealB: SignedDeal;
  let leadA = '';
  let leadB = '';
  let taskA = '';
  let billA = '';

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
  const ids = (res: { body: { data?: { id: string }[] } }) =>
    (res.body.data ?? []).map((r) => r.id);

  beforeAll(async () => {
    t = await createTestApp();
    a = await seedTenant(t.prisma, 'carteira');
    b = await seedTenant(t.prisma, 'carteirab');
    manager = await tokenFor(t.http, a.manager);
    admin = await tokenFor(t.http, a.admin);
    adminOther = await tokenFor(t.http, b.admin);
    sdr = await tokenFor(t.http, a.sdr);
    sellerA = await tokenWithRole(t, a, 'SALESPERSON');
    sellerB = await tokenWithRole(t, a, 'SALESPERSON');
    const flowA: Flow = { t, tenant: a, seller: sellerA.token, admin };
    const flowB: Flow = { t, tenant: a, seller: sellerB.token, admin };
    await ensureMarginPolicy(flowA, manager);
    dealA = await signedDeal(flowA, manager, { name: 'Cliente da Carteira A' });
    dealB = await signedDeal(flowB, manager, { name: 'Cliente da Carteira B' });

    leadA = (await post('/leads', sellerA.token, { name: 'Lead A', phone: '(85) 98111-0001' })).body
      .id;
    leadB = (await post('/leads', sellerB.token, { name: 'Lead B', phone: '(85) 98111-0002' })).body
      .id;
    taskA = (
      await post('/tasks', sellerA.token, {
        title: 'Tarefa da carteira A',
        dueAt: '2026-12-01',
        opportunityId: dealA.opportunityId,
      })
    ).body.id;
    const bills = await get('/energy-bills', sellerA.token);
    billA = (bills.body as { id: string }[])[0]?.id ?? '';
  });
  afterAll(() => t.close());

  describe('o vendedor só vê o que é dele', () => {
    it('leads: lista só os seus; ler, editar e excluir o de outro dá 404', async () => {
      expect(ids(await get('/leads?pageSize=100', sellerA.token))).toEqual(
        expect.arrayContaining([leadA]),
      );
      expect(ids(await get('/leads?pageSize=100', sellerA.token))).not.toContain(leadB);
      expect((await get(`/leads/${leadB}`, sellerA.token)).status).toBe(404);
      expect((await patch(`/leads/${leadB}`, sellerA.token, { notes: 'x' })).status).toBe(404);
      expect((await t.http.delete(`${API}/leads/${leadB}`).set(bearer(sellerA.token))).status).toBe(
        404,
      );
      expect((await get(`/leads/${leadA}`, sellerA.token)).status).toBe(200);
    });

    it('oportunidades: lista, quadro e leitura por id só da carteira', async () => {
      const list = await get('/opportunities?pageSize=100', sellerA.token);
      expect(ids(list)).toContain(dealA.opportunityId);
      expect(ids(list)).not.toContain(dealB.opportunityId);
      const board = JSON.stringify((await get('/opportunities/board', sellerA.token)).body);
      expect(board).toContain(dealA.opportunityId);
      expect(board).not.toContain(dealB.opportunityId);
      for (const path of [
        `/opportunities/${dealB.opportunityId}`,
        `/opportunities/${dealB.opportunityId}/timeline`,
        `/opportunities/${dealB.opportunityId}/guard`,
        `/opportunities/${dealB.opportunityId}/quotes`,
        `/opportunities/${dealB.opportunityId}/proposals`,
        `/opportunities/${dealB.opportunityId}/contracts`,
      ])
        expect((await get(path, sellerA.token)).status, path).toBe(404);
      expect(
        (
          await post(`/opportunities/${dealB.opportunityId}/stage`, sellerA.token, {
            stage: 'FIRST_CONTACT',
          })
        ).status,
      ).toBe(404);
    });

    it('contas, contatos, imóveis e unidades seguem a conta', async () => {
      expect(ids(await get('/accounts?pageSize=100', sellerA.token))).toContain(dealA.accountId);
      expect(ids(await get('/accounts?pageSize=100', sellerA.token))).not.toContain(
        dealB.accountId,
      );
      expect((await get(`/accounts/${dealB.accountId}`, sellerA.token)).status).toBe(404);
      expect(
        (await patch(`/accounts/${dealB.accountId}`, sellerA.token, { notes: 'invasão' })).status,
      ).toBe(404);
      expect(
        (await post(`/accounts/${dealB.accountId}/contacts`, sellerA.token, { name: 'Intruso' }))
          .status,
      ).toBe(404);
      expect((await get(`/accounts/${dealA.accountId}`, sellerA.token)).status).toBe(200);
    });

    it('cotação, proposta, contrato e projeto: só os das oportunidades dele', async () => {
      for (const path of [
        `/quotes/${dealB.quoteId}`,
        `/proposals/${dealB.proposalId}`,
        `/contracts/${dealB.contractId}`,
        `/projects/${dealB.projectId}`,
      ])
        expect((await get(path, sellerA.token)).status, path).toBe(404);
      for (const path of [
        `/quotes/${dealA.quoteId}`,
        `/proposals/${dealA.proposalId}`,
        `/contracts/${dealA.contractId}`,
        `/projects/${dealA.projectId}`,
      ])
        expect((await get(path, sellerA.token)).status, path).toBe(200);
      const projects = await get('/projects?pageSize=100', sellerA.token);
      expect(ids(projects)).toEqual([dealA.projectId]);
    });

    it('tarefas e faturas', async () => {
      expect(ids(await get('/tasks?pageSize=100', sellerA.token))).toContain(taskA);
      expect(ids(await get('/tasks?pageSize=100', sellerB.token))).not.toContain(taskA);
      expect((await get(`/tasks/${taskA}`, sellerB.token)).status).toBe(404);
      if (billA) {
        expect((await get(`/energy-bills/${billA}`, sellerB.token)).status).toBe(404);
        expect((await get(`/energy-bills/${billA}`, sellerA.token)).status).toBe(200);
      }
    });

    it('o projeto de outra carteira não aparece nem pela rota da oportunidade', async () => {
      const res = await get(`/opportunities/${dealB.opportunityId}/project`, sellerA.token);
      expect(res.status === 404 || res.body === null || res.body?.id === undefined).toBe(true);
    });

    it('painel comercial é da gestão: o vendedor continua sem acesso', async () => {
      expect((await get('/dashboard/commercial', sellerA.token)).status).toBe(403);
      const all = (await get('/dashboard/commercial', manager)).body;
      expect(all.totalLeads).toBeGreaterThanOrEqual(2);
    });

    it('não passa a oportunidade, o lead nem a conta para outra pessoa', async () => {
      for (const [path, body] of [
        [`/leads/${leadA}`, { ownerId: sellerB.id }],
        [`/opportunities/${dealA.opportunityId}`, { ownerId: sellerB.id }],
        [`/accounts/${dealA.accountId}`, { ownerId: sellerB.id }],
      ] as const)
        expect((await patch(path, sellerA.token, body)).status, path).toBe(403);
      expect(
        (await post('/leads', sellerA.token, { name: 'Para o colega', ownerId: sellerB.id }))
          .status,
      ).toBe(403);
    });

    it('não alcança documentos de outras carteiras pela API de documentos', async () => {
      const own = await get('/documents?pageSize=100', sellerA.token);
      const all = await get('/documents?pageSize=100', admin);
      expect(own.status).toBe(200);
      expect((own.body.meta?.total ?? 0) <= (all.body.meta?.total ?? 0)).toBe(true);
      const foreign = (all.body.data as { id: string; uploadedById: string | null }[]).find(
        (d) => d.uploadedById && d.uploadedById !== sellerA.id,
      );
      if (foreign) expect((await get(`/documents/${foreign.id}`, sellerA.token)).status).toBe(404);
    });
  });

  describe('a gestão enxerga tudo e redistribui', () => {
    it('gestor, administrador e proprietário veem as duas carteiras', async () => {
      for (const token of [manager, admin]) {
        const opps = ids(await get('/opportunities?pageSize=100', token));
        expect(opps).toEqual(expect.arrayContaining([dealA.opportunityId, dealB.opportunityId]));
        const leads = ids(await get('/leads?pageSize=100', token));
        expect(leads).toEqual(expect.arrayContaining([leadA, leadB]));
        const accounts = ids(await get('/accounts?pageSize=100', token));
        expect(accounts).toEqual(expect.arrayContaining([dealA.accountId, dealB.accountId]));
      }
    });

    it('gestor passa a oportunidade e a conta para outro vendedor, que então as enxerga', async () => {
      expect((await get(`/accounts/${dealB.accountId}`, sellerA.token)).status).toBe(404);
      expect(
        (await patch(`/accounts/${dealB.accountId}`, manager, { ownerId: sellerA.id })).status,
      ).toBe(200);
      expect((await patch(`/leads/${leadB}`, manager, { ownerId: sellerA.id })).status).toBe(200);
      expect((await get(`/accounts/${dealB.accountId}`, sellerA.token)).status).toBe(200);
      expect((await get(`/leads/${leadB}`, sellerA.token)).status).toBe(200);
      // O novo dono vê; o antigo deixa de ver o lead (a conta segue visível pela oportunidade dele).
      expect((await get(`/leads/${leadB}`, sellerB.token)).status).toBe(404);
      expect((await patch(`/leads/${leadB}`, manager, { ownerId: sellerB.id })).status).toBe(200);
    });

    it('a conta nova nasce na carteira de quem a cria e o filtro de responsável funciona para a gestão', async () => {
      const created = await post('/accounts', sellerA.token, { name: 'Conta nova do A' });
      expect(created.body.ownerId).toBe(sellerA.id);
      const filtered = await get(`/accounts?ownerId=${sellerA.id}&pageSize=100`, manager);
      expect(ids(filtered)).toContain(created.body.id);
    });
  });

  describe('duplicidade não vaza a carteira dos outros', () => {
    it('conta com o mesmo documento de outra carteira é barrada sem dizer de quem é', async () => {
      const document = '529.982.247-25';
      expect(
        (await post('/accounts', sellerB.token, { name: 'Documento do B', document })).status,
      ).toBe(201);
      const dup = await post('/accounts', sellerA.token, { name: 'Outro nome', document });
      expect(dup.status).toBe(409);
      expect(dup.body.code).toBe('DUPLICATE_ACCOUNT');
      expect(JSON.stringify(dup.body)).not.toContain('Documento do B');
      expect(dup.body.data?.matchedAccountId).toBeUndefined();
    });
  });

  describe('SDR', () => {
    it('vê os leads dele e os sem responsável, não os de vendedores', async () => {
      const mine = (await post('/leads', sdr, { name: 'Lead do SDR', phone: '(85) 98111-0003' }))
        .body.id;
      const open = await t.prisma.system.lead.create({
        data: {
          tenantId: a.id,
          name: 'Lead sem responsável',
          source: 'FORM',
          ownerId: null,
          firstContactDueAt: new Date(),
        },
      });
      const list = ids(await get('/leads?pageSize=100', sdr));
      expect(list).toEqual(expect.arrayContaining([mine, open.id]));
      expect(list).not.toContain(leadA);
      expect((await get(`/leads/${leadA}`, sdr)).status).toBe(404);
    });

    it('distribui: cria o lead já na carteira do vendedor, e depois o vendedor o enxerga', async () => {
      const lead = await post('/leads', sdr, {
        name: 'Distribuído pelo SDR',
        phone: '(85) 98111-0004',
        ownerId: sellerA.id,
      });
      expect(lead.status).toBe(201);
      expect((await get(`/leads/${lead.body.id}`, sellerA.token)).status).toBe(200);
      expect((await get(`/leads/${lead.body.id}`, sellerB.token)).status).toBe(404);
    });

    it('não enxerga oportunidades nem cotações', async () => {
      expect((await get('/opportunities', sdr)).status).toBe(403);
      expect((await get(`/quotes/${dealA.quoteId}`, sdr)).status).toBe(403);
    });
  });

  describe('isolamento entre empresas continua valendo', () => {
    it('administrador de outra empresa não vê nenhuma das carteiras', async () => {
      expect((await get(`/leads/${leadA}`, adminOther)).status).toBe(404);
      expect((await get(`/opportunities/${dealA.opportunityId}`, adminOther)).status).toBe(404);
      expect(ids(await get('/accounts?pageSize=100', adminOther))).not.toContain(dealA.accountId);
    });
  });

  describe('rotinas sem usuário não são restritas', () => {
    it('a rotina de eventos enxerga todas as carteiras (sem perfil no contexto)', async () => {
      const { OutboxPublisher } = await import('../src/platform/events/outbox-publisher.service');
      await t.app.get(OutboxPublisher).publishPending(1000, a.id);
      const count = await t.prisma.system.opportunity.count({ where: { tenantId: a.id } });
      expect(count).toBeGreaterThanOrEqual(2);
    });
  });
});
