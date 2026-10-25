import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  API,
  bearer,
  createTestApp,
  seedTenant,
  tokenFor,
  type SeededTenant,
  type TestApp,
} from './helpers';
import { tokenWithRole } from './crm-support';

type Fake = import('../src/platform/ai/providers/fake-ai.provider').FakeAiProvider;
type Gateway = import('../src/platform/ai/ai-gateway.service').AiGatewayService;

/**
 * IA, fundações (Fase 12A, ADR-0029): portão de acesso, cotas de custo zero, falhas com mensagem pronta, modelo
 * reserva e disjuntor. Roda com o provedor simulado: nenhuma chamada à internet, nenhum custo.
 */
describe('IA · fundações (e2e)', () => {
  let t: TestApp;
  let fake: Fake;
  let gateway: Gateway;
  let a: SeededTenant;
  let b: SeededTenant;
  let owner: string;
  let ownerB: string;
  let seller: string;
  let installer: string;

  const get = (path: string, token: string) => t.http.get(`${API}${path}`).set(bearer(token));
  const post = (path: string, token: string, body: unknown = {}) =>
    t.http
      .post(`${API}${path}`)
      .set(bearer(token))
      .send(body as object);
  const put = (path: string, token: string, body: unknown) =>
    t.http
      .put(`${API}${path}`)
      .set(bearer(token))
      .send(body as object);
  const setSettings = async (tenant: SeededTenant, patch: Record<string, unknown>) => {
    const row = await t.prisma.system.tenant.findUniqueOrThrow({ where: { id: tenant.id } });
    await t.prisma.system.tenant.update({
      where: { id: tenant.id },
      data: { settings: { ...((row.settings as object) ?? {}), ...patch } as never },
    });
  };
  const diag = async (token: string) => {
    const started = Date.now();
    const res = await post('/ai/admin/diagnostics', token);
    expect(Date.now() - started, 'responde sem deixar esperando').toBeLessThan(5_000);
    return res;
  };

  beforeAll(async () => {
    t = await createTestApp({
      AI_ENABLED: 'true',
      AI_PROVIDER: 'fake',
      AI_MODEL_DEFAULT: 'modelo-padrao',
      AI_MODEL_FALLBACK: 'modelo-reserva',
      AI_CALL_TIMEOUT_MS: '1000',
      AI_TOTAL_TIMEOUT_MS: '8000',
    });
    const { FakeAiProvider } = await import('../src/platform/ai/providers/fake-ai.provider');
    const { AiGatewayService } = await import('../src/platform/ai/ai-gateway.service');
    fake = t.app.get(FakeAiProvider);
    gateway = t.app.get(AiGatewayService);
    a = await seedTenant(t.prisma, 'ia');
    b = await seedTenant(t.prisma, 'iab');
    owner = await tokenFor(t.http, a.owner);
    ownerB = await tokenFor(t.http, b.owner);
    seller = await tokenFor(t.http, a.salesperson);
    installer = (await tokenWithRole(t, a, 'INSTALLER')).token;
  });
  afterAll(() => t.close());
  beforeEach(() => {
    fake.reset();
    gateway.resetBreaker();
  });

  describe('portão de acesso', () => {
    it('antes do parecer jurídico, empresa que não é de demonstração não usa a IA', async () => {
      const status = (await get('/ai/status', owner)).body;
      expect(status).toMatchObject({ available: false, code: 'LEGAL_REVIEW_PENDING' });
      expect(status.message).toMatch(/revisão jurídica/);
      expect((await diag(owner)).body).toMatchObject({ ok: false, code: 'LEGAL_REVIEW_PENDING' });
      expect(fake.calls).toHaveLength(0);
    });

    it('empresa de demonstração, mas ainda desligada: pede para um administrador ligar', async () => {
      await setSettings(a, { demo: true });
      const status = (await get('/ai/status', owner)).body;
      expect(status).toMatchObject({ available: false, code: 'TENANT_DISABLED' });
      expect(status.message).toMatch(/Administração → Inteligência/);
      expect(fake.calls).toHaveLength(0);
    });

    it('ligar exige o aceite dos termos; o aceite fica registrado e auditado', async () => {
      expect((await put('/ai/admin/settings', owner, { enabled: true })).status).toBe(422);
      const res = await put('/ai/admin/settings', owner, { enabled: true, acceptTerms: true });
      expect(res.status).toBe(200);
      expect(res.body.settings).toMatchObject({ enabled: true, termsAcceptedBy: a.owner.id });
      expect(res.body.settings.termsAcceptedAt).toBeTruthy();
      expect(res.body.demo).toBe(true);
      const audit = await t.prisma.system.auditLog.findMany({
        where: { tenantId: a.id, action: 'ai.settings_updated' },
      });
      expect(audit).toHaveLength(1);
      const status = (await get('/ai/status', owner)).body;
      expect(status).toMatchObject({
        available: true,
        code: null,
        message: null,
        provider: 'fake',
      });
      expect(status.quota.tenant.limit).toBe(1_500);
      expect(status.quota.user.limit).toBe(300);
    });

    it('o plano que exclui a IA responde com a mensagem do plano', async () => {
      await setSettings(a, { plan: { name: 'Sem IA', features: { ai: false }, limits: {} } });
      expect((await get('/ai/status', owner)).body).toMatchObject({
        available: false,
        code: 'PLAN_EXCLUDES_AI',
      });
      await setSettings(a, { plan: undefined });
      expect((await get('/ai/status', owner)).body.available).toBe(true);
    });

    it('permissões: instalador não usa o assistente; vendedor vê o estado mas não administra', async () => {
      expect((await get('/ai/status', installer)).status).toBe(403);
      expect((await get('/ai/status', seller)).status).toBe(200);
      for (const path of ['/ai/admin/settings', '/ai/admin/usage'])
        expect((await get(path, seller)).status, path).toBe(403);
      expect((await post('/ai/admin/diagnostics', seller)).status).toBe(403);
      expect((await put('/ai/admin/settings', seller, { enabled: false })).status).toBe(403);
    });

    it('a edição geral da empresa não apaga a configuração de IA nem a marca de demonstração', async () => {
      const before = (await get('/ai/admin/settings', owner)).body;
      const res = await t.http
        .patch(`${API}/tenant`)
        .set(bearer(owner))
        .send({ settings: { alguma: 'coisa' } });
      expect(res.status).toBeLessThan(300);
      const after = (await get('/ai/admin/settings', owner)).body;
      expect(after.settings).toEqual(before.settings);
      expect(after.demo).toBe(true);
    });

    it('isolamento: a outra empresa continua desligada', async () => {
      expect((await get('/ai/status', ownerB)).body.available).toBe(false);
      expect((await get('/ai/admin/usage', ownerB)).body.days).toEqual([]);
    });
  });

  describe('chamadas, uso e cotas', () => {
    it('diagnóstico responde, registra o custo e aparece no uso dos últimos dias', async () => {
      fake.enqueue({
        text: 'ok',
        toolCalls: [],
        model: 'x',
        neurons: 8.5,
        promptTokens: 4,
        completionTokens: 1,
        finishReason: 'stop',
      });
      const res = (await diag(owner)).body;
      expect(res).toMatchObject({ ok: true, text: 'ok', model: 'modelo-padrao', neurons: 8.5 });
      expect(fake.calls[0]!.model).toBe('modelo-padrao');
      const usage = (await get('/ai/admin/usage', owner)).body;
      expect(usage.totals.neurons).toBeGreaterThanOrEqual(8.5);
      expect(usage.days[0]).toMatchObject({ purpose: 'DIAGNOSTICS' });
      expect(JSON.stringify(usage)).not.toContain('Responda apenas');
    });

    it('cota da empresa: ao estourar, para antes de chamar o provedor e diz quando volta', async () => {
      const q = await seedTenant(t.prisma, 'iaquota');
      await setSettings(q, {
        demo: true,
        ai: {
          enabled: true,
          termsAcceptedBy: q.owner.id,
          termsAcceptedAt: new Date().toISOString(),
        },
        plan: {
          name: 'Teste',
          features: {},
          limits: { aiDailyNeurons: 20, aiDailyNeuronsPerUser: 300 },
        },
      });
      const token = await tokenFor(t.http, q.owner);
      expect((await post('/ai/admin/diagnostics', token)).body.ok).toBe(true);
      const calls = fake.calls.length;
      const blocked = (await post('/ai/admin/diagnostics', token)).body;
      expect(blocked).toMatchObject({ ok: false, code: 'QUOTA_TENANT' });
      expect(blocked.message).toMatch(/21h \(horário de Brasília\)/);
      expect(fake.calls.length, 'não chamou o provedor').toBe(calls);
      const status = (await get('/ai/status', token)).body;
      expect(status.quota.tenant.remaining).toBeLessThan(15);
    });

    it('cota do usuário: um usuário esgotar a dele não esgota a da empresa', async () => {
      const q = await seedTenant(t.prisma, 'iauser');
      await setSettings(q, {
        demo: true,
        ai: {
          enabled: true,
          termsAcceptedBy: q.owner.id,
          termsAcceptedAt: new Date().toISOString(),
        },
        plan: {
          name: 'Teste',
          features: {},
          limits: { aiDailyNeurons: 1000, aiDailyNeuronsPerUser: 20 },
        },
      });
      const ownerQ = await tokenFor(t.http, q.owner);
      const adminQ = await tokenFor(t.http, q.admin);
      expect((await post('/ai/admin/diagnostics', ownerQ)).body.ok).toBe(true);
      expect((await post('/ai/admin/diagnostics', ownerQ)).body).toMatchObject({
        ok: false,
        code: 'QUOTA_USER',
      });
      expect((await post('/ai/admin/diagnostics', adminQ)).body.ok).toBe(true);
    });

    it('chamada à rota HTTP bloqueada devolve o código e a mensagem pelo erro padrão', async () => {
      const { AiUnavailableError } = await import('../src/platform/ai/ai-errors');
      const err = new AiUnavailableError('QUOTA_GLOBAL');
      expect(err.getStatus()).toBe(429);
      expect(err.getResponse()).toMatchObject({ code: 'AI_QUOTA_GLOBAL' });
    });
  });

  describe('falhas do provedor', () => {
    const down = async () => {
      const { AiProviderError } = await import('../src/platform/ai/ai-provider');
      return new AiProviderError('PROVIDER_DOWN', 'simulado', true);
    };

    it('falhou no padrão: tenta o modelo reserva uma vez e responde', async () => {
      fake.enqueue(await down());
      const res = (await diag(owner)).body;
      expect(res).toMatchObject({ ok: true, model: 'modelo-reserva' });
      expect(fake.calls.map((c) => c.model)).toEqual(['modelo-padrao', 'modelo-reserva']);
    });

    it('resposta vazia também vai para o reserva', async () => {
      const { AiProviderError } = await import('../src/platform/ai/ai-provider');
      fake.enqueue(new AiProviderError('EMPTY_RESPONSE', 'vazio', true));
      expect((await diag(owner)).body).toMatchObject({ ok: true, model: 'modelo-reserva' });
    });

    it('os dois falham: mensagem de indisponível, na hora', async () => {
      fake.enqueue(await down(), await down());
      const res = (await diag(owner)).body;
      expect(res).toMatchObject({ ok: false, code: 'PROVIDER_DOWN' });
      expect(res.message).toMatch(/indisponível no momento/);
      expect(res.message).toMatch(/dados do sistema continuam acessíveis/);
    });

    it('limite do provedor: não insiste nem tenta o reserva', async () => {
      const { AiProviderError } = await import('../src/platform/ai/ai-provider');
      fake.enqueue(new AiProviderError('PROVIDER_QUOTA', '429', false));
      const res = (await diag(owner)).body;
      expect(res).toMatchObject({ ok: false, code: 'PROVIDER_QUOTA' });
      expect(res.message).toMatch(/Tente de novo amanhã/);
      expect(fake.calls).toHaveLength(1);
    });

    it('credencial recusada: avisa a administração e não insiste', async () => {
      const { AiProviderError } = await import('../src/platform/ai/ai-provider');
      fake.enqueue(new AiProviderError('PROVIDER_AUTH', '401', false));
      const res = (await diag(owner)).body;
      expect(res).toMatchObject({ ok: false, code: 'PROVIDER_AUTH' });
      expect(fake.calls).toHaveLength(1);
    });

    it('provedor lento: o prazo corta e o usuário recebe a mensagem de demora', async () => {
      fake.delayMs = 1_500; // maior que o prazo de 1 s por chamada
      const started = Date.now();
      const res = (await diag(owner)).body;
      expect(res).toMatchObject({ ok: false, code: 'TIMEOUT' });
      expect(res.message).toMatch(/demorou demais/);
      expect(Date.now() - started).toBeLessThan(4_500);
    });

    it('falhas seguidas abrem o disjuntor: as próximas respondem na hora, sem chamar o provedor', async () => {
      fake.enqueue(await down(), await down(), await down(), await down());
      await diag(owner); // 2 falhas (padrão + reserva)
      await diag(owner); // mais 1 falha abre o disjuntor
      const calls = fake.calls.length;
      const started = Date.now();
      const res = (await post('/ai/admin/diagnostics', owner)).body;
      expect(res).toMatchObject({ ok: false, code: 'CIRCUIT_OPEN' });
      expect(Date.now() - started).toBeLessThan(1_000);
      expect(fake.calls.length).toBe(calls);
    });

    it('falhas também entram na contagem de uso', async () => {
      fake.enqueue(await down(), await down());
      await diag(owner);
      const usage = (await get('/ai/admin/usage', owner)).body;
      expect(usage.totals.failures).toBeGreaterThanOrEqual(2);
    });
  });

  describe('privacidade na saída (última barreira)', () => {
    const run = async <T>(fn: () => Promise<T>) => {
      const { RequestContext } = await import('../src/common/context/request-context');
      return t.app
        .get(RequestContext)
        .run({ tenantId: a.id, userId: a.owner.id, role: 'OWNER' }, fn);
    };

    it('qualquer tipo de dado pessoal bloqueia o envio: o provedor nem é chamado e o incidente é auditado sem o dado', async () => {
      const { AiUnavailableError } = await import('../src/platform/ai/ai-errors');
      const { PERSONAL_DATA_SAMPLES } = await import('./ai-pii-fixtures');
      for (const [type, sample] of Object.entries(PERSONAL_DATA_SAMPLES)) {
        await expect(
          run(() =>
            gateway.chat({
              purpose: 'CHAT',
              messages: [{ role: 'user', content: `Resuma o caso: ${sample}` }],
            }),
          ),
          type,
        ).rejects.toMatchObject({ aiCode: 'PRIVACY_BLOCKED' });
      }
      expect(fake.calls, 'nada foi enviado ao provedor').toHaveLength(0);
      const audit = await t.prisma.system.auditLog.findMany({
        where: { tenantId: a.id, action: 'ai.privacy_blocked' },
      });
      expect(audit).toHaveLength(Object.keys(PERSONAL_DATA_SAMPLES).length);
      const stored = JSON.stringify(audit.map((x) => x.after));
      for (const sample of Object.values(PERSONAL_DATA_SAMPLES))
        expect(stored).not.toContain(sample);
      const err = new AiUnavailableError('PRIVACY_BLOCKED');
      expect(err.getStatus()).toBe(422);
    });

    it('texto mascarado passa e chega ao provedor sem o dado', async () => {
      const { AiPrivacySession } = await import('../src/platform/ai/privacy/session');
      const session = new AiPrivacySession();
      session.pseudonyms.alias('CLIENTE', 'a1', 'Helena Duarte Campos');
      const masked = session.maskUserText(
        'Quanto Helena Duarte Campos deve? CPF 529.982.247-25 e-mail h@example.com',
      );
      fake.enqueue({
        text: 'ok',
        toolCalls: [],
        model: 'x',
        neurons: 1,
        promptTokens: 1,
        completionTokens: 1,
        finishReason: 'stop',
      });
      await run(() =>
        gateway.chat({ purpose: 'CHAT', messages: [{ role: 'user', content: masked.text }] }),
      );
      expect(fake.calls).toHaveLength(1);
      const sent = JSON.stringify(fake.calls[0]!.messages);
      expect(sent).toContain('[CLIENTE_1]');
      expect(sent).not.toMatch(/Helena|529\.982|h@example/);
    });

    it('o diagnóstico (texto fixo, sem dado) continua passando pela barreira', async () => {
      expect((await post('/ai/admin/diagnostics', owner)).body.ok).toBe(true);
    });
  });
});

