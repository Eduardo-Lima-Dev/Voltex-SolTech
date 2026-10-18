import { JwtService } from '@nestjs/jwt';
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

/**
 * O requisito mais importante da plataforma: dados de uma empresa NUNCA aparecem para outra.
 * Cada teste tenta, como o tenant A, enxergar ou alterar dados do tenant B por todos os caminhos.
 */
describe('isolamento entre tenants (e2e)', () => {
  let t: TestApp;
  let a: SeededTenant;
  let b: SeededTenant;
  let tokenA: string;
  let tokenB: string;
  let docB: string;

  beforeAll(async () => {
    t = await createTestApp();
    a = await seedTenant(t.prisma, 'a');
    b = await seedTenant(t.prisma, 'b');
    tokenA = await tokenFor(t.http, a.owner);
    tokenB = await tokenFor(t.http, b.owner);

    const upload = await t.http
      .post(`${API}/documents`)
      .set(bearer(tokenB))
      .attach('file', pdfBuffer('segredo-de-b'), {
        filename: 'b.pdf',
        contentType: 'application/pdf',
      });
    expect(upload.status).toBe(201);
    docB = upload.body.id;
  });
  afterAll(() => t.close());

  describe('usuários', () => {
    it('a listagem de A contém só usuários de A', async () => {
      const res = await t.http.get(`${API}/users?pageSize=100`).set(bearer(tokenA));
      const emails: string[] = res.body.data.map((u: { email: string }) => u.email);
      expect(res.body.meta.total).toBe(5);
      expect(emails).toContain(a.owner.email);
      expect(emails).not.toContain(b.owner.email);
    });

    it('busca por e-mail de B retorna vazio para A', async () => {
      const res = await t.http
        .get(`${API}/users?search=${encodeURIComponent(b.owner.email)}`)
        .set(bearer(tokenA));
      expect(res.body.data).toEqual([]);
    });

    it('ler, alterar e excluir usuário de B resulta em 404 e nada muda', async () => {
      expect(
        (await t.http.get(`${API}/users/${b.salesperson.id}`).set(bearer(tokenA))).status,
      ).toBe(404);
      expect(
        (
          await t.http
            .patch(`${API}/users/${b.salesperson.id}`)
            .set(bearer(tokenA))
            .send({ isActive: false })
        ).status,
      ).toBe(404);
      expect(
        (await t.http.delete(`${API}/users/${b.salesperson.id}`).set(bearer(tokenA))).status,
      ).toBe(404);
      const still = await t.prisma.system.user.findUniqueOrThrow({
        where: { id: b.salesperson.id },
      });
      expect(still.isActive).toBe(true);
      expect(still.deletedAt).toBeNull();
    });
  });

  describe('filiais e times', () => {
    it('A não lista, altera nem exclui filial de B', async () => {
      const list = await t.http.get(`${API}/branches`).set(bearer(tokenA));
      expect(list.body.map((x: { id: string }) => x.id)).not.toContain(b.branchId);
      expect(
        (
          await t.http
            .patch(`${API}/branches/${b.branchId}`)
            .set(bearer(tokenA))
            .send({ name: 'Invadida' })
        ).status,
      ).toBe(404);
      expect(
        (await t.http.delete(`${API}/branches/${b.branchId}`).set(bearer(tokenA))).status,
      ).toBe(404);
      expect(
        (await t.prisma.system.branch.findUniqueOrThrow({ where: { id: b.branchId } })).name,
      ).toBe('Matriz');
    });

    it('A não altera nem exclui time de B', async () => {
      expect(
        (
          await t.http
            .patch(`${API}/teams/${b.teamId}`)
            .set(bearer(tokenA))
            .send({ name: 'Invadido' })
        ).status,
      ).toBe(404);
      expect((await t.http.delete(`${API}/teams/${b.teamId}`).set(bearer(tokenA))).status).toBe(
        404,
      );
    });

    it('A não cria time numa filial de B, nem associa usuário a filial/time de B', async () => {
      expect(
        (
          await t.http
            .post(`${API}/teams`)
            .set(bearer(tokenA))
            .send({ name: 'Time X', branchId: b.branchId })
        ).status,
      ).toBe(404);
      const assign = await t.http
        .patch(`${API}/users/${a.sdr.id}`)
        .set(bearer(tokenA))
        .send({ branchId: b.branchId });
      expect(assign.status).toBe(400);
      const assignTeam = await t.http
        .patch(`${API}/users/${a.sdr.id}`)
        .set(bearer(tokenA))
        .send({ teamId: b.teamId });
      expect(assignTeam.status).toBe(400);
    });

    it('o mesmo nome de filial pode existir em tenants diferentes', async () => {
      const res = await t.http
        .post(`${API}/branches`)
        .set(bearer(tokenA))
        .send({ name: 'Matriz 2' });
      expect(res.status).toBe(201);
      const dup = await t.http
        .post(`${API}/branches`)
        .set(bearer(tokenB))
        .send({ name: 'Matriz 2' });
      expect(dup.status).toBe(201);
      expect(dup.body.tenantId).toBe(b.id);
    });
  });

  describe('documentos', () => {
    it('A não vê, baixa nem exclui documento de B', async () => {
      expect((await t.http.get(`${API}/documents/${docB}`).set(bearer(tokenA))).status).toBe(404);
      expect(
        (await t.http.get(`${API}/documents/${docB}/download-url`).set(bearer(tokenA))).status,
      ).toBe(404);
      expect(
        (await t.http.get(`${API}/documents/${docB}/versions`).set(bearer(tokenA))).status,
      ).toBe(404);
      expect((await t.http.delete(`${API}/documents/${docB}`).set(bearer(tokenA))).status).toBe(
        404,
      );
      const list = await t.http.get(`${API}/documents`).set(bearer(tokenA));
      expect(list.body.data.map((d: { id: string }) => d.id)).not.toContain(docB);
    });

    it('nova versão não pode substituir documento de outro tenant', async () => {
      const res = await t.http
        .post(`${API}/documents`)
        .set(bearer(tokenA))
        .field('replacesDocumentId', docB)
        .attach('file', pdfBuffer(), { filename: 'x.pdf', contentType: 'application/pdf' });
      expect(res.status).toBe(404);
    });

    it('a chave do objeto carrega o tenant e nunca é exposta', async () => {
      const row = await t.prisma.system.document.findUniqueOrThrow({ where: { id: docB } });
      expect(row.storageKey.startsWith(`${b.id}/`)).toBe(true);
      const res = await t.http.get(`${API}/documents/${docB}`).set(bearer(tokenB));
      expect(res.body).not.toHaveProperty('storageKey');
    });
  });

  describe('convites e auditoria', () => {
    it('convidar um e-mail que já existe em outro tenant dá 409 sem revelar o tenant', async () => {
      const res = await t.http
        .post(`${API}/invitations`)
        .set(bearer(tokenA))
        .send({ email: b.owner.email, role: 'SDR' });
      expect(res.status).toBe(409);
      expect(JSON.stringify(res.body)).not.toContain(b.name);
    });

    it('A não revoga convite de B', async () => {
      const invite = await t.http
        .post(`${API}/invitations`)
        .set(bearer(tokenB))
        .send({ email: 'novo.b@teste.test', role: 'SDR' });
      expect(invite.status).toBe(201);
      expect(
        (await t.http.delete(`${API}/invitations/${invite.body.id}`).set(bearer(tokenA))).status,
      ).toBe(400);
      const listA = await t.http.get(`${API}/invitations`).set(bearer(tokenA));
      expect(listA.body.map((i: { id: string }) => i.id)).not.toContain(invite.body.id);
    });

    it('o audit log de A não contém registros de B', async () => {
      await t.http.patch(`${API}/tenant`).set(bearer(tokenB)).send({ name: 'B Renomeada' });
      const res = await t.http.get(`${API}/audit-logs?pageSize=100`).set(bearer(tokenA));
      expect(res.status).toBe(200);
      const tenantIds = new Set(
        (
          await t.prisma.system.auditLog.findMany({
            where: { id: { in: res.body.data.map((x: { id: string }) => x.id) } },
            select: { tenantId: true },
          })
        ).map((x) => x.tenantId),
      );
      expect([...tenantIds]).toEqual([a.id]);
    });

    it('PATCH /tenant altera somente o tenant do chamador', async () => {
      await t.http.patch(`${API}/tenant`).set(bearer(tokenA)).send({ name: 'A Renomeada' });
      expect((await t.prisma.system.tenant.findUniqueOrThrow({ where: { id: a.id } })).name).toBe(
        'A Renomeada',
      );
      expect((await t.prisma.system.tenant.findUniqueOrThrow({ where: { id: b.id } })).name).toBe(
        'B Renomeada',
      );
    });
  });

  describe('tokens forjados', () => {
    it('token com usuário de A e tenant de B é recusado', async () => {
      const mixed = t.app.get(JwtService).sign({ sub: a.owner.id, tid: b.id, role: 'OWNER' });
      expect((await t.http.get(`${API}/users`).set(bearer(mixed))).status).toBe(401);
    });

    it('o tenant vem sempre do token: parâmetros tenantId em corpo ou query são ignorados', async () => {
      const res = await t.http
        .post(`${API}/branches?tenantId=${b.id}`)
        .set(bearer(tokenA))
        .send({ name: 'Tentativa', tenantId: b.id });
      expect(res.status).toBe(201);
      expect(res.body.tenantId).toBe(a.id);
    });
  });

  describe('camada de dados (PrismaService)', () => {
    it('com tenant no contexto, o cliente escopado só enxerga aquele tenant', async () => {
      const { RequestContext } = await import('../src/common/context/request-context');
      const ctx = t.app.get(RequestContext);
      const users = await ctx.run({ tenantId: a.id }, () => t.prisma.db.user.findMany());
      expect(users.length).toBe(5);
      expect(users.every((u) => u.tenantId === a.id)).toBe(true);
    });

    it('sem tenant no contexto, o cliente escopado falha fechado', async () => {
      await expect(t.prisma.db.user.findMany()).rejects.toThrow(/sem tenant no contexto/);
      await expect(
        t.prisma.db.branch.create({ data: { tenantId: a.id, name: 'x' } }),
      ).rejects.toThrow(/sem tenant/);
    });

    it('filtro explícito por outro tenant é recusado', async () => {
      const { RequestContext } = await import('../src/common/context/request-context');
      const ctx = t.app.get(RequestContext);
      await expect(
        ctx.run({ tenantId: a.id }, () => t.prisma.db.user.findMany({ where: { tenantId: b.id } })),
      ).rejects.toThrow(/outro tenant|diferente do tenant/);
      await expect(
        ctx.run({ tenantId: a.id }, () =>
          t.prisma.db.branch.create({ data: { tenantId: b.id, name: 'x' } }),
        ),
      ).rejects.toThrow(/outro tenant/);
    });

    it('não é possível mover um registro para outro tenant', async () => {
      const { RequestContext } = await import('../src/common/context/request-context');
      const ctx = t.app.get(RequestContext);
      await expect(
        ctx.run({ tenantId: a.id }, () =>
          t.prisma.db.team.update({ where: { id: a.teamId }, data: { tenantId: b.id } as never }),
        ),
      ).rejects.toThrow(/alterar o tenant/);
    });
  });
});
