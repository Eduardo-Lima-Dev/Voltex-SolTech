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
import { acceptedDeal, ensureMarginPolicy, signedDeal } from './crm-delivery-flow';
import { buildOpportunity, type Flow } from './crm-flow';
import { auditOf } from './crm-support';

describe('Privacidade — eliminação de dados e retenção (e2e)', () => {
  let t: TestApp;
  let a: SeededTenant;
  let b: SeededTenant;
  let owner: string;
  let admin: string;
  let manager: string;
  let seller: string;
  let ownerB: string;
  let flow: Flow;

  const get = (path: string, token: string) => t.http.get(`${API}${path}`).set(bearer(token));
  const post = (path: string, token: string, body: unknown = {}) =>
    t.http
      .post(`${API}${path}`)
      .set(bearer(token))
      .send(body as object);
  const put = (path: string, token: string, body: unknown) =>
    t.http
      .put(`${API}${path}`)
      .set(bearer(token))
      .send(body as object);
  const erase = (
    subjectType: string,
    subjectId: string,
    token = owner,
    reason = 'Pedido do titular por e-mail',
  ) => post('/privacy/erasures', token, { subjectType, subjectId, reason });
  const raw = JSON.stringify;

  beforeAll(async () => {
    t = await createTestApp();
    a = await seedTenant(t.prisma, 'privacy');
    b = await seedTenant(t.prisma, 'privacyb');
    owner = await tokenFor(t.http, a.owner);
    admin = await tokenFor(t.http, a.admin);
    manager = await tokenFor(t.http, a.manager);
    seller = await tokenFor(t.http, a.salesperson);
    ownerB = await tokenFor(t.http, b.owner);
    flow = { t, tenant: a, seller, admin };
    await ensureMarginPolicy(flow, manager);
  });
  afterAll(() => t.close());

  describe('lead', () => {
    it('elimina os dados pessoais, mantém o registro para estatística e grava o pedido sem dado pessoal', async () => {
      const lead = (
        await post('/leads', seller, {
          name: 'Joana Quitéria Prado',
          email: 'joana@exemplo.com',
          phone: '(85) 98888-1234',
          document: '529.982.247-25',
          segment: 'RESIDENTIAL',
          notes: 'Prefere contato à tarde',
        })
      ).body;
      const res = await erase('LEAD', lead.id);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        subjectType: 'LEAD',
        subjectLabel: 'J. Q. P.',
        status: 'COMPLETED',
        summary: { leads: 1 },
        requestedByName: expect.any(String),
      });
      expect(raw(res.body)).not.toMatch(/Joana|joana@|98888|529\.982/);

      const row = await t.prisma.system.lead.findUniqueOrThrow({ where: { id: lead.id } });
      expect(row).toMatchObject({
        name: 'Titular removido',
        email: null,
        phone: null,
        document: null,
        documentNormalized: null,
        emailNormalized: null,
        phoneNormalized: null,
        notes: null,
      });
      expect(row.anonymizedAt).toBeTruthy();
      expect(row.segment).toBe('RESIDENTIAL'); // o que serve às estatísticas fica
      // O mesmo contato pode voltar a ser cadastrado: o índice foi limpo.
      expect(
        (
          await post('/leads', seller, {
            name: 'Joana de novo',
            email: 'joana@exemplo.com',
            segment: 'RESIDENTIAL',
          })
        ).status,
      ).toBe(201);

      expect((await auditOf(t, a.id, 'privacy.erasure_completed')).some((l) => !!l.entityId)).toBe(
        true,
      );
      expect(raw(await auditOf(t, a.id, 'privacy.erasure_completed'))).not.toMatch(/Joana/);
      const history = (await get('/privacy/erasures', owner)).body.data;
      expect(history[0]).toMatchObject({ status: 'COMPLETED', subjectLabel: 'J. Q. P.' });
    });

    it('não elimina duas vezes; lead que virou cliente aponta para a conta', async () => {
      const lead = (
        await post('/leads', seller, {
          name: 'Lead Duplo Pedido',
          phone: '(85) 97777-0001',
          segment: 'RESIDENTIAL',
        })
      ).body;
      await erase('LEAD', lead.id);
      expect((await erase('LEAD', lead.id)).status).toBe(409);

      const converted = (
        await post('/leads', seller, {
          name: 'Lead Convertido',
          phone: '(85) 97777-0002',
          segment: 'RESIDENTIAL',
        })
      ).body;
      await post(`/leads/${converted.id}/convert`, seller, { accountType: 'PERSON' });
      const blocked = await erase('LEAD', converted.id);
      expect(blocked.status).toBe(409);
      expect(blocked.body.code).toBe('ERASURE_BLOCKED');
      expect(blocked.body.message).toMatch(/eliminação da conta/);
    });
  });

  describe('conta', () => {
    it('elimina nome, contatos, imóvel, UC, textos, arquivos e propostas de um negócio perdido', async () => {
      const deal = await acceptedDeal(flow, { name: 'Marcelo Antunes Guerra' });
      const accountBefore = await t.prisma.system.account.findUniqueOrThrow({
        where: { id: deal.accountId },
      });
      await post(`/accounts/${deal.accountId}/contacts`, seller, {
        name: 'Sra. Helena Guerra',
        email: 'helena@guerra.com',
        phone: '(85) 96666-5555',
        isPrimary: true,
      });
      await post(`/opportunities/${deal.opportunityId}/notes`, seller, {
        body: 'Marcelo Antunes Guerra pediu desconto',
      });
      await post(`/opportunities/${deal.opportunityId}/stage`, seller, {
        stage: 'LOST',
        lostReason: 'Desistiu',
      }).catch(() => undefined);
      await t.prisma.system.opportunity.update({
        where: { id: deal.opportunityId },
        data: { status: 'LOST', stage: 'LOST' },
      });

      const docsBefore = await t.prisma.system.document.findMany({
        where: {
          tenantId: a.id,
          deletedAt: null,
          OR: [{ entityType: 'Proposal', entityId: deal.proposalId }],
        },
      });
      expect(docsBefore.length).toBeGreaterThan(0);

      const res = await erase('ACCOUNT', deal.accountId);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ status: 'COMPLETED', subjectLabel: 'M. A. G.' });
      expect(res.body.summary).toMatchObject({ contas: 1, propostas: 1 });
      expect(res.body.summary.contatos).toBeGreaterThanOrEqual(1);

      const sys = t.prisma.system;
      const account = await sys.account.findUniqueOrThrow({ where: { id: deal.accountId } });
      expect(account).toMatchObject({
        name: 'Titular removido',
        document: null,
        email: null,
        phone: null,
      });
      expect(account.anonymizedAt).toBeTruthy();
      expect(
        (await sys.contact.findMany({ where: { accountId: deal.accountId } })).every(
          (c) => c.name === 'Contato removido' && c.email === null && c.phone === null,
        ),
      ).toBe(true);
      const site = await sys.site.findFirstOrThrow({ where: { accountId: deal.accountId } });
      expect(site).toMatchObject({ street: null, number: null, zip: null, latitude: null });
      const unit = await sys.consumerUnit.findFirstOrThrow({
        where: { accountId: deal.accountId },
      });
      expect(unit.number).toMatch(/^removida-/);

      const opp = await sys.opportunity.findUniqueOrThrow({ where: { id: deal.opportunityId } });
      expect(opp.title).not.toMatch(/Marcelo|Guerra/);
      expect(
        raw(await sys.timelineEvent.findMany({ where: { opportunityId: deal.opportunityId } })),
      ).not.toMatch(/Marcelo|Antunes|Helena/);
      expect(
        raw(await sys.proposalSnapshot.findMany({ where: { proposalId: deal.proposalId } })),
      ).not.toMatch(/Marcelo|Antunes/);
      expect(
        raw(
          await sys.quickCalculationSnapshot.findMany({
            where: {
              tenantId: a.id,
              sessionId: {
                in: (
                  await sys.calculationSession.findMany({
                    where: { opportunityId: deal.opportunityId },
                  })
                ).map((s) => s.id),
              },
            },
          }),
        ),
      ).not.toMatch(/Marcelo|Antunes/);
      const proposal = await sys.proposal.findUniqueOrThrow({ where: { id: deal.proposalId } });
      expect(proposal).toMatchObject({ acceptedByDocument: null, acceptedIp: null });
      expect(proposal.acceptedByName).toBe('Titular removido');

      // Arquivos: marcados como removidos e apagados do armazenamento.
      const docsAfter = await sys.document.findMany({
        where: { id: { in: docsBefore.map((d) => d.id) } },
      });
      expect(docsAfter.every((d) => d.deletedAt !== null)).toBe(true);
      const { S3Service } = await import('../src/platform/documents/s3.service');
      await expect(t.app.get(S3Service).getBuffer(docsBefore[0]!.storageKey)).rejects.toThrow();
      expect(accountBefore.name).toContain('Marcelo');
    });

    it('bloqueia com negócio aberto e com contrato assinado dentro do prazo legal, e libera depois', async () => {
      const open = await buildOpportunity(flow);
      const blockedOpen = await erase('ACCOUNT', open.accountId);
      expect(blockedOpen.status).toBe(409);
      expect(blockedOpen.body.message).toMatch(/oportunidades em aberto/);
      expect(
        (await t.prisma.system.account.findUniqueOrThrow({ where: { id: open.accountId } }))
          .anonymizedAt,
      ).toBeNull();

      const deal = await signedDeal(flow, manager);
      const account = deal.accountId;
      const held = await erase('ACCOUNT', account);
      expect(held.status).toBe(409);
      expect(held.body.code).toBe('ERASURE_BLOCKED');
      expect(held.body.message).toMatch(/guardar o contrato assinado até/);
      expect(new Date(held.body.data.retainedUntil).getFullYear()).toBeGreaterThanOrEqual(
        new Date().getFullYear() + 4,
      );
      // O pedido bloqueado também fica registrado.
      expect(
        (await get('/privacy/erasures', owner)).body.data.some(
          (r: { status: string; retainedUntil: string | null }) =>
            r.status === 'BLOCKED' && r.retainedUntil,
        ),
      ).toBe(true);

      // Passados 5 anos da assinatura, libera; o contrato é anonimizado e o arquivo assinado apagado.
      const old = new Date(Date.now() - 62 * 30.44 * 86_400_000);
      // `signed_at` é bloqueado pelo gatilho fora do rascunho; ajusta com o gatilho desligado só para o teste.
      await t.prisma.system.$executeRawUnsafe(
        `ALTER TABLE contracts DISABLE TRIGGER contracts_immutable`,
      );
      await t.prisma.system
        .$executeRaw`UPDATE contracts SET signed_at = ${old} WHERE id = ${deal.contractId}::uuid`;
      await t.prisma.system.$executeRawUnsafe(
        `ALTER TABLE contracts ENABLE TRIGGER contracts_immutable`,
      );
      // A oportunidade já está Ganha (não está aberta), então o único impedimento era o prazo do contrato.

      const done = await erase('ACCOUNT', account);
      expect(done.status).toBe(201);
      expect(done.body.summary.contratos).toBe(1);
      const contract = await t.prisma.system.contract.findUniqueOrThrow({
        where: { id: deal.contractId },
      });
      expect(contract.signedByName).toBeNull();
      expect(contract.body).toMatch(/^enc:v2:/);
      const view = await get(`/contracts/${deal.contractId}`, manager);
      expect(view.body.body).toMatch(/Contrato anonimizado/);
      // Fora da anonimização, o contrato continua imutável.
      await expect(
        t.prisma.system.contract.update({
          where: { id: deal.contractId },
          data: { valueCents: 1 },
        }),
      ).rejects.toThrow(/imutável/);
    });
  });

  describe('política de retenção', () => {
    it('lê o padrão, grava, e recusa menos de 5 anos para contratos', async () => {
      const def = (await get('/privacy/retention', owner)).body;
      expect(def.policy).toEqual({
        unconvertedLeadsMonths: null,
        lostOpportunitiesMonths: null,
        signedContractsMonths: 60,
      });
      expect(def.floors.signedContractsMonths).toBe(60);
      expect(def.sources.signedContractsMonths).toMatch(/CTN/);
      expect(
        (
          await put('/privacy/retention', owner, {
            unconvertedLeadsMonths: 24,
            lostOpportunitiesMonths: null,
            signedContractsMonths: 59,
          })
        ).status,
      ).toBe(422);
      expect(
        (
          await put('/privacy/retention', owner, {
            unconvertedLeadsMonths: 0,
            lostOpportunitiesMonths: null,
            signedContractsMonths: 60,
          })
        ).status,
      ).toBe(422);
      const saved = await put('/privacy/retention', owner, {
        unconvertedLeadsMonths: 24,
        lostOpportunitiesMonths: 36,
        signedContractsMonths: 72,
      });
      expect(saved.body.policy).toEqual({
        unconvertedLeadsMonths: 24,
        lostOpportunitiesMonths: 36,
        signedContractsMonths: 72,
      });
      expect((await auditOf(t, a.id, 'privacy.retention_updated')).length).toBeGreaterThan(0);
      await put('/privacy/retention', owner, {
        unconvertedLeadsMonths: null,
        lostOpportunitiesMonths: null,
        signedContractsMonths: 60,
      });
    });

    it('a rotina elimina só o que passou do prazo da política: lead antigo sim, recente e convertido não', async () => {
      const own = await seedTenant(t.prisma, 'privacysweep');
      const tok = await tokenFor(t.http, own.owner);
      const sell = await tokenFor(t.http, own.salesperson);
      await put('/privacy/retention', tok, {
        unconvertedLeadsMonths: 12,
        lostOpportunitiesMonths: null,
        signedContractsMonths: 60,
      });
      const mk = async (name: string, phone: string) =>
        (
          await t.http
            .post(`${API}/leads`)
            .set(bearer(sell))
            .send({ name, phone, segment: 'RESIDENTIAL' })
        ).body;
      const old = await mk('Lead Antigo', '(85) 95555-0001');
      const recent = await mk('Lead Recente', '(85) 95555-0002');
      const convertedLead = await mk('Lead Antigo Convertido', '(85) 95555-0003');
      await t.http
        .post(`${API}/leads/${convertedLead.id}/convert`)
        .set(bearer(sell))
        .send({ accountType: 'PERSON' });
      const longAgo = new Date(Date.now() - 14 * 30.44 * 86_400_000);
      await t.prisma.system.lead.updateMany({
        where: { id: { in: [old.id, convertedLead.id] } },
        data: { createdAt: longAgo },
      });

      const { PrivacyService } = await import('../src/products/crm/privacy/privacy.service');
      const done = await t.app.get(PrivacyService).sweepAll();
      expect(done.leads).toBeGreaterThanOrEqual(1);
      const rows = await t.prisma.system.lead.findMany({
        where: { id: { in: [old.id, recent.id, convertedLead.id] } },
      });
      const by = (id: string) => rows.find((r) => r.id === id)!;
      expect(by(old.id).anonymizedAt).toBeTruthy();
      expect(by(recent.id).anonymizedAt).toBeNull();
      expect(by(convertedLead.id).anonymizedAt).toBeNull();
      const history = (await t.http.get(`${API}/privacy/erasures`).set(bearer(tok))).body.data;
      expect(
        history.find((h: { reason: string }) => /Política de retenção/.test(h.reason)),
      ).toMatchObject({ requestedById: null, status: 'COMPLETED' });
    });

    it('sem política definida, a rotina não elimina nada', async () => {
      const own = await seedTenant(t.prisma, 'privacynopolicy');
      const sell = await tokenFor(t.http, own.salesperson);
      const lead = (
        await t.http
          .post(`${API}/leads`)
          .set(bearer(sell))
          .send({ name: 'Lead Sem Política', phone: '(85) 94444-0001', segment: 'RESIDENTIAL' })
      ).body;
      await t.prisma.system.lead.update({
        where: { id: lead.id },
        data: { createdAt: new Date('2020-01-01') },
      });
      const { PrivacyService } = await import('../src/products/crm/privacy/privacy.service');
      await t.app.get(PrivacyService).sweepAll();
      expect(
        (await t.prisma.system.lead.findUniqueOrThrow({ where: { id: lead.id } })).anonymizedAt,
      ).toBeNull();
    });
  });

  describe('permissões e isolamento', () => {
    it('só proprietário e administrador; gestor e vendedor não', async () => {
      const lead = (
        await post('/leads', seller, {
          name: 'Lead Permissão',
          phone: '(85) 93333-0001',
          segment: 'RESIDENTIAL',
        })
      ).body;
      expect((await erase('LEAD', lead.id, seller)).status).toBe(403);
      expect((await erase('LEAD', lead.id, manager)).status).toBe(403);
      expect((await get('/privacy/retention', manager)).status).toBe(403);
      expect((await get('/privacy/erasures', seller)).status).toBe(403);
      expect((await t.http.get(`${API}/privacy/retention`)).status).toBe(401);
      expect((await erase('LEAD', lead.id, admin)).status).toBe(201);
    });

    it('a outra empresa não elimina nem enxerga o que não é dela', async () => {
      const lead = (
        await post('/leads', seller, {
          name: 'Lead da Empresa A',
          phone: '(85) 93333-0002',
          segment: 'RESIDENTIAL',
        })
      ).body;
      expect((await erase('LEAD', lead.id, ownerB)).status).toBe(404);
      expect(
        (await t.prisma.system.lead.findUniqueOrThrow({ where: { id: lead.id } })).anonymizedAt,
      ).toBeNull();
      expect(
        (await get('/privacy/erasures', ownerB)).body.data.every(
          (r: { subjectLabel: string }) => !r.subjectLabel.startsWith('L. D. E'),
        ),
      ).toBe(true);
    });
  });
});
