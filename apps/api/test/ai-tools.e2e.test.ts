import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ROLE_PERMISSIONS, type Role } from '@voltex/shared';
import {
  API,
  bearer,
  createTestApp,
  seedTenant,
  tokenFor,
  type SeededTenant,
  type SeededUser,
  type TestApp,
} from './helpers';
import { buildOpportunity, type Flow } from './crm-flow';
import { ensureMarginPolicy, signedDeal, type SignedDeal } from './crm-delivery-flow';
import { tokenWithRole } from './crm-support';
import { PERSONAL_DATA_SAMPLES, PERSONAL_NAMES } from './ai-pii-fixtures';

type Registry = import('../src/platform/ai/tools/tool-registry.service').AiToolRegistry;
type Session = import('../src/platform/ai/privacy/session').AiPrivacySession;
type RequestUser = import('../src/common/context/request-user').RequestUser;

/** Parâmetros mínimos válidos de cada ferramenta que exige algum. */
const SAMPLE_PARAMS: Record<string, Record<string, unknown>> = {};

/**
 * Catálogo de ferramentas do assistente (Fase 12D, ADR-0030): permissão igual à da rota que espelha, acesso negado
 * sem chamar nada, nenhum dado pessoal na saída, isolamento entre empresas, carteira do vendedor e tamanho limitado.
 */
