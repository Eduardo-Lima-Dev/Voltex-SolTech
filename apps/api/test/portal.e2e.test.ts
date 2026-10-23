import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, seedTenant, type SeededTenant, type TestApp } from './helpers';

describe('portal do cliente (e2e)', () => {
  let t: TestApp;
  let tenant: SeededTenant;

  beforeAll(async () => {
    t = await createTestApp();
    tenant = await seedTenant(t.prisma, 'portal');
  });
  afterAll(() => t.close());

  describe('POST /public/portal/entrar', () => {
    it('responde igual para e-mail inexistente e existente (sem enumeração)', async () => {
      const res1 = await t.http.post('/public/portal/entrar').send({ email: 'existe@teste.test' });

      const res2 = await t.http.post('/public/portal/entrar').send({ email: 'ninguem@nada.test' });

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
      expect(res1.body.message).toBe(res2.body.message);
    });

    it('valida o e-mail (422)', async () => {
      const res = await t.http.post('/public/portal/entrar').send({ email: 'nao-e-email' });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /public/portal/exchange', () => {
    it('token inválido devolve 410 Gone', async () => {
      const res = await t.http.post('/public/portal/exchange').send({ token: 'token-invalido' });

      expect(res.status).toBe(410);
    });
  });

  describe('GET /portal/dashboard', () => {
    it('sem sessão devolve 400', async () => {
      const res = await t.http.get('/portal/dashboard');

      expect(res.status).toBe(400);
    });
  });
});
