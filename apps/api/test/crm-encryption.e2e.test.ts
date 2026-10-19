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
    expect(raw.document).toMatch(/^enc:v2:/);
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
    expect(raw.document).toMatch(/^enc:v2:/);
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
    expect(raw.document).toMatch(/^enc:v2:/);
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
    expect(raw.acceptedByDocument).toMatch(/^enc:v2:/);
    expect(raw.acceptedByDocument).not.toContain('529');
  });
});

describe('Texto do contrato cifrado e rodízio de chave (e2e)', () => {
  let t: TestApp;
  let a: SeededTenant;
  let seller: string;
  let manager: string;

  const post = (path: string, token: string, body: unknown = {}) =>
    t.http
      .post(`${API}${path}`)
      .set(bearer(token))
      .send(body as object);

  beforeAll(async () => {
    t = await createTestApp();
    a = await seedTenant(t.prisma, 'rotate');
    seller = await tokenFor(t.http, a.salesperson);
    manager = await tokenFor(t.http, a.manager);
  });
  afterAll(() => t.close());

  it('o contrato é lido em claro pela API, mas o banco guarda texto e variáveis cifrados', async () => {
    const flow = { t, tenant: a, seller, admin: await tokenFor(t.http, a.admin) };
    await ensureMarginPolicy(flow, manager);
    const deal = await acceptedDeal(flow, { name: 'Cliente do Contrato Cifrado' });
    const res = await post(`/opportunities/${deal.opportunityId}/contracts`, manager, {
      customerDocument: '529.982.247-25',
    });
    expect(res.status).toBe(201);
    expect(res.body.body).toContain('529.982.247-25');
    expect(res.body.body).toContain('Cliente do Contrato Cifrado');
    const raw = await t.prisma.system.contract.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(raw.body).toMatch(/^enc:v2:/);
    expect(raw.body).not.toContain('529.982.247-25');
    expect(typeof raw.variables).toBe('string');
    expect(raw.variables as string).toMatch(/^enc:v2:/);
    // O PDF gerado e a leitura seguinte continuam funcionando.
    expect(
      (await t.http.get(`${API}/contracts/${res.body.id}`).set(bearer(manager))).body.body,
    ).toContain('529.982.247-25');
    expect(res.body.pdfDocumentId).toBeTruthy();
  });

  it('rodízio: recifra tudo com a chave nova, refaz os índices, é idempotente e não abre brecha na imutabilidade', async () => {
    const { createKeyring, decryptField, blindIndex, isEncryptedWithCurrent } =
      await import('../src/platform/crypto/field-crypto');
    const { DEV_DATA_ENCRYPTION_KEY } = await import('../src/config/env');
    const { reprotectAll } = await import('../src/cli/reprotect');
    const sys = t.prisma.system;

    const flow = { t, tenant: a, seller, admin: await tokenFor(t.http, a.admin) };
    await post('/accounts', seller, { name: 'Conta do rodízio', document: '390.533.447-05' });
    const deal = await acceptedDeal(flow, { name: 'Cliente Rodízio' });
    const contract = (await post(`/opportunities/${deal.opportunityId}/contracts`, manager, {}))
      .body;
    // Dado antigo em TEXTO (anterior à criptografia), gravado direto, sem a extensão.
    const legacy = await sys.account.create({
      data: {
        tenantId: a.id,
        name: 'Legado em texto',
        document: '248.438.034-80',
        documentNormalized: '24843803480',
      },
    });

    const newKey = randomKey();
    const ring = createKeyring(newKey, DEV_DATA_ENCRYPTION_KEY);
    try {
      const first = await reprotectAll(sys, ring);
      expect(first.accounts).toBeGreaterThanOrEqual(2);
      expect(first.contracts).toBeGreaterThanOrEqual(1);

      const accounts = await sys.account.findMany({
        where: { tenantId: a.id, document: { not: null } },
      });
      for (const acc of accounts) {
        expect(isEncryptedWithCurrent(acc.document as string, ring)).toBe(true);
        const plain = decryptField(acc.document as string, ring, a.id);
        expect(acc.documentNormalized).toBe(blindIndex(plain.replace(/\D/g, ''), ring, a.id));
      }
      expect(
        decryptField(
          (await sys.account.findUniqueOrThrow({ where: { id: legacy.id } })).document as string,
          ring,
          a.id,
        ),
      ).toBe('248.438.034-80');
      const rawContract = await sys.contract.findUniqueOrThrow({ where: { id: contract.id } });
      expect(isEncryptedWithCurrent(rawContract.body, ring)).toBe(true);
      expect(decryptField(rawContract.body, ring, a.id)).toContain('Cliente Rodízio');

      // Segunda execução: nada a fazer.
      expect(await reprotectAll(sys, ring)).toEqual({
        accounts: 0,
        leads: 0,
        proposals: 0,
        contracts: 0,
      });

      // O contrato continua imutável fora da manutenção.
      await expect(
        sys.contract.update({ where: { id: contract.id }, data: { body: 'adulterado' } }),
      ).rejects.toThrow(/imutável/);
    } finally {
      // Volta para a chave de desenvolvimento, que é a que o app de teste usa.
      await reprotectAll(sys, createKeyring(DEV_DATA_ENCRYPTION_KEY, newKey));
    }
    expect(
      (await t.http.get(`${API}/contracts/${contract.id}`).set(bearer(manager))).body.body,
    ).toContain('Cliente Rodízio');
  });
});

function randomKey(): string {
  return Buffer.from(Array.from({ length: 32 }, () => Math.floor(Math.random() * 256))).toString(
    'base64',
  );
}
