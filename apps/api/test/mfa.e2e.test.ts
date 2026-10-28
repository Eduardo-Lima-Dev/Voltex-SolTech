import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  API,
  PASSWORD,
  bearer,
  createTestApp,
  login,
  seedTenant,
  tokenFor,
  type SeededTenant,
  type SeededUser,
  type TestApp,
} from './helpers';
import { tokenWithRole } from './crm-support';
import { totp } from '../src/platform/auth/totp';

describe('Segundo fator por aplicativo (e2e)', () => {
  let t: TestApp;
  let a: SeededTenant;
  let b: SeededTenant;
  let admin: string;

  const post = (path: string, body: unknown = {}, token?: string) => {
    const req = t.http.post(`${API}${path}`);
    return (token ? req.set(bearer(token)) : req).send(body as object);
  };

  /** Código válido agora, liberando o passo (o mesmo código não vale duas vezes). */
  const freshCode = async (secret: string, user: SeededUser): Promise<string> => {
    await t.prisma.system.user.update({ where: { id: user.id }, data: { mfaLastStep: null } });
    return totp(secret);
  };

  /** Liga o segundo fator do usuário e devolve o segredo e os códigos de recuperação. */
  const enroll = async (user: SeededUser) => {
    const token = await tokenFor(t.http, user);
    const setup = await post('/auth/mfa/setup', {}, token);
    expect(setup.status).toBe(200);
    const secret = setup.body.secret as string;
    const confirmed = await post('/auth/mfa/confirm', { code: totp(secret) }, token);
    expect(confirmed.status).toBe(200);
    return { secret, recoveryCodes: confirmed.body.recoveryCodes as string[], token };
  };

  beforeAll(async () => {
    t = await createTestApp();
    a = await seedTenant(t.prisma, 'mfa');
    b = await seedTenant(t.prisma, 'mfab');
    admin = await tokenFor(t.http, a.admin);
  });
  afterAll(() => t.close());

  describe('cadastro do aplicativo', () => {
    it('mostra o segredo uma vez, só liga com um código certo e entrega dez códigos de recuperação', async () => {
      const user = a.sdr;
      const token = await tokenFor(t.http, user);
      const before = await t.http.get(`${API}/auth/mfa/status`).set(bearer(token));
      expect(before.body).toEqual({ enabled: false, required: false, recoveryCodesLeft: 0 });

      const setup = await post('/auth/mfa/setup', {}, token);
      expect(setup.body.secret).toMatch(/^[A-Z2-7]{32}$/);
      expect(setup.body.otpauthUri).toMatch(/^otpauth:\/\/totp\//);

      const wrong = await post('/auth/mfa/confirm', { code: '000000' }, token);
      expect(wrong.status).toBe(422);
      expect(wrong.body.code).toBe('INVALID_MFA_CODE');
      expect((await t.http.get(`${API}/auth/mfa/status`).set(bearer(token))).body.enabled).toBe(
        false,
      );

      const ok = await post('/auth/mfa/confirm', { code: totp(setup.body.secret) }, token);
      expect(ok.status).toBe(200);
      expect(ok.body.recoveryCodes).toHaveLength(10);
      const status = await t.http.get(`${API}/auth/mfa/status`).set(bearer(token));
      expect(status.body).toEqual({ enabled: true, required: false, recoveryCodesLeft: 10 });

      // O segredo fica cifrado no banco e os códigos de recuperação, só em hash.
      const row = await t.prisma.system.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(row.mfaSecret).not.toContain(setup.body.secret);
      expect(JSON.stringify(row.mfaRecoveryCodes)).not.toContain(ok.body.recoveryCodes[0]);
      expect((row.mfaRecoveryCodes as string[])[0]).toMatch(/^[0-9a-f]{64}$/);

      const again = await post('/auth/mfa/setup', {}, token);
      expect(again.status).toBe(422);
      expect(again.body.code).toBe('MFA_ALREADY_ENABLED');
    });

    it('exige estar logado', async () => {
      expect((await post('/auth/mfa/setup')).status).toBe(401);
      expect((await t.http.get(`${API}/auth/mfa/status`)).status).toBe(401);
    });
  });

  describe('login em duas etapas', () => {
    it('com o segundo fator ligado a senha sozinha não abre a sessão', async () => {
      const user = a.salesperson;
      const { secret } = await enroll(user);
      const res = await login(t.http, user.email);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'MFA_REQUIRED', expiresIn: 300 });
      expect(res.body.accessToken).toBeUndefined();
      expect(res.headers['set-cookie']).toBeUndefined();

      // O desafio não vale como token de acesso.
      expect((await t.http.get(`${API}/auth/me`).set(bearer(res.body.mfaToken))).status).toBe(401);

      const verified = await post('/auth/mfa/verify', {
        mfaToken: res.body.mfaToken,
        code: await freshCode(secret, user),
      });
      expect(verified.status).toBe(200);
      expect(verified.body.accessToken).toEqual(expect.any(String));
      expect(verified.body.user.email).toBe(user.email);
      const cookie = (verified.headers['set-cookie'] as unknown as string[]).find((c) =>
        c.startsWith('voltex_refresh='),
      );
      expect(cookie).toMatch(/HttpOnly/i);
    });

    it('código errado, repetido ou desafio adulterado são recusados', async () => {
      const user = a.manager;
      const { secret } = await enroll(user);
      const challenge = (await login(t.http, user.email)).body.mfaToken as string;
      expect((await post('/auth/mfa/verify', { mfaToken: challenge, code: '123456' })).status).toBe(
        401,
      );
      expect(
        (await post('/auth/mfa/verify', { mfaToken: `${challenge}x`, code: '123456' })).status,
      ).toBe(401);

      const code = await freshCode(secret, user);
      expect((await post('/auth/mfa/verify', { mfaToken: challenge, code })).status).toBe(200);
      // O mesmo código não vale duas vezes (nem no desafio seguinte).
      const next = (await login(t.http, user.email)).body.mfaToken as string;
      expect((await post('/auth/mfa/verify', { mfaToken: next, code })).status).toBe(401);
    });

    it('código de recuperação vale uma vez só', async () => {
      const user = a.owner;
      const { recoveryCodes } = await enroll(user);
      const challenge = async () => (await login(t.http, user.email)).body.mfaToken as string;
      const first = await post('/auth/mfa/verify', {
        mfaToken: await challenge(),
        code: recoveryCodes[0],
      });
      expect(first.status).toBe(200);
      const reused = await post('/auth/mfa/verify', {
        mfaToken: await challenge(),
        code: recoveryCodes[0],
      });
      expect(reused.status).toBe(401);
      const lower = await post('/auth/mfa/verify', {
        mfaToken: await challenge(),
        code: recoveryCodes[1]!.toLowerCase().replace('-', ' '),
      });
      expect(lower.status).toBe(200);
      const status = await t.http
        .get(`${API}/auth/mfa/status`)
        .set(bearer(first.body.accessToken as string));
      expect(status.body.recoveryCodesLeft).toBe(8);
    });

    it('muitas tentativas erradas travam por alguns minutos, até com o código certo', async () => {
      const user = b.sdr;
      const { secret } = await enroll(user);
      const challenge = (await login(t.http, user.email)).body.mfaToken as string;
      for (let i = 0; i < 5; i += 1)
        expect(
          (await post('/auth/mfa/verify', { mfaToken: challenge, code: '000000' })).status,
        ).toBe(401);
      const locked = await post('/auth/mfa/verify', {
        mfaToken: challenge,
        code: await freshCode(secret, user),
      });
      expect(locked.status).toBe(429);
      expect(locked.body.code).toBe('MFA_LOCKED');
    });
  });

  describe('desativar', () => {
    it('pede a senha e um código; depois o login volta a ser só com a senha', async () => {
      const user = b.manager;
      const { secret, token } = await enroll(user);
      const wrongPassword = await post(
        '/auth/mfa/disable',
        { password: 'SenhaErrada1', code: await freshCode(secret, user) },
        token,
      );
      expect(wrongPassword.status).toBe(422);
      expect(wrongPassword.body.code).toBe('INVALID_PASSWORD');
      const wrongCode = await post(
        '/auth/mfa/disable',
        { password: PASSWORD, code: '000000' },
        token,
      );
      expect(wrongCode.status).toBe(422);
      const ok = await post(
        '/auth/mfa/disable',
        { password: PASSWORD, code: await freshCode(secret, user) },
        token,
      );
      expect(ok.status).toBe(204);
      const res = await login(t.http, user.email);
      expect(res.body.accessToken).toEqual(expect.any(String));
      const row = await t.prisma.system.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(row).toMatchObject({ mfaEnabled: false, mfaSecret: null });
    });
  });

  describe('política da empresa', () => {
    it('só administrador define; exigir para um perfil leva o usuário a cadastrar o aplicativo no próprio login', async () => {
      const sellerToken = (await tokenWithRole(t, a, 'OPERATIONS')).token;
      const denied = await t.http
        .put(`${API}/auth/mfa/policy`)
        .set(bearer(sellerToken))
        .send({ required: true, roles: ['SALESPERSON'] });
      expect(denied.status).toBe(403);

      // O vendedor desta empresa ainda não usa o segundo fator (os testes acima usaram outros perfis).
      const seller = b.salesperson;
      await t.prisma.system.user.update({
        where: { id: seller.id },
        data: { mfaEnabled: false, mfaSecret: null, mfaRecoveryCodes: [] },
      });
      const adminB = await tokenFor(t.http, b.admin);
      const set = await t.http
        .put(`${API}/auth/mfa/policy`)
        .set(bearer(adminB))
        .send({ required: true, roles: ['SALESPERSON'] });
      expect(set.status).toBe(200);
      expect((await t.http.get(`${API}/auth/mfa/policy`).set(bearer(adminB))).body).toEqual({
        required: true,
        roles: ['SALESPERSON'],
      });

      // Quem não é do perfil entra normalmente.
      expect((await login(t.http, b.admin.email)).body.accessToken).toEqual(expect.any(String));

      const res = await login(t.http, seller.email);
      expect(res.body).toMatchObject({ status: 'MFA_SETUP_REQUIRED' });
      expect(res.body.accessToken).toBeUndefined();

      // O desafio de cadastro não serve para a etapa de verificação, e vice-versa.
      expect(
        (await post('/auth/mfa/verify', { mfaToken: res.body.mfaToken, code: '123456' })).status,
      ).toBe(401);

      const setup = await post('/auth/mfa/login/setup', { mfaToken: res.body.mfaToken });
      expect(setup.status).toBe(200);
      const confirm = await post('/auth/mfa/login/confirm', {
        mfaToken: res.body.mfaToken,
        code: totp(setup.body.secret),
      });
      expect(confirm.status).toBe(200);
      expect(confirm.body.accessToken).toEqual(expect.any(String));
      expect(confirm.body.recoveryCodes).toHaveLength(10);

      // Com a política, o aplicativo não pode ser desativado.
      const stuck = await post(
        '/auth/mfa/disable',
        { password: PASSWORD, code: await freshCode(setup.body.secret, seller) },
        confirm.body.accessToken,
      );
      expect(stuck.status).toBe(422);
      expect(stuck.body.code).toBe('MFA_REQUIRED_BY_POLICY');
      expect(
        (await t.http.get(`${API}/auth/mfa/status`).set(bearer(confirm.body.accessToken))).body
          .required,
      ).toBe(true);
    });

    it('a edição geral das configurações da empresa não apaga a política', async () => {
      const adminB = await tokenFor(t.http, b.admin);
      const tenant = await t.http.get(`${API}/tenant`).set(bearer(adminB));
      await t.http
        .patch(`${API}/tenant`)
        .set(bearer(adminB))
        .send({ name: tenant.body.name, settings: {} });
      expect((await t.http.get(`${API}/auth/mfa/policy`).set(bearer(adminB))).body.required).toBe(
        true,
      );
    });

    it('a política de uma empresa não vale para a outra', async () => {
      expect((await login(t.http, a.admin.email)).body.accessToken).toEqual(expect.any(String));
      expect((await t.http.get(`${API}/auth/mfa/policy`).set(bearer(admin))).body).toEqual({
        required: false,
        roles: [],
      });
    });
  });

  describe('administrador remove o segundo fator de quem perdeu o aparelho', () => {
    it('zera segredo e códigos; outra empresa não consegue', async () => {
      const user = a.admin;
      await enroll(user);
      expect((await login(t.http, user.email)).body.status).toBe('MFA_REQUIRED');
      const res = await post(`/auth/mfa/users/${user.id}/reset`, {}, admin);
      expect(res.status).toBe(204);
      expect((await login(t.http, user.email)).body.accessToken).toEqual(expect.any(String));
      const foreign = await post(`/auth/mfa/users/${b.admin.id}/reset`, {}, admin);
      expect(foreign.status).toBe(422);
      const audits = await t.prisma.system.auditLog.count({
        where: { tenantId: a.id, action: 'auth.mfa_reset_by_admin' },
      });
      expect(audits).toBe(1);
    });
  });
});
