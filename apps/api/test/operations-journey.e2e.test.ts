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
import { ensureMarginPolicy, signedDeal, type SignedDeal } from './crm-delivery-flow';
import type { Flow } from './crm-flow';
import { tokenWithRole } from './crm-support';

const HOUR = 3_600_000;
const iso = (h: number) => new Date(Date.now() + h * HOUR).toISOString();
const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const SRC = 'Roteiro da jornada de execução (valores de exemplo)';

/**
 * Jornada ponta a ponta da Fase 11: contrato assinado → homologação → materiais → campo → comissionamento →
 * aceite pelo portal → planta → monitoramento → chamado por desvio → financeiro. Um cliente, uma sequência.
 */
describe('Jornada de execução ponta a ponta (e2e)', () => {
  let t: TestApp;
  let a: SeededTenant;
  let flow: Flow;
  let owner: string;
  let manager: string;
  let operations: string;
  let lead: string;
  let om: string;
  let finance: string;
  let installer: { token: string; id: string };
  let crewId: string;
  let deal: SignedDeal;
  let installationId: string;
  let portalCookie = '';
  let plantId = '';

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
  const publishAll = async () => {
    const { OutboxPublisher } = await import('../src/platform/events/outbox-publisher.service');
    await t.app.get(OutboxPublisher).publishPending(1000, a.id);
  };
  const portal = (path: string) => t.http.get(`${API}/portal${path}`).set('Cookie', portalCookie);

  beforeAll(async () => {
    t = await createTestApp();
    a = await seedTenant(t.prisma, 'jornada');
    owner = await tokenFor(t.http, a.owner);
    manager = await tokenFor(t.http, a.manager);
    operations = (await tokenWithRole(t, a, 'OPERATIONS')).token;
    lead = (await tokenWithRole(t, a, 'TECHNICAL_LEAD')).token;
    om = (await tokenWithRole(t, a, 'OM')).token;
    finance = (await tokenWithRole(t, a, 'FINANCE')).token;
    installer = await tokenWithRole(t, a, 'INSTALLER');
    flow = { t, tenant: a, seller: await tokenFor(t.http, a.salesperson), admin: owner };
    await ensureMarginPolicy(flow, manager);
    crewId = (
      await post('/operations/crews', operations, {
        name: 'Equipe da jornada',
        memberIds: [installer.id],
      })
    ).body.id;

    // A regra do responsável técnico precisa estar ativa ANTES de a instalação terminar: é nesse momento que o
    // registro do comissionamento nasce, com os ensaios dela.
    const created = await post('/rules', lead, {
      key: 'ops.commissioning',
      definition: {
        tests: [
          {
            code: 'GROUND_CONTINUITY',
            label: 'Continuidade do aterramento',
            group: 'Cat. 1',
            kind: 'CHECK',
            source: SRC,
          },
        ],
      },
      sources: [{ type: 'INTERNAL_POLICY', reference: SRC }],
    });
    expect(created.status).toBe(201);
    expect(
      (
        await post(`/rules/${created.body.id}/activate`, lead, {
          reviewedBy: 'Eng. Teste',
          reviewedByRegistration: 'CREA-DF 1',
        })
      ).status,
    ).toBe(200);
  });
  afterAll(() => t.close());

  it('1. a venda assinada vira projeto de homologação e instalação', async () => {
    deal = await signedDeal(flow, manager);
    await publishAll();
    const inst = await t.prisma.system.installation.findFirstOrThrow({
      where: { projectId: deal.projectId },
    });
    installationId = inst.id;
    expect(inst.status).toBe('AWAITING_ENGINEERING');
    const timeline = await t.prisma.system.timelineEvent.findMany({
      where: { opportunityId: deal.opportunityId },
    });
    expect(timeline.map((e) => e.type)).toEqual(
      expect.arrayContaining(['CONTRACT_SIGNED', 'PROJECT_CREATED']),
    );
  });

  it('2. a homologação é aprovada e a instalação passa a esperar os materiais', async () => {
    const project = (await get(`/projects/${deal.projectId}`, owner)).body;
    for (const item of project.checklist.filter(
      (i: { required: boolean; status: string }) => i.required && i.status === 'PENDING',
    ))
      await patch(`/projects/${deal.projectId}/checklist/${item.id}`, operations, {
        status: 'DONE',
      });
    for (const [status, extra] of [
      ['SUBMITTED', { protocolNumber: `PROTO-${randomUUID().slice(0, 6)}` }],
      ['INSPECTION', {}],
      ['APPROVED', {}],
    ] as const)
      expect(
        (await post(`/projects/${deal.projectId}/status`, operations, { status, ...extra })).status,
      ).toBe(200);
    await publishAll();
    const inst = (await get(`/operations/installations/${installationId}`, operations)).body;
    expect(inst.status).toBe('AWAITING_MATERIAL');
  });

  it('3. material recebido libera o agendamento e cria a tarefa de agendar', async () => {
    const item = await post(`/operations/installations/${installationId}/materials`, operations, {
      category: 'MODULE',
      description: 'Módulo 550 W',
      quantity: 10,
      unit: 'un',
    });
    expect((await post(`/operations/materials/${item.body.id}/receive`, operations)).status).toBe(
      200,
    );
    await publishAll();
    expect((await get(`/operations/installations/${installationId}`, operations)).body.status).toBe(
      'MATERIAL_READY',
    );
    expect(
      await t.prisma.system.task.count({
        where: { tenantId: a.id, automationKey: `install-schedule:${installationId}` },
      }),
    ).toBeGreaterThan(0);
  });

  it('4. a equipe executa a instalação pelo app de campo, com geolocalização e conferência', async () => {
    const order = await post('/operations/work-orders', operations, {
      installationId,
      type: 'INSTALLATION',
      title: 'Instalar o sistema',
      crewId,
      scheduledStart: iso(24),
      scheduledEnd: iso(32),
    });
    expect(order.status).toBe(201);
    const act = (extra: Record<string, unknown>) => ({
      clientActionId: randomUUID(),
      workOrderId: order.body.id,
      capturedAt: new Date().toISOString(),
      ...extra,
    });
    const synced = await post('/operations/field/sync', installer.token, {
      actions: [
        act({ type: 'START', geo: { latitude: -3.73, longitude: -38.52, accuracy: 9 } }),
        act({ type: 'NOTE', text: 'Telhado liberado' }),
        act({ type: 'COMPLETE', geo: { latitude: -3.73, longitude: -38.52, accuracy: 7 } }),
      ],
    });
    expect(synced.status).toBe(200);
    expect(synced.body.map((r: { status: string }) => r.status)).toEqual([
      'APPLIED',
      'APPLIED',
      'APPLIED',
    ]);
    // Reenviar o mesmo lote não repete nada (a fila offline pode reentregar).
    const again = await post('/operations/field/sync', installer.token, {
      actions: [act({ type: 'NOTE', text: 'duplicada' })],
    });
    expect(again.status).toBe(200);
    await publishAll();
    const inst = (await get(`/operations/installations/${installationId}`, operations)).body;
    expect(['INSTALLED', 'COMMISSIONING']).toContain(inst.status);
    const row = await t.prisma.system.workOrder.findUniqueOrThrow({ where: { id: order.body.id } });
    expect((row.geo as unknown[]).length).toBe(2);
  });

  it('5. o responsável técnico aprova o comissionamento e o cliente é chamado para o aceite', async () => {
    const dto = (await get(`/operations/installations/${installationId}`, operations)).body;
    const order = dto.workOrders.find((o: { type: string }) => o.type === 'COMMISSIONING');
    await patch(`/operations/work-orders/${order.id}`, operations, {
      crewId,
      scheduledStart: iso(48),
      scheduledEnd: iso(52),
    });
    expect((await post(`/operations/work-orders/${order.id}/start`, installer.token)).status).toBe(
      200,
    );

    const rec = (await get(`/operations/installations/${installationId}/commissioning`, operations))
      .body.current;
    expect(rec).toMatchObject({ provisional: false, status: 'IN_PROGRESS' });
    await patch(`/operations/commissioning/${rec.id}`, operations, {
      conditions: { irradianceWm2: 800, moduleTempC: 45 },
    });
    for (const test of rec.tests)
      expect(
        (await patch(`/operations/commissioning/tests/${test.id}`, operations, { passed: true }))
          .status,
      ).toBe(200);
    expect(
      (await post(`/operations/work-orders/${order.id}/complete`, installer.token)).status,
    ).toBe(200);

    const decided = await post(`/operations/commissioning/${rec.id}/decision`, lead, {
      decision: 'APPROVE',
    });
    expect(decided.status).toBe(200);
    expect(decided.body.status).toBe('APPROVED');
    await publishAll();
    expect((await get(`/operations/installations/${installationId}`, operations)).body.status).toBe(
      'CUSTOMER_ACCEPTANCE',
    );
    expect(
      await t.prisma.system.task.count({
        where: { tenantId: a.id, automationKey: `acceptance-request:${installationId}` },
      }),
    ).toBe(1);
  });

  it('6. o cliente entra pelo link, acompanha o projeto e dá o aceite pelo portal', async () => {
    const access = await post('/portal-access', manager, {
      accountId: deal.accountId,
      email: 'cliente@jornada.test',
    });
    const link = await post(`/portal-access/${access.body.id}/link`, manager);
    const exchanged = await t.http
      .post(`${API}/public/portal/exchange`)
      .send({ token: (link.body.url as string).split('/portal/acesso/')[1] });
    expect(exchanged.status).toBe(200);
    portalCookie = ((exchanged.headers['set-cookie'] as unknown as string[])[0] as string).split(
      ';',
    )[0] as string;

    const before = (await portal(`/projects/${deal.projectId}`)).body;
    expect(before.statusLabel).toBe('Aguardando o seu aceite');
    expect(before.acceptance.status).toBe('PENDING');
    expect(
      before.milestones.filter((m: { done: boolean }) => m.done).map((m: { key: string }) => m.key),
    ).toEqual(
      expect.arrayContaining([
        'PROPOSAL',
        'CONTRACT',
        'HOMOLOGATION',
        'MATERIAL',
        'INSTALLATION',
        'COMMISSIONING',
      ]),
    );
    expect(before.documents.some((d: { kind: string }) => d.kind === 'COMMISSIONING_REPORT')).toBe(
      true,
    );

    const accepted = await t.http
      .post(`${API}/portal/projects/${deal.projectId}/acceptance`)
      .set('Cookie', portalCookie)
      .send({ acceptedByName: 'Maria da Silva' });
    expect(accepted.status).toBe(200);
    expect(accepted.body.acceptance).toMatchObject({
      status: 'DONE',
      acceptedByName: 'Maria da Silva',
    });
    await publishAll();
    const inst = (await get(`/operations/installations/${installationId}`, operations)).body;
    expect(inst.status).toBe('DONE');
  });

  it('7. a usina nasce do aceite, com os ativos da lista de materiais', async () => {
    await publishAll();
    const plant = await t.prisma.system.plant.findFirst({ where: { installationId } });
    if (!plant) expect((await post('/operations/plants/reconcile', om)).status).toBe(200);
    const row = await t.prisma.system.plant.findFirstOrThrow({ where: { installationId } });
    plantId = row.id;
    await t.prisma.system.plant.update({
      where: { id: plantId },
      data: { expectedMonthlyKwh: Array(12).fill(900) },
    });
    const detail = (await get(`/operations/plants/${plantId}`, om)).body;
    expect(detail.status).toBe('ACTIVE');
    expect(detail.assets).toHaveLength(1);
    const milestones = (await portal(`/projects/${deal.projectId}`)).body.milestones;
    expect(milestones.find((m: { key: string }) => m.key === 'ACTIVE').done).toBe(true);
  });

  it('8. o monitoramento por planilha mostra o desempenho; com a regra, o desvio abre um chamado', async () => {
    const csv = ['data;kwh', ...Array.from({ length: 6 }, (_, i) => `${day(-(i + 1))};2`)].join(
      '\n',
    );
    expect(
      (await post(`/operations/plants/${plantId}/monitoring/import`, om, { csv })).status,
    ).toBe(200);
    const before = (await get(`/operations/plants/${plantId}/monitoring`, om)).body;
    expect(before.deviationRule).toBeNull();
    expect(
      await t.prisma.system.ticket.count({
        where: { plantId, automationKey: { startsWith: 'monitoring-' } },
      }),
    ).toBe(0);

    const rule = await post('/rules', lead, {
      key: 'ops.monitoring',
      definition: {
        deviation: { thresholdPct: 30, consecutiveDays: 5 },
        alarmTicketSeverities: [],
      },
      sources: [{ type: 'INTERNAL_POLICY', reference: SRC }],
    });
    expect(
      (
        await post(`/rules/${rule.body.id}/activate`, lead, {
          reviewedBy: 'Eng. Teste',
          reviewedByRegistration: 'CREA-DF 1',
        })
      ).status,
    ).toBe(200);
    await post(`/operations/plants/${plantId}/monitoring/import`, om, { csv });
    const tickets = await t.prisma.system.ticket.findMany({
      where: { plantId, automationKey: { startsWith: 'monitoring-deviation:' } },
    });
    expect(tickets).toHaveLength(1);
    const customerView = (await portal(`/projects/${deal.projectId}`)).body;
    expect(
      customerView.tickets.some((x: { title: string }) => /abaixo do esperado/.test(x.title)),
    ).toBe(true);
  });

  it('9. o cliente abre um chamado pelo portal e a equipe responde', async () => {
    const created = await t.http
      .post(`${API}/portal/tickets`)
      .set('Cookie', portalCookie)
      .send({ plantId, title: 'Inversor com luz vermelha' });
    expect(created.status).toBe(201);
    const reply = await post(`/operations/tickets/${created.body.id}/comments`, om, {
      body: 'Vamos enviar um técnico amanhã.',
      internal: false,
    });
    expect(reply.status).toBe(201);
    const thread = (await portal(`/tickets/${created.body.id}`)).body;
    expect(thread.comments.map((c: { body: string }) => c.body)).toEqual([
      'Vamos enviar um técnico amanhã.',
    ]);
  });

  it('10. o financeiro registra o recebimento e a margem do projeto', async () => {
    const value = (
      await t.prisma.system.project.findUniqueOrThrow({ where: { id: deal.projectId } })
    ).valueCents;
    const parcel = await post(`/projects/${deal.projectId}/finance/receivables`, finance, {
      referenceId: 'NF-JORNADA',
      order: 1,
      amountCents: Math.floor(value / 2),
      dueOn: day(5),
    });
    expect(parcel.status).toBe(201);
    expect(
      (
        await post(
          `/projects/${deal.projectId}/finance/receivables/${parcel.body.id}/pay`,
          finance,
          { paymentMethod: 'PIX' },
        )
      ).status,
    ).toBe(200);
    await post(`/projects/${deal.projectId}/finance/costs`, finance, {
      category: 'MATERIAL',
      description: 'Módulos',
      actualCents: 100_000,
    });
    const summary = (await get(`/projects/${deal.projectId}/finance/summary`, finance)).body;
    expect(summary.totalReceivedCents).toBe(Math.floor(value / 2));
    expect(summary.marginCents).toBe(Math.floor(value / 2) - 100_000);
    const seen = (await portal(`/projects/${deal.projectId}`)).body.receivables;
    expect(seen).toEqual([expect.objectContaining({ order: 1, status: 'PAID' })]);
  });

  it('11. a trilha de auditoria e a linha do tempo registram a jornada sem dado do cliente em claro', async () => {
    const audit = await t.prisma.system.auditLog.findMany({ where: { tenantId: a.id } });
    const actions = new Set(audit.map((x) => x.action));
    const wanted = [
      'installation.accepted',
      'portal.access_granted',
      'portal.link_created',
      'finance.receivable_paid',
      'monitoring.csv_imported',
    ];
    expect(wanted.filter((action) => !actions.has(action))).toEqual([]);
    const timeline = await t.prisma.system.timelineEvent.findMany({
      where: { opportunityId: deal.opportunityId },
    });
    expect(timeline.map((e) => e.type)).toEqual(
      expect.arrayContaining(['INSTALLATION_STATUS_CHANGED', 'PLANT_ACTIVATED', 'RECEIVABLE_PAID']),
    );
    expect(JSON.stringify(audit)).not.toContain('cliente@jornada.test');
  });
});
