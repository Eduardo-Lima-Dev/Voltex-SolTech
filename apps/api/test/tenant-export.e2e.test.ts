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
import { auditOf } from './crm-support';

describe('Exportação dos dados da empresa — LGPD (e2e)', () => {
  let t: TestApp;
  let a: SeededTenant;
  let b: SeededTenant;
  let owner: string;
  let admin: string;
  let manager: string;
  let seller: string;
  let ownerB: string;
  const exportOf = (token: string) => t.http.get(`${API}/tenant/export`).set(bearer(token));

  beforeAll(async () => {
    t = await createTestApp();
    a = await seedTenant(t.prisma, 'export');
    b = await seedTenant(t.prisma, 'exportb');
    owner = await tokenFor(t.http, a.owner);
    admin = await tokenFor(t.http, a.admin);
    manager = await tokenFor(t.http, a.manager);
    seller = await tokenFor(t.http, a.salesperson);
    ownerB = await tokenFor(t.http, b.owner);
    await t.http
      .post(`${API}/accounts`)
      .set(bearer(seller))
      .send({ name: 'Cliente da A', document: '123.456.789-09', email: 'a@cliente.com' });
    const sellerB = await tokenFor(t.http, b.salesperson);
    await t.http
      .post(`${API}/accounts`)
      .set(bearer(sellerB))
      .send({ name: 'Cliente da B', document: '987.654.321-00' });
  });
  afterAll(() => t.close());

  it('proprietário e administrador exportam; gestor e vendedor não', async () => {
    expect((await exportOf(owner)).status).toBe(200);
    expect((await exportOf(admin)).status).toBe(200);
    expect((await exportOf(manager)).status).toBe(403);
    expect((await exportOf(seller)).status).toBe(403);
    expect((await t.http.get(`${API}/tenant/export`)).status).toBe(401);
  });

  it('traz só os dados da própria empresa, com o documento em claro', async () => {
    const res = await exportOf(owner);
    expect(res.body).toMatchObject({ exportVersion: 1, tenant: { id: a.id } });
    expect(res.body.accounts.map((x: { name: string }) => x.name)).toEqual(['Cliente da A']);
    expect(res.body.accounts[0].document).toBe('123.456.789-09');
    expect(res.body.users.length).toBeGreaterThanOrEqual(5);
    const other = await exportOf(ownerB);
    expect(other.body.accounts.map((x: { name: string }) => x.name)).toEqual(['Cliente da B']);
    expect(JSON.stringify(res.body)).not.toContain('987.654.321-00');
    expect(JSON.stringify(res.body)).not.toContain('Cliente da B');
  });

  it('não vaza segredos: senha, MFA, token de link, índices cegos', async () => {
    const raw = JSON.stringify((await exportOf(owner)).body);
    expect(raw).not.toMatch(
      /passwordHash|mfaSecret|tokenHash|documentNormalized|\$argon2|bi1:|enc:v1:/,
    );
  });

  it('registra a exportação na auditoria', async () => {
    await exportOf(admin);
    expect((await auditOf(t, a.id, 'tenant.exported')).length).toBeGreaterThanOrEqual(1);
  });
});
