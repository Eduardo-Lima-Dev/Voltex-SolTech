import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  API,
  PASSWORD,
  bearer,
  createTestApp,
  login,
  refreshCookie,
  seedTenant,
  tokenFor,
  type SeededTenant,
  type TestApp,
} from './helpers';

describe('usuários e convites (e2e)', () => {
  let t: TestApp;
  let tenant: SeededTenant;
  let owner: string;
  let admin: string;

  beforeAll(async () => {
    t = await createTestApp();
    tenant = await seedTenant(t.prisma, 'users');
    owner = await tokenFor(t.http, tenant.owner);
    admin = await tokenFor(t.http, tenant.admin);
  });
  afterAll(() => t.close());

  describe('listagem', () => {
    it('pagina, ordena por nome e filtra por perfil/busca/estado', async () => {
      const page = await t.http.get(`${API}/users?page=1&pageSize=2`).set(bearer(owner));
      expect(page.body.meta).toEqual({ page: 1, pageSize: 2, total: 5 });
      expect(page.body.data).toHaveLength(2);

      const byRole = await t.http.get(`${API}/users?role=SDR`).set(bearer(owner));
      expect(byRole.body.data.map((u: { email: string }) => u.email)).toEqual([tenant.sdr.email]);

      const search = await t.http.get(`${API}/users?search=VENDEDOR`).set(bearer(owner));
      expect(search.body.data).toHaveLength(1);

      const inactive = await t.http.get(`${API}/users?isActive=false`).set(bearer(owner));
      expect(inactive.body.data).toEqual([]);
    });

    it('rejeita paginação inválida', async () => {
      expect((await t.http.get(`${API}/users?pageSize=1000`).set(bearer(owner))).status).toBe(422);
      expect((await t.http.get(`${API}/users?page=0`).set(bearer(owner))).status).toBe(422);
    });

    it('GET /users/:id valida o UUID', async () => {
      expect((await t.http.get(`${API}/users/nao-e-uuid`).set(bearer(owner))).status).toBe(400);
    });
  });

  describe('edição', () => {
    it('altera dados e grava auditoria com antes/depois', async () => {
      const res = await t.http
        .patch(`${API}/users/${tenant.sdr.id}`)
        .set(bearer(owner))
        .send({ name: 'Sofia Renomeada', teamId: tenant.teamId });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Sofia Renomeada');

      const audit = await t.prisma.system.auditLog.findFirstOrThrow({
        where: { tenantId: tenant.id, action: 'user.updated', entityId: tenant.sdr.id },
      });
      expect((audit.before as { name: string }).name).toContain('sdr');
      expect((audit.after as { name: string }).name).toBe('Sofia Renomeada');
      expect(audit.actorId).toBe(tenant.owner.id);
    });

    it('ADMIN não gerencia OWNER nem concede OWNER', async () => {
      expect(
        (
          await t.http
            .patch(`${API}/users/${tenant.owner.id}`)
            .set(bearer(admin))
            .send({ name: 'Nome Novo' })
        ).status,
      ).toBe(403);
      expect(
        (
          await t.http
            .patch(`${API}/users/${tenant.sdr.id}`)
            .set(bearer(admin))
            .send({ role: 'OWNER' })
        ).status,
      ).toBe(403);
      expect(
        (await t.http.delete(`${API}/users/${tenant.owner.id}`).set(bearer(admin))).status,
      ).toBe(403);
      const ok = await t.http
        .patch(`${API}/users/${tenant.sdr.id}`)
        .set(bearer(admin))
        .send({ role: 'SALESPERSON' });
      expect(ok.status).toBe(200);
      await t.prisma.system.user.update({ where: { id: tenant.sdr.id }, data: { role: 'SDR' } });
    });

    it('ninguém altera o próprio perfil nem se desativa/exclui', async () => {
      expect(
        (
          await t.http
            .patch(`${API}/users/${tenant.owner.id}`)
            .set(bearer(owner))
            .send({ role: 'ADMIN' })
        ).status,
      ).toBe(403);
      expect(
        (
          await t.http
            .patch(`${API}/users/${tenant.owner.id}`)
            .set(bearer(owner))
            .send({ isActive: false })
        ).status,
      ).toBe(403);
      expect(
        (await t.http.delete(`${API}/users/${tenant.owner.id}`).set(bearer(owner))).status,
      ).toBe(403);
      expect(
        (
          await t.http
            .patch(`${API}/users/${tenant.owner.id}`)
            .set(bearer(owner))
            .send({ name: 'Novo Nome' })
        ).status,
      ).toBe(200);
    });

    it('perfil sem permissão de gestão recebe 403', async () => {
      const seller = await tokenFor(t.http, tenant.salesperson);
      expect(
        (
          await t.http
            .patch(`${API}/users/${tenant.sdr.id}`)
            .set(bearer(seller))
            .send({ name: 'Nome Novo' })
        ).status,
      ).toBe(403);
    });

    it('valida o corpo e ignora campos desconhecidos como passwordHash', async () => {
      expect(
        (
          await t.http
            .patch(`${API}/users/${tenant.sdr.id}`)
            .set(bearer(owner))
            .send({ role: 'SUPERUSER' })
        ).status,
      ).toBe(422);
      const res = await t.http
        .patch(`${API}/users/${tenant.sdr.id}`)
        .set(bearer(owner))
        .send({ name: 'Ok Nome', passwordHash: 'hack' });
      expect(res.status).toBe(200);
      const row = await t.prisma.system.user.findUniqueOrThrow({ where: { id: tenant.sdr.id } });
      expect(row.passwordHash).not.toBe('hack');
    });

    it('exclusão é lógica: some da lista, não faz login e preserva o registro', async () => {
      const victim = await t.prisma.system.user.create({
        data: {
          tenantId: tenant.id,
          name: 'Descartável',
          email: `descartavel.${tenant.id.slice(0, 6)}@users.test`,
          passwordHash: (
            await t.prisma.system.user.findUniqueOrThrow({ where: { id: tenant.owner.id } })
          ).passwordHash,
          role: 'SDR',
        },
      });
      expect((await login(t.http, victim.email)).status).toBe(200);
      const res = await t.http.delete(`${API}/users/${victim.id}`).set(bearer(owner));
      expect(res.status).toBe(200);
      expect((await login(t.http, victim.email)).status).toBe(401);
      expect((await t.http.get(`${API}/users/${victim.id}`).set(bearer(owner))).status).toBe(404);
      const row = await t.prisma.system.user.findUniqueOrThrow({ where: { id: victim.id } });
      expect(row.deletedAt).not.toBeNull();
      expect(row.isActive).toBe(false);
    });
  });

  describe('convites', () => {
    const email = () => `convidado.${Math.random().toString(36).slice(2, 8)}@convites.test`;
    const tokenFrom = (url: string) => new URL(url).searchParams.get('token')!;

    it('cria o convite, envia o e-mail com link e não persiste o token em claro', async () => {
      const to = email();
      const res = await t.http
        .post(`${API}/invitations`)
        .set(bearer(owner))
        .send({ email: to, role: 'SALESPERSON', branchId: tenant.branchId });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ email: to, role: 'SALESPERSON', emailSent: true });
      expect(res.body.devAcceptUrl).toMatch(/accept-invitation\?token=/);

      const mail = t.mail.last();
      expect(mail.to).toBe(to);
      expect(mail.text).toContain(tokenFrom(res.body.devAcceptUrl));

      const token = tokenFrom(res.body.devAcceptUrl);
      const stored = await t.prisma.system.invitation.findUniqueOrThrow({
        where: { id: res.body.id },
      });
      expect(stored.tokenHash).not.toContain(token);
      expect(
        JSON.stringify(
          await t.prisma.system.auditLog.findMany({ where: { entityId: res.body.id } }),
        ),
      ).not.toContain(token);
    });

    it('o convite é criado mesmo se o e-mail falhar (emailSent=false)', async () => {
      t.mail.fail = true;
      const res = await t.http
        .post(`${API}/invitations`)
        .set(bearer(owner))
        .send({ email: email(), role: 'SDR' });
      t.mail.fail = false;
      expect(res.status).toBe(201);
      expect(res.body.emailSent).toBe(false);
    });

    it('recusa e-mail já cadastrado e escalada de privilégio', async () => {
      expect(
        (
          await t.http
            .post(`${API}/invitations`)
            .set(bearer(owner))
            .send({ email: tenant.sdr.email, role: 'SDR' })
        ).status,
      ).toBe(409);
      expect(
        (
          await t.http
            .post(`${API}/invitations`)
            .set(bearer(admin))
            .send({ email: email(), role: 'OWNER' })
        ).status,
      ).toBe(403);
      const seller = await tokenFor(t.http, tenant.salesperson);
      expect(
        (
          await t.http
            .post(`${API}/invitations`)
            .set(bearer(seller))
            .send({ email: email(), role: 'SDR' })
        ).status,
      ).toBe(403);
    });

    it('reenviar invalida o convite anterior do mesmo e-mail', async () => {
      const to = email();
      const first = await t.http
        .post(`${API}/invitations`)
        .set(bearer(owner))
        .send({ email: to, role: 'SDR' });
      const second = await t.http
        .post(`${API}/invitations`)
        .set(bearer(owner))
        .send({ email: to, role: 'SDR' });
      const accept = (url: string) =>
        t.http
          .post(`${API}/invitations/accept`)
          .send({ token: tokenFrom(url), name: 'Fulano', password: PASSWORD });
      expect((await accept(first.body.devAcceptUrl)).status).toBe(400);
      expect((await accept(second.body.devAcceptUrl)).status).toBe(200);
    });

    it('aceitar cria o usuário no tenant certo, já loga e emite evento + auditoria', async () => {
      const to = email();
      const invite = await t.http
        .post(`${API}/invitations`)
        .set(bearer(owner))
        .send({ email: to, role: 'ENGINEERING', branchId: tenant.branchId, teamId: tenant.teamId });
      const res = await t.http.post(`${API}/invitations/accept`).send({
        token: tokenFrom(invite.body.devAcceptUrl),
        name: 'Nova Pessoa',
        password: PASSWORD,
      });

      expect(res.status).toBe(200);
      expect(res.body.user).toMatchObject({
        email: to,
        role: 'ENGINEERING',
        tenantId: tenant.id,
        name: 'Nova Pessoa',
      });
      expect(refreshCookie(res)).toBeTruthy();
      expect(JSON.stringify(res.body)).not.toMatch(/refreshToken/);

      const created = await t.prisma.system.user.findUniqueOrThrow({ where: { email: to } });
      expect(created).toMatchObject({
        tenantId: tenant.id,
        branchId: tenant.branchId,
        teamId: tenant.teamId,
        isActive: true,
      });
      expect((await login(t.http, to)).status).toBe(200);

      const event = await t.prisma.system.outboxEvent.findFirst({
        where: { tenantId: tenant.id, type: 'UserActivated', actorId: created.id },
      });
      expect(event).not.toBeNull();
      expect(
        await t.prisma.system.auditLog.findFirst({
          where: { tenantId: tenant.id, action: 'invitation.accepted', entityId: created.id },
        }),
      ).not.toBeNull();

      const listed = await t.http.get(`${API}/invitations`).set(bearer(owner));
      expect(listed.body.find((i: { id: string }) => i.id === invite.body.id).status).toBe(
        'ACCEPTED',
      );
    });

    it('o convite só pode ser usado uma vez', async () => {
      const invite = await t.http
        .post(`${API}/invitations`)
        .set(bearer(owner))
        .send({ email: email(), role: 'SDR' });
      const body = {
        token: tokenFrom(invite.body.devAcceptUrl),
        name: 'Pessoa Um',
        password: PASSWORD,
      };
      expect((await t.http.post(`${API}/invitations/accept`).send(body)).status).toBe(200);
      expect((await t.http.post(`${API}/invitations/accept`).send(body)).status).toBe(400);
    });

    it('recusa token inválido, convite expirado e convite revogado', async () => {
      const accept = (token: string) =>
        t.http
          .post(`${API}/invitations/accept`)
          .send({ token, name: 'Fulano', password: PASSWORD });
      expect((await accept('x'.repeat(43))).status).toBe(400);

      const expired = await t.http
        .post(`${API}/invitations`)
        .set(bearer(owner))
        .send({ email: email(), role: 'SDR' });
      await t.prisma.system.invitation.update({
        where: { id: expired.body.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      expect((await accept(tokenFrom(expired.body.devAcceptUrl))).status).toBe(400);
      expect(
        (await t.http.get(`${API}/invitations`).set(bearer(owner))).body.find(
          (i: { id: string }) => i.id === expired.body.id,
        ).status,
      ).toBe('EXPIRED');

      const revoked = await t.http
        .post(`${API}/invitations`)
        .set(bearer(owner))
        .send({ email: email(), role: 'SDR' });
      expect(
        (await t.http.delete(`${API}/invitations/${revoked.body.id}`).set(bearer(owner))).status,
      ).toBe(200);
      expect((await accept(tokenFrom(revoked.body.devAcceptUrl))).status).toBe(400);
    });

    it('exige senha forte e nome', async () => {
      const invite = await t.http
        .post(`${API}/invitations`)
        .set(bearer(owner))
        .send({ email: email(), role: 'SDR' });
      const token = tokenFrom(invite.body.devAcceptUrl);
      for (const password of ['curta1', 'somenteletras', '123456789']) {
        expect(
          (await t.http.post(`${API}/invitations/accept`).send({ token, name: 'Fulano', password }))
            .status,
        ).toBe(422);
      }
      expect(
        (
          await t.http
            .post(`${API}/invitations/accept`)
            .send({ token, name: 'F', password: PASSWORD })
        ).status,
      ).toBe(422);
    });

    it('não aceita se o e-mail passou a existir entre o convite e o aceite', async () => {
      const to = email();
      const invite = await t.http
        .post(`${API}/invitations`)
        .set(bearer(owner))
        .send({ email: to, role: 'SDR' });
      const other = await seedTenant(t.prisma, 'outra');
      await t.prisma.system.user.create({
        data: { tenantId: other.id, name: 'Já Existe', email: to, passwordHash: 'x', role: 'SDR' },
      });
      const res = await t.http
        .post(`${API}/invitations/accept`)
        .send({ token: tokenFrom(invite.body.devAcceptUrl), name: 'Fulano', password: PASSWORD });
      expect(res.status).toBe(409);
    });
  });

  describe('empresa, filiais e times', () => {
    it('só quem tem platform.tenant.manage altera a empresa', async () => {
      const seller = await tokenFor(t.http, tenant.salesperson);
      expect(
        (await t.http.patch(`${API}/tenant`).set(bearer(seller)).send({ name: 'Hack' })).status,
      ).toBe(403);
      const res = await t.http
        .patch(`${API}/tenant`)
        .set(bearer(owner))
        .send({ name: 'Empresa Users Ltda', document: '12.345.678/0001-90' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        name: 'Empresa Users Ltda',
        document: '12.345.678/0001-90',
      });
      expect((await t.http.get(`${API}/tenant`).set(bearer(seller))).body.name).toBe(
        'Empresa Users Ltda',
      );
    });

    it('CRUD de filial e time com auditoria; não exclui o que tem usuários', async () => {
      const branch = await t.http
        .post(`${API}/branches`)
        .set(bearer(owner))
        .send({ name: 'Filial Sul', city: 'Porto Alegre', state: 'rs' });
      expect(branch.status).toBe(201);
      expect(branch.body.state).toBe('RS');
      const team = await t.http
        .post(`${API}/teams`)
        .set(bearer(owner))
        .send({ name: 'Time Sul', branchId: branch.body.id });
      expect(team.status).toBe(201);

      expect(
        (await t.http.delete(`${API}/branches/${tenant.branchId}`).set(bearer(owner))).status,
      ).toBe(409);
      expect((await t.http.delete(`${API}/teams/${tenant.teamId}`).set(bearer(owner))).status).toBe(
        409,
      );

      expect(
        (
          await t.http
            .patch(`${API}/teams/${team.body.id}`)
            .set(bearer(owner))
            .send({ name: 'Time Sul 2' })
        ).body.name,
      ).toBe('Time Sul 2');
      expect((await t.http.delete(`${API}/teams/${team.body.id}`).set(bearer(owner))).status).toBe(
        200,
      );
      expect(
        (await t.http.delete(`${API}/branches/${branch.body.id}`).set(bearer(owner))).status,
      ).toBe(200);
      expect(
        (await t.http.get(`${API}/branches`).set(bearer(owner))).body.map(
          (b: { id: string }) => b.id,
        ),
      ).not.toContain(branch.body.id);

      const actions = (
        await t.prisma.system.auditLog.findMany({ where: { tenantId: tenant.id } })
      ).map((a) => a.action);
      expect(actions).toEqual(
        expect.arrayContaining([
          'branch.created',
          'team.created',
          'team.updated',
          'team.deleted',
          'branch.deleted',
        ]),
      );
    });

    it('nome duplicado na mesma empresa dá 409', async () => {
      await t.http.post(`${API}/branches`).set(bearer(owner)).send({ name: 'Duplicada' });
      expect(
        (await t.http.post(`${API}/branches`).set(bearer(owner)).send({ name: 'Duplicada' }))
          .status,
      ).toBe(409);
    });
  });
});
