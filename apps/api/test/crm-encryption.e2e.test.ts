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

const CPF = '123.456.789-09';
const DIGITS = '12345678909';

describe('Documentos pessoais cifrados (e2e)', () => {
  let t: TestApp;
  let a: SeededTenant;
  let b: SeededTenant;
  let seller: string;
  let sellerB: string;
  let manager: string;

  const post = (path: string, token: string, body: unknown = {}) =>
    t.http
      .post(`${API}${path}`)
      .set(bearer(token))
      .send(body as object);
  const get = (path: string, token: string) => t.http.get(`${API}${path}`).set(bearer(token));

  beforeAll(async () => {
    t = await createTestApp();
    a = await seedTenant(t.prisma, 'crypto');
    b = await seedTenant(t.prisma, 'cryptob');
    seller = await tokenFor(t.http, a.salesperson);
    sellerB = await tokenFor(t.http, b.salesperson);
    manager = await tokenFor(t.http, a.manager);
  });
  afterAll(() => t.close());

  it('a API devolve o documento em claro, mas o banco guarda cifrado e com índice cego', async () => {
    const res = await post('/accounts', seller, { name: 'Cliente Cifrado', document: CPF });
    expect(res.status).toBe(201);
    expect(res.body.document).toBe(CPF);
    expect((await get(`/accounts/${res.body.id}`, seller)).body.document).toBe(CPF);

    const raw = await t.prisma.system.account.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(raw.document).toMatch(/^enc:v1:/);
    expect(raw.document).not.toContain('123');
    expect(raw.documentNormalized).toMatch(/^bi1:[0-9a-f]{64}$/);
    expect(raw.documentNormalized).not.toContain(DIGITS);
  });

  it('continua barrando duplicados e permite achar pelo número completo (não pela metade)', async () => {
    const created = await post('/accounts', seller, {
      name: 'Dono do CPF',
      document: '987.654.321-00',
    });
    const dup = await post('/accounts', seller, { name: 'Outro', document: '98765432100' });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('DUPLICATE_ACCOUNT');
    expect(dup.body.data.matchedAccountId).toBe(created.body.id);

    const full = (await get('/accounts?search=98765432100', seller)).body.data;
    expect(full.map((x: { id: string }) => x.id)).toContain(created.body.id);
    const partial = (await get('/accounts?search=987654', seller)).body.data;
    expect(partial.map((x: { id: string }) => x.id)).not.toContain(created.body.id);
  });

  it('atualizar o documento recifra e mantém a deduplicação', async () => {
    const acc = (await post('/accounts', seller, { name: 'Troca Doc', document: '111.444.777-35' }))
      .body;
    const upd = await t.http
      .patch(`${API}/accounts/${acc.id}`)
      .set(bearer(seller))
      .send({ document: '529.982.247-25' });
    expect(upd.status).toBe(200);
    expect(upd.body.document).toBe('529.982.247-25');
    const raw = await t.prisma.system.account.findUniqueOrThrow({ where: { id: acc.id } });
    expect(raw.document).toMatch(/^enc:v1:/);
    expect((await post('/accounts', seller, { name: 'Dup', document: '52998224725' })).status).toBe(
      409,
    );
    expect(
      (await post('/accounts', seller, { name: 'Livre', document: '11144477735' })).status,
    ).toBe(201);
  });

  it('o mesmo CPF em duas empresas convive e os índices não se correlacionam', async () => {
    const mine = await post('/accounts', seller, { name: 'Comum A', document: '390.533.447-05' });
    const theirs = await post('/accounts', sellerB, {
      name: 'Comum B',
      document: '390.533.447-05',
    });
    expect(mine.status).toBe(201);
    expect(theirs.status).toBe(201);
    const rawA = await t.prisma.system.account.findUniqueOrThrow({ where: { id: mine.body.id } });
    const rawB = await t.prisma.system.account.findUniqueOrThrow({ where: { id: theirs.body.id } });
    expect(rawA.documentNormalized).not.toBe(rawB.documentNormalized);
    expect(rawA.document).not.toBe(rawB.document);
    expect((await get(`/accounts/${mine.body.id}`, sellerB)).status).toBe(404);
  });

  it('leads: dedupe por documento, conversão reaproveita a conta e o documento chega em claro', async () => {
    const account = (
      await post('/accounts', seller, { name: 'Conta Existente', document: '248.438.034-80' })
    ).body;
    const lead = await post('/leads', seller, {
      name: 'Lead Mesmo Doc',
      document: '24843803480',
      phone: '(85) 98888-1111',
      segment: 'RESIDENTIAL',
    });
    expect(lead.status).toBe(201);
    expect(lead.body.document).toBe('24843803480');
    const raw = await t.prisma.system.lead.findUniqueOrThrow({ where: { id: lead.body.id } });
    expect(raw.document).toMatch(/^enc:v1:/);
    expect(raw.documentNormalized).toMatch(/^bi1:/);
    const dup = await post('/leads', seller, { name: 'Outro Lead', document: '248.438.034-80' });
    expect(dup.status).toBe(409);
    expect(dup.body.data.matchedBy ?? dup.body.matchedBy ?? []).toContain('documento');

    const converted = await post(`/leads/${lead.body.id}/convert`, seller, {
      accountType: 'PERSON',
    });
    expect(converted.status).toBe(201);
    expect(converted.body.accountId).toBe(account.id);
    expect((await get(`/accounts/${account.id}`, seller)).body.document).toBe('248.438.034-80');
  });

  it('o aceite online guarda o documento do cliente cifrado e o contrato o usa em claro', async () => {
    const flow = { t, tenant: a, seller, admin: await tokenFor(t.http, a.admin) };
    await ensureMarginPolicy(flow, manager);
    const deal = await acceptedDeal(flow, { name: 'Cliente Com Doc' });
    const rawProposal = await t.prisma.system.proposal.findUniqueOrThrow({
      where: { id: deal.proposalId },
    });
    // O aceite do helper não envia documento: aceita outra para conferir o campo.
    expect(rawProposal.acceptedByDocument).toBeNull();
    const acc = await t.prisma.system.account.findFirstOrThrow({
      where: { tenantId: a.id, name: 'Cliente Com Doc' },
    });
    const { PrismaService } = await import('../src/platform/prisma/prisma.service');
    const { RequestContext } = await import('../src/common/context/request-context');
    const prisma = t.app.get(PrismaService);
    await t.app
      .get(RequestContext)
      .run({ tenantId: a.id }, () =>
        prisma.db.account.update({ where: { id: acc.id }, data: { document: '529.982.247-25' } }),
      );
    const contract = await post(`/opportunities/${deal.opportunityId}/contracts`, manager, {});
    expect(contract.status).toBe(201);
    expect(contract.body.body).toContain('529.982.247-25');
  });

  it('proposta aceita com documento grava cifrado', async () => {
    const flow = { t, tenant: a, seller, admin: await tokenFor(t.http, a.admin) };
    const deal = await acceptedDeal(flow, { accept: false });
    const res = await t.http
      .post(`${API}/public/proposals/${deal.token}/accept`)
      .send({ name: 'Maria da Silva', document: '529.982.247-25', acknowledge: true });
    expect(res.status).toBe(200);
    const raw = await t.prisma.system.proposal.findUniqueOrThrow({
      where: { id: deal.proposalId },
    });
    expect(raw.acceptedByDocument).toMatch(/^enc:v1:/);
    expect(raw.acceptedByDocument).not.toContain('529');
  });
});
