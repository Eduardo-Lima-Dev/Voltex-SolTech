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

const say = (payload: unknown) => ({
  text: JSON.stringify(payload),
  toolCalls: [],
  model: 'x',
  neurons: 12,
  promptTokens: 1,
  completionTokens: 1,
  finishReason: 'stop' as const,
});

const DOC = [
  'Distribuidora Sol Ltda - Tabela de preços',
  'Módulo Fab Proc MOD-550  código 1234  R$ 612,50',
  'Estrutura de fixação por módulo  R$ 85,90',
  'Contato comercial: vendas@distribuidora.example.com  (85) 99999-1234',
].join('\n');

/** Procurement assistido (Fase 12H): a IA propõe, a pessoa confirma, e nada é gravado antes disso. */
describe('IA · procurement assistido (e2e)', () => {
  let t: TestApp;
  let fake: Fake;
  let a: SeededTenant;
  let b: SeededTenant;
  let owner: string;
  let ownerB: string;
  let installer: string;

  const upload = (token: string, content: string, type = 'text/csv', name = 'tabela.csv') =>
    t.http
      .post(`${API}/ai/procurement/extractions`)
      .set(bearer(token))
      .attach('file', Buffer.from(content), { filename: name, contentType: type });
  const post = (path: string, token: string, body: unknown = {}) =>
    t.http
      .post(`${API}${path}`)
      .set(bearer(token))
      .send(body as object);
  const get = (path: string, token: string) => t.http.get(`${API}${path}`).set(bearer(token));

  const goodRows = [
    {
      manufacturer: 'Fab Proc',
      model: 'MOD-550',
      supplier: 'Distribuidora Sol Ltda',
      priceReais: 612.5,
      validFrom: '01/10/2026',
      excerpt: 'Módulo Fab Proc MOD-550  código 1234  R$ 612,50',
    },
    {
      description: 'Estrutura de fixação por módulo',
      supplier: 'Distribuidora Sol Ltda',
      priceReais: 85.9,
      validFrom: '01/10/2026',
      excerpt: 'Estrutura de fixação por módulo  R$ 85,90',
    },
    {
      manufacturer: 'Fab Proc',
      model: 'INVENTADO',
      supplier: 'Distribuidora Sol Ltda',
      priceReais: 99,
      validFrom: '01/10/2026',
      excerpt: 'Inversor que não está no documento R$ 99,00',
    },
  ];

  beforeAll(async () => {
    t = await createTestApp({
      AI_ENABLED: 'true',
      AI_PROVIDER: 'fake',
      AI_DAILY_NEURONS_GLOBAL: '10000000',
    });
    const { FakeAiProvider } = await import('../src/platform/ai/providers/fake-ai.provider');
    fake = t.app.get(FakeAiProvider);
    a = await seedTenant(t.prisma, 'procure');
    b = await seedTenant(t.prisma, 'procureb');
    for (const tenant of [a, b])
      await t.prisma.system.tenant.update({
        where: { id: tenant.id },
        data: {
          settings: {
            demo: true,
            plan: {
              name: 'T',
              features: {},
              limits: { aiDailyNeurons: 1_000_000, aiDailyNeuronsPerUser: 1_000_000 },
            },
            ai: {
              enabled: true,
              termsAcceptedBy: tenant.owner.id,
              termsAcceptedAt: new Date().toISOString(),
            },
          } as never,
        },
      });
    owner = await tokenFor(t.http, a.owner);
    ownerB = await tokenFor(t.http, b.owner);
    installer = (await tokenWithRole(t, a, 'INSTALLER')).token;
    await t.prisma.system.equipmentItem.create({
      data: {
        tenantId: a.id,
        kind: 'MODULE',
        manufacturer: 'Fab Proc',
        model: 'MOD-550',
        spec: {},
        status: 'APPROVED',
        approvedById: a.owner.id,
        approvedAt: new Date(),
      },
    });
  });
  afterAll(() => t.close());
  beforeEach(() => fake.reset());

  it('a prévia traz só linhas que se confirmam no documento, com o casamento no catálogo, e não grava preço', async () => {
    fake.enqueue(say({ rows: goodRows }));
    const res = await upload(owner, DOC);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'PENDING_REVIEW',
      discardedCount: 1,
      truncated: false,
    });
    expect(res.body.rows).toHaveLength(2);
    const [mod, struct] = res.body.rows;
    expect(mod).toMatchObject({
      priceReais: 612.5,
      problems: [],
      match: { label: 'Fab Proc MOD-550' },
    });
    expect(struct).toMatchObject({ match: null, problems: [] });
    // Contato do documento foi removido antes de ir à IA.
    expect(res.body.removed).toMatchObject({ EMAIL: 1 });
    const sent = JSON.stringify(fake.calls[0]!.messages);
    expect(sent).not.toContain('vendas@distribuidora');
    expect(sent).not.toContain('99999-1234');
    // Nada na lista de preços ainda.
    expect((await get('/catalog/prices', owner)).body).toEqual([]);
  });

  it('só importa depois da confirmação, pela rotina de preços, com a fonte "extraído por IA"', async () => {
    fake.enqueue(say({ rows: goodRows }));
    const prev = (await upload(owner, DOC)).body;
    const done = await post(`/ai/procurement/extractions/${prev.id}/import`, owner, {
      rows: prev.rows.map((r: { index: number }) => ({
        index: r.index,
        manufacturer: (prev.rows[r.index] as Record<string, string>).manufacturer,
        model: (prev.rows[r.index] as Record<string, string>).model,
        description: (prev.rows[r.index] as Record<string, string>).description,
        supplier: (prev.rows[r.index] as Record<string, string>).supplier,
        sku: '',
        priceReais: (prev.rows[r.index] as Record<string, number>).priceReais,
        validFrom: '01/10/2026',
        validTo: '',
      })),
    });
    expect(done.status).toBe(200);
    expect(done.body.result).toMatchObject({ created: 2, dryRun: false });
    expect(done.body.extraction.status).toBe('IMPORTED');
    const prices = (await get('/catalog/prices', owner)).body as Array<{
      priceCents: number;
      source: string;
    }>;
    expect(prices.map((p) => p.priceCents).sort((x, y) => x - y)).toEqual([8590, 61250]);
    expect(prices[0]!.source).toMatch(/^extraído por IA, conferido por .+: tabela\.csv$/);
    // Não importa duas vezes.
    const again = await post(`/ai/procurement/extractions/${prev.id}/import`, owner, {
      rows: [
        {
          index: 0,
          manufacturer: '',
          model: '',
          description: 'x',
          supplier: 's',
          sku: '',
          priceReais: 1,
          validFrom: '01/10/2026',
          validTo: '',
        },
      ],
    });
    expect(again.status).toBe(422);
  });

  it('linha com problema (sem fornecedor ou equipamento desconhecido) trava a importação', async () => {
    fake.enqueue(say({ rows: [{ ...goodRows[1], supplier: '' }] }));
    const prev = (await upload(owner, DOC)).body;
    expect(prev.rows[0].problems).toEqual(['Informe o fornecedor.']);
    const res = await post(`/ai/procurement/extractions/${prev.id}/import`, owner, {
      rows: [
        {
          index: 0,
          manufacturer: 'Fab',
          model: 'Desconhecido',
          description: '',
          supplier: 'S',
          sku: '',
          priceReais: 85.9,
          validFrom: '01/10/2026',
          validTo: '',
        },
      ],
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('PRICE_EXTRACTION_INVALID_ROWS');
    const bad = await post(`/ai/procurement/extractions/${prev.id}/import`, owner, {
      rows: [
        {
          index: 9,
          manufacturer: '',
          model: '',
          description: 'x',
          supplier: 'S',
          sku: '',
          priceReais: 1,
          validFrom: '01/10/2026',
          validTo: '',
        },
      ],
    });
    expect(bad.status).toBe(400);
  });

  it('descartar encerra a extração; permissão, tipo de arquivo, IA fora do ar e isolamento entre empresas', async () => {
    fake.enqueue(say({ rows: [goodRows[1]] }));
    const prev = (await upload(owner, DOC)).body;
    expect((await get(`/ai/procurement/extractions/${prev.id}`, ownerB)).status).toBe(404);
    expect((await get(`/ai/procurement/extractions/${prev.id}`, installer)).status).toBe(403);
    expect((await post(`/ai/procurement/extractions/${prev.id}/discard`, owner)).body.status).toBe(
      'DISCARDED',
    );
    expect((await post(`/ai/procurement/extractions/${prev.id}/discard`, owner)).status).toBe(422);
    expect((await upload(installer, DOC)).status).toBe(403);
    expect((await upload(owner, 'x', 'image/png', 'a.png')).status).toBe(415);
    expect((await upload(owner, 'curto')).status).toBe(400);
    // Provedor fora do ar: mensagem pronta, sem travar.
    const { AiProviderError } = await import('../src/platform/ai/ai-provider');
    fake.enqueue(new AiProviderError('PROVIDER_DOWN', 'simulado', false));
    const down = await upload(owner, DOC);
    expect(down.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(down.body)).toMatch(/indispon|IA/i);
  });
});
