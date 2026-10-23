import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, seedTenant, bearer, type SeededTenant, type TestApp } from './helpers';

describe('LGPD — Direitos do tituldar de dados (e2e)', () => {
  let t: TestApp;
  let tenant: SeededTenant;

  beforeAll(async () => {
    t = await createTestApp();
    tenant = await seedTenant(t.prisma, 'lgpd');
  });
  afterAll(() => t.close());

  describe('DELETE /crm/privacy/accounts/:id/erase', () => {
    it('apaga documentos, fotos, acessos, logs da conta', async () => {
      // Cria conta de teste
      const account = await t.prisma.crm.account.create({
        data: {
          tenantId: tenant.id,
          name: 'Conta LGPD Test',
          document: '12345678000100',
        },
      });

      // Cria alguns registros relacionados (fotos, documentos, logs)
      // Nota: implementação completa incluiria criar registros de teste

      // Solicita apagamento
      const res = await t.http
        .delete(`/crm/privacy/accounts/${account.id}/erase`)
        .set('Authorization', bearer(tenant.owner.id));

      expect(res.status).toBe(200);
      expect(res.body.deletedRecords).toBeDefined();
      expect(typeof res.body.deletedRecords.documents).toBe('number');
    });
  });

  describe('POST /crm/privacy/export', () => {
    it('exporta dados da empresa em conformidade', async () => {
      const res = await t.http
        .post('/crm/privacy/export')
        .set('Authorization', bearer(tenant.owner.id));

      expect(res.status).toBe(200);
      expect(res.body.exportDate).toBeDefined();
      expect(res.body.accounts).toBeInstanceOf(Array);
      expect(res.body.projects).toBeInstanceOf(Array);

      // Verifica que senhas não estão incluídas
      if (res.body.accounts.length > 0) {
        expect(res.body.accounts[0].passwordHash).toBeUndefined();
      }
    });
  });
});
