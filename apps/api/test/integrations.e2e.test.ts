import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Role } from '@voltex/shared';
import {
  API,
  bearer,
  createTestApp,
  seedTenant,
  tokenFor,
  type SeededTenant,
  type TestApp,
} from './helpers';
import { auditOf, tokenWithRole } from './crm-support';
import type { IntegrationAdapter } from '../src/platform/integrations/integration-adapter';

const SECRET = 'segredo-super-sensivel-123';

describe('Integration Hub, plano e comunicações (e2e)', () => {
  let t: TestApp;
  let a: SeededTenant;
  let b: SeededTenant;
  let admin: string;
  let adminB: string;
  let seller: string;
  let sdr: string;
  // Controle dos adaptadores falsos.
  let syncBehavior: 'ok' | 'fail' = 'ok';
  let syncCalls = 0;
  // Obtidos logo após subir o app: `createTestApp` reimporta os módulos (outra instância teria classes diferentes).
  let integrations: {
    runSync: (
      id: string,
      o?: { attempt?: number; final?: boolean; trigger?: string },
    ) => Promise<{ status: string; error?: string }>;
  };
  let queue: {
    process: (job: {
      name: string;
      data?: unknown;
      attemptsMade?: number;
      opts?: { attempts?: number };
    }) => Promise<unknown>;
    dueConnections: () => Promise<{ tenantId: string; connectionId: string }[]>;
  };
  let withTenant: <T>(tenantId: string, fn: () => Promise<T>) => Promise<T>;
  let planService: {
    assertFeature: (f: string) => Promise<void>;
    isFeatureEnabled: (f: string) => Promise<boolean>;
  };
  let integrationHttp: { request: (i: { url: string }) => Promise<unknown> };

  const get = (path: string, token: string) => t.http.get(`${API}${path}`).set(bearer(token));
  const post = (path: string, token: string, body: object = {}) =>
    t.http.post(`${API}${path}`).set(bearer(token)).send(body);
  const patch = (path: string, token: string, body: object = {}) =>
    t.http.patch(`${API}${path}`).set(bearer(token)).send(body);

  const credentialSchema = z.object({
    apiKey: z.string().min(3),
    siteId: z.string().min(1),
  });

  const fakeMonitor: IntegrationAdapter = {
    key: 'fake-monitor',
    kind: 'MONITORING',
    label: 'Monitor de teste',
    official: true,
    licenseStatus: 'CLEARED',
    credentialFields: [
      { name: 'apiKey', label: 'Chave', secret: true, required: true, hint: null },
      { name: 'siteId', label: 'ID da usina', secret: false, required: true, hint: null },
    ],
    credentialSchema,
    rateBudget: { perDay: 4 },
    minIntervalMinutes: 60,
    test: async ({ credentials }) =>
      credentials.apiKey === 'bad'
        ? { ok: false, message: 'chave recusada' }
        : { ok: true, message: 'conectado' },
    sync: async () => {
      syncCalls += 1;
      if (syncBehavior === 'fail') throw new Error('provedor fora do ar');
      return { summary: { plants: 2 } };
    },
  };
  const fakeUnofficial: IntegrationAdapter = {
    ...fakeMonitor,
    key: 'fake-unofficial',
    label: 'Monitor não oficial',
    official: false,
    rateBudget: undefined,
  };
  const fakeOff: IntegrationAdapter = {
    ...fakeMonitor,
    key: 'fake-off',
    label: 'Monitor desligado no servidor',
  };

  const validCreds = { apiKey: SECRET, siteId: 'S-1' };
  const createConnection = async (provider: string, label: string, token = admin) => {
    const res = await post('/integrations/connections', token, {
      provider,
      label,
      credentials: validCreds,
    });
    expect(res.status).toBe(201);
    return res.body as { id: string };
  };

  beforeAll(async () => {
    t = await createTestApp();
    const { IntegrationRegistry } =
      await import('../src/platform/integrations/integration-registry');
    const { IntegrationsService } =
      await import('../src/platform/integrations/integrations.service');
    const { IntegrationsQueue } = await import('../src/platform/integrations/integrations.queue');
    const { IntegrationHttp } = await import('../src/platform/integrations/integration-http');
    const { PlanService } = await import('../src/platform/tenancy/plan.service');
    const { RequestContext } = await import('../src/common/context/request-context');
    const registry = t.app.get(IntegrationRegistry);
    registry.register(fakeMonitor);
    registry.register(fakeUnofficial);
    registry.register(fakeOff);
    integrations = t.app.get(IntegrationsService);
    queue = t.app.get(IntegrationsQueue);
    planService = t.app.get(PlanService);
    integrationHttp = t.app.get(IntegrationHttp);
    const context = t.app.get(RequestContext);
    withTenant = (tenantId, fn) => context.run({ tenantId }, fn);
    a = await seedTenant(t.prisma, 'integ-a');
    b = await seedTenant(t.prisma, 'integ-b');
    admin = await tokenFor(t.http, a.admin);
    adminB = await tokenFor(t.http, b.admin);
    seller = await tokenFor(t.http, a.salesperson);
    sdr = await tokenFor(t.http, a.sdr);
  });

  afterAll(async () => {
    await t.close();
  });

  describe('conexões', () => {
    it('lista os provedores e informa se estão ligados no servidor', async () => {
      const res = await get('/integrations/providers', admin);
      expect(res.status).toBe(200);
      const providers = res.body as { key: string; enabled: boolean; official: boolean }[];
      expect(providers.find((p) => p.key === 'fake-monitor')?.enabled).toBe(true);
      expect(providers.find((p) => p.key === 'fake-off')?.enabled).toBe(false);
      expect(providers.find((p) => p.key === 'fake-unofficial')?.official).toBe(false);
    });

    it('vendedor não vê nem gerencia integrações', async () => {
      expect((await get('/integrations/connections', seller)).status).toBe(403);
      expect(
        (
          await post('/integrations/connections', seller, {
            provider: 'fake-monitor',
            label: 'x',
            credentials: validCreds,
          })
        ).status,
      ).toBe(403);
    });

    it('cria a conexão sem devolver o segredo e cifra a credencial no banco', async () => {
      const res = await post('/integrations/connections', admin, {
        provider: 'fake-monitor',
        label: 'Usina Cifrada',
        credentials: validCreds,
      });
      expect(res.status).toBe(201);
      expect(JSON.stringify(res.body)).not.toContain(SECRET);
      const dto = res.body as {
        status: string;
        credentials: { name: string; configured: boolean; value: string | null }[];
      };
      expect(dto.status).toBe('DISABLED');
      expect(dto.credentials.find((c) => c.name === 'apiKey')).toMatchObject({
        configured: true,
        value: null,
      });
      expect(dto.credentials.find((c) => c.name === 'siteId')?.value).toBe('S-1');
      const raw = await t.prisma.system.integrationConnection.findFirstOrThrow({
        where: { tenantId: a.id, label: 'Usina Cifrada' },
      });
      expect(typeof raw.credentials).toBe('string');
      expect(String(raw.credentials)).toMatch(/^enc:v2:/);
      expect(String(raw.credentials)).not.toContain(SECRET);
      // A auditoria registra o fato, nunca a credencial.
      const audit = await auditOf(t, a.id, 'integration.created');
      expect(JSON.stringify(audit)).not.toContain(SECRET);
    });

    it('recusa credencial inválida e provedor desconhecido', async () => {
      const bad = await post('/integrations/connections', admin, {
        provider: 'fake-monitor',
        label: 'Sem chave',
        credentials: { siteId: 'S-2' },
      });
      expect(bad.status).toBe(422);
      expect((bad.body as { code?: string }).code).toBe('INVALID_CREDENTIALS');
      const unknown = await post('/integrations/connections', admin, {
        provider: 'nao-existe',
        label: 'x',
        credentials: {},
      });
      expect(unknown.status).toBe(400);
    });

    it('não repete o nome de conexão do mesmo provedor', async () => {
      await createConnection('fake-monitor', 'Duplicada');
      const again = await post('/integrations/connections', admin, {
        provider: 'fake-monitor',
        label: 'Duplicada',
        credentials: validCreds,
      });
      expect(again.status).toBe(409);
    });

    it('troca só os campos enviados e mantém o restante', async () => {
      const { id } = await createConnection('fake-monitor', 'Parcial');
      const res = await patch(`/integrations/connections/${id}`, admin, {
        credentials: { siteId: 'S-NOVO' },
      });
      expect(res.status).toBe(200);
      const dto = res.body as {
        credentials: { name: string; configured: boolean; value: string | null }[];
      };
      expect(dto.credentials.find((c) => c.name === 'siteId')?.value).toBe('S-NOVO');
      expect(dto.credentials.find((c) => c.name === 'apiKey')?.configured).toBe(true);
    });

    it('a exportação da empresa leva as conexões, mas nunca as credenciais', async () => {
      await createConnection('fake-monitor', 'Para exportar');
      const res = await get('/tenant/export', admin);
      expect(res.status).toBe(200);
      const body = res.body as {
        integrationConnections: { label: string }[];
        communicationLogs: unknown[];
      };
      expect(body.integrationConnections.some((c) => c.label === 'Para exportar')).toBe(true);
      expect(Array.isArray(body.communicationLogs)).toBe(true);
      expect(JSON.stringify(res.body)).not.toContain(SECRET);
    });

    it('isola as empresas', async () => {
      const { id } = await createConnection('fake-monitor', 'Só da A');
      expect((await get(`/integrations/connections/${id}`, adminB)).status).toBe(404);
      const listB = await get('/integrations/connections', adminB);
      expect((listB.body as { id: string }[]).some((c) => c.id === id)).toBe(false);
      expect((await post(`/integrations/connections/${id}/activate`, adminB)).status).toBe(404);
    });
  });

  describe('ligar, testar e termos', () => {
    it('não liga provedor desligado no servidor', async () => {
      const { id } = await createConnection('fake-off', 'Desligado no servidor');
      const res = await post(`/integrations/connections/${id}/activate`, admin, {});
      expect(res.status).toBe(503);
    });

    it('endpoint não oficial só liga com o aceite dos termos, que fica registrado', async () => {
      const { id } = await createConnection('fake-unofficial', 'Não oficial');
      const refused = await post(`/integrations/connections/${id}/activate`, admin, {});
      expect(refused.status).toBe(422);
      expect((refused.body as { code?: string }).code).toBe('TERMS_NOT_ACCEPTED');
      const ok = await post(`/integrations/connections/${id}/activate`, admin, {
        acceptTerms: true,
      });
      expect(ok.status).toBe(200);
      const dto = ok.body as {
        status: string;
        termsAcceptedAt: string | null;
        termsAcceptedById: string | null;
      };
      expect(dto.status).toBe('ACTIVE');
      expect(dto.termsAcceptedAt).not.toBeNull();
      expect(dto.termsAcceptedById).toBe(a.admin.id);
      // Religar depois de pausar não pede o aceite de novo.
      await post(`/integrations/connections/${id}/pause`, admin);
      expect((await post(`/integrations/connections/${id}/activate`, admin, {})).status).toBe(200);
    });

    it('oficial liga sem aceite; testar registra a execução sem contar falha', async () => {
      const { id } = await createConnection('fake-monitor', 'Oficial teste');
      expect((await post(`/integrations/connections/${id}/activate`, admin, {})).status).toBe(200);
      const ok = await post(`/integrations/connections/${id}/test`, admin);
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ ok: true, message: 'conectado' });
      await patch(`/integrations/connections/${id}`, admin, { credentials: { apiKey: 'bad' } });
      const bad = await post(`/integrations/connections/${id}/test`, admin);
      expect(bad.body).toMatchObject({ ok: false, message: 'chave recusada' });
      const conn = await get(`/integrations/connections/${id}`, admin);
      expect((conn.body as { consecutiveFailures: number }).consecutiveFailures).toBe(0);
      const runs = await get(`/integrations/runs?connectionId=${id}`, admin);
      const statuses = (runs.body as { trigger: string; status: string }[]).map(
        (r) => `${r.trigger}:${r.status}`,
      );
      expect(statuses).toEqual(expect.arrayContaining(['TEST:SUCCEEDED', 'TEST:FAILED']));
    });
  });

  describe('sincronização', () => {
    it('sucesso: marca a saúde verde e a última sincronização', async () => {
      syncBehavior = 'ok';
      const { id } = await createConnection('fake-unofficial', 'Sync ok');
      await post(`/integrations/connections/${id}/activate`, admin, { acceptTerms: true });
      const res = await post(`/integrations/connections/${id}/sync`, admin);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'SUCCEEDED', summary: { plants: 2 } });
      const dto = (await get(`/integrations/connections/${id}`, admin)).body as {
        health: string;
        lastSyncAt: string | null;
      };
      expect(dto.health).toBe('GREEN');
      expect(dto.lastSyncAt).not.toBeNull();
    });

    it('conexão que não está ativa é pulada, sem consultar o provedor', async () => {
      const { id } = await createConnection('fake-unofficial', 'Sync parada');
      const before = syncCalls;
      const res = await post(`/integrations/connections/${id}/sync`, admin);
      expect(res.body).toMatchObject({ status: 'SKIPPED' });
      expect(syncCalls).toBe(before);
    });

    it('falhas seguidas: amarelo, vermelho, pausa e fila de falhas; reprocessar resolve', async () => {
      const { id } = await createConnection('fake-unofficial', 'Sync falha');
      await post(`/integrations/connections/${id}/activate`, admin, { acceptTerms: true });
      syncBehavior = 'fail';
      const health: string[] = [];
      for (let i = 0; i < 5; i += 1) {
        const r = await post(`/integrations/connections/${id}/sync`, admin);
        expect(r.body).toMatchObject({ status: 'FAILED', error: 'provedor fora do ar' });
        health.push(
          ((await get(`/integrations/connections/${id}`, admin)).body as { health: string }).health,
        );
      }
      expect(health).toEqual(['YELLOW', 'YELLOW', 'RED', 'RED', 'RED']);
      const paused = (await get(`/integrations/connections/${id}`, admin)).body as {
        status: string;
        lastError: string;
      };
      expect(paused.status).toBe('PAUSED');
      expect(paused.lastError).toBe('provedor fora do ar');
      const letters = (await get('/integrations/dead-letters', admin)).body as {
        id: string;
        connectionId: string;
      }[];
      const letter = letters.find((l) => l.connectionId === id);
      expect(letter).toBeDefined();
      // Reprocessar com o provedor ainda fora do ar não resolve.
      const stillBad = await post(`/integrations/dead-letters/${letter!.id}/retry`, admin);
      expect((stillBad.body as { resolved: boolean }).resolved).toBe(false);
      syncBehavior = 'ok';
      const healed = await post(`/integrations/dead-letters/${letter!.id}/retry`, admin);
      expect((healed.body as { resolved: boolean }).resolved).toBe(true);
      const after = (await get('/integrations/dead-letters', admin)).body as { id: string }[];
      expect(after.some((l) => l.id === letter!.id)).toBe(false);
      const conn = (await get(`/integrations/connections/${id}`, admin)).body as {
        status: string;
        health: string;
      };
      expect(conn).toMatchObject({ status: 'ACTIVE', health: 'GREEN' });
    });

    it('descartar uma falha a tira da fila', async () => {
      const { id } = await createConnection('fake-unofficial', 'Descarte');
      await post(`/integrations/connections/${id}/activate`, admin, { acceptTerms: true });
      syncBehavior = 'fail';
      await withTenant(a.id, () => integrations.runSync(id, { final: true }));
      syncBehavior = 'ok';
      const letters = (await get('/integrations/dead-letters', admin)).body as {
        id: string;
        connectionId: string;
      }[];
      const letter = letters.find((l) => l.connectionId === id);
      expect(letter).toBeDefined();
      expect((await post(`/integrations/dead-letters/${letter!.id}/dismiss`, admin)).status).toBe(
        200,
      );
      expect((await post(`/integrations/dead-letters/${letter!.id}/dismiss`, admin)).status).toBe(
        404,
      );
    });

    it('tentativa intermediária da fila não conta falha; a última manda para a fila de falhas', async () => {
      const { id } = await createConnection('fake-unofficial', 'Retentativa');
      await post(`/integrations/connections/${id}/activate`, admin, { acceptTerms: true });
      syncBehavior = 'fail';
      const job = {
        name: 'sync',
        data: { tenantId: a.id, connectionId: id },
        opts: { attempts: 3 },
      };
      // Tentativas 1 e 2: a fila repete (o processamento lança) e nada é contado.
      await expect(queue.process({ ...job, attemptsMade: 0 })).rejects.toThrow(
        'provedor fora do ar',
      );
      await expect(queue.process({ ...job, attemptsMade: 1 })).rejects.toThrow(
        'provedor fora do ar',
      );
      let dto = (await get(`/integrations/connections/${id}`, admin)).body as {
        consecutiveFailures: number;
      };
      expect(dto.consecutiveFailures).toBe(0);
      expect(
        ((await get('/integrations/dead-letters', admin)).body as { connectionId: string }[]).some(
          (l) => l.connectionId === id,
        ),
      ).toBe(false);
      // Tentativa 3 (final): conta uma falha e vai para a fila de falhas, sem lançar.
      await expect(queue.process({ ...job, attemptsMade: 2 })).resolves.toMatchObject({
        status: 'FAILED',
      });
      dto = (await get(`/integrations/connections/${id}`, admin)).body as {
        consecutiveFailures: number;
      };
      expect(dto.consecutiveFailures).toBe(1);
      expect(
        ((await get('/integrations/dead-letters', admin)).body as { connectionId: string }[]).some(
          (l) => l.connectionId === id,
        ),
      ).toBe(true);
      syncBehavior = 'ok';
    });

    it('respeita o orçamento de chamadas do provedor', async () => {
      syncBehavior = 'ok';
      const { id } = await createConnection('fake-monitor', 'Orçamento');
      await post(`/integrations/connections/${id}/activate`, admin, {});
      const results: string[] = [];
      for (let i = 0; i < 6; i += 1)
        results.push(
          ((await post(`/integrations/connections/${id}/sync`, admin)).body as { status: string })
            .status,
        );
      // perDay = 4: quatro execuções reais e o restante pulado.
      expect(results.filter((s) => s === 'SUCCEEDED')).toHaveLength(4);
      expect(results.slice(4)).toEqual(['SKIPPED', 'SKIPPED']);
      const runs = (await get(`/integrations/runs?connectionId=${id}`, admin)).body as {
        status: string;
        error: string | null;
      }[];
      expect(runs.find((r) => r.status === 'SKIPPED')?.error).toMatch(/orçamento diário/);
    });

    it('a varredura só escolhe conexões ativas, de provedor ligado e com o intervalo vencido', async () => {
      syncBehavior = 'ok';
      const fresh = await createConnection('fake-monitor', 'Varredura nova');
      await post(`/integrations/connections/${fresh.id}/activate`, admin, {});
      const stale = await createConnection('fake-monitor', 'Varredura vencida');
      await post(`/integrations/connections/${stale.id}/activate`, admin, {});
      const idle = await createConnection('fake-monitor', 'Varredura parada');
      // nunca sincronizada e ativa → devida; recém-sincronizada → fora; parada → fora.
      await post(`/integrations/connections/${fresh.id}/sync`, admin);
      await t.prisma.system.integrationConnection.update({
        where: { id: stale.id },
        data: { lastSyncAt: new Date(Date.now() - 2 * 3_600_000) },
      });
      const due = (await queue.dueConnections()).map((d) => d.connectionId);
      expect(due).toContain(stale.id);
      expect(due).not.toContain(fresh.id);
      expect(due).not.toContain(idle.id);
    });
  });

  describe('SSRF', () => {
    it('o acesso HTTP recusa endereços internos', async () => {
      await expect(integrationHttp.request({ url: 'http://127.0.0.1:5432/x' })).rejects.toThrow(
        /interno/,
      );
      await expect(integrationHttp.request({ url: 'http://localhost/x' })).rejects.toThrow(
        /interno/,
      );
      await expect(integrationHttp.request({ url: 'ftp://exemplo.com/x' })).rejects.toThrow();
    });
  });

  describe('plano da empresa', () => {
    it('sem plano tudo é liberado; com plano, o limite de conexões de monitoramento vale', async () => {
      expect(await withTenant(b.id, () => planService.isFeatureEnabled('qualquer'))).toBe(true);
      await t.prisma.system.tenant.update({
        where: { id: b.id },
        data: {
          settings: {
            plan: {
              name: 'Mínimo',
              features: { monitoring: false },
              limits: { monitoringConnections: 1 },
            },
          },
        },
      });
      await createConnection('fake-monitor', 'Única B', adminB);
      const second = await post('/integrations/connections', adminB, {
        provider: 'fake-monitor',
        label: 'Segunda B',
        credentials: validCreds,
      });
      expect(second.status).toBe(403);
      expect((second.body as { code?: string }).code).toBe('PLAN_LIMIT_REACHED');
      // Conexão de outro tipo não conta no limite de monitoramento (a assinatura entra na 11I).
      expect(await withTenant(b.id, () => planService.isFeatureEnabled('monitoring'))).toBe(false);
      await expect(
        withTenant(b.id, () => planService.assertFeature('monitoring')),
      ).rejects.toMatchObject({
        status: 403,
      });
      expect(await withTenant(b.id, () => planService.isFeatureEnabled('outro'))).toBe(true);
    });

    it('a empresa não altera nem apaga o próprio plano pela API', async () => {
      const res = await patch('/tenant', adminB, {
        settings: { tema: 'escuro', plan: { name: 'Hacker', features: {}, limits: {} } },
      });
      expect(res.status).toBe(200);
      const row = await t.prisma.system.tenant.findUniqueOrThrow({ where: { id: b.id } });
      const settings = row.settings as { tema?: string; plan?: { name: string } };
      expect(settings.tema).toBe('escuro');
      expect(settings.plan?.name).toBe('Mínimo');
      // Mandar settings sem plano também não o apaga.
      await patch('/tenant', adminB, { settings: { tema: 'claro' } });
      const again = await t.prisma.system.tenant.findUniqueOrThrow({ where: { id: b.id } });
      expect((again.settings as { plan?: { name: string } }).plan?.name).toBe('Mínimo');
    });

    it('empresa sem plano não ganha uma chave plan ao editar as configurações', async () => {
      const res = await patch('/tenant', admin, { settings: { tema: 'escuro' } });
      expect(res.status).toBe(200);
      const row = await t.prisma.system.tenant.findUniqueOrThrow({ where: { id: a.id } });
      expect('plan' in (row.settings as object)).toBe(false);
    });
  });

  describe('comunicações', () => {
    const clientId = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';

    it('lista os modelos com as variáveis', async () => {
      const res = await get('/communications/templates', seller);
      expect(res.status).toBe(200);
      const portal = (res.body as { id: string; variables: string[] }[]).find(
        (x) => x.id === 'portal.access',
      );
      expect(portal?.variables).toEqual(['nome', 'link']);
    });

    it('SDR não envia comunicação; vendedor sim', async () => {
      expect(
        (await post('/communications/copied-link', sdr, { template: 'portal.access' })).status,
      ).toBe(403);
      expect(
        (await post('/communications/copied-link', seller, { template: 'portal.access' })).status,
      ).toBe(201);
    });

    it('envia e-mail pelo modelo e registra o histórico', async () => {
      const before = t.mail.sent.length;
      const res = await post('/communications/email', seller, {
        template: 'proposal.link',
        to: 'cliente@exemplo.com',
        variables: { nome: 'Ana', link: 'https://app/p/abc' },
        entityType: 'Proposal',
        entityId: clientId,
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        channel: 'EMAIL',
        recipient: 'cliente@exemplo.com',
        template: 'proposal.link',
      });
      expect(t.mail.sent).toHaveLength(before + 1);
      expect(t.mail.last().text).toContain('Olá, Ana!');
      expect(t.mail.last().text).toContain('https://app/p/abc');
      const list = await get(`/communications?entityType=Proposal&entityId=${clientId}`, seller);
      expect((list.body as unknown[]).length).toBeGreaterThanOrEqual(1);
    });

    it('recusa variável faltando e não registra nada', async () => {
      const before = (await get('/communications', seller)).body as unknown[];
      const res = await post('/communications/email', seller, {
        template: 'proposal.link',
        to: 'cliente@exemplo.com',
        variables: { nome: 'Ana' },
      });
      expect(res.status).toBe(422);
      expect((res.body as { code?: string }).code).toBe('MISSING_TEMPLATE_VARIABLES');
      expect(((await get('/communications', seller)).body as unknown[]).length).toBe(before.length);
    });

    it('se o SMTP falhar, o histórico não registra um envio que não houve', async () => {
      const before = ((await get('/communications', seller)).body as unknown[]).length;
      t.mail.fail = true;
      const res = await post('/communications/email', seller, {
        template: 'proposal.link',
        to: 'cliente@exemplo.com',
        variables: { nome: 'Ana', link: 'https://app/p/x' },
      });
      t.mail.fail = false;
      expect(res.status).toBeGreaterThanOrEqual(500);
      expect(((await get('/communications', seller)).body as unknown[]).length).toBe(before);
    });

    it('modelo desconhecido dá 404', async () => {
      expect(
        (
          await post('/communications/email', seller, {
            template: 'nao.existe',
            to: 'x@y.com',
            variables: {},
          })
        ).status,
      ).toBe(404);
    });

    it('gera o link wa.me com a mensagem pronta e registra, sem enviar nada', async () => {
      const before = t.mail.sent.length;
      const res = await post('/communications/whatsapp-link', seller, {
        template: 'installation.scheduled',
        phone: '(61) 99999-8888',
        variables: { nome: 'Ana', data: '10/11/2026', janela: 'manhã' },
      });
      expect(res.status).toBe(201);
      const body = res.body as {
        url: string;
        text: string;
        log: { channel: string; recipient: string };
      };
      expect(body.url.startsWith('https://wa.me/5561999998888?text=')).toBe(true);
      expect(decodeURIComponent(body.url.split('?text=')[1]!)).toBe(body.text);
      expect(body.text).toContain('10/11/2026');
      expect(body.log).toMatchObject({ channel: 'WHATSAPP_LINK', recipient: '5561999998888' });
      expect(t.mail.sent).toHaveLength(before);
    });

    it('recusa telefone inválido', async () => {
      const res = await post('/communications/whatsapp-link', seller, {
        template: 'installation.scheduled',
        phone: '1234',
        variables: { nome: 'Ana', data: 'x', janela: 'y' },
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it('o histórico de uma empresa não aparece na outra', async () => {
      const other = await tokenWithRole(t, b, Role.SALESPERSON);
      const list = await get('/communications?limit=200', other.token);
      expect(list.status).toBe(200);
      expect(
        (list.body as { recipient: string | null }[]).some(
          (l) => l.recipient === 'cliente@exemplo.com',
        ),
      ).toBe(false);
    });
  });
});
