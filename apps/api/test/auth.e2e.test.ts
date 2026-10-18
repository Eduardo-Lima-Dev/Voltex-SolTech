import { JwtService } from '@nestjs/jwt';
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
  withRefresh,
  type SeededTenant,
  type TestApp,
} from './helpers';

describe('autenticação (e2e)', () => {
  let t: TestApp;
  let tenant: SeededTenant;

  beforeAll(async () => {
    t = await createTestApp();
    tenant = await seedTenant(t.prisma, 'auth');
  });
  afterAll(() => t.close());

  describe('login', () => {
    it('autentica, devolve access token e entrega o refresh só em cookie httpOnly', async () => {
      const res = await login(t.http, tenant.owner.email);
      expect(res.status).toBe(200);
      expect(res.body.accessToken).toEqual(expect.any(String));
      expect(res.body.expiresIn).toBe(900);
      expect(res.body.user).toMatchObject({
        email: tenant.owner.email,
        role: 'OWNER',
        tenantId: tenant.id,
      });
      expect(res.body.user.permissions).toContain('platform.user.manage');
      expect(JSON.stringify(res.body)).not.toMatch(/refresh|passwordHash|password_hash/i);

      const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) =>
        c.startsWith('voltex_refresh='),
      );
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
      expect(cookie).toMatch(/SameSite=Lax/i);
    });

    it('normaliza o e-mail (caixa e espaços)', async () => {
      const res = await login(t.http, `  ${tenant.owner.email.toUpperCase()} `);
      expect(res.status).toBe(200);
    });

    it('responde igual para senha errada e e-mail inexistente (sem enumeração de usuários)', async () => {
      const wrong = await login(t.http, tenant.owner.email, 'SenhaErrada1');
      const unknown = await login(t.http, 'ninguem@nada.test', 'SenhaErrada1');
      expect(wrong.status).toBe(401);
      expect(unknown.status).toBe(401);
      expect(wrong.body.message).toBe(unknown.body.message);
      expect(wrong.body.code).toBe('UNAUTHORIZED');
    });

    it('recusa usuário inativo e tenant suspenso', async () => {
      const inactive = await t.prisma.system.user.update({
        where: { id: tenant.sdr.id },
        data: { isActive: false },
      });
      expect((await login(t.http, inactive.email)).status).toBe(401);
      await t.prisma.system.user.update({ where: { id: tenant.sdr.id }, data: { isActive: true } });

      await t.prisma.system.tenant.update({
        where: { id: tenant.id },
        data: { status: 'SUSPENDED' },
      });
      expect((await login(t.http, tenant.owner.email)).status).toBe(401);
      await t.prisma.system.tenant.update({ where: { id: tenant.id }, data: { status: 'ACTIVE' } });
    });

    it('valida o corpo (422 com detalhes por campo)', async () => {
      const res = await t.http
        .post(`${API}/auth/login`)
        .send({ email: 'nao-e-email', password: '1' });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.details.map((d: { path: string }) => d.path).sort()).toEqual([
        'email',
        'password',
      ]);
      expect(res.body.requestId).toEqual(expect.any(String));
    });

    it('registra login e falha de login na auditoria', async () => {
      await login(t.http, tenant.manager.email, 'SenhaErrada1');
      await login(t.http, tenant.manager.email);
      const actions = (
        await t.prisma.system.auditLog.findMany({
          where: { tenantId: tenant.id, actorId: tenant.manager.id },
        })
      ).map((a) => a.action);
      expect(actions).toEqual(expect.arrayContaining(['auth.login', 'auth.login_failed']));
    });
  });

  describe('rotas protegidas', () => {
    it('401 sem token, com token malformado e com token assinado por outro segredo', async () => {
      expect((await t.http.get(`${API}/auth/me`)).status).toBe(401);
      expect((await t.http.get(`${API}/auth/me`).set(bearer('abc.def.ghi'))).status).toBe(401);
      const forged = new JwtService({
        secret: 'outro-segredo-qualquer-com-mais-de-32-caracteres',
      }).sign({ sub: tenant.owner.id, tid: tenant.id, role: 'OWNER' });
      expect((await t.http.get(`${API}/auth/me`).set(bearer(forged))).status).toBe(401);
    });

    it('rejeita token válido cujo tenant não corresponde ao do usuário', async () => {
      const other = await seedTenant(t.prisma, 'outro');
      const jwt = t.app.get(JwtService);
      const mixed = jwt.sign({ sub: tenant.owner.id, tid: other.id, role: 'OWNER' });
      expect((await t.http.get(`${API}/auth/me`).set(bearer(mixed))).status).toBe(401);
    });

    it('/auth/me devolve o usuário e as permissões do perfil', async () => {
      const token = await tokenFor(t.http, tenant.salesperson);
      const res = await t.http.get(`${API}/auth/me`).set(bearer(token));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        email: tenant.salesperson.email,
        role: 'SALESPERSON',
        tenantName: tenant.name,
      });
      expect(res.body.permissions).toContain('calculator.session.create');
      expect(res.body.permissions).not.toContain('platform.user.manage');
    });

    it('perfil sem permissão recebe 403; com permissão recebe 200', async () => {
      const seller = await tokenFor(t.http, tenant.salesperson);
      const owner = await tokenFor(t.http, tenant.owner);
      expect((await t.http.get(`${API}/users`).set(bearer(seller))).status).toBe(403);
      expect((await t.http.get(`${API}/audit-logs`).set(bearer(seller))).status).toBe(403);
      expect((await t.http.get(`${API}/users`).set(bearer(owner))).status).toBe(200);
    });

    it('desativar o usuário derruba o access token imediatamente', async () => {
      const token = await tokenFor(t.http, tenant.sdr);
      expect((await t.http.get(`${API}/auth/me`).set(bearer(token))).status).toBe(200);
      await t.prisma.system.user.update({
        where: { id: tenant.sdr.id },
        data: { isActive: false },
      });
      expect((await t.http.get(`${API}/auth/me`).set(bearer(token))).status).toBe(401);
      await t.prisma.system.user.update({ where: { id: tenant.sdr.id }, data: { isActive: true } });
    });

    it('mudança de perfil vale na hora (permissões vêm do banco, não do token)', async () => {
      const token = await tokenFor(t.http, tenant.sdr);
      expect((await t.http.get(`${API}/users`).set(bearer(token))).status).toBe(403);
      await t.prisma.system.user.update({ where: { id: tenant.sdr.id }, data: { role: 'ADMIN' } });
      expect((await t.http.get(`${API}/users`).set(bearer(token))).status).toBe(200);
      await t.prisma.system.user.update({ where: { id: tenant.sdr.id }, data: { role: 'SDR' } });
    });
  });

  describe('refresh e logout', () => {
    it('rotaciona o refresh token a cada uso', async () => {
      const first = await login(t.http, tenant.admin.email);
      const c1 = refreshCookie(first)!;
      const second = await t.http.post(`${API}/auth/refresh`).set(withRefresh(c1));
      expect(second.status).toBe(200);
      const c2 = refreshCookie(second)!;
      expect(c2).toBeTruthy();
      expect(c2).not.toBe(c1);
      expect(second.body.accessToken).toEqual(expect.any(String));
      expect(second.body.user.email).toBe(tenant.admin.email);
    });

    it('detecta reuso de refresh token e revoga a sessão inteira', async () => {
      const first = await login(t.http, tenant.admin.email);
      const stolen = refreshCookie(first)!;
      const rotated = await t.http.post(`${API}/auth/refresh`).set(withRefresh(stolen));
      const legit = refreshCookie(rotated)!;

      // Quem reapresenta o token antigo (atacante) é barrado...
      expect((await t.http.post(`${API}/auth/refresh`).set(withRefresh(stolen))).status).toBe(401);
      // ...e o token novo do usuário legítimo também é revogado (toda a família).
      expect((await t.http.post(`${API}/auth/refresh`).set(withRefresh(legit))).status).toBe(401);

      const audit = await t.prisma.system.auditLog.findFirst({
        where: {
          tenantId: tenant.id,
          action: 'auth.refresh_reuse_detected',
          actorId: tenant.admin.id,
        },
      });
      expect(audit).not.toBeNull();
    });

    it('recusa refresh sem cookie, com cookie inválido ou expirado', async () => {
      expect((await t.http.post(`${API}/auth/refresh`)).status).toBe(401);
      expect((await t.http.post(`${API}/auth/refresh`).set(withRefresh('lixo'))).status).toBe(401);

      const res = await login(t.http, tenant.manager.email);
      await t.prisma.system.refreshToken.updateMany({
        where: { userId: tenant.manager.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      expect(
        (await t.http.post(`${API}/auth/refresh`).set(withRefresh(refreshCookie(res)!))).status,
      ).toBe(401);
    });

    it('logout revoga a sessão e limpa o cookie; é idempotente', async () => {
      const res = await login(t.http, tenant.manager.email);
      const cookie = refreshCookie(res)!;
      const out = await t.http.post(`${API}/auth/logout`).set(withRefresh(cookie));
      expect(out.status).toBe(204);
      expect((out.headers['set-cookie'] as unknown as string[]).join(';')).toMatch(
        /voltex_refresh=;/,
      );
      expect((await t.http.post(`${API}/auth/refresh`).set(withRefresh(cookie))).status).toBe(401);
      expect((await t.http.post(`${API}/auth/logout`)).status).toBe(204);
    });

    it('desativar o usuário revoga as sessões de refresh', async () => {
      const owner = await tokenFor(t.http, tenant.owner);
      const victim = await login(t.http, tenant.salesperson.email);
      const cookie = refreshCookie(victim)!;
      const res = await t.http
        .patch(`${API}/users/${tenant.salesperson.id}`)
        .set(bearer(owner))
        .send({ isActive: false });
      expect(res.status).toBe(200);
      expect((await t.http.post(`${API}/auth/refresh`).set(withRefresh(cookie))).status).toBe(401);
      await t.prisma.system.user.update({
        where: { id: tenant.salesperson.id },
        data: { isActive: true },
      });
    });
  });

  it('a senha nunca aparece em respostas nem na auditoria', async () => {
    await login(t.http, tenant.owner.email);
    const token = await tokenFor(t.http, tenant.owner);
    const users = await t.http.get(`${API}/users`).set(bearer(token));
    expect(JSON.stringify(users.body)).not.toMatch(/passwordHash|argon2|mfaSecret/);
    const logs = await t.prisma.system.auditLog.findMany({ where: { tenantId: tenant.id } });
    expect(JSON.stringify(logs)).not.toContain(PASSWORD);
  });
});

describe('limite de tentativas de login (e2e)', () => {
  it('responde 429 depois de 5 tentativas por minuto', async () => {
    const t = await createTestApp({ THROTTLE_DISABLED: 'false' });
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 7; i++)
        statuses.push((await login(t.http, 'ninguem@nada.test', 'SenhaErrada1')).status);
      expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
      expect(statuses.slice(5)).toEqual([429, 429]);
    } finally {
      await t.close();
    }
  });

  it('o health check não sofre limite', async () => {
    const t = await createTestApp({ THROTTLE_DISABLED: 'false', THROTTLE_LIMIT: '2' });
    try {
      for (let i = 0; i < 6; i++) expect((await t.http.get(`${API}/health`)).status).toBe(200);
    } finally {
      await t.close();
    }
  });
});

describe('janela de tolerância do refresh (e2e)', () => {
  it('reapresentar o token recém-rotacionado (abas simultâneas) não revoga a sessão', async () => {
    const t = await createTestApp({ REFRESH_REUSE_GRACE_MS: '60000' });
    try {
      const tenant = await seedTenant(t.prisma, 'grace');
      const first = await login(t.http, tenant.owner.email);
      const old = refreshCookie(first)!;
      const rotated = await t.http.post(`${API}/auth/refresh`).set(withRefresh(old));
      const fresh = refreshCookie(rotated)!;

      expect((await t.http.post(`${API}/auth/refresh`).set(withRefresh(old))).status).toBe(401);
      // dentro da janela: a família NÃO foi revogada, o token novo continua válido
      expect((await t.http.post(`${API}/auth/refresh`).set(withRefresh(fresh))).status).toBe(200);
    } finally {
      await t.close();
    }
  });
});
