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
import { buildOpportunity, type Flow } from './crm-flow';
import { ensureMarginPolicy, signedDeal } from './crm-delivery-flow';
import { tokenWithRole } from './crm-support';

type Fake = import('../src/platform/ai/providers/fake-ai.provider').FakeAiProvider;
type Request = import('../src/platform/ai/ai-provider').AiChatRequest;

/** Responde como um modelo bom: escreve uma frase só com a primeira referência dos dados recebidos. */
const writeWithFirstRef = (request: Request) => {
  const user = request.messages.find((m) => m.role === 'user')!.content;
  const ref = /\{\{F\d+\}\}/.exec(user)?.[0] ?? '{{F1}}';
  return {
    text: JSON.stringify({ kind: 'ANSWER', text: `Atenção: o principal número é ${ref}.` }),
    toolCalls: [],
    model: 'x',
    neurons: 4,
    promptTokens: 1,
    completionTokens: 1,
    finishReason: 'stop' as const,
  };
};

/** Insights proativos (Fase 12G): detecção determinística, redação opcional pela IA, visibilidade e situação. */
describe('IA · insights (e2e)', () => {
  let t: TestApp;
  let fake: Fake;
  let a: SeededTenant;
  let b: SeededTenant;
  let owner: string;
  let ownerB: string;
  let finance: string;
  let sellerOne: { token: string };
  let sellerTwo: { token: string };
  let installer: string;
  let receivableId: string;
  let projectId: string;

  const get = (path: string, token: string) => t.http.get(`${API}${path}`).set(bearer(token));
  const post = (path: string, token: string, body: unknown = {}) =>
    t.http
      .post(`${API}${path}`)
      .set(bearer(token))
      .send(body as object);
  const patch = (path: string, token: string, body: unknown) =>
    t.http
      .patch(`${API}${path}`)
      .set(bearer(token))
      .send(body as object);

  beforeAll(async () => {
    t = await createTestApp({
      AI_ENABLED: 'true',
      AI_PROVIDER: 'fake',
      AI_DAILY_NEURONS_GLOBAL: '10000000',
    });
    const { FakeAiProvider } = await import('../src/platform/ai/providers/fake-ai.provider');
    fake = t.app.get(FakeAiProvider);
    a = await seedTenant(t.prisma, 'insights');
    b = await seedTenant(t.prisma, 'insightsb');
    const settings = (tenant: SeededTenant) => ({
      demo: true,
      plan: {
        name: 'Teste',
        features: {},
        limits: { aiDailyNeurons: 1_000_000, aiInsightsDailyNeurons: 1_000_000 },
      },
      ai: {
        enabled: true,
        termsAcceptedBy: tenant.owner.id,
        termsAcceptedAt: new Date().toISOString(),
      },
    });
    for (const tenant of [a, b])
      await t.prisma.system.tenant.update({
        where: { id: tenant.id },
        data: { settings: settings(tenant) as never },
      });
    owner = await tokenFor(t.http, a.owner);
    ownerB = await tokenFor(t.http, b.owner);
    const manager = await tokenFor(t.http, a.manager);
    finance = (await tokenWithRole(t, a, 'FINANCE')).token;
    sellerOne = await tokenWithRole(t, a, 'SALESPERSON');
    sellerTwo = await tokenWithRole(t, a, 'SALESPERSON');
    installer = (await tokenWithRole(t, a, 'INSTALLER')).token;
    const flow: Flow = { t, tenant: a, seller: sellerOne.token, admin: owner };
    await ensureMarginPolicy(flow, manager);
    const deal = await signedDeal(flow, manager, { name: 'Cliente de insights' });
    projectId = deal.projectId;
    const parcel = await post(`/projects/${projectId}/finance/receivables`, finance, {
      referenceId: 'NF-I',
      order: 1,
      amountCents: 700_000,
      dueOn: '2020-03-01',
    });
    receivableId = parcel.body.id;
    // Uma oportunidade aberta e sem tarefa na carteira do vendedor 1.
    await buildOpportunity(flow, { name: 'Cliente parado' });
  });
  afterAll(() => t.close());
  beforeEach(() => fake.reset());

  it('a rotina detecta sem a IA: o insight nasce com o texto padrão e valores do sistema', async () => {
    fake.enqueue({
      text: 'resposta que não é JSON',
      toolCalls: [],
      model: 'x',
      neurons: 1,
      promptTokens: 1,
      completionTokens: 1,
      finishReason: 'stop',
    });
    const run = await post('/ai/insights/run', owner);
    expect(run.status).toBe(200);
    expect(run.body.created).toBeGreaterThanOrEqual(2);
    const list = (await get('/ai/insights', owner)).body as Array<
      Record<string, unknown> & {
        kind: string;
        aiWritten: boolean;
        text: string;
        facts: { text: string }[];
      }
    >;
    const overdue = list.find((i) => i.kind === 'OVERDUE_RECEIVABLES')!;
    expect(overdue).toMatchObject({
      aiWritten: false,
      status: 'NEW',
      link: '/operations/financeiro',
    });
    expect(overdue.text).toMatch(/1 parcela vencida há 7 dias ou mais, somando R\$\s?7\.000,00/);
    expect(overdue.facts.map((f: { text: string }) => f.text)).toContain('1');
  });

  it('com a IA, a frase é redigida só com referências e validada; sem referência válida, fica o padrão', async () => {
    fake.enqueue(writeWithFirstRef, writeWithFirstRef, writeWithFirstRef);
    // Força nova redação: a rotina só redige o que ainda não tem texto da IA.
    await t.prisma.system.insight.updateMany({ where: { tenantId: a.id }, data: { aiText: null } });
    const run = await post('/ai/insights/run', owner);
    expect(run.body.written).toBeGreaterThanOrEqual(1);
    const list = (await get('/ai/insights', owner)).body as Array<
      Record<string, unknown> & {
        kind: string;
        aiWritten: boolean;
        text: string;
        facts: { text: string }[];
      }
    >;
    const written = list.find((i) => i.aiWritten)!;
    expect(written.text).toMatch(/^Atenção: o principal número é \S+\.$/);
    expect(written.text).not.toContain('{{');
    // Os dados que o modelo recebeu estavam mascarados e sem número cru.
    const sent = JSON.stringify(fake.calls[0]!.messages);
    expect(sent).toMatch(/\{\{F\d+\}\}/);
    expect(sent).not.toContain('700000');
  });

  it('cada pessoa vê só o que a permissão e a carteira permitem', async () => {
    const kinds = async (token: string) =>
      ((await get('/ai/insights', token)).body as Array<{ kind: string }>).map((i) => i.kind);
    expect(await kinds(owner)).toEqual(
      expect.arrayContaining(['OVERDUE_RECEIVABLES', 'STALLED_OPPORTUNITIES']),
    );
    // Financeiro vê o financeiro (tem a permissão).
    expect(await kinds(finance)).toContain('OVERDUE_RECEIVABLES');
    // Vendedor 1 vê só o que é dele; vendedor 2, nada.
    expect(await kinds(sellerOne.token)).toEqual(['STALLED_OPPORTUNITIES']);
    expect(await kinds(sellerTwo.token)).toEqual([]);
    // Instalador não tem a permissão de insights.
    expect((await get('/ai/insights', installer)).status).toBe(403);
    // Outra empresa não vê nada desta.
    expect(await kinds(ownerB)).toEqual([]);
  });

  it('dispensar tira da lista e a rotina não recria por 30 dias; vendedor alheio recebe 404', async () => {
    const list = (await get('/ai/insights', owner)).body as Array<{ id: string; kind: string }>;
    const stalled = list.find((i) => i.kind === 'STALLED_OPPORTUNITIES')!;
    expect(
      (await patch(`/ai/insights/${stalled.id}`, sellerTwo.token, { status: 'SEEN' })).status,
    ).toBe(404);
    const done = await patch(`/ai/insights/${stalled.id}`, sellerOne.token, {
      status: 'DISMISSED',
      helpful: false,
    });
    expect(done.status).toBe(200);
    await post('/ai/insights/run', owner);
    const kinds = ((await get('/ai/insights', owner)).body as Array<{ kind: string }>).map(
      (i) => i.kind,
    );
    expect(kinds).not.toContain('STALLED_OPPORTUNITIES');
    const row = await t.prisma.system.insight.findUniqueOrThrow({ where: { id: stalled.id } });
    expect(row).toMatchObject({
      status: 'DISMISSED',
      helpful: false,
      statusById: expect.any(String),
    });
  });

  it('quando o problema acaba, o insight se resolve sozinho', async () => {
    expect(
      (
        await post(`/projects/${projectId}/finance/receivables/${receivableId}/pay`, finance, {
          paymentMethod: 'PIX',
        })
      ).status,
    ).toBe(200);
    const run = await post('/ai/insights/run', owner);
    expect(run.body.resolved).toBeGreaterThanOrEqual(1);
    const kinds = ((await get('/ai/insights', owner)).body as Array<{ kind: string }>).map(
      (i) => i.kind,
    );
    expect(kinds).not.toContain('OVERDUE_RECEIVABLES');
    const row = await t.prisma.system.insight.findFirstOrThrow({
      where: { tenantId: a.id, kind: 'OVERDUE_RECEIVABLES' },
    });
    expect(row).toMatchObject({ status: 'RESOLVED', statusById: null });
  });

  it('só a administração roda a rotina; o corpo de situação é validado', async () => {
    expect((await post('/ai/insights/run', finance)).status).toBe(403);
    const some = (await t.prisma.system.insight.findFirstOrThrow({ where: { tenantId: a.id } })).id;
    expect((await patch(`/ai/insights/${some}`, owner, { status: 'NEW' })).status).toBe(422);
  });
});
