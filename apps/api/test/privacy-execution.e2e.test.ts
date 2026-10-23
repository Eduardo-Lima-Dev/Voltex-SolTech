import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  API,
  bearer,
  createTestApp,
  pdfBuffer,
  seedTenant,
  tokenFor,
  type SeededTenant,
  type TestApp,
} from './helpers';
import { ensureMarginPolicy, signedDeal } from './crm-delivery-flow';
import type { Flow } from './crm-flow';
import { tokenWithRole } from './crm-support';

describe('LGPD · eliminação dos dados da execução (e2e)', () => {
  let t: TestApp;
  let a: SeededTenant;
  let owner: string;
  let manager: string;
  let om: string;
  let flow: Flow;

  const post = (path: string, token: string, body: unknown = {}) =>
    t.http
      .post(`${API}${path}`)
      .set(bearer(token))
      .send(body as object);

  beforeAll(async () => {
    t = await createTestApp();
    a = await seedTenant(t.prisma, 'lgpd11');
    owner = await tokenFor(t.http, a.owner);
    manager = await tokenFor(t.http, a.manager);
    om = (await tokenWithRole(t, a, 'OM')).token;
    flow = { t, tenant: a, seller: await tokenFor(t.http, a.salesperson), admin: owner };
    await ensureMarginPolicy(flow, manager);
  });
  afterAll(() => t.close());

  it('apaga acesso ao portal, fotos, assinatura, geolocalização, mensagens e textos livres da conta', async () => {
    // --- projeto com planta ativa ---
    const deal = await signedDeal(flow, manager);
    const account = await t.prisma.system.account.findUniqueOrThrow({
      where: { id: deal.accountId },
    });
    const name = account.name;
    const { OutboxPublisher } = await import('../src/platform/events/outbox-publisher.service');
    await t.app.get(OutboxPublisher).publishPending(1000, a.id);
    const inst = await t.prisma.system.installation.findFirstOrThrow({
      where: { projectId: deal.projectId },
    });
    await t.prisma.system.materialItem.create({
      data: {
        tenantId: a.id,
        installationId: inst.id,
        category: 'MODULE',
        description: 'Módulo',
        quantity: 2,
        unit: 'un',
        status: 'RECEIVED',
      },
    });
    await t.prisma.system.installation.update({
      where: { id: inst.id },
      data: {
        status: 'DONE',
        installedAt: new Date(),
        acceptedAt: new Date(),
        doneAt: new Date(),
        acceptedByName: name,
        acceptanceIp: '203.0.113.9',
        acceptanceUserAgent: 'Navegador do cliente',
      },
    });
    await post('/operations/plants/reconcile', om);
    const plant = await t.prisma.system.plant.findFirstOrThrow({
      where: { installationId: inst.id },
    });
    await t.prisma.system.plant.update({
      where: { id: plant.id },
      data: { name: `Usina de ${name}`, notes: `Cliente ${name} pediu contato à tarde` },
    });

    // --- portal: acesso, sessão e arquivo enviado ---
    const access = await post('/portal-access', manager, {
      accountId: deal.accountId,
      email: 'cliente@lgpd.test',
    });
    const link = await post(`/portal-access/${access.body.id}/link`, manager);
    const exchanged = await t.http
      .post(`${API}/public/portal/exchange`)
      .send({ token: (link.body.url as string).split('/portal/acesso/')[1] });
    const cookie = ((exchanged.headers['set-cookie'] as unknown as string[])[0] as string).split(
      ';',
    )[0] as string;
    const upload = await t.http
      .post(`${API}/portal/projects/${deal.projectId}/uploads`)
      .set('Cookie', cookie)
      .attach('file', pdfBuffer('rg'), { filename: 'rg.pdf', contentType: 'application/pdf' });
    expect(upload.status).toBe(201);
    const ticket = await t.http
      .post(`${API}/portal/tickets`)
      .set('Cookie', cookie)
      .send({
        plantId: plant.id,
        title: `Problema de ${name}`,
        description: `Sou ${name} e o inversor apitou`,
      });
    expect(ticket.status).toBe(201);
    await t.http
      .post(`${API}/portal/tickets/${ticket.body.id}/comments`)
      .set('Cookie', cookie)
      .send({ body: 'Pode ligar para (85) 98888-7777' });

    // --- campo: ordem com geolocalização, foto, assinatura e anotações ---
    const sig = await t.prisma.system.document.create({
      data: {
        tenantId: a.id,
        groupId: crypto.randomUUID(),
        filename: 'assinatura.png',
        mimeType: 'image/png',
        sizeBytes: 10,
        storageKey: `${a.id}/teste/assinatura-${Date.now()}.png`,
        checksumSha256: 'x',
        entityType: 'WorkOrderSignature',
      },
    });
    const photoDoc = await t.prisma.system.document.create({
      data: {
        tenantId: a.id,
        groupId: crypto.randomUUID(),
        filename: 'fachada.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 10,
        storageKey: `${a.id}/teste/fachada-${Date.now()}.jpg`,
        checksumSha256: 'y',
        entityType: 'WorkOrder',
      },
    });
    const order = await t.prisma.system.workOrder.create({
      data: {
        tenantId: a.id,
        installationId: inst.id,
        accountId: deal.accountId,
        type: 'INSTALLATION',
        title: 'Instalação',
        notes: `Portão da casa de ${name}, cão bravo`,
        geo: [{ kind: 'START', latitude: -3.7, longitude: -38.5, accuracy: 10 }],
        signatureDocumentId: sig.id,
        signedByName: name,
        signedAt: new Date(),
      },
    });
    await t.prisma.system.workOrderPhoto.create({
      data: {
        tenantId: a.id,
        workOrderId: order.id,
        documentId: photoDoc.id,
        clientActionId: crypto.randomUUID(),
        caption: `Fachada da casa de ${name}`,
        takenAt: new Date(),
        latitude: -3.7,
        longitude: -38.5,
        accuracy: 8,
        visibleToCustomer: true,
      },
    });
    await t.prisma.system.communicationLog.create({
      data: {
        tenantId: a.id,
        channel: 'EMAIL',
        template: 'portal.access',
        recipient: 'cliente@lgpd.test',
        subject: `Acesso de ${name}`,
        accountId: deal.accountId,
      },
    });
    const fin = (await tokenWithRole(t, a, 'FINANCE')).token;
    await post(`/projects/${deal.projectId}/finance/receivables`, fin, {
      referenceId: 'NF-1',
      order: 1,
      amountCents: 1000,
      dueOn: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
      notes: `Cobrar ${name} por telefone`,
    });

    // --- passados 5 anos do contrato, a eliminação é liberada ---
    const old = new Date(Date.now() - 62 * 30.44 * 86_400_000);
    await t.prisma.system.$executeRawUnsafe(
      `ALTER TABLE contracts DISABLE TRIGGER contracts_immutable`,
    );
    await t.prisma.system
      .$executeRaw`UPDATE contracts SET signed_at = ${old} WHERE id = ${deal.contractId}::uuid`;
    await t.prisma.system.$executeRawUnsafe(
      `ALTER TABLE contracts ENABLE TRIGGER contracts_immutable`,
    );

    const done = await post('/privacy/erasures', owner, {
      subjectType: 'ACCOUNT',
      subjectId: deal.accountId,
      reason: 'Pedido do titular por e-mail',
    });
    expect(done.status).toBe(201);
    expect(done.body.summary).toMatchObject({
      acessosAoPortal: 1,
      arquivosEnviadosPeloCliente: 1,
      ordensDeServico: 1,
      fotosDeCampo: 1,
      chamados: 1,
      comunicacoes: 1,
      parcelas: 1,
    });

    // --- conferências ---
    const db = t.prisma.system;
    expect(await db.portalAccess.count({ where: { accountId: deal.accountId } })).toBe(0);
    expect(await db.portalSession.count({ where: { accountId: deal.accountId } })).toBe(0);
    expect(await db.portalMagicLink.count({ where: { accountId: deal.accountId } })).toBe(0);
    expect(await db.portalUpload.count({ where: { accountId: deal.accountId } })).toBe(0);
    expect((await t.http.get(`${API}/portal/me`).set('Cookie', cookie)).status).toBe(401);

    const savedOrder = await db.workOrder.findUniqueOrThrow({
      where: { id: order.id },
      include: { photos: true },
    });
    expect(savedOrder.geo).toEqual([]);
    expect(savedOrder.signatureDocumentId).toBeNull();
    expect(savedOrder.signedByName).toBe('Titular removido');
    expect(savedOrder.notes).not.toContain(name);
    expect(savedOrder.photos[0]).toMatchObject({
      latitude: null,
      longitude: null,
      accuracy: null,
      visibleToCustomer: false,
    });
    expect(savedOrder.photos[0]?.caption).not.toContain(name);
    expect(
      (await db.document.findUniqueOrThrow({ where: { id: sig.id } })).deletedAt,
    ).not.toBeNull();
    expect(
      (await db.document.findUniqueOrThrow({ where: { id: photoDoc.id } })).deletedAt,
    ).not.toBeNull();
    const sentDoc = await db.document.findFirst({
      where: { tenantId: a.id, entityType: 'PortalUpload', filename: 'rg.pdf' },
    });
    expect(sentDoc?.deletedAt).not.toBeNull();

    const savedInst = await db.installation.findUniqueOrThrow({ where: { id: inst.id } });
    expect(savedInst).toMatchObject({
      acceptedByName: 'Titular removido',
      acceptanceIp: null,
      acceptanceUserAgent: null,
    });

    const savedPlant = await db.plant.findUniqueOrThrow({ where: { id: plant.id } });
    expect(savedPlant.name).not.toContain(name);
    expect(savedPlant.notes).not.toContain(name);

    const savedTicket = await db.ticket.findUniqueOrThrow({
      where: { id: ticket.body.id },
      include: { comments: true },
    });
    expect(savedTicket.title).not.toContain(name);
    expect(savedTicket.description).not.toContain(name);
    expect(
      savedTicket.comments.every((c) => !c.body.includes('98888-7777') && c.authorName !== name),
    ).toBe(true);

    const log = await db.communicationLog.findFirstOrThrow({
      where: { accountId: deal.accountId },
    });
    expect(log.recipient).toBeNull();
    expect(log.subject).not.toContain(name);

    const receivable = await db.receivable.findFirstOrThrow({
      where: { projectId: deal.projectId },
    });
    expect(receivable.notes).not.toContain(name);

    // Nada que identifique a pessoa sobrou nos textos desta execução.
    const dump = JSON.stringify([savedOrder, savedPlant, savedTicket, log, receivable]);
    expect(dump).not.toContain(name);
  });

  describe('prazos de guarda das fotos e da geolocalização', () => {
    it('só elimina o que passou do prazo da empresa; sem prazo, nada sai', async () => {
      const own = await seedTenant(t.prisma, 'lgpd11ret');
      const ownerTok = await tokenFor(t.http, own.owner);
      const mk = async (takenMonthsAgo: number, label: string) => {
        const doc = await t.prisma.system.document.create({
          data: {
            tenantId: own.id,
            groupId: crypto.randomUUID(),
            filename: `${label}.jpg`,
            mimeType: 'image/jpeg',
            sizeBytes: 10,
            storageKey: `${own.id}/teste/${label}-${Date.now()}.jpg`,
            checksumSha256: 'z',
            entityType: 'WorkOrder',
          },
        });
        const order = await t.prisma.system.workOrder.create({
          data: {
            tenantId: own.id,
            type: 'VISIT',
            title: `Visita ${label}`,
            geo: [{ kind: 'START', latitude: 1, longitude: 2, accuracy: 3 }],
            createdAt: new Date(Date.now() - takenMonthsAgo * 30.44 * 86_400_000),
          },
        });
        const photo = await t.prisma.system.workOrderPhoto.create({
          data: {
            tenantId: own.id,
            workOrderId: order.id,
            documentId: doc.id,
            clientActionId: crypto.randomUUID(),
            takenAt: new Date(Date.now() - takenMonthsAgo * 30.44 * 86_400_000),
            latitude: 1,
            longitude: 2,
            accuracy: 3,
          },
        });
        return { doc, order, photo };
      };
      const old = await mk(10, 'antiga');
      const recent = await mk(1, 'recente');
      const { PrivacyService } = await import('../src/products/crm/privacy/privacy.service');

      // Sem prazo definido: nada é eliminado.
      await t.app.get(PrivacyService).sweepAll();
      expect(await t.prisma.system.workOrderPhoto.count({ where: { tenantId: own.id } })).toBe(2);

      const policy = await t.http.get(`${API}/privacy/retention`).set(bearer(ownerTok));
      expect(policy.body.policy).toMatchObject({
        fieldPhotosMonths: null,
        geolocationMonths: null,
      });
      expect(policy.body.sources.fieldPhotosMonths).toMatch(/jurídico/);

      // Geolocalização com prazo de 6 meses: só a antiga perde as coordenadas, a foto continua.
      const set = await t.http
        .put(`${API}/privacy/retention`)
        .set(bearer(ownerTok))
        .send({ ...policy.body.policy, geolocationMonths: 6 });
      expect(set.status).toBe(200);
      const geo = await t.app.get(PrivacyService).sweepAll();
      expect(geo.geolocation).toBeGreaterThanOrEqual(1);
      const oldPhoto = await t.prisma.system.workOrderPhoto.findUniqueOrThrow({
        where: { id: old.photo.id },
      });
      expect(oldPhoto).toMatchObject({ latitude: null, longitude: null, accuracy: null });
      expect(
        (await t.prisma.system.workOrder.findUniqueOrThrow({ where: { id: old.order.id } })).geo,
      ).toEqual([]);
      const recentPhoto = await t.prisma.system.workOrderPhoto.findUniqueOrThrow({
        where: { id: recent.photo.id },
      });
      expect(recentPhoto).toMatchObject({ latitude: 1, longitude: 2 });
      expect(
        (await t.prisma.system.document.findUniqueOrThrow({ where: { id: old.doc.id } })).deletedAt,
      ).toBeNull();

      // Fotos com prazo de 6 meses: a antiga é eliminada (arquivo e linha); a recente fica.
      await t.http
        .put(`${API}/privacy/retention`)
        .set(bearer(ownerTok))
        .send({ ...policy.body.policy, geolocationMonths: 6, fieldPhotosMonths: 6 });
      const photos = await t.app.get(PrivacyService).sweepAll();
      expect(photos.photos).toBe(1);
      expect(
        await t.prisma.system.workOrderPhoto.findUnique({ where: { id: old.photo.id } }),
      ).toBeNull();
      expect(
        (await t.prisma.system.document.findUniqueOrThrow({ where: { id: old.doc.id } })).deletedAt,
      ).not.toBeNull();
      expect(
        await t.prisma.system.workOrderPhoto.findUnique({ where: { id: recent.photo.id } }),
      ).not.toBeNull();
      const audits = await t.prisma.system.auditLog.count({
        where: { tenantId: own.id, action: 'privacy.field_photos_expired' },
      });
      expect(audits).toBe(1);
    });
  });
});
