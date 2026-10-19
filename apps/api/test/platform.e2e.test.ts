import { EventEmitter2 } from '@nestjs/event-emitter';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DomainEventEnvelope } from '@voltex/shared';
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

describe('plataforma: health, eventos, auditoria e OpenAPI (e2e)', () => {
  let t: TestApp;
  let tenant: SeededTenant;
  let owner: string;

  beforeAll(async () => {
    t = await createTestApp();
    tenant = await seedTenant(t.prisma, 'plat');
    owner = await tokenFor(t.http, tenant.owner);
  });
  afterAll(() => t.close());

  describe('health', () => {
    it('é público e verifica banco, Redis e armazenamento', async () => {
      const res = await t.http.get(`${API}/health`);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(Object.keys(res.body.checks).sort()).toEqual(['database', 'redis', 'storage']);
      for (const check of Object.values(res.body.checks) as { status: string }[])
        expect(check.status).toBe('up');
    });
  });

  describe('outbox de eventos', () => {
    const upload = () =>
      t.http
        .post(`${API}/documents`)
        .set(bearer(owner))
        .attach('file', pdfBuffer(), { filename: 'a.pdf', contentType: 'application/pdf' });
    const outbox = async () =>
      (await import('../src/platform/events/outbox-publisher.service')).OutboxPublisher;

    it('entrega o evento ao consumidor com o envelope completo e marca como publicado', async () => {
      const publisher = t.app.get(await outbox());
      await publisher.publishPending(500, tenant.id); // drena eventos de testes anteriores

      const received: DomainEventEnvelope[] = [];
      const listener = (envelope: DomainEventEnvelope) => void received.push(envelope);
      t.app.get(EventEmitter2).on('DocumentUploaded', listener);
      try {
        const doc = await upload();
        const before = await t.prisma.system.outboxEvent.findFirstOrThrow({
          where: { tenantId: tenant.id, type: 'DocumentUploaded', publishedAt: null },
        });
        expect(before.attempts).toBe(0);

        expect(await publisher.publishPending(500, tenant.id)).toBeGreaterThanOrEqual(1);
        const mine = received.find((e) => e.payload.documentId === doc.body.id)!;
        expect(mine).toMatchObject({
          type: 'DocumentUploaded',
          tenantId: tenant.id,
          actorId: tenant.owner.id,
          schemaVersion: 1,
          projectCode: null,
        });
        expect(mine.occurredAt).toBeInstanceOf(Date);

        const after = await t.prisma.system.outboxEvent.findUniqueOrThrow({
          where: { id: before.id },
        });
        expect(after.publishedAt).not.toBeNull();
        // já publicado: não é entregue de novo
        received.length = 0;
        await publisher.publishPending(500, tenant.id);
        expect(received).toEqual([]);
      } finally {
        t.app.get(EventEmitter2).off('DocumentUploaded', listener);
      }
    });

    it('reentrega depois de falha, registrando tentativas e o erro', async () => {
      const publisher = t.app.get(await outbox());
      await publisher.publishPending(500, tenant.id);
      await upload();

      const failing = async () => {
        throw new Error('consumidor fora do ar');
      };
      const emitter = t.app.get(EventEmitter2);
      emitter.on('DocumentUploaded', failing);
      await publisher.publishPending(500, tenant.id);
      emitter.off('DocumentUploaded', failing);

      const pending = await t.prisma.system.outboxEvent.findFirstOrThrow({
        where: { tenantId: tenant.id, type: 'DocumentUploaded', publishedAt: null },
      });
      expect(pending.attempts).toBe(1);
      expect(pending.lastError).toContain('consumidor fora do ar');

      expect(await publisher.publishPending(500, tenant.id)).toBe(1);
      const done = await t.prisma.system.outboxEvent.findUniqueOrThrow({
        where: { id: pending.id },
      });
      expect(done.publishedAt).not.toBeNull();
      expect(done.lastError).toBeNull();
    });

    it('para de tentar depois do limite de tentativas', async () => {
      const { OUTBOX_MAX_ATTEMPTS } =
        await import('../src/platform/events/outbox-publisher.service');
      const publisher = t.app.get(await outbox());
      await publisher.publishPending(500, tenant.id);
      const dead = await t.prisma.system.outboxEvent.create({
        data: {
          tenantId: tenant.id,
          type: 'LeadCreated',
          payload: {},
          attempts: OUTBOX_MAX_ATTEMPTS,
        },
      });
      expect(await publisher.publishPending(500, tenant.id)).toBe(0);
      expect(
        (await t.prisma.system.outboxEvent.findUniqueOrThrow({ where: { id: dead.id } }))
          .publishedAt,
      ).toBeNull();
    });
  });

  describe('auditoria', () => {
    it('lista paginada e filtrável por entidade, ação e período', async () => {
      await t.http.post(`${API}/branches`).set(bearer(owner)).send({ name: 'Auditada' });
      const res = await t.http
        .get(`${API}/audit-logs?entity=Branch&action=branch.created`)
        .set(bearer(owner));
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data[0]).toMatchObject({
        entity: 'Branch',
        action: 'branch.created',
        actorId: tenant.owner.id,
      });
      expect(res.body.data[0].requestId).toEqual(expect.any(String));

      const future = await t.http.get(`${API}/audit-logs?from=2999-01-01`).set(bearer(owner));
      expect(future.body.data).toEqual([]);
      const past = await t.http
        .get(`${API}/audit-logs?to=2999-01-01T00:00:00Z&pageSize=1`)
        .set(bearer(owner));
      expect(past.body.data).toHaveLength(1);
      expect((await t.http.get(`${API}/audit-logs?from=ontem`).set(bearer(owner))).status).toBe(
        422,
      );
    });

    it('é imutável no banco: UPDATE e DELETE são recusados até para acesso direto', async () => {
      const entry = await t.prisma.system.auditLog.findFirstOrThrow({
        where: { tenantId: tenant.id },
      });
      await expect(
        t.prisma.system.auditLog.update({
          where: { id: entry.id },
          data: { action: 'adulterado' },
        }),
      ).rejects.toThrow(/imutável/);
      await expect(t.prisma.system.auditLog.delete({ where: { id: entry.id } })).rejects.toThrow(
        /imutável/,
      );
      await expect(
        t.prisma.system.auditLog.deleteMany({ where: { tenantId: tenant.id } }),
      ).rejects.toThrow(/imutável/);
    });

    it('registra o IP, o user-agent e o requestId da requisição', async () => {
      const requestId = 'req-fixo-12345';
      await t.http
        .post(`${API}/teams`)
        .set(bearer(owner))
        .set('x-request-id', requestId)
        .set('user-agent', 'e2e-agent/1.0')
        .send({ name: 'Time Rastreado' });
      const entry = await t.prisma.system.auditLog.findFirstOrThrow({
        where: { tenantId: tenant.id, action: 'team.created' },
        orderBy: { createdAt: 'desc' },
      });
      expect(entry.requestId).toBe(requestId);
      expect(entry.userAgent).toBe('e2e-agent/1.0');
      expect(entry.ip).toBeTruthy();
    });
  });

  describe('contrato de erros e cabeçalhos', () => {
    it('devolve o x-request-id e o mesmo id no corpo do erro', async () => {
      const res = await t.http.get(`${API}/users`).set('x-request-id', 'abc-123');
      expect(res.status).toBe(401);
      expect(res.headers['x-request-id']).toBe('abc-123');
      expect(res.body.requestId).toBe('abc-123');
    });

    it('404 de rota inexistente segue o formato ApiError e não vaza stack trace', async () => {
      const res = await t.http.get(`${API}/nao-existe`).set(bearer(owner));
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
      expect(JSON.stringify(res.body)).not.toMatch(/at \w+|node_modules/);
    });

    it('envia os cabeçalhos de segurança do helmet', async () => {
      const res = await t.http.get(`${API}/health`);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['strict-transport-security']).toBeTruthy();
      expect(res.headers['x-powered-by']).toBeUndefined();
    });

    it('CORS só libera a origem configurada, com credenciais', async () => {
      const allowed = await t.http
        .options(`${API}/auth/login`)
        .set('Origin', 'http://localhost:5173')
        .set('Access-Control-Request-Method', 'POST');
      expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');
      expect(allowed.headers['access-control-allow-credentials']).toBe('true');
      const denied = await t.http
        .options(`${API}/auth/login`)
        .set('Origin', 'http://evil.example')
        .set('Access-Control-Request-Method', 'POST');
      expect(denied.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('OpenAPI', () => {
    it('gera o documento para todas as rotas e schemas Zod', async () => {
      const res = await t.http.get('/api/docs-json');
      expect(res.status).toBe(200);
      const paths = Object.keys(res.body.paths);
      expect(paths).toEqual(
        expect.arrayContaining([
          `${API}/auth/login`,
          `${API}/users`,
          `${API}/documents`,
          `${API}/invitations/accept`,
          `${API}/health`,
        ]),
      );
      expect(res.body.components.securitySchemes.bearer).toBeDefined();
    });
  });
});
