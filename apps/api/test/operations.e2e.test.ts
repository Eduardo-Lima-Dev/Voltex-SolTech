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
import { auditOf, outboxOf, tokenWithRole } from './crm-support';

const HOUR = 3_600_000;
const iso = (offsetHours: number) => new Date(Date.now() + offsetHours * HOUR).toISOString();

describe('Operação · instalação, materiais, equipes e agenda (e2e)', () => {
  let t: TestApp;
  let a: SeededTenant;
  let b: SeededTenant;
  let flow: Flow;
  let owner: string;
  let manager: string;
  let seller: string;
  let sdr: string;
  let adminB: string;
  let operations: string;
  let techLead: string;
  let installer: { token: string; id: string };
  let installer2: { token: string; id: string };
  let crewId: string;

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
  const installationOf = async (deal: SignedDeal) => {
    const found = await t.prisma.system.installation.findFirst({
      where: { projectId: deal.projectId },
    });
    return found;
  };
  const detail = async (id: string) =>
    (await get(`/operations/installations/${id}`, operations)).body;

  /** Aprova a homologação do projeto pela API do CRM (checklist → protocolo → vistoria → aprovado). */
  const approveProject = async (projectId: string) => {
    const project = (await get(`/projects/${projectId}`, owner)).body;
    for (const item of project.checklist.filter(
      (i: { required: boolean; status: string }) => i.required && i.status === 'PENDING',
    ))
      await patch(`/projects/${projectId}/checklist/${item.id}`, operations, { status: 'DONE' });
    for (const [status, extra] of [
      ['SUBMITTED', { protocolNumber: `PROTO-${randomUUID().slice(0, 6)}` }],
      ['INSPECTION', {}],
      ['APPROVED', {}],
    ] as const) {
      const res = await post(`/projects/${projectId}/status`, operations, { status, ...extra });
      if (res.status !== 200) throw new Error(`projeto → ${status}: ${JSON.stringify(res.body)}`);
    }
  };

  /** Contrato assinado, homologação aprovada e eventos entregues: a instalação espera material. */
  const awaitingMaterial = async (): Promise<{ deal: SignedDeal; id: string }> => {
    const deal = await signedDeal(flow, manager);
    // Na ordem real: o contrato cria a instalação; só depois a homologação é aprovada.
    await publishAll();
    await approveProject(deal.projectId);
    await publishAll();
    const inst = await installationOf(deal);
    if (!inst) throw new Error('instalação não foi criada');
    return { deal, id: inst.id };
  };

  const addAndReceive = async (id: string, count = 1) => {
    const itemIds: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const res = await post(`/operations/installations/${id}/materials`, operations, {
        category: 'MODULE',
        description: `Módulo ${i + 1}`,
        quantity: 10,
        unit: 'un',
        unitCostCents: 80_000,
      });
      expect(res.status).toBe(201);
      itemIds.push(res.body.id);
    }
    for (const itemId of itemIds) await post(`/operations/materials/${itemId}/receive`, operations);
  };

  /** Material recebido, ordem de instalação com equipe e data: a instalação fica "equipe designada". */
  const crewAssigned = async (): Promise<{ deal: SignedDeal; id: string; orderId: string }> => {
    const { deal, id } = await awaitingMaterial();
    await addAndReceive(id);
    const order = await post('/operations/work-orders', operations, {
      installationId: id,
      type: 'INSTALLATION',
      title: 'Instalar o sistema',
      crewId,
      scheduledStart: iso(48),
      scheduledEnd: iso(56),
    });
    expect(order.status).toBe(201);
    return { deal, id, orderId: order.body.id };
  };

  beforeAll(async () => {
    t = await createTestApp();
    a = await seedTenant(t.prisma, 'ops');
    b = await seedTenant(t.prisma, 'opsb');
    owner = await tokenFor(t.http, a.owner);
    manager = await tokenFor(t.http, a.manager);
    seller = await tokenFor(t.http, a.salesperson);
    sdr = await tokenFor(t.http, a.sdr);
    adminB = await tokenFor(t.http, b.admin);
    operations = (await tokenWithRole(t, a, 'OPERATIONS')).token;
    techLead = (await tokenWithRole(t, a, 'TECHNICAL_LEAD')).token;
    installer = await tokenWithRole(t, a, 'INSTALLER');
    installer2 = await tokenWithRole(t, a, 'INSTALLER');
    flow = { t, tenant: a, seller, admin: owner };
    await ensureMarginPolicy(flow, manager);
    const crew = await post('/operations/crews', operations, {
      name: 'Equipe Alfa',
      memberIds: [installer.id],
    });
    crewId = crew.body.id;
  });
  afterAll(() => t.close());

  describe('criação a partir do projeto', () => {
    it('o contrato assinado cria a instalação aguardando a engenharia, uma única vez', async () => {
      const deal = await signedDeal(flow, manager);
      await publishAll();
      const inst = await installationOf(deal);
      expect(inst).toMatchObject({ status: 'AWAITING_ENGINEERING', projectCode: deal.projectCode });
      const dto = await detail(inst!.id);
      expect(dto.history).toHaveLength(1);
      expect(dto.history[0]).toMatchObject({ fromStatus: null, toStatus: 'AWAITING_ENGINEERING' });
      expect(dto.allowedTransitions).toEqual(['AWAITING_MATERIAL', 'CANCELLED']);
      // Reentregar o evento não duplica.
      const { OperationsAutomationsService } =
        await import('../src/products/operations/operations-automations.service');
      await t.app.get(OperationsAutomationsService).onProjectCreated({
        id: randomUUID(),
        type: 'ProjectCreated',
        occurredAt: new Date(),
        tenantId: a.id,
        actorId: null,
        projectCode: deal.projectCode,
        schemaVersion: 1,
        payload: { projectId: deal.projectId },
      });
      expect(
        await t.prisma.system.installation.count({ where: { projectId: deal.projectId } }),
      ).toBe(1);
    });

    it('a homologação aprovada libera material e compra; a lista não é gerada sem projeto técnico', async () => {
      const { deal, id } = await awaitingMaterial();
      const dto = await detail(id);
      expect(dto.status).toBe('AWAITING_MATERIAL');
      expect(dto.history.map((h: { toStatus: string }) => h.toStatus)).toEqual([
        'AWAITING_MATERIAL',
        'AWAITING_ENGINEERING',
      ]);
      expect(dto.materials).toEqual([]);
      const task = await t.prisma.system.task.findFirst({
        where: { tenantId: a.id, automationKey: `install-purchase:${id}` },
      });
      expect(task).toMatchObject({ opportunityId: deal.opportunityId });
      expect(task?.title).toMatch(/Comprar o material/);
      // A linha do tempo da oportunidade registra a mudança.
      const timeline = await t.prisma.system.timelineEvent.findMany({
        where: { opportunityId: deal.opportunityId, type: 'INSTALLATION_STATUS_CHANGED' },
      });
      expect(timeline.length).toBeGreaterThanOrEqual(1);
    });

    it('reconcile cria a instalação de projetos anteriores à fase, sem duplicar', async () => {
      const deal = await signedDeal(flow, manager);
      expect(await installationOf(deal)).toBeNull();
      const first = await post('/operations/installations/reconcile', operations);
      expect(first.status).toBe(200);
      expect(first.body.created).toBeGreaterThanOrEqual(1);
      expect(await installationOf(deal)).not.toBeNull();
      const again = await post('/operations/installations/reconcile', operations);
      expect(again.body.created).toBe(0);
      // Quando o evento do contrato for entregue depois, continua sendo uma só.
      await publishAll();
      expect(
        await t.prisma.system.installation.count({ where: { projectId: deal.projectId } }),
      ).toBe(1);
    });
  });

  describe('permissões e isolamento', () => {
    it('só quem tem permissão da operação vê; técnico líder só lê', async () => {
      const { id } = await awaitingMaterial();
      expect((await get('/operations/installations', sdr)).status).toBe(403);
      expect((await get('/operations/installations', seller)).status).toBe(403);
      expect((await get('/operations/installations', installer.token)).status).toBe(403);
      expect((await get('/operations/installations', techLead)).status).toBe(200);
      expect(
        (
          await post(`/operations/installations/${id}/status`, techLead, {
            status: 'CANCELLED',
            reason: 'teste',
          })
        ).status,
      ).toBe(403);
      expect((await get('/operations/work-orders', techLead)).status).toBe(403);
    });

    it('outra empresa não vê nem altera a instalação', async () => {
      const { id } = await awaitingMaterial();
      expect((await get(`/operations/installations/${id}`, adminB)).status).toBe(404);
      expect(
        (
          await post(`/operations/installations/${id}/status`, adminB, {
            status: 'CANCELLED',
            reason: 'invasão',
          })
        ).status,
      ).toBe(404);
      const list = await get('/operations/installations', adminB);
      expect(list.body.data.some((i: { id: string }) => i.id === id)).toBe(false);
    });
  });

  describe('materiais', () => {
    it('só passa para material separado com todos os itens recebidos; o último recebimento avança sozinho', async () => {
      const { deal, id } = await awaitingMaterial();
      const noItems = await post(`/operations/installations/${id}/status`, operations, {
        status: 'MATERIAL_READY',
      });
      expect(noItems.status).toBe(422);
      expect(noItems.body.code).toBe('NO_MATERIAL_ITEMS');

      const m1 = (
        await post(`/operations/installations/${id}/materials`, operations, {
          category: 'MODULE',
          description: 'Módulo 550 W',
          quantity: 12,
          unit: 'un',
          unitCostCents: 90_000,
        })
      ).body;
      const m2 = (
        await post(`/operations/installations/${id}/materials`, operations, {
          category: 'CABLE',
          description: 'Cabo solar 6 mm²',
          quantity: 120.5,
          unit: 'm',
        })
      ).body;
      const notReady = await post(`/operations/installations/${id}/status`, operations, {
        status: 'MATERIAL_READY',
      });
      expect(notReady.body.code).toBe('MATERIALS_NOT_READY');

      // Pedido: só o registro, com fornecedor, número do pedido e valor pago.
      const ordered = await post(`/operations/materials/${m1.id}/order`, operations, {
        supplier: 'Distribuidora Sol',
        purchaseOrder: 'PC-100',
        orderedCents: 1_080_000,
        expectedAt: iso(72),
      });
      expect(ordered.status).toBe(200);
      expect(ordered.body).toMatchObject({
        status: 'ORDERED',
        supplier: 'Distribuidora Sol',
        orderedCents: 1_080_000,
      });
      expect(
        (await post(`/operations/materials/${m1.id}/order`, operations, { supplier: 'X' })).status,
      ).toBe(422);
      expect((await post(`/operations/materials/${m2.id}/separate`, operations)).status).toBe(422);

      expect((await post(`/operations/materials/${m1.id}/receive`, operations)).body.status).toBe(
        'RECEIVED',
      );
      expect((await detail(id)).status).toBe('AWAITING_MATERIAL');
      expect((await post(`/operations/materials/${m2.id}/receive`, operations)).status).toBe(200);

      const dto = await detail(id);
      expect(dto.status).toBe('MATERIAL_READY');
      expect(dto.materialsTotal).toBe(2);
      expect(dto.materialsReady).toBe(2);
      expect(dto.history[0]).toMatchObject({ toStatus: 'MATERIAL_READY', actorId: null });
      expect(
        (await outboxOf(t, a.id, 'MaterialsReady')).some(
          (e) => (e.payload as { installationId: string }).installationId === id,
        ),
      ).toBe(true);
      const task = await t.prisma.system.task.findFirst({
        where: { tenantId: a.id, automationKey: `install-schedule:${id}` },
      });
      expect(task?.opportunityId).toBe(deal.opportunityId);

      // Entrou item novo: volta a aguardar material, com o motivo no histórico.
      await post(`/operations/installations/${id}/materials`, operations, {
        category: 'PROTECTION',
        description: 'DPS',
        quantity: 2,
        unit: 'un',
      });
      const back = await detail(id);
      expect(back.status).toBe('AWAITING_MATERIAL');
      expect(back.history[0].reason).toMatch(/lista de materiais mudou/);
    });

    it('item cancelado não conta; separar exige recebimento; item separado não cancela', async () => {
      const { id } = await awaitingMaterial();
      const keep = (
        await post(`/operations/installations/${id}/materials`, operations, {
          category: 'MODULE',
          description: 'A',
          quantity: 1,
          unit: 'un',
        })
      ).body;
      const drop = (
        await post(`/operations/installations/${id}/materials`, operations, {
          category: 'MODULE',
          description: 'B',
          quantity: 1,
          unit: 'un',
        })
      ).body;
      await post(`/operations/materials/${drop.id}/cancel`, operations);
      expect((await post(`/operations/materials/${drop.id}/cancel`, operations)).status).toBe(422);
      await post(`/operations/materials/${keep.id}/receive`, operations);
      expect((await detail(id)).status).toBe('MATERIAL_READY');
      expect((await post(`/operations/materials/${keep.id}/separate`, operations)).status).toBe(
        200,
      );
      expect((await post(`/operations/materials/${keep.id}/cancel`, operations)).status).toBe(422);
      expect(
        (await patch(`/operations/materials/${keep.id}`, operations, { quantity: 5 })).status,
      ).toBe(422);
    });

    it('gera a lista do snapshot técnico aprovado, uma só vez, ignorando linhas inválidas', async () => {
      const { id } = await awaitingMaterial();
      const noSnapshot = await post(
        `/operations/installations/${id}/materials/generate`,
        operations,
      );
      expect(noSnapshot.status).toBe(422);
      expect(noSnapshot.body.code).toBe('NO_TECHNICAL_SNAPSHOT');

      const project = await t.prisma.system.engineeringProject.create({
        data: { tenantId: a.id, code: `ENG-${randomUUID().slice(0, 6)}`, name: 'Técnico' },
      });
      const version = await t.prisma.system.engineeringVersion.create({
        data: { tenantId: a.id, projectId: project.id, number: 1, design: {} },
      });
      const snapshot = await t.prisma.system.engineeringSnapshot.create({
        data: {
          tenantId: a.id,
          projectId: project.id,
          versionId: version.id,
          hash: 'h',
          content: {
            version: {
              results: {
                bom: {
                  lines: [
                    {
                      category: 'MODULE',
                      equipmentId: null,
                      description: 'Módulo 550 W',
                      quantity: 12,
                      unit: 'un',
                      unitCostCents: 90_000,
                      totalCents: 1_080_000,
                      priceSource: 'PRICE_LIST',
                      note: null,
                    },
                    {
                      category: 'CABLE',
                      equipmentId: null,
                      description: 'Cabo 6 mm²',
                      quantity: 80.5,
                      unit: 'm',
                      unitCostCents: null,
                      totalCents: null,
                      priceSource: 'NONE',
                      note: 'sem preço',
                    },
                    {
                      category: 'INVERTER',
                      equipmentId: null,
                      description: 'Inversor',
                      quantity: 1,
                      unit: 'un',
                      unitCostCents: 400_000,
                      totalCents: 400_000,
                      priceSource: 'REFERENCE',
                      note: null,
                    },
                    { category: 'MODULE', description: 'sem quantidade' },
                    { category: 'MODULE', description: 'quantidade zero', quantity: 0, unit: 'un' },
                  ],
                },
              },
            },
          },
        },
      });
      await t.prisma.system.installation.update({
        where: { id },
        data: { engineeringSnapshotId: snapshot.id },
      });
      const gen = await post(`/operations/installations/${id}/materials/generate`, operations);
      expect(gen.status).toBe(200);
      expect(gen.body.created).toBe(3);
      const again = await post(`/operations/installations/${id}/materials/generate`, operations);
      expect(again.body.created).toBe(0);
      const items = (await get(`/operations/installations/${id}/materials`, operations)).body;
      expect(items).toHaveLength(3);
      expect(items.find((i: { unit: string }) => i.unit === 'm')).toMatchObject({
        quantity: 80.5,
        unitCostCents: null,
        note: 'sem preço',
      });
      expect((await detail(id)).materialsGeneratedAt).not.toBeNull();
    });

    it('compara as ofertas vigentes de fornecedores diferentes e marca a melhor', async () => {
      const { id } = await awaitingMaterial();
      const equipment = await t.prisma.system.equipmentItem.create({
        data: {
          tenantId: a.id,
          kind: 'MODULE',
          manufacturer: 'Fab',
          model: `M-${randomUUID().slice(0, 6)}`,
          spec: {},
          status: 'APPROVED',
          approvedById: a.owner.id,
          approvedAt: new Date(),
        },
      });
      const day = 86_400_000;
      const offer = (
        supplier: string,
        priceCents: number,
        validFrom: Date,
        validTo: Date | null = null,
      ) =>
        t.prisma.system.priceListItem.create({
          data: {
            tenantId: a.id,
            equipmentId: equipment.id,
            description: 'Módulo',
            supplier,
            priceCents,
            validFrom,
            validTo,
            source: 'teste',
          },
        });
      await offer('Forn A', 95_000, new Date(Date.now() - 10 * day));
      await offer('Forn A', 91_000, new Date(Date.now() - 2 * day)); // a mais recente do fornecedor vale
      await offer('Forn B', 89_000, new Date(Date.now() - 5 * day));
      await offer(
        'Forn C',
        50_000,
        new Date(Date.now() - 30 * day),
        new Date(Date.now() - 20 * day),
      ); // vencida
      await offer('Forn D', 40_000, new Date(Date.now() + 5 * day)); // ainda não vale
      await post(`/operations/installations/${id}/materials`, operations, {
        category: 'MODULE',
        description: 'Módulo',
        quantity: 10,
        unit: 'un',
        equipmentId: equipment.id,
        unitCostCents: 92_000,
      });
      await post(`/operations/installations/${id}/materials`, operations, {
        category: 'CABLE',
        description: 'Sem equipamento',
        quantity: 5,
        unit: 'm',
      });
      const quotes = (await get(`/operations/installations/${id}/materials/quotes`, operations))
        .body;
      expect(quotes).toHaveLength(1);
      expect(quotes[0].plannedUnitCostCents).toBe(92_000);
      expect(quotes[0].offers.map((o: { supplier: string }) => o.supplier)).toEqual([
        'Forn B',
        'Forn A',
      ]);
      expect(quotes[0].offers[0]).toMatchObject({
        unitPriceCents: 89_000,
        totalCents: 890_000,
        best: true,
      });
      expect(quotes[0].offers[1]).toMatchObject({ unitPriceCents: 91_000, best: false });
    });
  });

  describe('equipes', () => {
    it('cria, edita e não repete nome; integrante tem de existir', async () => {
      const dup = await post('/operations/crews', operations, { name: 'Equipe Alfa' });
      expect(dup.status).toBe(409);
      const invalid = await post('/operations/crews', operations, {
        name: 'Equipe Fantasma',
        memberIds: [randomUUID()],
      });
      expect(invalid.status).toBe(422);
      const created = await post('/operations/crews', operations, {
        name: 'Equipe Beta',
        memberIds: [installer2.id],
      });
      expect(created.status).toBe(201);
      expect(created.body.members).toHaveLength(1);
      const edited = await patch(`/operations/crews/${created.body.id}`, operations, {
        memberIds: [installer.id, installer2.id],
      });
      expect(edited.body.members).toHaveLength(2);
      const list = await get('/operations/crews', operations);
      expect(list.body.map((c: { name: string }) => c.name)).toEqual(
        expect.arrayContaining(['Equipe Alfa', 'Equipe Beta']),
      );
      expect((await get('/operations/crews', adminB)).body).toEqual([]);
      expect((await post('/operations/crews', techLead, { name: 'Nada' })).status).toBe(403);
    });
  });

  describe('ordens de serviço e agenda', () => {
    it('a ordem de instalação só nasce com o material separado', async () => {
      const { id } = await awaitingMaterial();
      const early = await post('/operations/work-orders', operations, {
        installationId: id,
        type: 'INSTALLATION',
        title: 'Instalar cedo demais',
      });
      expect(early.status).toBe(422);
      expect(early.body.code).toBe('INSTALLATION_NOT_READY');
      const noInstallation = await post('/operations/work-orders', operations, {
        type: 'INSTALLATION',
        title: 'Sem instalação',
      });
      expect(noInstallation.status).toBe(422);
    });

    it('com data e equipe a instalação fica "equipe designada", avisa por evento e cria a tarefa do aviso ao cliente', async () => {
      const { deal, id, orderId } = await crewAssigned();
      const dto = await detail(id);
      expect(dto.status).toBe('CREW_ASSIGNED');
      expect(dto.history.slice(0, 3).map((h: { toStatus: string }) => h.toStatus)).toEqual([
        'CREW_ASSIGNED',
        'SCHEDULING',
        'MATERIAL_READY',
      ]);
      const order = dto.workOrders.find((o: { id: string }) => o.id === orderId);
      expect(order).toMatchObject({
        status: 'SCHEDULED',
        crewName: 'Equipe Alfa',
        type: 'INSTALLATION',
      });
      expect(dto.nextScheduledStart).not.toBeNull();
      const events = await outboxOf(t, a.id, 'InstallationScheduled');
      expect(
        events.some((e) => (e.payload as { workOrderId: string }).workOrderId === orderId),
      ).toBe(true);
      const notice = await t.prisma.system.task.findFirst({
        where: {
          tenantId: a.id,
          opportunityId: deal.opportunityId,
          automationKey: { startsWith: `install-notice:${orderId}` },
        },
      });
      expect(notice?.title).toMatch(/Avisar o cliente da instalação/);
      // Uma ordem de instalação em aberto por vez.
      const dup = await post('/operations/work-orders', operations, {
        installationId: id,
        type: 'INSTALLATION',
        title: 'Outra',
      });
      expect(dup.status).toBe(409);
    });

    it('tirar a equipe volta a "agendamento"; reatribuir designa de novo; cancelar a ordem volta a "agendamento"', async () => {
      const { id, orderId } = await crewAssigned();
      const unassigned = await patch(`/operations/work-orders/${orderId}`, operations, {
        crewId: null,
      });
      expect(unassigned.status).toBe(200);
      expect((await detail(id)).status).toBe('SCHEDULING');
      await patch(`/operations/work-orders/${orderId}`, operations, { crewId });
      expect((await detail(id)).status).toBe('CREW_ASSIGNED');
      // Sem data volta a ser pendente e a instalação, a agendar.
      const unscheduled = await patch(`/operations/work-orders/${orderId}`, operations, {
        scheduledStart: null,
      });
      expect(unscheduled.body).toMatchObject({
        status: 'PENDING',
        scheduledStart: null,
        scheduledEnd: null,
      });
      expect((await detail(id)).status).toBe('SCHEDULING');
      await patch(`/operations/work-orders/${orderId}`, operations, {
        scheduledStart: iso(24),
        scheduledEnd: iso(30),
      });
      expect((await detail(id)).status).toBe('CREW_ASSIGNED');
      const cancelled = await post(`/operations/work-orders/${orderId}/cancel`, operations, {
        reason: 'Cliente pediu outra data',
      });
      expect(cancelled.body).toMatchObject({
        status: 'CANCELLED',
        cancelReason: 'Cliente pediu outra data',
      });
      expect((await detail(id)).status).toBe('SCHEDULING');
      expect(
        (await patch(`/operations/work-orders/${orderId}`, operations, { title: 'Tarde demais' }))
          .status,
      ).toBe(422);
    });

    it('valida o horário, a equipe e o técnico', async () => {
      const bad = await post('/operations/work-orders', operations, {
        type: 'VISIT',
        title: 'Visita',
        scheduledStart: iso(10),
        scheduledEnd: iso(9),
      });
      expect(bad.status).toBe(422);
      const noStart = await post('/operations/work-orders', operations, {
        type: 'VISIT',
        title: 'Visita',
        scheduledEnd: iso(9),
      });
      expect(noStart.status).toBe(422);
      expect(
        (
          await post('/operations/work-orders', operations, {
            type: 'VISIT',
            title: 'Visita',
            crewId: randomUUID(),
          })
        ).status,
      ).toBe(422);
      expect(
        (
          await post('/operations/work-orders', operations, {
            type: 'VISIT',
            title: 'Visita',
            assigneeId: randomUUID(),
          })
        ).status,
      ).toBe(422);
    });

    it('a agenda mostra o intervalo por equipe e avisa choque de horário (mesma equipe ou mesmo técnico), sem bloquear', async () => {
      const base = 1000; // horas à frente: longe das outras ordens dos demais testes
      const first = await post('/operations/work-orders', operations, {
        type: 'VISIT',
        title: 'Visita 1',
        crewId,
        scheduledStart: iso(base),
        scheduledEnd: iso(base + 3),
      });
      const overlapping = await post('/operations/work-orders', operations, {
        type: 'VISIT',
        title: 'Visita 2 (mesma equipe)',
        crewId,
        scheduledStart: iso(base + 2),
        scheduledEnd: iso(base + 5),
      });
      const sameTech = await post('/operations/work-orders', operations, {
        type: 'SURVEY',
        title: 'Levantamento (mesmo técnico, sem fim)',
        assigneeId: installer.id,
        scheduledStart: iso(base + 3.5),
      });
      const sameTech2 = await post('/operations/work-orders', operations, {
        type: 'SURVEY',
        title: 'Levantamento 2 (mesmo técnico)',
        assigneeId: installer.id,
        scheduledStart: iso(base + 4),
        scheduledEnd: iso(base + 6),
      });
      const free = await post('/operations/work-orders', operations, {
        type: 'VISIT',
        title: 'Visita sem choque',
        crewId,
        scheduledStart: iso(base + 10),
        scheduledEnd: iso(base + 12),
      });
      for (const r of [first, overlapping, sameTech, sameTech2, free]) expect(r.status).toBe(201);
      const agenda = await get(
        `/operations/agenda?from=${encodeURIComponent(iso(base - 1))}&to=${encodeURIComponent(iso(base + 24))}`,
        operations,
      );
      expect(agenda.status).toBe(200);
      const orders = agenda.body.orders as { id: string; conflictsWith: string[] }[];
      expect(orders).toHaveLength(5);
      const byId = new Map(orders.map((o) => [o.id, o]));
      expect(byId.get(first.body.id)?.conflictsWith).toEqual([overlapping.body.id]);
      expect(byId.get(overlapping.body.id)?.conflictsWith).toEqual([first.body.id]);
      // Sem horário de fim, vale a duração presumida de 4 h: o levantamento de 3,5 h encosta no de 4 h.
      expect(byId.get(sameTech.body.id)?.conflictsWith).toEqual([sameTech2.body.id]);
      expect(byId.get(free.body.id)?.conflictsWith).toEqual([]);
      // Filtro por equipe.
      const onlyCrew = await get(
        `/operations/agenda?from=${encodeURIComponent(iso(base - 1))}&to=${encodeURIComponent(iso(base + 24))}&crewId=${crewId}`,
        operations,
      );
      expect(onlyCrew.body.orders).toHaveLength(3);
      // Outra empresa não vê a agenda.
      const other = await get(
        `/operations/agenda?from=${encodeURIComponent(iso(base - 1))}&to=${encodeURIComponent(iso(base + 24))}`,
        adminB,
      );
      expect(other.body.orders).toEqual([]);
    });
  });

  describe('execução em campo', () => {
    it('o técnico vê só as ordens em que está escalado e só ele (ou a operação) as inicia', async () => {
      const { id, orderId } = await crewAssigned();
      const mine = await get('/operations/work-orders/mine', installer.token);
      expect(mine.status).toBe(200);
      expect(mine.body.map((o: { id: string }) => o.id)).toContain(orderId);
      const other = await get('/operations/work-orders/mine', installer2.token);
      expect(other.body.map((o: { id: string }) => o.id)).not.toContain(orderId);
      expect((await get('/operations/work-orders/mine', operations)).status).toBe(403);
      expect(
        (await post(`/operations/work-orders/${orderId}/start`, installer2.token)).status,
      ).toBe(403);
      expect((await post(`/operations/work-orders/${orderId}/start`, sdr)).status).toBe(403);
      expect((await detail(id)).status).toBe('CREW_ASSIGNED');
    });

    it('iniciar e concluir a instalação: em instalação → concluída, abre o comissionamento e o aviso', async () => {
      const { deal, id, orderId } = await crewAssigned();
      const started = await post(`/operations/work-orders/${orderId}/start`, installer.token);
      expect(started.status).toBe(200);
      expect(started.body).toMatchObject({ status: 'IN_PROGRESS', assigneeId: installer.id });
      expect((await detail(id)).status).toBe('IN_PROGRESS');
      // Em execução: não reagenda, não cancela.
      expect(
        (await patch(`/operations/work-orders/${orderId}`, operations, { crewId: null })).status,
      ).toBe(422);
      expect(
        (await post(`/operations/work-orders/${orderId}/cancel`, operations, { reason: 'tarde' }))
          .status,
      ).toBe(422);
      const done = await post(`/operations/work-orders/${orderId}/complete`, installer.token, {
        notes: 'Instalado sem intercorrências',
      });
      expect(done.status).toBe(200);
      expect(done.body).toMatchObject({ status: 'DONE', notes: 'Instalado sem intercorrências' });
      const dto = await detail(id);
      expect(dto.status).toBe('INSTALLED');
      expect(dto.installedAt).not.toBeNull();
      expect(dto.allowedTransitions).toEqual(['COMMISSIONING', 'IN_PROGRESS']);
      const commissioning = dto.workOrders.find(
        (o: { type: string }) => o.type === 'COMMISSIONING',
      );
      expect(commissioning).toMatchObject({
        status: 'PENDING',
        title: `Comissionamento – ${deal.projectCode}`,
      });
      expect(
        (await outboxOf(t, a.id, 'InstallationCompleted')).some(
          (e) => (e.payload as { installationId: string }).installationId === id,
        ),
      ).toBe(true);
      expect(
        await t.prisma.system.task.count({
          where: { tenantId: a.id, automationKey: `commissioning-open:${id}` },
        }),
      ).toBe(1);
      // Concluir de novo não vale.
      expect(
        (await post(`/operations/work-orders/${orderId}/complete`, installer.token)).status,
      ).toBe(422);
    });

    it('iniciar o comissionamento muda a instalação para "comissionamento"', async () => {
      const { id, orderId } = await crewAssigned();
      await post(`/operations/work-orders/${orderId}/start`, installer.token);
      await post(`/operations/work-orders/${orderId}/complete`, installer.token);
      const dto = await detail(id);
      const commissioning = dto.workOrders.find(
        (o: { type: string }) => o.type === 'COMMISSIONING',
      );
      // O comissionamento escalado a uma equipe pode ser iniciado em campo.
      await patch(`/operations/work-orders/${commissioning.id}`, operations, {
        crewId,
        scheduledStart: iso(72),
        scheduledEnd: iso(76),
      });
      expect(
        (await post(`/operations/work-orders/${commissioning.id}/start`, installer.token)).status,
      ).toBe(200);
      expect((await detail(id)).status).toBe('COMMISSIONING');
    });

    it('pendência de campo que bloqueia pára a instalação; resolver a última libera; a que não bloqueia não muda nada', async () => {
      const { id, orderId } = await crewAssigned();
      // Antes de começar não se registra pendência de campo bloqueante em estado errado? (equipe designada vale)
      await post(`/operations/work-orders/${orderId}/start`, installer.token);
      const light = await post(`/operations/installations/${id}/issues`, installer.token, {
        type: 'OTHER',
        description: 'Cliente quer mudar a posição do inversor depois',
        blocking: false,
      });
      expect(light.status).toBe(201);
      expect((await detail(id)).status).toBe('IN_PROGRESS');
      const block = await post(`/operations/installations/${id}/issues`, installer.token, {
        type: 'ACCESS',
        description: 'Telhado sem acesso seguro',
        workOrderId: orderId,
      });
      expect(block.status).toBe(201);
      expect(block.body.blocking).toBe(true);
      let dto = await detail(id);
      expect(dto.status).toBe('FIELD_ISSUE');
      expect(dto.openIssues).toBe(2);
      expect(dto.history[0].reason).toMatch(/Telhado sem acesso seguro/);
      const blocked = await post(`/operations/work-orders/${orderId}/complete`, installer.token);
      expect(blocked.status).toBe(422);
      expect(blocked.body.code).toBe('BLOCKING_ISSUES_OPEN');
      const manual = await post(`/operations/installations/${id}/status`, operations, {
        status: 'IN_PROGRESS',
      });
      expect(manual.body.code).toBe('BLOCKING_ISSUES_OPEN');
      // Resolve a que não bloqueava: continua parada. Resolve a bloqueante: volta.
      await post(`/operations/issues/${light.body.id}/resolve`, installer.token, {
        resolution: 'Combinado com o cliente',
      });
      expect((await detail(id)).status).toBe('FIELD_ISSUE');
      expect(
        (
          await post(`/operations/issues/${light.body.id}/resolve`, installer.token, {
            resolution: 'de novo',
          })
        ).status,
      ).toBe(422);
      const resolved = await post(`/operations/issues/${block.body.id}/resolve`, installer.token, {
        resolution: 'Instalada linha de vida',
      });
      expect(resolved.body).toMatchObject({ status: 'RESOLVED', resolvedById: installer.id });
      dto = await detail(id);
      expect(dto.status).toBe('IN_PROGRESS');
      expect(dto.openIssues).toBe(0);
      expect(
        (await post(`/operations/work-orders/${orderId}/complete`, installer.token)).status,
      ).toBe(200);
    });

    it('técnico fora da escala não registra nem resolve pendência; a operação registra', async () => {
      const { id, orderId } = await crewAssigned();
      await post(`/operations/work-orders/${orderId}/start`, installer.token);
      expect(
        (
          await post(`/operations/installations/${id}/issues`, installer2.token, {
            type: 'SAFETY',
            description: 'Intruso',
          })
        ).status,
      ).toBe(403);
      const byOps = await post(`/operations/installations/${id}/issues`, operations, {
        type: 'MATERIAL',
        description: 'Faltou conector MC4',
      });
      expect(byOps.status).toBe(201);
      expect(
        (
          await post(`/operations/issues/${byOps.body.id}/resolve`, installer2.token, {
            resolution: 'x x x',
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await post(`/operations/issues/${byOps.body.id}/resolve`, installer.token, {
            resolution: 'Conector comprado',
          })
        ).status,
      ).toBe(200);
    });

    it('não registra pendência de campo antes da equipe ser designada', async () => {
      const { id } = await awaitingMaterial();
      const res = await post(`/operations/installations/${id}/issues`, operations, {
        type: 'OTHER',
        description: 'Cedo demais',
      });
      expect(res.status).toBe(422);
    });
  });

  describe('mudança manual de situação', () => {
    it('recusa passo inválido, exige motivo para voltar ou cancelar e o projeto homologado para avançar', async () => {
      const deal = await signedDeal(flow, manager);
      await publishAll();
      const id = (await installationOf(deal))!.id;
      const skip = await post(`/operations/installations/${id}/status`, operations, {
        status: 'IN_PROGRESS',
      });
      expect(skip.status).toBe(422);
      expect(skip.body.code).toBe('INVALID_INSTALLATION_TRANSITION');
      const early = await post(`/operations/installations/${id}/status`, operations, {
        status: 'AWAITING_MATERIAL',
      });
      expect(early.body.code).toBe('HOMOLOGATION_PENDING');
      const noReason = await post(`/operations/installations/${id}/status`, operations, {
        status: 'CANCELLED',
      });
      expect(noReason.body.code).toBe('REASON_REQUIRED');
      await approveProject(deal.projectId);
      // O evento já está no outbox, mas o avanço manual também vale.
      const ok = await post(`/operations/installations/${id}/status`, operations, {
        status: 'AWAITING_MATERIAL',
      });
      expect(ok.status).toBe(200);
      expect(ok.body.status).toBe('AWAITING_MATERIAL');
      // Quando o evento chegar depois, não regride nem duplica.
      await publishAll();
      expect((await detail(id)).status).toBe('AWAITING_MATERIAL');
    });

    it('cancelar encerra, cancela as ordens abertas e registra motivo, histórico e auditoria', async () => {
      const { id, orderId } = await crewAssigned();
      const cancelled = await post(`/operations/installations/${id}/status`, operations, {
        status: 'CANCELLED',
        reason: 'Cliente desistiu',
      });
      expect(cancelled.status).toBe(200);
      expect(cancelled.body).toMatchObject({
        status: 'CANCELLED',
        cancelReason: 'Cliente desistiu',
        allowedTransitions: [],
      });
      const order = cancelled.body.workOrders.find((o: { id: string }) => o.id === orderId);
      expect(order.status).toBe('CANCELLED');
      expect(
        (
          await post(`/operations/installations/${id}/status`, operations, {
            status: 'AWAITING_MATERIAL',
          })
        ).status,
      ).toBe(422);
      expect(
        (
          await post(`/operations/installations/${id}/materials`, operations, {
            category: 'MODULE',
            description: 'x',
            quantity: 1,
            unit: 'un',
          })
        ).status,
      ).toBe(422);
      const audit = await auditOf(t, a.id, 'installation.status_changed');
      expect(
        audit.some(
          (e) =>
            e.entityId === id && (e.after as { reason?: string }).reason === 'Cliente desistiu',
        ),
      ).toBe(true);
    });

    it('percorre o começo do fim do fluxo: comissionamento, voltar com motivo e a trava do aceite', async () => {
      const { id, orderId } = await crewAssigned();
      await post(`/operations/work-orders/${orderId}/start`, installer.token);
      await post(`/operations/work-orders/${orderId}/complete`, installer.token);
      const toCommissioning = await post(`/operations/installations/${id}/status`, operations, {
        status: 'COMMISSIONING',
      });
      expect(toCommissioning.body.status).toBe('COMMISSIONING');
      const back = await post(`/operations/installations/${id}/status`, operations, {
        status: 'IN_PROGRESS',
      });
      expect(back.body.code).toBe('REASON_REQUIRED');
      const reproved = await post(`/operations/installations/${id}/status`, operations, {
        status: 'IN_PROGRESS',
        reason: 'Reprovado no ensaio de isolamento',
      });
      expect(reproved.body.status).toBe('IN_PROGRESS');
      // Reinstala e volta ao comissionamento.
      await post(`/operations/installations/${id}/status`, operations, { status: 'INSTALLED' });
      await post(`/operations/installations/${id}/status`, operations, { status: 'COMMISSIONING' });
      // Sem o comissionamento aprovado pelo responsável técnico, o aceite não abre (ver o e2e do comissionamento).
      const skipped = await post(`/operations/installations/${id}/status`, operations, {
        status: 'CUSTOMER_ACCEPTANCE',
      });
      expect(skipped.status).toBe(422);
      expect(skipped.body.code).toBe('COMMISSIONING_NOT_APPROVED');
    });

    it('altera o responsável (que precisa existir) e audita', async () => {
      const { id } = await awaitingMaterial();
      const ok = await patch(`/operations/installations/${id}`, operations, {
        responsibleId: a.manager.id,
      });
      expect(ok.status).toBe(200);
      expect(ok.body.responsibleId).toBe(a.manager.id);
      expect(
        (
          await patch(`/operations/installations/${id}`, operations, {
            responsibleId: randomUUID(),
          })
        ).status,
      ).toBe(422);
    });
  });

  describe('lista e indicadores', () => {
    it('filtra por situação e busca por código do projeto ou nome do cliente', async () => {
      const deal = await signedDeal(flow, manager, { name: 'Cliente Instalação Única' });
      await publishAll();
      const inst = await installationOf(deal);
      const byName = await get(
        '/operations/installations?search=Instala%C3%A7%C3%A3o%20%C3%9Anica',
        operations,
      );
      expect(byName.body.data.map((i: { id: string }) => i.id)).toEqual([inst!.id]);
      expect(byName.body.data[0]).toMatchObject({
        accountName: 'Cliente Instalação Única',
        status: 'AWAITING_ENGINEERING',
        materialsTotal: 0,
      });
      const byCode = await get(`/operations/installations?search=${deal.projectCode}`, operations);
      expect(byCode.body.data.map((i: { id: string }) => i.id)).toContain(inst!.id);
      const byStatus = await get(
        '/operations/installations?status=AWAITING_ENGINEERING&pageSize=100',
        operations,
      );
      expect(
        byStatus.body.data.every((i: { status: string }) => i.status === 'AWAITING_ENGINEERING'),
      ).toBe(true);
      expect((await get('/operations/installations?status=XYZ', operations)).status).toBe(422);
    });

    it('o painel conta por situação, atrasos, pendências abertas, produtividade e retrabalho', async () => {
      const { id, orderId } = await crewAssigned();
      await post(`/operations/work-orders/${orderId}/start`, installer.token);
      await post(`/operations/installations/${id}/issues`, installer.token, {
        type: 'TECHNICAL',
        description: 'Estrutura divergente',
      });
      // Uma ordem agendada no passado conta como atrasada.
      const late = await post('/operations/work-orders', operations, {
        type: 'VISIT',
        title: 'Visita atrasada',
        scheduledStart: iso(-5),
        scheduledEnd: iso(-3),
      });
      expect(late.status).toBe(201);
      // Uma ordem concluída da equipe entra na produtividade.
      const doneVisit = await post('/operations/work-orders', operations, {
        type: 'VISIT',
        title: 'Visita feita',
        crewId,
        scheduledStart: iso(-30),
        scheduledEnd: iso(-28),
      });
      await post(`/operations/work-orders/${doneVisit.body.id}/start`, operations);
      await post(`/operations/work-orders/${doneVisit.body.id}/complete`, operations, {});
      const dash = (await get('/operations/dashboard', operations)).body;
      expect(dash.byStatus.FIELD_ISSUE).toBeGreaterThanOrEqual(1);
      expect(dash.overdueCount).toBeGreaterThanOrEqual(1);
      expect(dash.openIssuesCount).toBeGreaterThanOrEqual(1);
      expect(dash.reworkCount).toBeGreaterThanOrEqual(1);
      expect(
        dash.crews.find((c: { crewName: string }) => c.crewName === 'Equipe Alfa').doneLast30Days,
      ).toBeGreaterThanOrEqual(1);
      expect((await get('/operations/dashboard', adminB)).body.byStatus).toEqual({});
    });
  });
});