describe('IA · ambiente sem IA e teto da plataforma (e2e)', () => {
  it('com AI_ENABLED=false toda empresa recebe a mensagem de ambiente sem IA, na hora', async () => {
    const t = await createTestApp({ AI_ENABLED: 'false', AI_PROVIDER: 'fake' });
    try {
      const a = await seedTenant(t.prisma, 'iaoff');
      const owner = await tokenFor(t.http, a.owner);
      const started = Date.now();
      const res = await t.http.get(`${API}/ai/status`).set(bearer(owner));
      expect(Date.now() - started).toBeLessThan(1_000);
      expect(res.body).toMatchObject({ available: false, code: 'ENV_DISABLED', provider: null });
      expect(res.body.message).toBe('O assistente de IA não está disponível neste ambiente.');
    } finally {
      await t.close();
    }
  });

  it('provedor "none" ou sem credencial também é ambiente sem IA', async () => {
    const t = await createTestApp({
      AI_ENABLED: 'true',
      AI_PROVIDER: 'cloudflare',
      // O .env local pode ter a credencial real: o teste exige o caso SEM credencial e nunca chama a internet.
      CLOUDFLARE_ACCOUNT_ID: '',
      CLOUDFLARE_API_TOKEN: '',
    });
    try {
      const a = await seedTenant(t.prisma, 'iacred');
      const owner = await tokenFor(t.http, a.owner);
      const res = await t.http.get(`${API}/ai/status`).set(bearer(owner));
      expect(res.body.code).toBe('ENV_DISABLED');
    } finally {
      await t.close();
    }
  });

  it('teto global esgotado: a plataforma para antes de gastar a cota grátis', async () => {
    const t = await createTestApp({
      AI_ENABLED: 'true',
      AI_PROVIDER: 'fake',
      AI_DAILY_NEURONS_GLOBAL: '10',
    });
    try {
      const a = await seedTenant(t.prisma, 'iaglobal');
      await t.prisma.system.tenant.update({
        where: { id: a.id },
        data: {
          settings: {
            demo: true,
            ai: {
              enabled: true,
              termsAcceptedBy: a.owner.id,
              termsAcceptedAt: new Date().toISOString(),
            },
          },
        },
      });
      const owner = await tokenFor(t.http, a.owner);
      const res = await t.http.post(`${API}/ai/admin/diagnostics`).set(bearer(owner));
      expect(res.body).toMatchObject({ ok: false, code: 'QUOTA_GLOBAL' });
    } finally {
      await t.close();
    }
  });

  it('o provedor simulado é recusado em produção', async () => {
    const { createAiProvider } = await import('../src/platform/ai/ai.module');
    const { FakeAiProvider } = await import('../src/platform/ai/providers/fake-ai.provider');
    const config = {
      get: (key: string) => ({ AI_PROVIDER: 'fake', NODE_ENV: 'production' })[key],
    };
    expect(() => createAiProvider(config as never, {} as never, new FakeAiProvider())).toThrow(
      /produção/,
    );
  });
});
