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
import { acceptedDeal, ensureMarginPolicy } from './crm-delivery-flow';
import type { Flow } from './crm-flow';
import { outboxOf } from './crm-support';

describe('CRM · Automações (e2e)', () => {
  let t: TestApp;
  let a: SeededTenant;
  let owner: string;
  let admin: string;
  let manager: string;
  let seller: string;
  let svc: import('../src/products/crm/automations/automations.service').AutomationsService;
  let flow: Flow;

  const post = (path: string, token: string, body: unknown = {}) =>
    t.http
      .post(`${API}${path}`)
      .set(bearer(token))
      .send(body as object);
  const tasksOf = (where: Record<string, unknown>) =>
    t.prisma.system.task.findMany({ where: { tenantId: a.id, ...where } });
  const until = async <T>(
    fn: () => Promise<T | null | undefined | false>,
    ms = 8000,
  ): Promise<T> => {
    const end = Date.now() + ms;
    for (;;) {
      const value = await fn();
      if (value) return value;
      if (Date.now() > end) throw new Error('tempo esgotado esperando a automação');
      await new Promise((r) => setTimeout(r, 100));
    }
  };
  const newLead = async (name: string) =>
    (
      await post('/leads', seller, {
        name,
        phone: `(85) 9${String(Math.random()).slice(2, 6)}-${String(Math.random()).slice(2, 6)}`,
        segment: 'RESIDENTIAL',
      })
    ).body;
  const billPending = async (name: string) => {
    const acc = (await post('/accounts', seller, { name })).body;
    const opp = (await post('/opportunities', seller, { accountId: acc.id })).body;
    for (const stage of ['FIRST_CONTACT', 'QUALIFICATION', 'BILL_PENDING'])
      await post(`/opportunities/${opp.id}/stage`, seller, { stage });
    return opp.id as string;
  };
  const backdate = (id: string, hours: number) =>
    t.prisma.system.opportunity.update({
      where: { id },
      data: { stageChangedAt: new Date(Date.now() - hours * 3_600_000) },
    });

  beforeAll(async () => {
    t = await createTestApp();
    const { AutomationsService } =
      await import('../src/products/crm/automations/automations.service');
    svc = t.app.get(AutomationsService);
    a = await seedTenant(t.prisma, 'automation');
    owner = await tokenFor(t.http, a.owner);
    admin = await tokenFor(t.http, a.admin);
    manager = await tokenFor(t.http, a.manager);
    seller = await tokenFor(t.http, a.salesperson);
    flow = { t, tenant: a, seller, admin };
    await ensureMarginPolicy(flow, manager);
  });
  afterAll(() => t.close());

  describe('lead sem primeiro contato no prazo', () => {
    it('gera o alerta uma vez: evento, tarefa para o responsável e marca no lead', async () => {
      const lead = await newLead('Lead Atrasado');
      expect(lead.slaBreached).toBe(false);
      await svc.runScan();
      expect(await tasksOf({ leadId: lead.id })).toHaveLength(0); // ainda no prazo

      await t.prisma.system.lead.update({
        where: { id: lead.id },
        data: { firstContactDueAt: new Date(Date.now() - 60_000) },
      });
      const first = await svc.runScan();
      expect(first.leadAlerts).toBeGreaterThanOrEqual(1);
      const tasks = await tasksOf({ leadId: lead.id });
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toMatchObject({
        origin: 'automation:lead-sla',
        automationKey: `lead-sla:${lead.id}`,
        status: 'OPEN',
      });
      expect(tasks[0]!.assigneeId).toBe(lead.ownerId);
      expect(tasks[0]!.title).toContain('Lead Atrasado');
      expect(
        (await t.prisma.system.lead.findUniqueOrThrow({ where: { id: lead.id } })).slaAlertedAt,
      ).toBeTruthy();
      expect(
        (await outboxOf(t, a.id, 'LeadSlaBreached')).some(
          (e) => (e.payload as { leadId: string }).leadId === lead.id,
        ),
      ).toBe(true);

      await svc.runScan();
      expect(await tasksOf({ leadId: lead.id })).toHaveLength(1);
      expect(
        (await outboxOf(t, a.id, 'LeadSlaBreached')).filter(
          (e) => (e.payload as { leadId: string }).leadId === lead.id,
        ),
      ).toHaveLength(1);
    });

    it('lead já contatado ou desqualificado não gera alerta', async () => {
      const contacted = await newLead('Lead Contatado');
      await post(`/leads/${contacted.id}/status`, seller, { status: 'CONTACTED' }).catch(
        () => undefined,
      );
      await t.prisma.system.lead.update({
        where: { id: contacted.id },
        data: {
          status: 'CONTACTED',
          firstContactAt: new Date(),
          firstContactDueAt: new Date(Date.now() - 60_000),
        },
      });
      await svc.runScan();
      expect(await tasksOf({ leadId: contacted.id })).toHaveLength(0);
    });
  });

  describe('fatura pedida e não recebida', () => {
    it('cria a tarefa de cobrança depois de 24 h, uma vez; fatura recebida dispensa', async () => {
      const waiting = await billPending('Cliente Sem Fatura');
      const received = await billPending('Cliente Com Fatura');
      const { textPdf, SAMPLE_BILL } = await import('./crm-support');
      await t.http
        .post(`${API}/energy-bills`)
        .set(bearer(seller))
        .field('opportunityId', received)
        .attach('file', await textPdf(SAMPLE_BILL), {
          filename: 'f.pdf',
          contentType: 'application/pdf',
        });
      const recent = await billPending('Cliente Recente');

      await svc.runScan();
      expect(await tasksOf({ opportunityId: waiting })).toHaveLength(0); // ainda não passou 24 h

      await backdate(waiting, 25);
      await backdate(received, 25);
      const scan = await svc.runScan();
      expect(scan.billTasks).toBeGreaterThanOrEqual(1);
      const tasks = await tasksOf({ opportunityId: waiting });
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toMatchObject({ origin: 'automation:bill-followup', status: 'OPEN' });
      expect(tasks[0]!.title).toContain('Cliente Sem Fatura');
      expect(await tasksOf({ opportunityId: received })).toHaveLength(0);
      expect(await tasksOf({ opportunityId: recent })).toHaveLength(0);

      await svc.runScan();
      expect(await tasksOf({ opportunityId: waiting })).toHaveLength(1);
      const timeline = (
        await t.http.get(`${API}/opportunities/${waiting}/timeline`).set(bearer(owner))
      ).body;
      expect(
        timeline.some(
          (e: { type: string; summary: string }) =>
            e.type === 'TASK_CREATED' && /Tarefa automática/.test(e.summary),
        ),
      ).toBe(true);
    });

    it('o prazo da empresa vale (billFollowUpHours); voltar à etapa depois gera nova tarefa', async () => {
      const opp = await billPending('Cliente Prazo Maior');
      await t.prisma.system.tenant.update({
        where: { id: a.id },
        data: { settings: { billFollowUpHours: 48 } },
      });
      await backdate(opp, 30);
      await svc.runScan();
      expect(await tasksOf({ opportunityId: opp })).toHaveLength(0);
      await backdate(opp, 50);
      await svc.runScan();
      expect(await tasksOf({ opportunityId: opp })).toHaveLength(1);
      await t.prisma.system.tenant.update({ where: { id: a.id }, data: { settings: {} } });
      // Nova passagem pela etapa (stageChangedAt diferente) → outra chave.
      await backdate(opp, 26);
      await svc.runScan();
      expect(await tasksOf({ opportunityId: opp })).toHaveLength(2);
    });
  });

  describe('proposta visualizada (pela fila BullMQ)', () => {
    it('o cliente abre a proposta e o responsável recebe a tarefa de follow-up, uma vez', async () => {
      // Proposta enviada e ainda não aceita: a primeira abertura é a visualização.
      const deal2 = await acceptedDeal(flow, { accept: false });
      const open = await t.http.get(`${API}/public/proposals/${deal2.token}`);
      expect(open.status).toBe(200);
      const { OutboxPublisher } = await import('../src/platform/events/outbox-publisher.service');
      const tasks = await until(async () => {
        // Outros processos de teste compartilham o outbox: reentrega até aparecer (pelo menos uma vez).
        await t.app.get(OutboxPublisher).publishPending(500, a.id);
        const found = await tasksOf({
          opportunityId: deal2.opportunityId,
          origin: 'automation:proposal-viewed',
        });
        return found.length ? found : null;
      });
      expect(tasks).toHaveLength(1);
      expect(tasks[0]!.automationKey).toMatch(/^proposal-viewed:/);
      expect(tasks[0]!.title).toMatch(/abriu a proposta v1/);
      expect(tasks[0]!.dueAt.getTime()).toBeGreaterThan(Date.now());

      // Reentrega do mesmo evento (pelo menos uma vez): não duplica.
      await svc.proposalViewedTask({
        tenantId: a.id,
        opportunityId: deal2.opportunityId,
        proposalId: deal2.proposalId,
        version: 1,
      });
      expect(
        await tasksOf({ opportunityId: deal2.opportunityId, origin: 'automation:proposal-viewed' }),
      ).toHaveLength(1);
    });

    it('a varredura também roda pela fila (sem chamada direta)', async () => {
      const lead = await newLead('Lead Pela Fila');
      await t.prisma.system.lead.update({
        where: { id: lead.id },
        data: { firstContactDueAt: new Date(Date.now() - 60_000) },
      });
      await svc.enqueueScan();
      const tasks = await until(async () => {
        const found = await tasksOf({ leadId: lead.id });
        return found.length ? found : null;
      });
      expect(tasks).toHaveLength(1);
      const counts = await svc.counts();
      expect(counts?.failed ?? 0).toBe(0);
    });
  });
});
