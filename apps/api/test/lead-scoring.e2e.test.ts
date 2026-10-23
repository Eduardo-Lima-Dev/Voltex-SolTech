import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

describe('CRM · Pontuação e distribuição de leads (e2e)', () => {
  let t: TestApp;
  let a: SeededTenant;
  let b: SeededTenant;
  let manager: string;
  let adminA: string;
  let adminB: string;
  let sdr: string;
  let sellerA: { id: string; token: string };
  let sellerB: { id: string; token: string };
  let captureKey: string;

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
  const patch = (path: string, token: string, body: unknown) =>
    t.http
      .patch(`${API}${path}`)
      .set(bearer(token))
      .send(body as object);

  let counter = 0;
  const phone = () => `(85) 9${String(81000000 + ++counter * 7919).slice(0, 8)}`;
  const capture = async (name: string, state?: string) => {
    const res = await t.http
      .post(`${API}/public/leads/${captureKey}`)
      .send({ name, phone: phone(), consent: true, ...(state ? { state } : {}) });
    expect(res.status).toBe(202);
    return t.prisma.system.lead.findFirstOrThrow({ where: { tenantId: a.id, name } });
  };

  const CONFIG = {
    criteria: [
      { key: 'SOURCE', weight: 20, points: { REFERRAL: 100, LANDING_PAGE: 40, MANUAL: 10 } },
      { key: 'SEGMENT', weight: 30, points: { RESIDENTIAL: 50, INDUSTRIAL: 100 } },
      {
        key: 'MONTHLY_BILL',
        weight: 50,
        ranges: [
          { minCents: 0, points: 10 },
          { minCents: 30_000, points: 60 },
          { minCents: 100_000, points: 100 },
        ],
      },
    ],
    routing: { method: 'NONE' },
  };

  beforeAll(async () => {
    t = await createTestApp();
    a = await seedTenant(t.prisma, 'score');
    b = await seedTenant(t.prisma, 'scoreb');
    manager = await tokenFor(t.http, a.manager);
    adminA = await tokenFor(t.http, a.admin);
    adminB = await tokenFor(t.http, b.admin);
    sdr = await tokenFor(t.http, a.sdr);
    sellerA = {
      id: a.salesperson.id,
      token: await tokenFor(t.http, a.salesperson),
    };
    const extra = await tokenWithRole(t, a, 'SALESPERSON');
    sellerB = { id: extra.id, token: extra.token };
    captureKey = (await get('/lead-capture', adminA)).body.key;
  });
  afterAll(() => t.close());

  describe('sem critérios da empresa', () => {
    it('ninguém é pontuado nem distribuído sozinho', async () => {
      const lead = await post('/leads', sdr, {
        name: 'Sem critérios',
        phone: phone(),
        segment: 'RESIDENTIAL',
      });
      expect(lead.status).toBe(201);
      expect(lead.body).toMatchObject({ score: null, scoreBreakdown: null });
      const captured = await capture('Captado sem critérios');
      expect(captured.score).toBeNull();
      expect(captured.ownerId).toBeNull();
      expect((await get('/lead-scoring/config', sdr)).body).toEqual({
        criteria: [],
        routing: { method: 'NONE', userIds: [], regions: [] },
      });
    });
  });

  describe('configuração', () => {
    it('só quem gerencia a pontuação salva; valida o conteúdo', async () => {
      expect((await put('/lead-scoring/config', sdr, CONFIG)).status).toBe(403);
      expect(
        (
          await put('/lead-scoring/config', manager, {
            criteria: [
              { key: 'SEGMENT', weight: 10, points: {} },
              { key: 'SEGMENT', weight: 10, points: {} },
            ],
          })
        ).status,
      ).toBe(422);
      expect(
        (
          await put('/lead-scoring/config', manager, {
            criteria: [],
            routing: { method: 'REGION' },
          })
        ).status,
      ).toBe(422);
      expect(
        (
          await put('/lead-scoring/config', manager, {
            criteria: [{ key: 'SOURCE', weight: 0, points: {} }],
          })
        ).status,
      ).toBe(422);
      const inactive = await put('/lead-scoring/config', manager, {
        criteria: [],
        routing: { method: 'ROUND_ROBIN', userIds: ['018f0000-0000-7000-8000-000000000000'] },
      });
      expect(inactive.status).toBe(422);
      expect(inactive.body.code).toBe('INVALID_ROUTING_USER');
      const saved = await put('/lead-scoring/config', manager, CONFIG);
      expect(saved.status).toBe(200);
      expect((await get('/lead-scoring/config', sdr)).body.criteria).toHaveLength(3);
    });

    it('a edição geral da empresa não apaga a configuração e outra empresa não a enxerga', async () => {
      const tenant = await get('/tenant', adminA);
      await patch('/tenant', adminA, { name: tenant.body.name, settings: {} });
      expect((await get('/lead-scoring/config', sdr)).body.criteria).toHaveLength(3);
      expect((await get('/lead-scoring/config', adminB)).body.criteria).toEqual([]);
    });
  });

  describe('pontuação', () => {
    it('calcula pelos critérios da empresa e mostra de onde veio cada ponto', async () => {
      // (20×100 + 30×50 + 50×60) / 100 = 65
      const lead = await post('/leads', sdr, {
        name: 'Indicação residencial',
        phone: phone(),
        source: 'REFERRAL',
        segment: 'RESIDENTIAL',
        monthlyBillCents: 45_000,
      });
      expect(lead.body.score).toBe(65);
      expect(lead.body.scoreBreakdown).toEqual([
        { key: 'SOURCE', weight: 20, points: 100 },
        { key: 'SEGMENT', weight: 30, points: 50 },
        { key: 'MONTHLY_BILL', weight: 50, points: 60 },
      ]);
      expect(lead.body.scoredAt).not.toBeNull();
    });

    it('critério sem dado no lead fica de fora; a lista pode vir por maior pontuação', async () => {
      const sem = await post('/leads', sdr, {
        name: 'Só origem',
        phone: phone(),
        source: 'REFERRAL',
      });
      expect(sem.body.score).toBe(100);
      const alta = await post('/leads', sdr, {
        name: 'Indústria grande',
        phone: phone(),
        source: 'REFERRAL',
        segment: 'INDUSTRIAL',
        monthlyBillCents: 500_000,
      });
      expect(alta.body.score).toBe(100);
      const baixa = await post('/leads', sdr, {
        name: 'Conta baixa',
        phone: phone(),
        segment: 'RESIDENTIAL',
        monthlyBillCents: 5_000,
      });
      // 20×10 + 30×50 + 50×10 = 2200 → 22
      expect(baixa.body.score).toBe(22);
      const list = await get('/leads?sort=score&pageSize=100', sdr);
      const scores = list.body.data.map((l: { score: number | null }) => l.score);
      const firstNull = scores.findIndex((s: number | null) => s === null);
      const numeric = firstNull === -1 ? scores : scores.slice(0, firstNull);
      expect(numeric).toEqual([...numeric].sort((x: number, y: number) => y - x));
      if (firstNull !== -1)
        expect(scores.slice(firstNull).every((s: number | null) => s === null)).toBe(true);
    });

    it('editar o dado que entra na conta pontua de novo', async () => {
      const lead = await post('/leads', sdr, {
        name: 'Vai mudar',
        phone: phone(),
        source: 'REFERRAL',
        segment: 'RESIDENTIAL',
        monthlyBillCents: 5_000,
      });
      expect(lead.body.score).toBe(40); // (20×100 + 30×50 + 50×10) / 100
      const edited = await patch(`/leads/${lead.body.id}`, sdr, { monthlyBillCents: 120_000 });
      expect(edited.body.score).toBe(85); // (2000 + 1500 + 50×100) / 100
      // Editar o que não entra na conta não mexe na pontuação.
      const note = await patch(`/leads/${lead.body.id}`, sdr, { notes: 'Ligar à tarde' });
      expect(note.body.score).toBe(85);
    });

    it('mudar os critérios não repontua sozinho; repontuar atualiza só os leads em aberto', async () => {
      const open = await post('/leads', sdr, {
        name: 'Em aberto',
        phone: phone(),
        source: 'REFERRAL',
      });
      const closed = await post('/leads', sdr, {
        name: 'Desqualificado',
        phone: phone(),
        source: 'REFERRAL',
      });
      await patch(`/leads/${closed.body.id}`, sdr, {
        status: 'DISQUALIFIED',
        disqualifiedReason: 'Sem interesse',
      });
      expect(open.body.score).toBe(100);

      await put('/lead-scoring/config', manager, {
        criteria: [{ key: 'SOURCE', weight: 10, points: { REFERRAL: 30 } }],
        routing: { method: 'NONE' },
      });
      expect((await get(`/leads/${open.body.id}`, sdr)).body.score).toBe(100);
      expect((await post('/lead-scoring/rescore', sdr)).status).toBe(403);
      const res = await post('/lead-scoring/rescore', manager);
      expect(res.body.updated).toBeGreaterThan(0);
      expect((await get(`/leads/${open.body.id}`, sdr)).body.score).toBe(30);
      expect((await get(`/leads/${closed.body.id}`, sdr)).body.score).toBe(100);
      await put('/lead-scoring/config', manager, CONFIG);
    });
  });

  describe('distribuição', () => {
    const route = (routing: unknown) =>
      put('/lead-scoring/config', manager, { ...CONFIG, routing });

    it('rodízio: o lead captado sem responsável vai para o próximo da lista, em revezamento', async () => {
      expect(
        (await route({ method: 'ROUND_ROBIN', userIds: [sellerA.id, sellerB.id] })).status,
      ).toBe(200);
      const owners: (string | null)[] = [];
      for (const name of ['Rodízio 1', 'Rodízio 2', 'Rodízio 3', 'Rodízio 4'])
        owners.push((await capture(name)).ownerId);
      expect(owners[0]).toBe(sellerA.id);
      expect(owners[1]).toBe(sellerB.id);
      expect(owners[2]).toBe(sellerA.id);
      expect(owners[3]).toBe(sellerB.id);
    });

    it('importação em lote também reveza, dentro do mesmo lote', async () => {
      const rows = Array.from({ length: 4 }, (_, i) => ({
        name: `Importado ${i}`,
        phone: phone(),
      }));
      const res = await post('/leads/import', sdr, { rows });
      expect(res.body.created).toBe(4);
      const imported = await t.prisma.system.lead.findMany({
        where: { tenantId: a.id, name: { startsWith: 'Importado ' } },
        orderBy: { createdAt: 'asc' },
      });
      const counts = new Map<string | null, number>();
      for (const l of imported) counts.set(l.ownerId, (counts.get(l.ownerId) ?? 0) + 1);
      expect(counts.get(sellerA.id)).toBe(2);
      expect(counts.get(sellerB.id)).toBe(2);
    });

    it('lead criado à mão sem responsável continua com quem o criou', async () => {
      const lead = await post('/leads', sellerA.token, { name: 'Criado à mão', phone: phone() });
      expect(lead.body.ownerId).toBe(sellerA.id);
    });

    it('por região: o estado do lead escolhe o grupo; estado sem região fica sem responsável', async () => {
      expect(
        (
          await route({
            method: 'REGION',
            regions: [
              { states: ['SP', 'RJ'], userIds: [sellerA.id] },
              { states: ['CE'], userIds: [sellerB.id] },
            ],
          })
        ).status,
      ).toBe(200);
      expect((await capture('Paulista', 'SP')).ownerId).toBe(sellerA.id);
      expect((await capture('Cearense', 'CE')).ownerId).toBe(sellerB.id);
      expect((await capture('Mineiro', 'MG')).ownerId).toBeNull();
      expect((await capture('Sem estado')).ownerId).toBeNull();
    });

    it('sem lista, o rodízio usa todos os vendedores ativos; vendedor inativo sai da fila', async () => {
      await route({ method: 'ROUND_ROBIN' });
      await t.prisma.system.user.update({ where: { id: sellerB.id }, data: { isActive: false } });
      const lead = await capture('Só um ativo');
      expect(lead.ownerId).toBe(sellerA.id);
      await t.prisma.system.user.update({ where: { id: sellerB.id }, data: { isActive: true } });
    });

    it('a distribuição publica o responsável no evento do lead', async () => {
      await route({ method: 'ROUND_ROBIN', userIds: [sellerB.id] });
      const lead = await capture('Evento com dono');
      const events = await t.prisma.system.outboxEvent.findMany({
        where: { tenantId: a.id, type: 'LeadCreated' },
      });
      expect(
        events.some(
          (e) =>
            (e.payload as { leadId?: string; ownerId?: string }).leadId === lead.id &&
            (e.payload as { ownerId?: string }).ownerId === sellerB.id,
        ),
      ).toBe(true);
    });
  });
});
