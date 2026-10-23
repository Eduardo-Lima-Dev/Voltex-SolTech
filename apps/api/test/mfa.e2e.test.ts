import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, seedTenant, bearer, type SeededTenant, type TestApp } from './helpers';

describe('autenticação MFA (e2e)', () => {
  let t: TestApp;
  let tenant: SeededTenant;

  beforeAll(async () => {
    t = await createTestApp();
    tenant = await seedTenant(t.prisma, 'mfa');
  });
  afterAll(() => t.close());

  describe('POST /auth/mfa/setup', () => {
    it('retorna QR code e backup codes sem ativar', async () => {
      const res = await t.http
        .post('/auth/mfa/setup')
        .set('Authorization', bearer(tenant.owner.id))
        .send();

      expect(res.status).toBe(200);
      expect(res.body.qrCode).toBeDefined();
      expect(res.body.secret).toBeDefined();
      expect(res.body.backupCodes).toHaveLength(10);
    });

    it('sem autenticação devolve 401', async () => {
      const res = await t.http.post('/auth/mfa/setup').send();

      expect(res.status).toBe(401);
    });
  });

  describe('GET /auth/mfa/status', () => {
    it('mostra MFA desativado por padrão', async () => {
      const res = await t.http
        .get('/auth/mfa/status')
        .set('Authorization', bearer(tenant.owner.id));

      expect(res.status).toBe(200);
      expect(res.body.enabled).toBe(false);
    });
  });

  describe('POST /auth/mfa/disable', () => {
    it('desativa MFA já ativada', async () => {
      // TODO: Setup MFA primeiro, depois testar disable
    });
  });
});