describe('IA · catálogo de ferramentas (e2e)', () => {
  let t: TestApp;
  let registry: Registry;
  let newSession: () => Session;
  let runAs: <T>(user: RequestUser, fn: () => Promise<T>) => Promise<T>;
  let a: SeededTenant;
  let b: SeededTenant;
  let admin: RequestUser;
  let adminOther: RequestUser;
  let sellerA: RequestUser;
  let sellerB: RequestUser;
  let dealA: SignedDeal;
  let dealB: SignedDeal;
  let projectCodeA = '';
  let projectCodeB = '';

  const post = (path: string, token: string, body: unknown = {}) =>
    t.http
      .post(`${API}${path}`)
      .set(bearer(token))
      .send(body as object);

  const asUser = (
    tenant: SeededTenant,
    u: SeededUser,
    role: Role,
    name = 'Usuário de Teste',
  ): RequestUser => ({
    id: u.id,
    tenantId: tenant.id,
    tenantName: tenant.name,
    role,
    name,
    email: u.email,
    permissions: ROLE_PERMISSIONS[role],
  });

  const exec = (
    user: RequestUser,
    tool: string,
    args: Record<string, unknown> = {},
    session = newSession(),
  ) => runAs(user, () => registry.execute(tool, args, user, session));

  beforeAll(async () => {
    t = await createTestApp();
    const [{ AiToolRegistry }, { AiPrivacySession }, { RequestContext }] = await Promise.all([
      import('../src/platform/ai/tools/tool-registry.service'),
      import('../src/platform/ai/privacy/session'),
      import('../src/common/context/request-context'),
    ]);
    registry = t.app.get(AiToolRegistry);
    newSession = () => new AiPrivacySession();
    const ctx = t.app.get(RequestContext);
    runAs = (user, fn) =>
      ctx.run({ tenantId: user.tenantId, userId: user.id, role: user.role }, fn);

    a = await seedTenant(t.prisma, 'ferramentas');
    b = await seedTenant(t.prisma, 'ferramentasb');
    admin = asUser(a, a.admin, 'ADMIN');
    adminOther = asUser(b, b.admin, 'ADMIN');
    const manager = await tokenFor(t.http, a.manager);
    const adminToken = await tokenFor(t.http, a.admin);
    const sA = await tokenWithRole(t, a, 'SALESPERSON');
    const sB = await tokenWithRole(t, a, 'SALESPERSON');
    sellerA = { ...asUser(a, { id: sA.id, email: 'a@x', role: 'SALESPERSON' }, 'SALESPERSON') };
    sellerB = { ...asUser(a, { id: sB.id, email: 'b@x', role: 'SALESPERSON' }, 'SALESPERSON') };

    const flowA: Flow = { t, tenant: a, seller: sA.token, admin: adminToken };
    const flowB: Flow = { t, tenant: a, seller: sB.token, admin: adminToken };
    await ensureMarginPolicy(flowA, manager);
    dealA = await signedDeal(flowA, manager, { name: PERSONAL_NAMES[0] });
    dealB = await signedDeal(flowB, manager, { name: PERSONAL_NAMES[1] });
    await buildOpportunity(flowA, { name: 'Maria em negociação' });

    // Dados pessoais plantados em todo lugar onde o sistema os guarda: nada disso pode chegar à IA.
    const S = PERSONAL_DATA_SAMPLES;
    await t.prisma.system.account.updateMany({
      where: { id: { in: [dealA.accountId, dealB.accountId] } },
      data: {
        email: S.EMAIL,
        phone: S.PHONE,
        notes: `Cliente chato, ligar ${S.PHONE}, CPF ${S.CPF}`,
      },
    });
    await post(`/accounts/${dealA.accountId}/contacts`, sA.token, {
      name: 'Contato da Helena',
      email: S.EMAIL,
      phone: S.PHONE,
    });
    await post('/leads', sA.token, {
      name: 'Lead com dados',
      email: S.EMAIL,
      phone: S.PHONE,
      document: S.CPF,
      notes: `Mora no CEP ${S.CEP}, coordenadas ${S.COORDINATES}`,
      monthlyBillCents: 85_000,
      segment: 'COMMERCIAL',
    });
    await post('/tasks', sA.token, {
      title: `Ligar para ${PERSONAL_NAMES[0]}`,
      description: `Telefone ${S.PHONE}`,
      dueAt: '2020-01-01',
      opportunityId: dealA.opportunityId,
    });
    projectCodeA = dealA.projectCode;
    projectCodeB = dealB.projectCode;
    // Financeiro lançado para os dois projetos.
    const finance = (await tokenWithRole(t, a, 'FINANCE')).token;
    for (const [deal, paid, cost] of [
      [dealA, 1_000_000, 400_000],
      [dealB, 800_000, 200_000],
    ] as const) {
      const base = `/projects/${deal.projectId}/finance`;
      const parcel = await post(`${base}/receivables`, finance, {
        referenceId: 'NF-1',
        order: 1,
        amountCents: paid,
        dueOn: '2026-12-01',
      });
      await post(`${base}/receivables/${parcel.body.id}/pay`, finance, { paymentMethod: 'PIX' });
      await post(`${base}/costs`, finance, {
        category: 'MATERIAL',
        description: `Compra ${S.PHONE}`,
        actualCents: cost,
      });
    }
    await post(`/projects/${dealA.projectId}/finance/receivables`, finance, {
      referenceId: 'NF-2',
      order: 2,
      amountCents: 300_000,
      dueOn: '2020-02-01',
    });

    Object.assign(SAMPLE_PARAMS, {
      oportunidade_detalhe: { projeto: projectCodeA },
      cotacoes_margens: { projeto: projectCodeA },
      financeiro_projeto: { projeto: projectCodeA },
      planta_desempenho: { projeto: projectCodeA },
      previsoes_geracao: { projeto: projectCodeA },
      cliente_perfil: { cliente: '[CLIENTE_1]' },
    });
  });
  afterAll(() => t.close());

  describe('o catálogo', () => {
    it('tem as ferramentas esperadas, sem nome repetido, cada uma com descrição e permissões', () => {
      const tools = registry.all();
      expect(tools.length).toBeGreaterThanOrEqual(30);
      expect(new Set(tools.map((x) => x.name)).size).toBe(tools.length);
      for (const tool of tools) {
        expect(tool.description.length, tool.name).toBeGreaterThan(30);
        expect(tool.permissions.length, tool.name).toBeGreaterThan(0);
        expect(tool.name, tool.name).toMatch(/^[a-z_]+$/);
      }
    });

    it('a permissão de cada ferramenta cobre a da rota de leitura que ela espelha (e só acrescenta o financeiro)', async () => {
      const { PERMISSIONS_KEY } = await import('../src/common/decorators');
      const EXTRA_ALLOWED = new Set(['crm.finance.read']);
      for (const tool of registry.all()) {
        const proto = tool.mirrors.controller.prototype as unknown as Record<string, unknown>;
        const handler = proto[tool.mirrors.handler];
        expect(handler, `${tool.name}: rota ${tool.mirrors.handler} não existe`).toBeTypeOf(
          'function',
        );
        const mirrored = (Reflect.getMetadata(PERMISSIONS_KEY, handler as object) ??
          []) as string[];
        expect(
          mirrored.length,
          `${tool.name}: a rota espelhada não exige permissão`,
        ).toBeGreaterThan(0);
        for (const p of mirrored)
          expect(tool.permissions, `${tool.name} deve exigir ${p}`).toContain(p);
        for (const p of tool.permissions)
          if (!mirrored.includes(p))
            expect(EXTRA_ALLOWED.has(p), `${tool.name} exige ${p} além da rota`).toBe(true);
      }
    });

    it('os esquemas de parâmetros viram JSON Schema para o modelo', () => {
      const specs = registry.specsFor(admin);
      expect(specs.length).toBe(registry.all().length);
      for (const spec of specs) {
        expect(spec.parameters.type, spec.name).toBe('object');
        expect(spec.parameters.$schema).toBeUndefined();
      }
    });
  });

  describe('acesso: o modelo só recebe o que o usuário pode usar', () => {
    it('vendedor não recebe ferramentas de financeiro, engenharia, operação nem painel comercial', () => {
      const names = registry.specsFor(sellerA).map((s) => s.name);
      for (const hidden of [
        'financeiro_visao',
        'financeiro_projeto',
        'recebiveis_vencidos',
        'comissoes_resumo',
        'clientes_potencial',
        'clientes_risco',
        'painel_comercial',
        'operacao_painel',
        'engenharia_painel',
        'posvenda_painel',
      ])
        expect(names, hidden).not.toContain(hidden);
      for (const shown of [
        'leads_buscar',
        'funil_resumo',
        'oportunidade_detalhe',
        'clientes_ranking',
        'glossario',
      ])
        expect(names, shown).toContain(shown);
    });

    it('instalador não recebe nenhuma ferramenta (não usa o assistente)', async () => {
      const installer = await tokenWithRole(t, a, 'INSTALLER');
      const user = asUser(a, { id: installer.id, email: 'i@x', role: 'INSTALLER' }, 'INSTALLER');
      expect(registry.specsFor(user)).toEqual([]);
    });

    it('financeiro recebe as ferramentas de dinheiro e de contas, mas não as de engenharia', async () => {
      const f = await tokenWithRole(t, a, 'FINANCE');
      const user = asUser(a, { id: f.id, email: 'f@x', role: 'FINANCE' }, 'FINANCE');
      const names = registry.specsFor(user).map((s) => s.name);
      expect(names).toEqual(
        expect.arrayContaining(['financeiro_visao', 'clientes_ranking', 'clientes_potencial']),
      );
      expect(names).not.toContain('engenharia_painel');
    });

    it('executar sem permissão é recusado com a área, sem rodar a consulta', async () => {
      const out = await exec(sellerA, 'financeiro_visao');
      expect(out).toMatchObject({ ok: false, code: 'ACCESS_DENIED', area: 'financeiro' });
      expect(await exec(sellerA, 'ferramenta_que_nao_existe')).toMatchObject({
        ok: false,
        code: 'NO_TOOL',
      });
    });

    it('as áreas negadas ao vendedor alimentam a recusa por falta de acesso', () => {
      const areas = registry.deniedAreas(sellerA);
      expect(areas).toEqual(expect.arrayContaining(['financeiro', 'engenharia']));
      expect(areas).not.toContain('leads');
    });

    it('parâmetros inválidos voltam como erro de argumento, sem vazar o valor', async () => {
      const out = await exec(admin, 'leads_buscar', { limit: 9999, status: 'XYZ' });
      expect(out).toMatchObject({ ok: false, code: 'INVALID_ARGUMENTS' });
      expect(JSON.stringify(out)).not.toContain('XYZ');
    });
  });

  describe('nenhum dado pessoal sai (suíte de vazamento)', () => {
    it('toda ferramenta, com dados pessoais plantados no banco, devolve saída sem nenhum deles e passa na última barreira', async () => {
      const { assertNoPersonalData } = await import('../src/platform/ai/privacy/guard');
      const secrets = [
        ...Object.values(PERSONAL_DATA_SAMPLES),
        ...PERSONAL_NAMES,
        'Contato da Helena',
        'Lead com dados',
        'Cliente chato',
        '@example.com',
      ];
      const ran: string[] = [];
      // Uma sessão só, como numa conversa: o ranking registra os pseudônimos que o perfil do cliente usa depois.
      const session = newSession();
      await exec(admin, 'clientes_ranking', { sortBy: 'contracted' }, session);
      for (const tool of registry.all()) {
        const out = await exec(admin, tool.name, SAMPLE_PARAMS[tool.name] ?? {}, session);
        // Falta de dado é aceitável (ex.: usina sem monitoramento); o que não pode acontecer é erro interno.
        expect(
          out.ok || out.code === 'NOT_FOUND',
          `${tool.name}: ${JSON.stringify(out).slice(0, 200)}`,
        ).toBe(true);
        if (!out.ok) continue;
        const text = JSON.stringify(out.payload);
        for (const secret of secrets)
          expect(text, `${tool.name} vazou "${secret}"`).not.toContain(secret);
        expect(
          () => assertNoPersonalData([{ role: 'tool', content: text, toolCallId: 'x' }]),
          tool.name,
        ).not.toThrow();
        ran.push(tool.name);
      }
      expect(ran.length).toBeGreaterThanOrEqual(25);
    });

    it('nomes de clientes viram pseudônimos e voltam ao nome real só para quem pode ver', async () => {
      const session = newSession();
      const out = await exec(
        admin,
        'clientes_ranking',
        { sortBy: 'contracted', limit: 10 },
        session,
      );
      expect(out.ok).toBe(true);
      const text = JSON.stringify(out.ok ? out.payload : {});
      expect(text).toMatch(/\[CLIENTE_1\]/);
      for (const name of PERSONAL_NAMES) expect(text).not.toContain(name);
      const { revealPolicy } = await import('../src/platform/ai/tools/reveal-policy');
      const revealed = session.pseudonyms.reveal('[CLIENTE_1] e [CLIENTE_2]', revealPolicy(admin));
      expect(PERSONAL_NAMES.some((n) => revealed.includes(n))).toBe(true);
      expect(
        session.pseudonyms.reveal('[CLIENTE_1]', revealPolicy({ ...admin, permissions: [] })),
      ).toBe('um cliente');
    });

    it('valores viram referências {{F#}} com a fonte, e os números do sistema batem', async () => {
      const session = newSession();
      const out = await exec(admin, 'financeiro_projeto', { projeto: projectCodeA }, session);
      expect(out.ok).toBe(true);
      const payload = JSON.stringify(out.ok ? out.payload : {});
      expect(payload).toMatch(/\{\{F\d+\}\}/);
      const money = session.facts.all().find((f) => f.path === 'totalReceivedCents');
      expect(money).toMatchObject({ type: 'MONEY', value: 1_000_000 });
      expect(money!.source.tool).toBe('financeiro_projeto');
      expect(session.facts.all().find((f) => f.path === 'marginCents')).toMatchObject({
        value: 600_000,
      });
      expect(session.facts.all().find((f) => f.path === 'totalOverdueCents')).toMatchObject({
        value: 300_000,
      });
    });
  });

  describe('carteira do vendedor e isolamento', () => {
    it('cada vendedor só vê os próprios clientes e projetos pelas ferramentas', async () => {
      const mine = await exec(sellerA, 'clientes_ranking', { sortBy: 'contracted' });
      expect(mine.ok && (mine.payload as { clientsCount: unknown }).clientsCount).toBeTruthy();
      const aliasCount = (o: typeof mine) =>
        (JSON.stringify(o.ok ? o.payload : {}).match(/\[CLIENTE_\d+\]/g) ?? []).length;
      expect(aliasCount(mine)).toBeGreaterThanOrEqual(1);
      const other = await exec(sellerB, 'oportunidade_detalhe', { projeto: projectCodeA });
      expect(other).toMatchObject({ ok: false, code: 'NOT_FOUND' });
      const own = await exec(sellerA, 'oportunidade_detalhe', { projeto: projectCodeA });
      expect(own.ok).toBe(true);
      expect((await exec(sellerB, 'oportunidade_detalhe', { projeto: projectCodeB })).ok).toBe(
        true,
      );
    });

    it('vendedor não alcança o cliente de outra carteira pelo pseudônimo nem pelo id', async () => {
      const session = newSession();
      await exec(sellerA, 'clientes_ranking', { sortBy: 'contracted' }, session);
      const viaAlias = await exec(sellerA, 'cliente_perfil', { cliente: '[CLIENTE_1]' }, session);
      expect(viaAlias.ok).toBe(true);
      expect(await exec(sellerA, 'cliente_perfil', { cliente: dealB.accountId })).toMatchObject({
        ok: false,
        code: 'NOT_FOUND',
      });
      expect(await exec(sellerA, 'cliente_perfil', { cliente: '[CLIENTE_9]' })).toMatchObject({
        ok: false,
        code: 'NOT_FOUND',
      });
      expect(await exec(sellerA, 'cliente_perfil', { cliente: 'Helena Duarte' })).toMatchObject({
        ok: false,
        code: 'NOT_FOUND',
      });
    });

    it('sem acesso ao financeiro, o ranking de clientes não traz valores financeiros', async () => {
      const out = await exec(sellerA, 'clientes_ranking', { sortBy: 'contracted' });
      expect(out.ok).toBe(true);
      const rows = (
        out.ok ? (out.payload as { rows: Record<string, unknown>[] }).rows : []
      ) as Record<string, unknown>[];
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) expect(r.marginRealCents ?? null).toBeNull();
    });

    it('outra empresa não alcança nada desta, nem pelo código do projeto', async () => {
      for (const tool of [
        'oportunidade_detalhe',
        'cotacoes_margens',
        'financeiro_projeto',
        'planta_desempenho',
        'previsoes_geracao',
      ])
        expect(await exec(adminOther, tool, { projeto: projectCodeA }), tool).toMatchObject({
          ok: false,
          code: 'NOT_FOUND',
        });
      const ranking = await exec(adminOther, 'clientes_ranking', { sortBy: 'contracted' });
      expect(ranking.ok && (ranking.payload as { rows: unknown[] }).rows).toEqual([]);
      const text = JSON.stringify(ranking.ok ? ranking.payload : {});
      expect(text).not.toContain('CLIENTE_1');
      const visao = await exec(adminOther, 'financeiro_visao');
      expect(visao.ok && JSON.stringify(visao.payload)).toMatch(/\{\{F\d+\}\}/); // existe, mas é a empresa dela
    });
  });

  describe('tamanho e comportamento', () => {
    it('resultado grande é cortado até caber e avisa que cortou', async () => {
      const { capResult } = await import('../src/platform/ai/tools/tool');
      const big = { lista: Array.from({ length: 400 }, (_, i) => ({ i, texto: 'x'.repeat(40) })) };
      const out = capResult(big, 3_000);
      expect(JSON.stringify(out.value).length).toBeLessThanOrEqual(3_000);
      expect(out.truncated).toBe(true);
      expect((out.value as { truncated?: boolean }).truncated).toBe(true);
      expect(capResult({ a: 1 }, 3_000)).toEqual({ value: { a: 1 }, truncated: false });
    });

    it('glossário responde com o texto oficial, e termo desconhecido não é inventado', async () => {
      const hit = await exec(sellerA, 'glossario', { termo: 'Margem Real' });
      expect(hit.ok && (hit.payload as { significado: string }).significado).toMatch(
        /valor recebido/,
      );
      const miss = await exec(sellerA, 'glossario', { termo: 'xpto qualquer' });
      expect(miss.ok && (miss.payload as { significado: unknown }).significado).toBeNull();
    });

    it('a mesma conversa reaproveita pseudônimo e numera as referências sem repetir', async () => {
      const session = newSession();
      await exec(admin, 'clientes_ranking', { sortBy: 'contracted' }, session);
      const first = session.facts.all().length;
      await exec(admin, 'clientes_ranking', { sortBy: 'contracted' }, session);
      expect(session.facts.all().length).toBeGreaterThan(first);
      const ids = session.facts.all().map((f) => f.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(session.pseudonyms.entries().length).toBe(2);
    });
  });
});
