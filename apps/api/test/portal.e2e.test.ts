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

const COOKIE = 'voltex_portal';

describe('Portal do cliente (e2e)', () => {
  let t: TestApp;
  let a: SeededTenant;
  let b: SeededTenant;
  let flow: Flow;
  let manager: string;
  let seller: string;
  let om: string;
  let sdr: string;
  let adminB: string;

  const get = (path: string, token: string) => t.http.get(`${API}${path}`).set(bearer(token));
  const post = (path: string, token: string, body: unknown = {}) =>
    t.http
      .post(`${API}${path}`)
      .set(bearer(token))
      .send(body as object);

  const cookieOf = (res: { headers: Record<string, unknown> }): string => {
    const raw = ((res.headers['set-cookie'] as string[] | undefined) ?? []).find((c) =>
      c.startsWith(`${COOKIE}=`),
    );
    if (!raw) throw new Error('sem cookie do portal');
    return raw.split(';')[0] as string;
  };
  const tokenFromUrl = (url: string) => url.split('/portal/acesso/')[1] as string;

  /** Cliente com contrato assinado + acesso liberado + sessão aberta. */
  const customer = async (
    email = `cliente-${Math.random().toString(36).slice(2, 8)}@teste.test`,
  ) => {
    const deal = await signedDeal(flow, manager);
    const access = await post('/portal-access', manager, { accountId: deal.accountId, email });
    expect(access.status).toBe(201);
    const link = await post(`/portal-access/${access.body.id}/link`, manager);
    expect(link.status).toBe(200);
    const exchanged = await t.http
      .post(`${API}/public/portal/exchange`)
      .send({ token: tokenFromUrl(link.body.url) });
    expect(exchanged.status).toBe(200);
    const cookie = cookieOf(exchanged);
    const portalGet = (path: string) => t.http.get(`${API}/portal${path}`).set('Cookie', cookie);
    const portalPost = (path: string, body: unknown = {}) =>
      t.http
        .post(`${API}/portal${path}`)
        .set('Cookie', cookie)
        .send(body as object);
    return { deal, email, accessId: access.body.id as string, cookie, portalGet, portalPost };
  };

  /** Planta ativa da instalação do projeto (aceite já feito pelo escritório). */
  const activate = async (projectId: string) => {
    const { OutboxPublisher } = await import('../src/platform/events/outbox-publisher.service');
    await t.app.get(OutboxPublisher).publishPending(1000, a.id);
    const inst = await t.prisma.system.installation.findFirstOrThrow({ where: { projectId } });
    await t.prisma.system.materialItem.create({
      data: {
        tenantId: a.id,
        installationId: inst.id,
        category: 'MODULE',
        description: 'Módulo',
        quantity: 4,
        unit: 'un',
        status: 'RECEIVED',
      },
    });
    await t.prisma.system.installation.update({
      where: { id: inst.id },
      data: { status: 'DONE', installedAt: new Date(), acceptedAt: new Date(), doneAt: new Date() },
    });
    expect((await post('/operations/plants/reconcile', om)).status).toBe(200);
    return t.prisma.system.plant.findFirstOrThrow({ where: { installationId: inst.id } });
  };

  beforeAll(async () => {
    t = await createTestApp();
    a = await seedTenant(t.prisma, 'portal');
    b = await seedTenant(t.prisma, 'portalb');
    manager = await tokenFor(t.http, a.manager);
    seller = await tokenFor(t.http, a.salesperson);
    adminB = await tokenFor(t.http, b.admin);
    om = (await tokenWithRole(t, a, 'OM')).token;
    sdr = await tokenFor(t.http, a.sdr);
    flow = { t, tenant: a, seller, admin: await tokenFor(t.http, a.owner) };
    await ensureMarginPolicy(flow, manager);
  });
  afterAll(() => t.close());

  describe('acessos (usuário interno)', () => {
    it('libera, é idempotente por e-mail e só quem tem permissão mexe', async () => {
      const deal = await signedDeal(flow, manager);
      const body = { accountId: deal.accountId, email: 'Maria@Teste.test ' };
      const first = await post('/portal-access', manager, body);
      expect(first.status).toBe(201);
      expect(first.body).toMatchObject({ email: 'maria@teste.test', active: true });
      const again = await post('/portal-access', manager, body);
      expect(again.body.id).toBe(first.body.id);
      expect((await post('/portal-access', sdr, body)).status).toBe(403);
      expect((await get(`/portal-access?accountId=${deal.accountId}`, manager)).body).toHaveLength(
        1,
      );
      expect((await post('/portal-access', adminB, body)).status).toBe(404);
    });

    it('desativar derruba a sessão e invalida links abertos', async () => {
      const c = await customer();
      expect((await c.portalGet('/me')).status).toBe(200);
      const pending = await post(`/portal-access/${c.accessId}/link`, manager);
      const off = await post(`/portal-access/${c.accessId}/deactivate`, manager);
      expect(off.body.active).toBe(false);
      expect((await c.portalGet('/me')).status).toBe(401);
      const exchange = await t.http
        .post(`${API}/public/portal/exchange`)
        .send({ token: tokenFromUrl(pending.body.url) });
      expect(exchange.status).toBe(404);
    });
  });

  describe('link mágico', () => {
    it('o pedido do cliente responde sempre igual, só envia e-mail a quem tem acesso e respeita o intervalo', async () => {
      const deal = await signedDeal(flow, manager);
      await post('/portal-access', manager, {
        accountId: deal.accountId,
        email: 'tem@acesso.test',
      });
      const before = t.mail.sent.length;
      const unknown = await t.http
        .post(`${API}/public/portal/request-link`)
        .send({ email: 'ninguem@nada.test' });
      const known = await t.http
        .post(`${API}/public/portal/request-link`)
        .send({ email: 'TEM@acesso.test' });
      expect(unknown.status).toBe(202);
      expect(known.status).toBe(202);
      expect(known.body).toEqual(unknown.body);
      expect(t.mail.sent.length).toBe(before + 1);
      const mail = t.mail.last();
      expect(mail.to).toBe('tem@acesso.test');
      expect(mail.text).toMatch(/\/portal\/acesso\//);
      // Segundo pedido no mesmo minuto: nada novo é enviado.
      await t.http.post(`${API}/public/portal/request-link`).send({ email: 'tem@acesso.test' });
      expect(t.mail.sent.length).toBe(before + 1);

      const token = /\/portal\/acesso\/([\w-]+)/.exec(mail.text)?.[1];
      const ok = await t.http.post(`${API}/public/portal/exchange`).send({ token });
      expect(ok.status).toBe(200);
    });

    it('a sessão vai em cookie httpOnly, SameSite=Strict e restrito ao portal; o link só vale uma vez', async () => {
      const deal = await signedDeal(flow, manager);
      const access = await post('/portal-access', manager, {
        accountId: deal.accountId,
        email: 'um@uso.test',
      });
      const link = await post(`/portal-access/${access.body.id}/link`, manager);
      const token = tokenFromUrl(link.body.url);
      const ok = await t.http.post(`${API}/public/portal/exchange`).send({ token });
      expect(ok.status).toBe(200);
      const raw = (ok.headers['set-cookie'] as unknown as string[]).find((c) =>
        c.startsWith(`${COOKIE}=`),
      )!;
      expect(raw).toMatch(/HttpOnly/i);
      expect(raw).toMatch(/SameSite=Strict/i);
      expect(raw).toMatch(/Path=\/api\/v1\/portal/);
      expect(JSON.stringify(ok.body)).not.toContain(token);
      const reused = await t.http.post(`${API}/public/portal/exchange`).send({ token });
      expect(reused.status).toBe(410);
    });

    it('link inexistente: 404; vencido: 410; duas aberturas ao mesmo tempo: só uma passa', async () => {
      expect(
        (await t.http.post(`${API}/public/portal/exchange`).send({ token: 'x'.repeat(43) })).status,
      ).toBe(404);
      const deal = await signedDeal(flow, manager);
      const access = await post('/portal-access', manager, {
        accountId: deal.accountId,
        email: 'corrida@teste.test',
      });
      const expired = await post(`/portal-access/${access.body.id}/link`, manager);
      await t.prisma.system.portalMagicLink.updateMany({
        where: { accessId: access.body.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      expect(
        (
          await t.http
            .post(`${API}/public/portal/exchange`)
            .send({ token: tokenFromUrl(expired.body.url) })
        ).status,
      ).toBe(410);

      const fresh = await post(`/portal-access/${access.body.id}/link`, manager);
      const token = tokenFromUrl(fresh.body.url);
      const results = await Promise.all(
        Array.from({ length: 4 }, () =>
          t.http.post(`${API}/public/portal/exchange`).send({ token }),
        ),
      );
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 410)).toHaveLength(3);
    });

    it('só o hash do link e da sessão fica no banco', async () => {
      const c = await customer();
      const links = await t.prisma.system.portalMagicLink.findMany({
        where: { accessId: c.accessId },
      });
      const sessions = await t.prisma.system.portalSession.findMany({
        where: { accessId: c.accessId },
      });
      const secret = c.cookie.slice(`${COOKIE}=`.length);
      expect(JSON.stringify(sessions)).not.toContain(secret);
      expect(links[0]?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(sessions[0]?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('sessão', () => {
    it('sem cookie: 401; o login interno não abre o portal e o cookie do portal não abre a área interna', async () => {
      expect((await t.http.get(`${API}/portal/me`)).status).toBe(401);
      expect((await get('/portal/me', manager)).status).toBe(401);
      const c = await customer();
      expect((await t.http.get(`${API}/users`).set('Cookie', c.cookie)).status).toBe(401);
      expect((await t.http.get(`${API}/projects`).set('Cookie', c.cookie)).status).toBe(401);
    });

    it('sessão vencida ou encerrada é recusada; sair revoga', async () => {
      const c = await customer();
      expect((await c.portalPost('/logout')).status).toBe(204);
      expect((await c.portalGet('/me')).status).toBe(401);
      const d = await customer();
      await t.prisma.system.portalSession.updateMany({
        where: { accessId: d.accessId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      expect((await d.portalGet('/me')).status).toBe(401);
    });

    it('empresa suspensa derruba o acesso', async () => {
      const c = await customer();
      await t.prisma.system.tenant.update({ where: { id: a.id }, data: { status: 'SUSPENDED' } });
      expect((await c.portalGet('/me')).status).toBe(401);
      await t.prisma.system.tenant.update({ where: { id: a.id }, data: { status: 'ACTIVE' } });
      expect((await c.portalGet('/me')).status).toBe(200);
    });
  });

  describe('o que o cliente vê', () => {
    it('só o próprio projeto, com marcos e situação em linguagem simples', async () => {
      const mine = await customer();
      const other = await customer();
      const projects = (await mine.portalGet('/projects')).body;
      expect(projects).toHaveLength(1);
      expect(projects[0].id).toBe(mine.deal.projectId);
      expect(
        projects[0].milestones.find((m: { key: string }) => m.key === 'CONTRACT'),
      ).toMatchObject({
        done: true,
      });
      expect(projects[0].milestones.find((m: { key: string }) => m.key === 'ACTIVE')).toMatchObject(
        { done: false },
      );
      expect((await mine.portalGet(`/projects/${other.deal.projectId}`)).status).toBe(404);
      expect((await mine.portalGet(`/projects/${mine.deal.projectId}`)).status).toBe(200);
    });

    it('não expõe custo, margem nem nada interno', async () => {
      const c = await customer();
      const detail = JSON.stringify((await c.portalGet(`/projects/${c.deal.projectId}`)).body);
      for (const forbidden of [
        'marginRate',
        'costCents',
        'commissionRate',
        'rulesRef',
        'unitCostCents',
        '"internal"',
      ])
        expect(detail.toLowerCase()).not.toContain(forbidden.toLowerCase());
    });

    it('documentos: o contrato assinado é liberado; arquivo qualquer do projeto, não', async () => {
      const c = await customer();
      const detail = (await c.portalGet(`/projects/${c.deal.projectId}`)).body;
      const contract = detail.documents.find((d: { kind: string }) => d.kind === 'CONTRACT');
      expect(contract).toBeDefined();
      const ok = await c.portalGet(
        `/projects/${c.deal.projectId}/documents/${contract.id}/download`,
      );
      expect(ok.status).toBe(200);
      expect(ok.body.url).toMatch(/^https?:\/\//);
      const bill = await t.prisma.system.document.findFirstOrThrow({
        where: { tenantId: a.id, id: { not: contract.id } },
      });
      expect(
        (await c.portalGet(`/projects/${c.deal.projectId}/documents/${bill.id}/download`)).status,
      ).toBe(404);
    });

    it('parcelas só para consulta, sem cancelamentos', async () => {
      const c = await customer();
      const p = await t.prisma.system.project.findUniqueOrThrow({
        where: { id: c.deal.projectId },
      });
      const fin = (await tokenWithRole(t, a, 'FINANCE')).token;
      const day = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
      await post(`/projects/${p.id}/finance/receivables`, fin, {
        referenceId: 'NF-1',
        order: 1,
        amountCents: 1000,
        dueOn: day,
      });
      const cancelled = await post(`/projects/${p.id}/finance/receivables`, fin, {
        referenceId: 'NF-2',
        order: 2,
        amountCents: 1000,
        dueOn: day,
      });
      await post(`/projects/${p.id}/finance/receivables/${cancelled.body.id}/cancel`, fin, {
        reason: 'Renegociada',
      });
      const detail = (await c.portalGet(`/projects/${p.id}`)).body;
      expect(detail.receivables).toHaveLength(1);
      expect(detail.receivables[0]).toMatchObject({ order: 1, status: 'OPEN' });
    });
  });

  describe('chamados', () => {
    it('abre chamado da própria usina, vê o andamento e comenta; comentário interno não aparece', async () => {
      const c = await customer();
      const plant = await activate(c.deal.projectId);
      const created = await c.portalPost('/tickets', {
        plantId: plant.id,
        title: 'Inversor com luz vermelha',
        description: 'Desde ontem',
      });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ status: 'OPEN', title: 'Inversor com luz vermelha' });
      const row = await t.prisma.system.ticket.findUniqueOrThrow({
        where: { id: created.body.id },
      });
      expect(row.origin).toBe('CUSTOMER');

      await post(`/operations/tickets/${row.id}/comments`, om, {
        body: 'Nota interna: verificar garantia',
        internal: true,
      });
      await post(`/operations/tickets/${row.id}/comments`, om, {
        body: 'Vamos enviar um técnico amanhã',
        internal: false,
      });
      const comment = await c.portalPost(`/tickets/${row.id}/comments`, { body: 'Obrigado!' });
      expect(comment.status).toBe(201);
      const detail = (await c.portalGet(`/tickets/${row.id}`)).body;
      expect(detail.comments.map((x: { body: string }) => x.body)).toEqual([
        'Vamos enviar um técnico amanhã',
        'Obrigado!',
      ]);
      expect(detail.comments.at(-1).fromYou).toBe(true);
      expect((await c.portalGet('/tickets')).body).toHaveLength(1);
    });

    it('não abre nem lê chamado de outra usina', async () => {
      const mine = await customer();
      const other = await customer();
      const plantOther = await activate(other.deal.projectId);
      const denied = await mine.portalPost('/tickets', {
        plantId: plantOther.id,
        title: 'Tentativa',
      });
      expect(denied.status).toBe(404);
      const ticket = await other.portalPost('/tickets', {
        plantId: plantOther.id,
        title: 'Do outro cliente',
      });
      expect((await mine.portalGet(`/tickets/${ticket.body.id}`)).status).toBe(404);
      expect(
        (await mine.portalPost(`/tickets/${ticket.body.id}/comments`, { body: 'x' })).status,
      ).toBe(404);
    });

    it('valida o corpo', async () => {
      const c = await customer();
      expect((await c.portalPost('/tickets', { plantId: 'nao-e-uuid', title: 'ab' })).status).toBe(
        422,
      );
    });
  });

  describe('aceite pelo portal', () => {
    it('só vale quando a instalação aguarda o aceite; registra nome, canal, IP e navegador', async () => {
      const c = await customer();
      const { OutboxPublisher } = await import('../src/platform/events/outbox-publisher.service');
      await t.app.get(OutboxPublisher).publishPending(1000, a.id);
      const early = await c.portalPost(`/projects/${c.deal.projectId}/acceptance`, {
        acceptedByName: 'Maria da Silva',
      });
      expect(early.status).toBe(422);
      expect(early.body.code).toBe('ACCEPTANCE_NOT_PENDING');

      const inst = await t.prisma.system.installation.findFirstOrThrow({
        where: { projectId: c.deal.projectId },
      });
      await t.prisma.system.installation.update({
        where: { id: inst.id },
        data: { status: 'CUSTOMER_ACCEPTANCE' },
      });
      await t.prisma.system.commissioningRecord.create({
        data: {
          tenantId: a.id,
          installationId: inst.id,
          attempt: 1,
          status: 'APPROVED',
          ruleRef: 'teste',
          provisional: false,
          decidedAt: new Date(),
        },
      });
      const pending = (await c.portalGet(`/projects/${c.deal.projectId}`)).body;
      expect(pending.acceptance.status).toBe('PENDING');
      expect(pending.statusLabel).toBe('Aguardando o seu aceite');

      const done = await t.http
        .post(`${API}/portal/projects/${c.deal.projectId}/acceptance`)
        .set('Cookie', c.cookie)
        .set('User-Agent', 'Navegador-de-teste/1.0')
        .send({ acceptedByName: 'Maria da Silva' });
      expect(done.status).toBe(200);
      expect(done.body.acceptance).toMatchObject({
        status: 'DONE',
        acceptedByName: 'Maria da Silva',
      });
      const saved = await t.prisma.system.installation.findUniqueOrThrow({
        where: { id: inst.id },
      });
      expect(saved).toMatchObject({
        status: 'DONE',
        acceptedChannel: 'PORTAL',
        acceptanceUserAgent: 'Navegador-de-teste/1.0',
      });
      expect(saved.acceptanceIp).toBeTruthy();
      const again = await c.portalPost(`/projects/${c.deal.projectId}/acceptance`, {
        acceptedByName: 'Maria da Silva',
      });
      expect(again.status).toBe(422);
    });
  });

  describe('documento enviado pelo cliente', () => {
    it('fica em quarentena até um usuário interno aceitar; aceito, o cliente passa a vê-lo', async () => {
      const c = await customer();
      const sent = await t.http
        .post(`${API}/portal/projects/${c.deal.projectId}/uploads`)
        .set('Cookie', c.cookie)
        .field('note', 'Conta de luz')
        .attach('file', pdfBuffer('conta'), {
          filename: 'conta.pdf',
          contentType: 'application/pdf',
        });
      expect(sent.status).toBe(201);
      expect(sent.body).toMatchObject({ status: 'PENDING', filename: 'conta.pdf' });

      // Quarentena: o cliente não baixa de volta e a lista de documentos liberados não o inclui.
      const detail = (await c.portalGet(`/projects/${c.deal.projectId}`)).body;
      expect(detail.documents.some((d: { kind: string }) => d.kind === 'SENT_BY_YOU')).toBe(false);
      expect(detail.uploads).toHaveLength(1);

      const pending = (await get('/portal-access/uploads', manager)).body;
      const item = pending.find((u: { id: string }) => u.id === sent.body.id);
      expect(item).toMatchObject({
        projectCode: expect.any(String),
        accountName: expect.any(String),
      });
      expect((await get('/portal-access/uploads', sdr)).status).toBe(403);

      const reviewed = await post(`/portal-access/uploads/${sent.body.id}/review`, manager, {
        accept: true,
      });
      expect(reviewed.body.status).toBe('ACCEPTED');
      const doc = await t.prisma.system.document.findUniqueOrThrow({
        where: { id: item.documentId },
      });
      expect(doc).toMatchObject({ entityType: 'Project', entityId: c.deal.projectId });
      const after = (await c.portalGet(`/projects/${c.deal.projectId}`)).body;
      expect(after.documents.some((d: { kind: string }) => d.kind === 'SENT_BY_YOU')).toBe(true);
      expect(
        (await post(`/portal-access/uploads/${sent.body.id}/review`, manager, { accept: false }))
          .status,
      ).toBe(422);
    });

    it('recusa arquivo de tipo não permitido e o envio recusado sai de circulação', async () => {
      const c = await customer();
      const exe = await t.http
        .post(`${API}/portal/projects/${c.deal.projectId}/uploads`)
        .set('Cookie', c.cookie)
        .attach('file', Buffer.from('MZ\x90\x00 programa'), {
          filename: 'virus.exe',
          contentType: 'application/x-msdownload',
        });
      expect([400, 415, 422]).toContain(exe.status);

      const ok = await t.http
        .post(`${API}/portal/projects/${c.deal.projectId}/uploads`)
        .set('Cookie', c.cookie)
        .attach('file', pdfBuffer('x'), { filename: 'x.pdf', contentType: 'application/pdf' });
      const rejected = await post(`/portal-access/uploads/${ok.body.id}/review`, manager, {
        accept: false,
        note: 'Ilegível',
      });
      expect(rejected.body).toMatchObject({ status: 'REJECTED', reviewNote: 'Ilegível' });
      const upload = await t.prisma.system.portalUpload.findUniqueOrThrow({
        where: { id: ok.body.id },
      });
      const doc = await t.prisma.system.document.findUniqueOrThrow({
        where: { id: upload.documentId },
      });
      expect(doc.deletedAt).not.toBeNull();
    });

    it('não envia para projeto de outro cliente', async () => {
      const mine = await customer();
      const other = await customer();
      const res = await t.http
        .post(`${API}/portal/projects/${other.deal.projectId}/uploads`)
        .set('Cookie', mine.cookie)
        .attach('file', pdfBuffer('x'), { filename: 'x.pdf', contentType: 'application/pdf' });
      expect(res.status).toBe(404);
    });
  });

  describe('isolamento entre empresas', () => {
    it('outra empresa não gerencia os acessos desta', async () => {
      const c = await customer();
      expect((await post(`/portal-access/${c.accessId}/deactivate`, adminB)).status).toBe(404);
      expect((await post(`/portal-access/${c.accessId}/link`, adminB)).status).toBe(404);
      expect((await get('/portal-access/uploads', adminB)).body).toEqual([]);
    });
  });
});
