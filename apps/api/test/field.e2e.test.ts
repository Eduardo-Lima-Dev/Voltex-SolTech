import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  API,
  bearer,
  createTestApp,
  seedTenant,
  tokenFor,
  pdfBuffer,
  type SeededTenant,
  type TestApp,
} from './helpers';
import { ensureMarginPolicy, signedDeal, type SignedDeal } from './crm-delivery-flow';
import type { Flow } from './crm-flow';
import { pngBuffer, tokenWithRole } from './crm-support';

const HOUR = 3_600_000;
const iso = (offsetHours: number) => new Date(Date.now() + offsetHours * HOUR).toISOString();

describe('App de campo · sincronização, fotos e assinatura (e2e)', () => {
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
  const sync = (token: string, actions: unknown[]) =>
    post('/operations/field/sync', token, { actions });
  const action = (workOrderId: string, extra: Record<string, unknown>) => ({
    clientActionId: randomUUID(),
    workOrderId,
    capturedAt: new Date().toISOString(),
    ...extra,
  });
  const order = async (id: string) =>
    t.prisma.system.workOrder.findUniqueOrThrow({ where: { id } });

  /** Visita avulsa escalada ao instalador, com checklist. */
  const visit = async (items = ['Conferir a estrutura', 'Medir o isolamento']) => {
    const res = await post('/operations/work-orders', operations, {
      type: 'VISIT',
      title: 'Visita técnica',
      assigneeId: installer.id,
      scheduledStart: iso(2),
      scheduledEnd: iso(4),
      checklist: items,
    });
    expect(res.status).toBe(201);
    return res.body as { id: string; checklist: { id: string; label: string; done: boolean }[] };
  };

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
    ] as const)
      await post(`/projects/${projectId}/status`, operations, { status, ...extra });
  };

  /** Instalação com a equipe designada (material recebido e ordem de instalação agendada para a equipe do instalador). */
  const installation = async (): Promise<{ deal: SignedDeal; id: string; orderId: string }> => {
    const deal = await signedDeal(flow, manager);
    await publishAll();
    await approveProject(deal.projectId);
    await publishAll();
    const inst = await t.prisma.system.installation.findFirstOrThrow({
      where: { projectId: deal.projectId },
    });
    const item = await post(`/operations/installations/${inst.id}/materials`, operations, {
      category: 'MODULE',
      description: 'Módulo',
      quantity: 4,
      unit: 'un',
    });
    await post(`/operations/materials/${item.body.id}/receive`, operations);
    const created = await post('/operations/work-orders', operations, {
      installationId: inst.id,
      type: 'INSTALLATION',
      title: 'Instalar',
      crewId,
      scheduledStart: iso(24),
      scheduledEnd: iso(32),
      checklist: ['Fixar a estrutura'],
    });
    expect(created.status).toBe(201);
    return { deal, id: inst.id, orderId: created.body.id };
  };

  beforeAll(async () => {
    t = await createTestApp();
    a = await seedTenant(t.prisma, 'field');
    b = await seedTenant(t.prisma, 'fieldb');
    owner = await tokenFor(t.http, a.owner);
    manager = await tokenFor(t.http, a.manager);
    seller = await tokenFor(t.http, a.salesperson);
    sdr = await tokenFor(t.http, a.sdr);
    adminB = await tokenFor(t.http, b.admin);
    operations = (await tokenWithRole(t, a, 'OPERATIONS')).token;
    installer = await tokenWithRole(t, a, 'INSTALLER');
    installer2 = await tokenWithRole(t, a, 'INSTALLER');
    flow = { t, tenant: a, seller, admin: owner };
    await ensureMarginPolicy(flow, manager);
    crewId = (
      await post('/operations/crews', operations, {
        name: 'Equipe Campo',
        memberIds: [installer.id],
      })
    ).body.id;
  });
  afterAll(() => t.close());

  describe('checklist da ordem', () => {
    it('quem cria a ordem define os itens; trocar a lista mantém o estado dos que continuam', async () => {
      const o = await visit(['Conferir a estrutura', 'Medir o isolamento']);
      expect(o.checklist.map((i) => i.label)).toEqual([
        'Conferir a estrutura',
        'Medir o isolamento',
      ]);
      expect(o.checklist.every((i) => !i.done && i.id)).toBe(true);
      const first = o.checklist[0]!;
      const res = await sync(installer.token, [
        action(o.id, { type: 'CHECK', itemId: first.id, done: true }),
      ]);
      expect(res.body[0].status).toBe('APPLIED');
      const updated = await patch(`/operations/work-orders/${o.id}`, operations, {
        checklist: ['Conferir a estrutura', 'Apertar os conectores', 'conferir a estrutura'],
      });
      expect(updated.status).toBe(200);
      const items = updated.body.checklist as { id: string; label: string; done: boolean }[];
      expect(items.map((i) => i.label)).toEqual(['Conferir a estrutura', 'Apertar os conectores']);
      expect(items[0]).toMatchObject({ id: first.id, done: true });
      expect(items[1]!.done).toBe(false);
    });

    it('sem checklist informado, a ordem fica sem itens (não há lista técnica padrão)', async () => {
      const res = await post('/operations/work-orders', operations, {
        type: 'VISIT',
        title: 'Sem itens',
      });
      expect(res.body.checklist).toEqual([]);
    });
  });

  describe('lista do técnico', () => {
    it('traz local, contato, pendências abertas e a contagem de fotos; só as ordens dele', async () => {
      const { deal, orderId } = await installation();
      await t.prisma.system.contact.create({
        data: {
          tenantId: a.id,
          accountId: deal.accountId,
          name: 'Maria da Silva',
          phone: '(61) 99999-8888',
          isPrimary: true,
        },
      });
      const mine = await get('/operations/field/work-orders', installer.token);
      expect(mine.status).toBe(200);
      const found = mine.body.find((o: { id: string }) => o.id === orderId);
      expect(found).toBeDefined();
      expect(found.address).toEqual(expect.any(String));
      expect(found.contactName).toBe('Maria da Silva');
      expect(found.contactPhone).toBe('(61) 99999-8888');
      expect(found.fetchedAt).toEqual(expect.any(String));
      expect(found.checklist.map((i: { label: string }) => i.label)).toEqual(['Fixar a estrutura']);
      expect(found.photos).toEqual([]);
      expect(found.photoCount).toBe(0);
      const other = await get('/operations/field/work-orders', installer2.token);
      expect(other.body.map((o: { id: string }) => o.id)).not.toContain(orderId);
    });

    it('vendedor e SDR não usam o app de campo; a operação usa', async () => {
      expect((await get('/operations/field/work-orders', seller)).status).toBe(403);
      expect((await sync(sdr, [action(randomUUID(), { type: 'START' })])).status).toBe(403);
      expect((await get('/operations/field/work-orders', operations)).status).toBe(200);
    });
  });

  describe('sincronização', () => {
    it('aplica o lote feito offline, em ordem, e reenviar o lote não repete nada', async () => {
      const o = await visit();
      const [c1, c2] = o.checklist;
      const batch = [
        action(o.id, { type: 'START', geo: { latitude: -15.79, longitude: -47.88, accuracy: 12 } }),
        action(o.id, { type: 'CHECK', itemId: c1!.id, done: true, note: 'Ok' }),
        action(o.id, { type: 'CHECK', itemId: c2!.id, done: true }),
        action(o.id, { type: 'NOTE', text: 'Cliente não estava em casa' }),
        action(o.id, {
          type: 'COMPLETE',
          notes: 'Visita feita',
          geo: { latitude: -15.79, longitude: -47.88 },
        }),
      ];
      const first = await sync(installer.token, batch);
      expect(first.status).toBe(200);
      expect(first.body.map((r: { status: string }) => r.status)).toEqual(Array(5).fill('APPLIED'));
      const row = await order(o.id);
      expect(row.status).toBe('DONE');
      expect(row.notes).toContain('Visita feita');
      const done = row.checklist as {
        id: string;
        done: boolean;
        note: string | null;
        doneById: string | null;
      }[];
      expect(done.every((i) => i.done)).toBe(true);
      expect(done.find((i) => i.id === c1!.id)).toMatchObject({
        note: 'Ok',
        doneById: installer.id,
      });
      const geo = row.geo as { kind: string; latitude: number }[];
      expect(geo.map((g) => g.kind)).toEqual(['START', 'COMPLETE']);
      expect(geo[0]!.latitude).toBe(-15.79);
      // O NOTE foi concatenado antes do COMPLETE substituir as notas? As notas guardam a última escrita; o NOTE fica no registro de ações.
      const again = await sync(installer.token, batch);
      expect(again.body.map((r: { status: string }) => r.status)).toEqual(
        Array(5).fill('DUPLICATE'),
      );
      const rowAgain = await order(o.id);
      expect(rowAgain.geo).toHaveLength(2);
      expect(await t.prisma.system.fieldAction.count({ where: { workOrderId: o.id } })).toBe(5);
    });

    it('anotação é acrescentada com data e autor, sem apagar a anterior', async () => {
      const o = await visit();
      await sync(installer.token, [
        action(o.id, { type: 'NOTE', text: 'Primeira' }),
        action(o.id, { type: 'NOTE', text: 'Segunda' }),
      ]);
      const notes = (await order(o.id)).notes ?? '';
      expect(notes.split('\n')).toHaveLength(2);
      expect(notes).toMatch(/Primeira/);
      expect(notes).toMatch(/Segunda/);
      expect(notes).toContain('INSTALLER');
    });

    it('iniciar de novo uma ordem que já está em execução não é erro', async () => {
      const o = await visit();
      expect((await sync(installer.token, [action(o.id, { type: 'START' })])).body[0].status).toBe(
        'APPLIED',
      );
      const second = await sync(installer.token, [action(o.id, { type: 'START' })]);
      expect(second.body[0]).toMatchObject({
        status: 'APPLIED',
        message: expect.stringMatching(/já estava/),
      });
    });

    it('o servidor recusa o que não cabe (item que sumiu, ordem cancelada, técnico fora da escala) e lembra a recusa', async () => {
      const o = await visit();
      const ghost = action(o.id, { type: 'CHECK', itemId: randomUUID(), done: true });
      const r1 = await sync(installer.token, [ghost]);
      expect(r1.body[0]).toMatchObject({
        status: 'REJECTED',
        message: expect.stringMatching(/não existe mais/),
      });
      // Reenviar devolve a mesma recusa, sem tentar de novo.
      const r2 = await sync(installer.token, [ghost]);
      expect(r2.body[0].status).toBe('REJECTED');

      const stranger = await sync(installer2.token, [action(o.id, { type: 'START' })]);
      expect(stranger.body[0]).toMatchObject({
        status: 'REJECTED',
        message: expect.stringMatching(/não está escalado/),
      });
      expect((await order(o.id)).status).toBe('SCHEDULED');

      await post(`/operations/work-orders/${o.id}/cancel`, operations, {
        reason: 'Cliente cancelou',
      });
      const late = await sync(installer.token, [
        action(o.id, { type: 'START' }),
        action(o.id, { type: 'NOTE', text: 'tarde' }),
      ]);
      expect(late.body.map((r: { status: string }) => r.status)).toEqual(['REJECTED', 'REJECTED']);
      expect((await order(o.id)).status).toBe('CANCELLED');

      const missing = await sync(installer.token, [action(randomUUID(), { type: 'START' })]);
      expect(missing.body[0].status).toBe('REJECTED');
    });

    it('uma ação recusada não impede as seguintes do lote', async () => {
      const o = await visit();
      const res = await sync(installer.token, [
        action(o.id, { type: 'CHECK', itemId: randomUUID(), done: true }),
        action(o.id, { type: 'START' }),
      ]);
      expect(res.body.map((r: { status: string }) => r.status)).toEqual(['REJECTED', 'APPLIED']);
      expect((await order(o.id)).status).toBe('IN_PROGRESS');
    });

    it('lote inválido (identificador que não é UUID, ação desconhecida, vazio) falha inteiro e não aplica nada', async () => {
      const o = await visit();
      const bad = await sync(installer.token, [
        action(o.id, { type: 'START' }),
        { ...action(o.id, { type: 'CHECK', itemId: 'x', done: true }) },
      ]);
      expect(bad.status).toBe(422);
      expect((await order(o.id)).status).toBe('SCHEDULED');
      expect((await sync(installer.token, [action(o.id, { type: 'TELEPORT' })])).status).toBe(422);
      expect((await sync(installer.token, [])).status).toBe(422);
    });

    it('outra empresa não age nas ordens daqui', async () => {
      const o = await visit();
      const other = await sync(adminB, [action(o.id, { type: 'START' })]);
      expect(other.body[0].status).toBe('REJECTED');
      expect((await order(o.id)).status).toBe('SCHEDULED');
    });

    it('em instalação real: iniciar leva a "em instalação"; pendência bloqueante pára; concluir é recusado até resolver', async () => {
      const { id, orderId } = await installation();
      await publishAll();
      const start = await sync(installer.token, [
        action(orderId, { type: 'START', geo: { latitude: -15.8, longitude: -47.9 } }),
      ]);
      expect(start.body[0].status).toBe('APPLIED');
      expect((await t.prisma.system.installation.findUniqueOrThrow({ where: { id } })).status).toBe(
        'IN_PROGRESS',
      );
      const issue = await sync(installer.token, [
        action(orderId, {
          type: 'ISSUE',
          issueType: 'ACCESS',
          description: 'Sem acesso ao telhado',
          blocking: true,
        }),
      ]);
      expect(issue.body[0].status).toBe('APPLIED');
      expect((await t.prisma.system.installation.findUniqueOrThrow({ where: { id } })).status).toBe(
        'FIELD_ISSUE',
      );
      const blocked = await sync(installer.token, [action(orderId, { type: 'COMPLETE' })]);
      expect(blocked.body[0]).toMatchObject({
        status: 'REJECTED',
        message: expect.stringMatching(/pendências de campo/),
      });
      const open = await t.prisma.system.fieldIssue.findFirstOrThrow({
        where: { installationId: id, status: 'OPEN' },
      });
      expect(open.workOrderId).toBe(orderId);
      await post(`/operations/issues/${open.id}/resolve`, installer.token, {
        resolution: 'Linha de vida instalada',
      });
      const done = await sync(installer.token, [
        action(orderId, { type: 'COMPLETE', notes: 'Concluída' }),
      ]);
      expect(done.body[0].status).toBe('APPLIED');
      expect((await t.prisma.system.installation.findUniqueOrThrow({ where: { id } })).status).toBe(
        'INSTALLED',
      );
    });
  });

  describe('fotos', () => {
    const upload = (
      token: string,
      orderId: string,
      clientActionId: string,
      fields: Record<string, string> = {},
      file = pngBuffer(),
      contentType = 'image/png',
    ) => {
      let req = t.http
        .post(`${API}/operations/field/work-orders/${orderId}/photos`)
        .set(bearer(token))
        .field('clientActionId', clientActionId);
      for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
      return req.attach('file', file, { filename: 'foto.png', contentType });
    };

    it('envia a foto com legenda, hora e local; reenviar a mesma foto não duplica; conta na ordem', async () => {
      const o = await visit();
      const clientActionId = randomUUID();
      const first = await upload(installer.token, o.id, clientActionId, {
        caption: 'Estrutura fixada',
        takenAt: iso(-1),
        latitude: '-15.79',
        longitude: '-47.88',
        accuracy: '9',
      });
      expect(first.status).toBe(201);
      expect(first.body).toMatchObject({
        caption: 'Estrutura fixada',
        latitude: -15.79,
        visibleToCustomer: false,
      });
      expect(first.body.url).toMatch(/^https?:\/\//);
      const again = await upload(installer.token, o.id, clientActionId, {
        caption: 'Outra legenda',
      });
      expect(again.status).toBe(201);
      expect(again.body.id).toBe(first.body.id);
      expect(await t.prisma.system.workOrderPhoto.count({ where: { workOrderId: o.id } })).toBe(1);
      expect(
        await t.prisma.system.document.count({
          where: { entityType: 'WorkOrder', entityId: o.id },
        }),
      ).toBe(1);
      const dto = (await get(`/operations/work-orders/${o.id}`, operations)).body;
      expect(dto.photoCount).toBe(1);
      const list = await get(`/operations/work-orders/${o.id}/photos`, operations);
      expect(list.body).toHaveLength(1);
      // Aparece na lista do técnico.
      const mine = (await get('/operations/field/work-orders', installer.token)).body.find(
        (x: { id: string }) => x.id === o.id,
      );
      expect(mine.photos).toHaveLength(1);
    });

    it('só imagens; só o técnico escalado; ordem cancelada recusa', async () => {
      const o = await visit();
      const pdf = await upload(
        installer.token,
        o.id,
        randomUUID(),
        {},
        pdfBuffer(),
        'application/pdf',
      );
      expect(pdf.status).toBe(422);
      const stranger = await upload(installer2.token, o.id, randomUUID());
      expect(stranger.status).toBe(403);
      const noFile = await t.http
        .post(`${API}/operations/field/work-orders/${o.id}/photos`)
        .set(bearer(installer.token))
        .field('clientActionId', randomUUID());
      expect(noFile.status).toBe(422);
      await post(`/operations/work-orders/${o.id}/cancel`, operations, { reason: 'Cancelada' });
      expect((await upload(installer.token, o.id, randomUUID())).status).toBe(422);
    });

    it('a operação legenda a foto e decide se o cliente pode vê-la; o técnico não', async () => {
      const o = await visit();
      const photo = (await upload(installer.token, o.id, randomUUID())).body;
      expect(
        (
          await patch(`/operations/photos/${photo.id}`, installer.token, {
            visibleToCustomer: true,
          })
        ).status,
      ).toBe(403);
      const ok = await patch(`/operations/photos/${photo.id}`, operations, {
        visibleToCustomer: true,
        caption: 'Pronta para o cliente',
      });
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ visibleToCustomer: true, caption: 'Pronta para o cliente' });
      expect(
        (await patch(`/operations/photos/${randomUUID()}`, operations, { caption: 'x' })).status,
      ).toBe(404);
    });

    it('as fotos de uma empresa não aparecem para outra', async () => {
      const o = await visit();
      await upload(installer.token, o.id, randomUUID());
      expect((await get(`/operations/work-orders/${o.id}/photos`, adminB)).status).toBe(404);
    });
  });

  describe('assinatura do cliente', () => {
    const sign = (
      token: string,
      orderId: string,
      clientActionId: string,
      name = 'Maria da Silva',
      file = pngBuffer(),
      contentType = 'image/png',
    ) =>
      t.http
        .post(`${API}/operations/field/work-orders/${orderId}/signature`)
        .set(bearer(token))
        .field('clientActionId', clientActionId)
        .field('signedByName', name)
        .attach('file', file, { filename: 'assinatura.png', contentType });

    it('só com a ordem em execução ou concluída; grava o nome e a data; repetir a mesma chave não duplica; refazer substitui', async () => {
      const o = await visit();
      expect((await sign(installer.token, o.id, randomUUID())).status).toBe(422);
      await sync(installer.token, [action(o.id, { type: 'START' })]);
      const key = randomUUID();
      const first = await sign(installer.token, o.id, key);
      expect(first.status).toBe(200);
      expect(first.body.signedByName).toBe('Maria da Silva');
      const row = await order(o.id);
      expect(row.signedByName).toBe('Maria da Silva');
      expect(row.signatureDocumentId).not.toBeNull();
      const again = await sign(installer.token, o.id, key);
      expect(again.status).toBe(200);
      expect((await order(o.id)).signatureDocumentId).toBe(row.signatureDocumentId);
      const redo = await sign(installer.token, o.id, randomUUID(), 'João Pereira');
      expect(redo.status).toBe(200);
      const after = await order(o.id);
      expect(after.signedByName).toBe('João Pereira');
      const versions = await t.prisma.system.document.findMany({
        where: { entityType: 'WorkOrderSignature', entityId: o.id },
        orderBy: { version: 'asc' },
      });
      expect(versions.map((d) => d.version)).toEqual([1, 2]);
      const dto = (await get(`/operations/work-orders/${o.id}`, operations)).body;
      expect(dto).toMatchObject({ signedByName: 'João Pereira' });
    });

    it('exige PNG, nome e a escala do técnico', async () => {
      const o = await visit();
      await sync(installer.token, [action(o.id, { type: 'START' })]);
      expect(
        (await sign(installer.token, o.id, randomUUID(), 'Maria', pdfBuffer(), 'application/pdf'))
          .status,
      ).toBe(422);
      expect((await sign(installer.token, o.id, randomUUID(), 'M')).status).toBe(422);
      expect((await sign(installer2.token, o.id, randomUUID())).status).toBe(403);
    });
  });
});
