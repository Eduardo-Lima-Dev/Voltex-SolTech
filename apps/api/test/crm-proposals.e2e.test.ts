import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { extractText, getDocumentProxy } from 'unpdf';
import {
  API,
  bearer,
  createTestApp,
  seedTenant,
  tokenFor,
  type SeededTenant,
  type TestApp,
} from './helpers';
import { buildOpportunity, referenceQuote, type Flow, type Ready } from './crm-flow';
import { auditOf, outboxOf, pngBuffer, tokenWithRole } from './crm-support';

describe('CRM · Proposta (e2e)', () => {
  let t: TestApp;
  let a: SeededTenant;
  let b: SeededTenant;
  let flow: Flow;
  let admin: string;
  let manager: string;
  let seller: string;
  let sdr: string;
  let adminB: string;
  let installer: string;
  let publish: () => Promise<number>;

  const post = (path: string, token: string, body: unknown = {}) =>
    t.http
      .post(`${API}${path}`)
      .set(bearer(token))
      .send(body as object);
  const get = (path: string, token: string) => t.http.get(`${API}${path}`).set(bearer(token));
  const put = (path: string, token: string, body: unknown) =>
    t.http
      .put(`${API}${path}`)
      .set(bearer(token))
      .send(body as object);
  const publicGet = (token: string) => t.http.get(`${API}/public/proposals/${token}`);
  const accept = (
    token: string,
    body: Record<string, unknown> = { name: 'Maria da Silva', acknowledge: true },
  ) => t.http.post(`${API}/public/proposals/${token}/accept`).send(body);
  const tokenOf = (url: string) => url.split('/p/')[1] as string;
  const pdfText = async (buffer: Buffer) => {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    return (await extractText(pdf, { mergePages: true })).text;
  };
  const binary = (res: { body: unknown }) => res.body as Buffer;

  /** Oportunidade em Cotação, triagem verde, uma cotação dentro da política. */
  async function quotingOpportunity(
    options: { name?: string } = {},
  ): Promise<Ready & { quoteId: string }> {
    const ready = await buildOpportunity(flow, options);
    await post(`/opportunities/${ready.opportunityId}/guard/evaluate`, seller);
    await post(`/opportunities/${ready.opportunityId}/stage`, seller, { stage: 'QUOTING' });
    const quote = await post(
      `/opportunities/${ready.opportunityId}/quotes`,
      seller,
      referenceQuote(),
    );
    return { ...ready, quoteId: quote.body.id };
  }
  const createProposal = (
    opportunityId: string,
    quoteIds: string[],
    extra: Record<string, unknown> = {},
    token = seller,
  ) => post(`/opportunities/${opportunityId}/proposals`, token, { quoteIds, ...extra });
  const stageOf = async (opportunityId: string) =>
    (await get(`/opportunities/${opportunityId}`, seller)).body.stage as string;

  beforeAll(async () => {
    t = await createTestApp();
    const { OutboxPublisher } = await import('../src/platform/events/outbox-publisher.service');
    publish = () => t.app.get(OutboxPublisher).publishPending(500, a.id);
    a = await seedTenant(t.prisma, 'prop');
    b = await seedTenant(t.prisma, 'propb');
    admin = await tokenFor(t.http, a.admin);
    manager = await tokenFor(t.http, a.manager);
    seller = await tokenFor(t.http, a.salesperson);
    sdr = await tokenFor(t.http, a.sdr);
    adminB = await tokenFor(t.http, b.admin);
    installer = (await tokenWithRole(t, a, 'INSTALLER')).token;
    flow = { t, tenant: a, seller, admin };
    await t.prisma.system.marginPolicy.updateMany({
      where: { tenantId: a.id },
      data: { deletedAt: new Date() },
    });
    expect(
      (await post('/margin-policies', manager, { name: 'Mínimo geral', minMarginRate: 0.2 }))
        .status,
    ).toBe(201);
  });
  afterAll(() => t.close());

  describe('geração', () => {
    it('gera a proposta v1 a partir da cotação: snapshot sem custos, cotação travada, etapa Proposta pronta, PDF legível', async () => {
      const ready = await quotingOpportunity({ name: 'Maria Souza Ltda' });
      const res = await createProposal(ready.opportunityId, [ready.quoteId], {
        validityDays: 10,
        paymentTerms: '30% de entrada + 6x',
        notes: 'Instalação em até 30 dias.',
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        version: 1,
        status: 'GENERATED',
        viewCount: 0,
        expired: false,
        sentAt: null,
      });
      expect(res.body.scenarios).toHaveLength(1);
      expect(res.body.scenarios[0]).toMatchObject({
        label: 'Proposta',
        quoteId: ready.quoteId,
        quoteVersion: 1,
        priceCents: 1_980_000,
      });
      expect(res.body.snapshotId).toBeTruthy();
      expect(res.body.pdfDocumentId).toBeTruthy();
      expect(await stageOf(ready.opportunityId)).toBe('PROPOSAL_READY');

      // Cotação travada: não edita nem exclui.
      const quote = (await get(`/quotes/${ready.quoteId}`, seller)).body;
      expect(quote.locked).toBe(true);
      expect(
        (
          await t.http
            .patch(`${API}/quotes/${ready.quoteId}`)
            .set(bearer(seller))
            .send({ priceCents: 1 })
        ).status,
      ).toBe(409);
      expect(
        (await t.http.delete(`${API}/quotes/${ready.quoteId}`).set(bearer(seller))).status,
      ).toBe(409);

      // Snapshot: nada de custo nem margem; premissas e rastreabilidade presentes.
      const snapshot = await t.prisma.system.proposalSnapshot.findUniqueOrThrow({
        where: { id: res.body.snapshotId },
      });
      const raw = JSON.stringify(snapshot.content);
      expect(raw).not.toMatch(
        /margin|unitCostCents|commission|contingency|taxRate|materialsCents/i,
      );
      expect(snapshot.content).toMatchObject({
        customerName: 'Maria Souza Ltda',
        projectCode: ready.projectCode,
        conditions: {
          paymentTerms: '30% de entrada + 6x',
          notes: 'Instalação em até 30 dias.',
          validityDays: 10,
        },
        guard: { status: 'GREEN', overridden: false },
      });
      expect(snapshot.contentHash).toMatch(/^[0-9a-f]{64}$/);

      // PDF baixável e legível, sem custos.
      const url = (await get(`/proposals/${res.body.id}/pdf-url`, seller)).body.url as string;
      const file = await fetch(url);
      const text = await pdfText(Buffer.from(await file.arrayBuffer()));
      expect(text).toContain('Maria Souza Ltda');
      expect(text).toContain(ready.projectCode);
      expect(text).toContain('19.800,00');
      expect(text).not.toMatch(/margem/i);

      expect(
        (await auditOf(t, a.id, 'proposal.generated')).some((l) => l.entityId === res.body.id),
      ).toBe(true);
      expect(
        (await outboxOf(t, a.id, 'ProposalGenerated')).some(
          (e) => e.projectCode === ready.projectCode,
        ),
      ).toBe(true);
      const timeline = (await get(`/opportunities/${ready.opportunityId}/timeline`, seller)).body;
      expect(timeline.some((e: { type: string }) => e.type === 'PROPOSAL_GENERATED')).toBe(true);
    });

    it('vários cenários, com nomes; o snapshot é imutável no banco', async () => {
      const ready = await quotingOpportunity();
      const second = await post(
        `/opportunities/${ready.opportunityId}/quotes`,
        seller,
        referenceQuote({ title: 'Premium', priceCents: 2_400_000 }),
      );
      const res = await createProposal(ready.opportunityId, [ready.quoteId, second.body.id], {
        labels: ['Essencial', 'Premium'],
      });
      expect(res.status).toBe(201);
      expect(res.body.scenarios.map((s: { label: string }) => s.label)).toEqual([
        'Essencial',
        'Premium',
      ]);
      expect(res.body.scenarios[1].priceCents).toBe(2_400_000);
      // Payback recalculado sobre o preço de cada cotação.
      const content = (
        await t.prisma.system.proposalSnapshot.findUniqueOrThrow({
          where: { id: res.body.snapshotId },
        })
      ).content as { scenarios: { simplePaybackYears: number | null }[] };
      expect(content.scenarios[1]!.simplePaybackYears).toBeGreaterThan(
        content.scenarios[0]!.simplePaybackYears as number,
      );

      await expect(
        t.prisma.system.proposalSnapshot.update({
          where: { id: res.body.snapshotId },
          data: { contentHash: 'x' },
        }),
      ).rejects.toThrow(/imutável/);
      await expect(
        t.prisma.system.proposalSnapshot.delete({ where: { id: res.body.snapshotId } }),
      ).rejects.toThrow(/imutável/);
    });

    it('nova versão substitui a anterior e o link antigo deixa de valer', async () => {
      const ready = await quotingOpportunity();
      const v1 = (await createProposal(ready.opportunityId, [ready.quoteId])).body;
      const sent = await post(`/proposals/${v1.id}/send`, seller);
      const oldToken = tokenOf(sent.body.publicUrl);

      const quote2 = (
        await post(
          `/opportunities/${ready.opportunityId}/quotes`,
          seller,
          referenceQuote({ priceCents: 2_000_000 }),
        )
      ).body;
      const v2 = await createProposal(ready.opportunityId, [quote2.id]);
      expect(v2.body.version).toBe(2);
      expect((await get(`/proposals/${v1.id}`, seller)).body.status).toBe('SUPERSEDED');
      const list = (await get(`/opportunities/${ready.opportunityId}/proposals`, seller)).body;
      expect(list.map((p: { version: number }) => p.version)).toEqual([2, 1]);

      const old = await publicGet(oldToken);
      expect(old.status).toBe(200);
      expect(old.body.status).toBe('SUPERSEDED');
      expect((await accept(oldToken)).status).toBe(410);
      expect((await post(`/proposals/${v1.id}/send`, seller)).status).toBe(409);
    });

    it('bloqueios: etapa errada, triagem vermelha/desatualizada, margem sem liberação, cotação alheia, sem cálculo', async () => {
      // Fora de Cotação.
      const early = await buildOpportunity(flow);
      const earlyQuote = await post(
        `/opportunities/${early.opportunityId}/quotes`,
        seller,
        referenceQuote(),
      );
      const wrongStage = await createProposal(early.opportunityId, [earlyQuote.body.id]);
      expect(wrongStage.status).toBe(422);
      expect(wrongStage.body.code).toBe('WRONG_STAGE');

      // Triagem desatualizada depois de entrar em Cotação.
      const stale = await quotingOpportunity();
      await t.http
        .patch(`${API}/sites/${stale.siteId}`)
        .set(bearer(seller))
        .send({
          intake: {
            roofType: 'CERAMIC',
            roofAzimuthDegrees: 90,
            tiltDegrees: 15,
            shading: 'NONE',
            availableAreaM2: 80,
            entryBreakerAmps: 63,
            groundingAdequate: true,
          },
        });
      const blocked = await createProposal(stale.opportunityId, [stale.quoteId]);
      expect(blocked.status).toBe(422);
      expect(blocked.body.code).toBe('GUARD_REQUIRED');

      // Margem abaixo do mínimo e sem aprovação.
      const low = await quotingOpportunity();
      const cheap = (
        await post(
          `/opportunities/${low.opportunityId}/quotes`,
          seller,
          referenceQuote({ priceCents: 1_300_000 }),
        )
      ).body;
      expect(cheap.marginStatus).toBe('BELOW_POLICY');
      const margin = await createProposal(low.opportunityId, [cheap.id]);
      expect(margin.status).toBe(422);
      expect(margin.body.code).toBe('MARGIN_NOT_RELEASED');
      // Aprovada, passa.
      await post(`/quotes/${cheap.id}/request-approval`, seller, {
        justification: 'Cliente estratégico da região.',
      });
      const approval = (await get('/approvals?status=PENDING', manager)).body.data.find(
        (x: { quoteId: string }) => x.quoteId === cheap.id,
      );
      await post(`/approvals/${approval.id}/decide`, manager, {
        approve: true,
        justification: 'Aprovado, volume compensa.',
      });
      expect((await createProposal(low.opportunityId, [cheap.id])).status).toBe(201);

      // Cotação de outra oportunidade.
      const one = await quotingOpportunity();
      const two = await quotingOpportunity();
      expect((await createProposal(one.opportunityId, [two.quoteId])).status).toBe(422);

      // Cotação sem cálculo vinculado.
      const noCalc = await quotingOpportunity();
      await t.prisma.system.quote.update({
        where: { id: noCalc.quoteId },
        data: { calculationSessionId: null },
      });
      const missing = await createProposal(noCalc.opportunityId, [noCalc.quoteId]);
      expect(missing.status).toBe(422);
      expect(missing.body.message).toMatch(/não tem cálculo vinculado/);
    });

    it('valida o corpo: 1 a 3 cotações, validade de 1 a 90 dias', async () => {
      const ready = await quotingOpportunity();
      expect((await createProposal(ready.opportunityId, [])).status).toBe(422);
      expect(
        (
          await createProposal(ready.opportunityId, [
            ready.quoteId,
            ready.quoteId,
            ready.quoteId,
            ready.quoteId,
          ])
        ).status,
      ).toBe(422);
      expect(
        (await createProposal(ready.opportunityId, [ready.quoteId], { validityDays: 0 })).status,
      ).toBe(422);
      expect(
        (await createProposal(ready.opportunityId, [ready.quoteId], { validityDays: 91 })).status,
      ).toBe(422);
    });

    it('a etapa Proposta pronta/enviada só nasce pelas ações próprias', async () => {
      const ready = await quotingOpportunity();
      const manual = await post(`/opportunities/${ready.opportunityId}/stage`, seller, {
        stage: 'PROPOSAL_READY',
      });
      expect(manual.status).toBe(422);
      expect(manual.body.code).toBe('PROPOSAL_REQUIRED');
      await createProposal(ready.opportunityId, [ready.quoteId]);
      expect(
        (
          await post(`/opportunities/${ready.opportunityId}/stage`, seller, {
            stage: 'PROPOSAL_SENT',
          })
        ).body.code,
      ).toBe('PROPOSAL_REQUIRED');
    });

    it('regenera o PDF a partir do snapshot', async () => {
      const ready = await quotingOpportunity();
      const proposal = (await createProposal(ready.opportunityId, [ready.quoteId])).body;
      const again = await post(`/proposals/${proposal.id}/pdf`, seller);
      expect(again.status).toBe(200);
      expect(again.body.pdfDocumentId).toBeTruthy();
      expect(again.body.pdfDocumentId).not.toBe(proposal.pdfDocumentId);
    });
  });

  describe('envio, página pública e aceite', () => {
    it('envia, cria o link; o cliente abre (uma visualização registrada) e a etapa muda', async () => {
      const ready = await quotingOpportunity({ name: 'Carlos Pereira' });
      const proposal = (await createProposal(ready.opportunityId, [ready.quoteId])).body;
      const sent = await post(`/proposals/${proposal.id}/send`, seller);
      expect(sent.status).toBe(200);
      expect(sent.body.status).toBe('SENT');
      expect(sent.body.publicUrl).toMatch(/\/p\/[A-Za-z0-9_-]{40,}$/);
      expect(await stageOf(ready.opportunityId)).toBe('PROPOSAL_SENT');
      const token = tokenOf(sent.body.publicUrl);

      // Só o hash do token é guardado.
      const stored = await t.prisma.system.proposal.findUniqueOrThrow({
        where: { id: proposal.id },
      });
      expect(stored.tokenHash).toBeTruthy();
      expect(stored.tokenHash).not.toContain(token);
      expect(JSON.stringify(stored)).not.toContain(token);

      const first = await publicGet(token);
      expect(first.status).toBe(200);
      expect(first.body).toMatchObject({
        status: 'VIEWED',
        customerName: 'Carlos Pereira',
        projectCode: ready.projectCode,
        expired: false,
      });
      expect(first.body.scenarios[0].priceCents).toBe(1_980_000);
      expect(JSON.stringify(first.body)).not.toMatch(
        /margin|unitCostCents|commission|contingency|taxRate|materialsCents|tokenHash/i,
      );

      await publicGet(token);
      const after = (await get(`/proposals/${proposal.id}`, seller)).body;
      expect(after).toMatchObject({ status: 'VIEWED', viewCount: 2 });
      expect(after.firstViewedAt).toBeTruthy();

      // Só a primeira abertura gera evento e linha do tempo.
      await publish();
      const views = (await outboxOf(t, a.id, 'ProposalViewed')).filter(
        (e) => e.projectCode === ready.projectCode,
      );
      expect(views).toHaveLength(1);
      const timeline = (await get(`/opportunities/${ready.opportunityId}/timeline`, seller)).body;
      expect(timeline.filter((e: { type: string }) => e.type === 'PROPOSAL_VIEWED')).toHaveLength(
        1,
      );
      expect(
        (await auditOf(t, a.id, 'proposal.sent')).some((l) => l.entityId === proposal.id),
      ).toBe(true);
    });

    it('reenviar cria outro link e o anterior deixa de funcionar', async () => {
      const ready = await quotingOpportunity();
      const proposal = (await createProposal(ready.opportunityId, [ready.quoteId])).body;
      const first = tokenOf((await post(`/proposals/${proposal.id}/send`, seller)).body.publicUrl);
      const second = tokenOf((await post(`/proposals/${proposal.id}/send`, seller)).body.publicUrl);
      expect(second).not.toBe(first);
      expect((await publicGet(first)).status).toBe(404);
      expect((await publicGet(second)).status).toBe(200);
    });

    it('token inválido é 404 e proposta apenas gerada (sem envio) não abre', async () => {
      expect((await publicGet('token-que-nao-existe-token-que-nao-existe-00')).status).toBe(404);
      expect((await accept('token-que-nao-existe-token-que-nao-existe-00')).status).toBe(404);
    });

    it('o cliente baixa o PDF e a logo pelo link, sem login', async () => {
      const ready = await quotingOpportunity();
      const upload = await t.http
        .post(`${API}/documents`)
        .set(bearer(admin))
        .attach('file', pngBuffer(), { filename: 'logo.png', contentType: 'image/png' });
      expect(
        (await put('/branding', admin, { primaryColor: '#0a7d3b', logoDocumentId: upload.body.id }))
          .status,
      ).toBe(200);
      const proposal = (await createProposal(ready.opportunityId, [ready.quoteId])).body;
      const token = tokenOf((await post(`/proposals/${proposal.id}/send`, seller)).body.publicUrl);

      const pdf = await t.http
        .get(`${API}/public/proposals/${token}/pdf`)
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        });
      expect(pdf.status).toBe(200);
      expect(pdf.headers['content-type']).toContain('application/pdf');
      expect((await pdfText(binary(pdf))).length).toBeGreaterThan(50);

      const logo = await t.http.get(`${API}/public/proposals/${token}/logo`);
      expect(logo.status).toBe(200);
      expect(logo.headers['content-type']).toContain('image/png');

      // Sem logo cadastrada na proposta, a rota responde 404.
      const plain = await quotingOpportunity();
      await put('/branding', admin, { logoDocumentId: null });
      const p2 = (await createProposal(plain.opportunityId, [plain.quoteId])).body;
      const t2 = tokenOf((await post(`/proposals/${p2.id}/send`, seller)).body.publicUrl);
      expect((await t.http.get(`${API}/public/proposals/${t2}/logo`)).status).toBe(404);
    });

    it('aceite online registra quem, quando e de onde; leva a oportunidade para Contrato', async () => {
      const ready = await quotingOpportunity();
      const proposal = (await createProposal(ready.opportunityId, [ready.quoteId])).body;
      const token = tokenOf((await post(`/proposals/${proposal.id}/send`, seller)).body.publicUrl);

      // Exige nome completo e a confirmação.
      expect((await accept(token, { name: 'Ma', acknowledge: true })).status).toBe(422);
      expect((await accept(token, { name: 'Maria da Silva', acknowledge: false })).status).toBe(
        422,
      );

      const res = await accept(token, {
        name: 'Maria da Silva',
        document: '123.456.789-09',
        acknowledge: true,
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'ACCEPTED', acceptedByName: 'Maria da Silva' });
      expect(await stageOf(ready.opportunityId)).toBe('CONTRACT');

      const stored = await t.prisma.system.proposal.findUniqueOrThrow({
        where: { id: proposal.id },
      });
      expect(stored).toMatchObject({
        status: 'ACCEPTED',
        acceptedByName: 'Maria da Silva',
        acceptedByDocument: '123.456.789-09',
      });
      expect(stored.acceptedAt).toBeTruthy();
      expect(stored.acceptedIp).toBeTruthy();

      expect((await accept(token)).status).toBe(409);
      expect((await post(`/proposals/${proposal.id}/send`, seller)).status).toBe(409);
      // Aceita continua visível no link.
      expect((await publicGet(token)).body).toMatchObject({
        status: 'ACCEPTED',
        acceptedByName: 'Maria da Silva',
      });

      await publish();
      expect(
        (await outboxOf(t, a.id, 'ProposalAccepted')).some(
          (e) => e.projectCode === ready.projectCode,
        ),
      ).toBe(true);
      const log = (await auditOf(t, a.id, 'proposal.accepted')).find(
        (l) => l.entityId === proposal.id,
      );
      expect(log).toBeTruthy();
      expect(log!.actorId).toBeNull();
      const timeline = (await get(`/opportunities/${ready.opportunityId}/timeline`, seller)).body;
      expect(
        timeline.some((e: { summary: string }) => /aceita por Maria da Silva/.test(e.summary)),
      ).toBe(true);
    });

    it('proposta expirada: abre mostrando a expiração, não aceita (410) e não pode ser reenviada', async () => {
      const ready = await quotingOpportunity();
      const proposal = (await createProposal(ready.opportunityId, [ready.quoteId])).body;
      const token = tokenOf((await post(`/proposals/${proposal.id}/send`, seller)).body.publicUrl);
      await t.prisma.system.proposal.update({
        where: { id: proposal.id },
        data: { validUntil: new Date(Date.now() - 60_000) },
      });

      expect((await publicGet(token)).body.expired).toBe(true);
      expect((await accept(token)).status).toBe(410);
      expect((await get(`/proposals/${proposal.id}`, seller)).body.expired).toBe(true);
      const resend = await post(`/proposals/${proposal.id}/send`, seller);
      expect(resend.status).toBe(409);
      expect(resend.body.message).toMatch(/validade/);
    });

    it('não envia se as premissas mudaram desde a triagem', async () => {
      const ready = await quotingOpportunity();
      const proposal = (await createProposal(ready.opportunityId, [ready.quoteId])).body;
      await t.http
        .patch(`${API}/sites/${ready.siteId}`)
        .set(bearer(seller))
        .send({
          intake: {
            roofType: 'CERAMIC',
            roofAzimuthDegrees: 270,
            tiltDegrees: 15,
            shading: 'NONE',
            availableAreaM2: 80,
            entryBreakerAmps: 63,
            groundingAdequate: true,
          },
        });
      const res = await post(`/proposals/${proposal.id}/send`, seller);
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('GUARD_REQUIRED');
    });
  });

  describe('identidade visual', () => {
    it('qualquer usuário lê; só quem gerencia a empresa altera; valida cor e logo', async () => {
      expect((await get('/branding', seller)).status).toBe(200);
      expect((await put('/branding', seller, { primaryColor: '#112233' })).status).toBe(403);
      expect((await put('/branding', admin, { primaryColor: 'verde' })).status).toBe(422);
      expect(
        (await put('/branding', admin, { logoDocumentId: '0192b0c0-0000-7000-8000-00000000dead' }))
          .status,
      ).toBe(422);

      const pdfDoc = await t.http
        .post(`${API}/documents`)
        .set(bearer(admin))
        .attach('file', Buffer.from('%PDF-1.4\n%%EOF'), {
          filename: 'x.pdf',
          contentType: 'application/pdf',
        });
      expect((await put('/branding', admin, { logoDocumentId: pdfDoc.body.id })).status).toBe(422);

      const ok = await put('/branding', admin, { primaryColor: '#112233' });
      expect(ok.body.primaryColor).toBe('#112233');
      expect((await get('/branding', sdr)).body.primaryColor).toBe('#112233');
      expect((await auditOf(t, a.id, 'branding.updated')).length).toBeGreaterThan(0);
      expect((await get('/branding', adminB)).body.primaryColor).toBeUndefined();
    });
  });

  describe('permissões e isolamento', () => {
    it('SDR não vê propostas; instalador não gera; a outra empresa não enxerga nada', async () => {
      const ready = await quotingOpportunity();
      const proposal = (await createProposal(ready.opportunityId, [ready.quoteId])).body;
      expect((await get(`/opportunities/${ready.opportunityId}/proposals`, sdr)).status).toBe(403);
      expect((await createProposal(ready.opportunityId, [ready.quoteId], {}, sdr)).status).toBe(
        403,
      );
      expect((await get(`/proposals/${proposal.id}`, installer)).status).toBe(403);
      expect((await t.http.get(`${API}/proposals/${proposal.id}`)).status).toBe(401);

      expect((await get(`/proposals/${proposal.id}`, adminB)).status).toBe(404);
      expect((await post(`/proposals/${proposal.id}/send`, adminB)).status).toBe(404);
      expect((await get(`/proposals/${proposal.id}/pdf-url`, adminB)).status).toBe(404);
      expect((await post(`/proposals/${proposal.id}/pdf`, adminB)).status).toBe(404);
      expect((await get(`/opportunities/${ready.opportunityId}/proposals`, adminB)).status).toBe(
        404,
      );
      expect((await createProposal(ready.opportunityId, [ready.quoteId], {}, adminB)).status).toBe(
        404,
      );
    });
  });
});
