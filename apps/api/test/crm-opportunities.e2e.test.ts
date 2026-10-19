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
import { auditOf, outboxOf, tokenWithRole } from './crm-support';

const calcInput = (o: Record<string, unknown> = {}) => ({
  consumptionMonthlyKwh: Array<number>(12).fill(500),
  availabilityCostKwh: 30,
  hspMonthly: Array<number>(12).fill(5),
  performanceRatio: 0.8,
  modulePowerWp: 550,
  moduleAreaM2: 2.58,
  tariffCentsPerKwh: 95,
  costPerWpCents: 450,
  ...o,
});

describe('CRM · Pipeline, oportunidades, tarefas e Calculator (e2e)', () => {
  let t: TestApp;
  let a: SeededTenant;
  let b: SeededTenant;
  let admin: string;
  let manager: string;
  let seller: string;
  let sdr: string;
  let adminB: string;
  let engineering: string;

  const post = (path: string, token: string, body: unknown = {}) =>
    t.http
      .post(`${API}${path}`)
      .set(bearer(token))
      .send(body as object);
  const get = (path: string, token: string) => t.http.get(`${API}${path}`).set(bearer(token));
  const patch = (path: string, token: string, body: unknown) =>
    t.http
      .patch(`${API}${path}`)
      .set(bearer(token))
      .send(body as object);

  const newOpp = async (
    extra: Record<string, unknown> = {},
    accountExtra: Record<string, unknown> = {},
  ) => {
    const acc = (
      await post('/accounts', seller, {
        name: `Cliente ${Math.random().toString(36).slice(2, 8)}`,
        ...accountExtra,
      })
    ).body;
    const opp = await post('/opportunities', seller, { accountId: acc.id, ...extra });
    expect(opp.status).toBe(201);
    return { acc, opp: opp.body };
  };
  const goTo = async (id: string, stages: string[]) => {
    for (const stage of stages) {
      const res = await post(`/opportunities/${id}/stage`, seller, { stage });
      expect(res.status, `→ ${stage}: ${JSON.stringify(res.body)}`).toBe(200);
    }
  };

  beforeAll(async () => {
    t = await createTestApp();
    a = await seedTenant(t.prisma, 'opp');
    b = await seedTenant(t.prisma, 'oppb');
    admin = await tokenFor(t.http, a.admin);
    manager = await tokenFor(t.http, a.manager);
    seller = await tokenFor(t.http, a.salesperson);
    sdr = await tokenFor(t.http, a.sdr);
    adminB = await tokenFor(t.http, b.admin);
    engineering = (await tokenWithRole(t, a, 'ENGINEERING')).token;
  });
  afterAll(() => t.close());

  describe('pipeline do tenant', () => {
    it('nasce com as 15 etapas padrão, na ordem; gestor renomeia e reordena; vendedor não', async () => {
      const res = await get('/pipeline', seller);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(15);
      expect(res.body.map((s: { order: number }) => s.order)).toEqual(
        Array.from({ length: 15 }, (_, i) => i + 1),
      );
      expect(res.body[0]).toMatchObject({ key: 'NEW_LEAD', name: 'Novo lead', terminal: false });
      expect(
        res.body
          .filter((s: { terminal: boolean }) => s.terminal)
          .map((s: { key: string }) => s.key),
      ).toEqual(['WON', 'LOST']);

      const stage = res.body.find((s: { key: string }) => s.key === 'QUOTING');
      expect(
        (await patch(`/pipeline/stages/${stage.id}`, seller, { name: 'Orçamento' })).status,
      ).toBe(403);
      const renamed = await patch(`/pipeline/stages/${stage.id}`, manager, { name: 'Orçamento' });
      expect(renamed.body).toMatchObject({ key: 'QUOTING', name: 'Orçamento' });
      expect((await patch(`/pipeline/stages/${stage.id}`, manager, { name: 'x' })).status).toBe(
        422,
      );
      expect((await auditOf(t, a.id, 'pipeline.stage_updated')).length).toBeGreaterThan(0);
    });

    it('cada empresa tem o seu pipeline', async () => {
      const mine = await get('/pipeline', seller);
      const theirs = await get('/pipeline', adminB);
      expect(theirs.body.find((s: { key: string }) => s.key === 'QUOTING').name).toBe('Cotação');
      expect(new Set([...mine.body, ...theirs.body].map((s: { id: string }) => s.id)).size).toBe(
        30,
      );
    });
  });

  describe('oportunidades', () => {
    it('cria com Project ID único, dono, etapa inicial, linha do tempo, auditoria e evento', async () => {
      const { acc, opp } = await newOpp({ title: 'Casa do João', projectType: 'ON_GRID' });
      expect(opp).toMatchObject({
        title: 'Casa do João',
        stage: 'NEW_LEAD',
        status: 'OPEN',
        ownerId: a.salesperson.id,
        accountId: acc.id,
        valueCents: null,
        openTaskCount: 0,
      });
      expect(opp.projectCode).toMatch(/^VLX-[0-9A-HJKMNP-TV-Z]{8}$/);

      const other = (await newOpp()).opp;
      expect(other.projectCode).not.toBe(opp.projectCode);

      const timeline = await get(`/opportunities/${opp.id}/timeline`, seller);
      expect(timeline.body).toHaveLength(1);
      expect(timeline.body[0]).toMatchObject({
        type: 'CREATED',
        actorName: expect.stringContaining('vendedor'),
      });
      expect(
        (await outboxOf(t, a.id, 'OpportunityCreated')).some(
          (e) => e.projectCode === opp.projectCode,
        ),
      ).toBe(true);
      expect(
        (await auditOf(t, a.id, 'opportunity.created')).some((l) => l.entityId === opp.id),
      ).toBe(true);
    });

    it('título padrão usa o nome da conta; imóvel e UC precisam ser da mesma conta', async () => {
      const acc = (await post('/accounts', seller, { name: 'Maria Souza' })).body;
      const opp = (await post('/opportunities', seller, { accountId: acc.id })).body;
      expect(opp.title).toBe('Sistema solar — Maria Souza');

      const otherAcc = (await post('/accounts', seller, { name: 'Outra Conta' })).body;
      const foreignSite = (
        await post(`/accounts/${otherAcc.id}/sites`, seller, {
          name: 'Casa',
          city: 'Fortaleza',
          state: 'CE',
        })
      ).body;
      const foreignUnit = (
        await post(`/accounts/${otherAcc.id}/consumer-units`, seller, { number: '2020202' })
      ).body;
      expect(
        (await post('/opportunities', seller, { accountId: acc.id, siteId: foreignSite.id }))
          .status,
      ).toBe(422);
      expect(
        (
          await post('/opportunities', seller, {
            accountId: acc.id,
            consumerUnitId: foreignUnit.id,
          })
        ).status,
      ).toBe(422);
      expect(
        (
          await post('/opportunities', seller, {
            accountId: '0192b0c0-0000-7000-8000-00000000dead',
          })
        ).status,
      ).toBe(422);
      expect(
        (await post('/opportunities', seller, { accountId: acc.id, ownerId: b.admin.id })).status,
      ).toBe(422);
    });

    it('lista com filtros, busca por Project ID e paginação', async () => {
      const { opp } = await newOpp({ title: 'Oportunidade Pesquisável Xyz' });
      expect(
        (await get(`/opportunities?search=pesquisável%20xyz`, seller)).body.data.map(
          (o: { id: string }) => o.id,
        ),
      ).toContain(opp.id);
      expect(
        (await get(`/opportunities?search=${opp.projectCode}`, seller)).body.data.map(
          (o: { id: string }) => o.id,
        ),
      ).toContain(opp.id);
      expect(
        (
          await get(`/opportunities?stage=NEW_LEAD&status=OPEN&pageSize=100`, seller)
        ).body.data.every((o: { stage: string }) => o.stage === 'NEW_LEAD'),
      ).toBe(true);
      expect((await get('/opportunities?page=1&pageSize=2', seller)).body.data).toHaveLength(2);
      const byAccount = await get(`/opportunities?accountId=${opp.accountId}`, seller);
      expect(byAccount.body.data.map((o: { id: string }) => o.id)).toEqual([opp.id]);
    });

    it('edita título, responsável e previsão; trocar o imóvel avisa que as premissas mudaram', async () => {
      const { acc, opp } = await newOpp();
      const site = (
        await post(`/accounts/${acc.id}/sites`, seller, {
          name: 'Casa',
          city: 'Fortaleza',
          state: 'CE',
        })
      ).body;
      const before = (await outboxOf(t, a.id, 'OpportunityPremisesChanged')).length;
      const updated = await patch(`/opportunities/${opp.id}`, seller, {
        title: 'Título novo',
        ownerId: a.manager.id,
        expectedCloseDate: '2026-12-31',
        siteId: site.id,
      });
      expect(updated.body).toMatchObject({
        title: 'Título novo',
        ownerId: a.manager.id,
        siteId: site.id,
      });
      expect(updated.body.expectedCloseDate).toContain('2026-12-31');
      expect((await outboxOf(t, a.id, 'OpportunityPremisesChanged')).length).toBe(before + 1);
      await patch(`/opportunities/${opp.id}`, seller, { title: 'Só o título' });
      expect((await outboxOf(t, a.id, 'OpportunityPremisesChanged')).length).toBe(before + 1);
    });
  });

  describe('etapas (máquina de estados)', () => {
    it('avança passo a passo, registra na linha do tempo e emite o evento com o Project ID', async () => {
      const { opp } = await newOpp();
      await goTo(opp.id, ['FIRST_CONTACT', 'QUALIFICATION', 'BILL_PENDING']);
      expect((await get(`/opportunities/${opp.id}`, seller)).body.stage).toBe('BILL_PENDING');
      const timeline = (await get(`/opportunities/${opp.id}/timeline`, seller)).body;
      expect(timeline.filter((e: { type: string }) => e.type === 'STAGE_CHANGED')).toHaveLength(3);
      expect(timeline[0].summary).toBe('Etapa: Qualificação → Fatura pendente');
      const events = (await outboxOf(t, a.id, 'OpportunityStageChanged')).filter(
        (e) => e.projectCode === opp.projectCode,
      );
      expect(events.map((e) => (e.payload as { to: string }).to)).toEqual([
        'FIRST_CONTACT',
        'QUALIFICATION',
        'BILL_PENDING',
      ]);
    });

    it('recusa pular etapa, repetir a atual e marcar Ganho; informa as etapas possíveis', async () => {
      const { opp } = await newOpp();
      const jump = await post(`/opportunities/${opp.id}/stage`, seller, { stage: 'QUOTING' });
      expect(jump.status).toBe(422);
      expect(jump.body.code).toBe('INVALID_STAGE_TRANSITION');
      expect(jump.body.data.allowed).toEqual(['FIRST_CONTACT', 'QUALIFICATION', 'LOST']);
      expect(
        (await post(`/opportunities/${opp.id}/stage`, seller, { stage: 'NEW_LEAD' })).status,
      ).toBe(422);
      const won = await post(`/opportunities/${opp.id}/stage`, seller, { stage: 'WON' });
      expect(won.status).toBe(422);
      expect(won.body.message).toMatch(/contrato é assinado/);
      expect(
        (await post(`/opportunities/${opp.id}/stage`, seller, { stage: 'INEXISTENTE' })).status,
      ).toBe(422);
    });

    it('Perdido exige o motivo (também no banco), encerra a oportunidade e pode ser reaberto', async () => {
      const { opp } = await newOpp();
      expect((await post(`/opportunities/${opp.id}/stage`, seller, { stage: 'LOST' })).status).toBe(
        422,
      );
      const lost = await post(`/opportunities/${opp.id}/stage`, seller, {
        stage: 'LOST',
        lostReason: 'Foi para a concorrência',
      });
      expect(lost.body).toMatchObject({
        stage: 'LOST',
        status: 'LOST',
        lostReason: 'Foi para a concorrência',
      });
      expect(
        (await patch(`/opportunities/${opp.id}`, seller, { title: 'Novo título' })).status,
      ).toBe(409);

      // O banco também recusa: perdido sem motivo.
      const raw = await newOpp();
      await expect(
        t.prisma.system.opportunity.update({
          where: { id: raw.opp.id },
          data: { status: 'LOST', lostReason: null },
        }),
      ).rejects.toThrow(/opportunities_lost_requires_reason/);

      const reopened = await post(`/opportunities/${opp.id}/stage`, seller, {
        stage: 'QUALIFICATION',
      });
      expect(reopened.body).toMatchObject({
        stage: 'QUALIFICATION',
        status: 'OPEN',
        lostReason: null,
      });
      expect(
        (await post(`/opportunities/${opp.id}/stage`, seller, { stage: 'QUOTING' })).status,
      ).toBe(422);
    });

    it('a linha do tempo é imutável (nem o banco permite alterar ou apagar)', async () => {
      const { opp } = await newOpp();
      const row = await t.prisma.system.timelineEvent.findFirstOrThrow({
        where: { opportunityId: opp.id },
      });
      await expect(
        t.prisma.system.timelineEvent.update({
          where: { id: row.id },
          data: { summary: 'adulterado' },
        }),
      ).rejects.toThrow(/imutável/);
      await expect(t.prisma.system.timelineEvent.delete({ where: { id: row.id } })).rejects.toThrow(
        /imutável/,
      );
    });

    it('notas entram na linha do tempo com o autor', async () => {
      const { opp } = await newOpp();
      expect(
        (
          await post(`/opportunities/${opp.id}/notes`, seller, {
            body: 'Cliente pediu retorno na sexta',
          })
        ).status,
      ).toBe(201);
      expect((await post(`/opportunities/${opp.id}/notes`, seller, { body: '' })).status).toBe(422);
      const timeline = (await get(`/opportunities/${opp.id}/timeline`, seller)).body;
      expect(timeline[0]).toMatchObject({
        type: 'NOTE',
        summary: 'Cliente pediu retorno na sexta',
      });
    });
  });

  describe('Kanban', () => {
    it('uma coluna por etapa, na ordem do tenant, com total e cartões; fechadas só dos últimos 30 dias', async () => {
      const { opp } = await newOpp({ title: 'Cartão no Quadro' });
      const old = await newOpp({ title: 'Perdida Antiga' });
      await post(`/opportunities/${old.opp.id}/stage`, seller, {
        stage: 'LOST',
        lostReason: 'Desistiu',
      });
      await t.prisma.system.opportunity.update({
        where: { id: old.opp.id },
        data: { stageChangedAt: new Date(Date.now() - 40 * 86_400_000) },
      });

      const board = await get('/opportunities/board', seller);
      expect(board.status).toBe(200);
      expect(board.body.columns).toHaveLength(15);
      expect(board.body.columns.map((c: { stage: { order: number } }) => c.stage.order)).toEqual(
        Array.from({ length: 15 }, (_, i) => i + 1),
      );
      const newLead = board.body.columns.find(
        (c: { stage: { key: string } }) => c.stage.key === 'NEW_LEAD',
      );
      expect(newLead.total).toBeGreaterThan(0);
      expect(newLead.items.map((o: { id: string }) => o.id)).toContain(opp.id);
      const lost = board.body.columns.find(
        (c: { stage: { key: string } }) => c.stage.key === 'LOST',
      );
      expect(lost.items.map((o: { id: string }) => o.id)).not.toContain(old.opp.id);
    });

    it('soma o valor por etapa e filtra por busca e situação', async () => {
      const all = await get('/opportunities/board', seller);
      for (const column of all.body.columns)
        expect(Number.isInteger(column.totalValueCents)).toBe(true);

      const none = await get('/opportunities/board?search=zzz-nao-existe', seller);
      expect(none.status).toBe(200);
      expect(none.body.columns.every((c: { total: number }) => c.total === 0)).toBe(true);
      expect(
        none.body.columns.every((c: { totalValueCents: number }) => c.totalValueCents === 0),
      ).toBe(true);

      const lostOnly = await get('/opportunities/board?status=LOST', seller);
      const open = lostOnly.body.columns.flatMap((c: { items: { status: string }[] }) => c.items);
      expect(open.every((o: { status: string }) => o.status === 'LOST')).toBe(true);
    });

    it('filtra por responsável', async () => {
      const mine = await get(`/opportunities/board?ownerId=${a.manager.id}`, seller);
      const all = mine.body.columns.flatMap((c: { items: { ownerId: string }[] }) => c.items);
      expect(all.every((o: { ownerId: string }) => o.ownerId === a.manager.id)).toBe(true);
    });
  });

  describe('tarefas', () => {
    it('cria, lista atrasadas, conclui e mostra na linha do tempo; indicador de negócio sem próxima tarefa', async () => {
      const { opp } = await newOpp();
      const without = await get('/opportunities?withoutNextTask=true&pageSize=100', seller);
      expect(without.body.data.map((o: { id: string }) => o.id)).toContain(opp.id);

      const task = await post('/tasks', seller, {
        title: 'Ligar para o cliente',
        dueAt: new Date(Date.now() - 3_600_000).toISOString(),
        opportunityId: opp.id,
      });
      expect(task.status).toBe(201);
      expect(task.body).toMatchObject({
        status: 'OPEN',
        overdue: true,
        assigneeId: a.salesperson.id,
        opportunityId: opp.id,
      });

      const withTask = await get('/opportunities?withoutNextTask=true&pageSize=100', seller);
      expect(withTask.body.data.map((o: { id: string }) => o.id)).not.toContain(opp.id);
      const detail = (await get(`/opportunities/${opp.id}`, seller)).body;
      expect(detail.openTaskCount).toBe(1);
      expect(detail.nextTaskDueAt).toBe(task.body.dueAt);

      const overdue = await get('/tasks?overdue=true&pageSize=100', seller);
      expect(overdue.body.data.map((x: { id: string }) => x.id)).toContain(task.body.id);

      const done = await post(`/tasks/${task.body.id}/complete`, seller);
      expect(done.body).toMatchObject({ status: 'DONE', overdue: false });
      expect(done.body.completedAt).toBeTruthy();
      const timeline = (await get(`/opportunities/${opp.id}/timeline`, seller)).body.map(
        (e: { type: string }) => e.type,
      );
      expect(timeline).toEqual(expect.arrayContaining(['TASK_CREATED', 'TASK_COMPLETED']));
      expect((await get(`/opportunities/${opp.id}`, seller)).body.openTaskCount).toBe(0);
      expect(
        (await auditOf(t, a.id, 'task.completed')).some((l) => l.entityId === task.body.id),
      ).toBe(true);
    });

    it('valida prazo, responsável e alvo; edita, reabre e exclui', async () => {
      const { opp } = await newOpp();
      expect((await post('/tasks', seller, { title: 'Sem prazo' })).status).toBe(422);
      expect(
        (
          await post('/tasks', seller, {
            title: 'Alvo inexistente',
            dueAt: '2026-12-01',
            opportunityId: '0192b0c0-0000-7000-8000-00000000dead',
          })
        ).status,
      ).toBe(422);
      expect(
        (
          await post('/tasks', seller, {
            title: 'Responsável de fora',
            dueAt: '2026-12-01',
            assigneeId: b.admin.id,
          })
        ).status,
      ).toBe(422);

      const task = (
        await post('/tasks', sdr, {
          title: 'Enviar proposta',
          dueAt: '2026-12-01',
          opportunityId: opp.id,
          assigneeId: a.manager.id,
        })
      ).body;
      expect(task.assigneeId).toBe(a.manager.id);
      expect(
        (
          await patch(`/tasks/${task.id}`, seller, {
            title: 'Enviar proposta revisada',
            dueAt: '2026-12-05',
          })
        ).body.title,
      ).toBe('Enviar proposta revisada');
      await post(`/tasks/${task.id}/complete`, seller);
      const reopened = await patch(`/tasks/${task.id}`, seller, { status: 'OPEN' });
      expect(reopened.body).toMatchObject({ status: 'OPEN', completedAt: null });
      expect((await t.http.delete(`${API}/tasks/${task.id}`).set(bearer(seller))).status).toBe(200);
      expect((await get(`/tasks/${task.id}`, seller)).status).toBe(404);
    });

    it('filtra por responsável e por oportunidade', async () => {
      const { opp } = await newOpp();
      await post('/tasks', seller, {
        title: 'Tarefa A',
        dueAt: '2026-12-01',
        opportunityId: opp.id,
      });
      await post('/tasks', seller, {
        title: 'Tarefa B',
        dueAt: '2026-12-02',
        opportunityId: opp.id,
        assigneeId: a.manager.id,
      });
      const byOpp = await get(`/tasks?opportunityId=${opp.id}`, seller);
      expect(byOpp.body.data).toHaveLength(2);
      const byAssignee = await get(
        `/tasks?opportunityId=${opp.id}&assigneeId=${a.manager.id}`,
        seller,
      );
      expect(byAssignee.body.data.map((x: { title: string }) => x.title)).toEqual(['Tarefa B']);
      expect(byAssignee.body.data[0].assigneeName).toContain('manager');
    });
  });

  describe('integração com o Solar Calculator', () => {
    it('monta o contexto do cálculo a partir do local e da UC (sem fatura ainda)', async () => {
      const { acc, opp } = await newOpp({}, { name: 'Contexto Ltda' });
      const dist = (await post('/distributors', admin, { name: `Dist Contexto ${Date.now()}` }))
        .body;
      await post('/tariffs', admin, {
        distributorId: dist.id,
        customerGroup: 'B',
        energyCentsPerKwh: 98.5,
        validFrom: '2026-01-01',
        source: 'teste de contexto',
      });
      const site = (
        await post(`/accounts/${acc.id}/sites`, seller, {
          name: 'Casa',
          city: 'Fortaleza',
          state: 'CE',
          latitude: -3.73,
          intake: {
            roofAzimuthDegrees: 0,
            tiltDegrees: 15,
            availableAreaM2: 50,
            shading: 'RELEVANT',
          },
        })
      ).body;
      const unit = (
        await post(`/accounts/${acc.id}/consumer-units`, seller, {
          number: '90909090',
          distributorId: dist.id,
          customerGroup: 'B',
          phaseSystem: 'TWO_PHASE',
        })
      ).body;
      await patch(`/opportunities/${opp.id}`, seller, { siteId: site.id, consumerUnitId: unit.id });

      const ctx = await get(`/opportunities/${opp.id}/calculation-context`, seller);
      expect(ctx.status).toBe(200);
      expect(ctx.body).toMatchObject({
        customerName: 'Contexto Ltda',
        consumptionMonthlyKwh: [],
        billSnapshotId: null,
        customerGroup: 'B',
        phaseSystem: 'TWO_PHASE',
        tariffCentsPerKwh: 98.5,
        latitude: -3.73,
        roofAzimuthDegrees: 0,
        tiltDegrees: 15,
        availableAreaM2: 50,
        shadingRelevant: true,
        projectType: 'ON_GRID',
      });
      expect(ctx.body.tariffId).toBeTruthy();
      expect(ctx.body.distributorName).toContain('Dist Contexto');
    });

    it('cálculo verde criado pela oportunidade fica vinculado, com linha do tempo, sem pedido de engenharia', async () => {
      const { opp } = await newOpp();
      await goTo(opp.id, ['FIRST_CONTACT', 'QUALIFICATION', 'PRE_SIZING']);
      const res = await post(`/opportunities/${opp.id}/calculations`, seller, {
        title: 'Cálculo da oportunidade',
        input: calcInput(),
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ trafficLight: 'GREEN', opportunityId: opp.id });
      expect(res.body.result.moduleCount).toBe(8);

      const list = await get(`/opportunities/${opp.id}/calculations`, seller);
      expect(list.body.map((c: { id: string }) => c.id)).toEqual([res.body.id]);
      expect((await get(`/opportunities/${opp.id}`, seller)).body.stage).toBe('PRE_SIZING');
      expect((await get(`/opportunities/${opp.id}/engineering-requests`, seller)).body).toEqual([]);
      const timeline = (await get(`/opportunities/${opp.id}/timeline`, seller)).body;
      expect(timeline[0]).toMatchObject({ type: 'CALCULATION_LINKED' });
      expect(timeline[0].summary).toContain('4.4 kWp');
    });

    it('semáforo amarelo abre pedido de engenharia e move para "Engenharia necessária" (RF-CRM-042)', async () => {
      const { opp } = await newOpp();
      await goTo(opp.id, ['FIRST_CONTACT', 'QUALIFICATION', 'PRE_SIZING']);
      const res = await post(`/opportunities/${opp.id}/calculations`, seller, {
        input: calcInput({ customerGroup: 'A' }),
      });
      expect(res.body.trafficLight).toBe('YELLOW');

      expect((await get(`/opportunities/${opp.id}`, seller)).body.stage).toBe(
        'ENGINEERING_REQUIRED',
      );
      const requests = (await get(`/opportunities/${opp.id}/engineering-requests`, seller)).body;
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({ status: 'PENDING', calculationSessionId: res.body.id });
      expect(requests[0].reason).toBeTruthy();
      const timeline = (await get(`/opportunities/${opp.id}/timeline`, seller)).body.map(
        (e: { type: string }) => e.type,
      );
      expect(timeline).toEqual(
        expect.arrayContaining(['ENGINEERING_REQUESTED', 'STAGE_CHANGED', 'CALCULATION_LINKED']),
      );
      expect(
        (await outboxOf(t, a.id, 'EngineeringRequested')).some(
          (e) => e.projectCode === opp.projectCode,
        ),
      ).toBe(true);

      // vincular de novo não duplica o pedido
      await post(`/opportunities/${opp.id}/calculations/link`, seller, { sessionId: res.body.id });
      expect(
        (await get(`/opportunities/${opp.id}/engineering-requests`, seller)).body,
      ).toHaveLength(1);
    });

    it('amarelo em etapa que não permite ir a engenharia mantém a etapa, mas abre o pedido', async () => {
      const { opp } = await newOpp(); // NEW_LEAD → ENGINEERING_REQUIRED não é permitido
      await post(`/opportunities/${opp.id}/calculations`, seller, {
        input: calcInput({ customerGroup: 'A' }),
      });
      expect((await get(`/opportunities/${opp.id}`, seller)).body.stage).toBe('NEW_LEAD');
      expect(
        (await get(`/opportunities/${opp.id}/engineering-requests`, seller)).body,
      ).toHaveLength(1);
    });

    it('vincula um cálculo existente; um cálculo não muda de oportunidade; oportunidade encerrada não recebe', async () => {
      const { opp } = await newOpp();
      const other = (await newOpp()).opp;
      const calc = await post('/calculations/quick', seller, { input: calcInput() });
      expect(
        (
          await post(`/opportunities/${opp.id}/calculations/link`, seller, {
            sessionId: calc.body.id,
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await post(`/opportunities/${other.id}/calculations/link`, seller, {
            sessionId: calc.body.id,
          })
        ).status,
      ).toBe(409);
      expect(
        (
          await post(`/opportunities/${opp.id}/calculations/link`, seller, {
            sessionId: '0192b0c0-0000-7000-8000-00000000dead',
          })
        ).status,
      ).toBe(404);

      await post(`/opportunities/${other.id}/stage`, seller, {
        stage: 'LOST',
        lostReason: 'Desistiu',
      });
      const fresh = await post('/calculations/quick', seller, { input: calcInput() });
      expect(
        (
          await post(`/opportunities/${other.id}/calculations/link`, seller, {
            sessionId: fresh.body.id,
          })
        ).status,
      ).toBe(409);
    });

    it('exige permissão do Calculator além do CRM; engenharia só consulta', async () => {
      const { opp } = await newOpp();
      expect(
        (await post(`/opportunities/${opp.id}/calculations`, sdr, { input: calcInput() })).status,
      ).toBe(403); // SDR: sem opportunity.write
      expect((await get(`/opportunities/${opp.id}`, engineering)).status).toBe(200);
      expect(
        (await post(`/opportunities/${opp.id}/calculations`, engineering, { input: calcInput() }))
          .status,
      ).toBe(403);
    });
  });

  describe('permissões e isolamento', () => {
    it('SDR não cria oportunidade; vendedor sim; sem token 401', async () => {
      const acc = (await post('/accounts', sdr, { name: 'Conta do SDR' })).body;
      expect((await post('/opportunities', sdr, { accountId: acc.id })).status).toBe(403);
      expect((await post('/opportunities', seller, { accountId: acc.id })).status).toBe(201);
      expect((await t.http.get(`${API}/opportunities`)).status).toBe(401);
    });

    it('outra empresa não vê nem opera as oportunidades, notas, tarefas e cálculos desta', async () => {
      const { opp } = await newOpp();
      const task = (
        await post('/tasks', seller, {
          title: 'Privada',
          dueAt: '2026-12-01',
          opportunityId: opp.id,
        })
      ).body;
      expect(
        (await get('/opportunities?pageSize=100', adminB)).body.data.every(
          (o: { tenantId: string }) => o.tenantId === b.id,
        ),
      ).toBe(true);
      expect((await get(`/opportunities/${opp.id}`, adminB)).status).toBe(404);
      expect((await get(`/opportunities/${opp.id}/timeline`, adminB)).status).toBe(404);
      expect(
        (await post(`/opportunities/${opp.id}/stage`, adminB, { stage: 'FIRST_CONTACT' })).status,
      ).toBe(404);
      expect(
        (await post(`/opportunities/${opp.id}/notes`, adminB, { body: 'invasor' })).status,
      ).toBe(404);
      expect((await get(`/opportunities/${opp.id}/calculation-context`, adminB)).status).toBe(404);
      expect(
        (await post(`/opportunities/${opp.id}/calculations`, adminB, { input: calcInput() }))
          .status,
      ).toBe(404);
      expect((await get(`/tasks/${task.id}`, adminB)).status).toBe(404);
      expect((await post(`/tasks/${task.id}/complete`, adminB)).status).toBe(404);
      const board = await get('/opportunities/board', adminB);
      expect(
        board.body.columns
          .flatMap((c: { items: { id: string }[] }) => c.items)
          .map((o: { id: string }) => o.id),
      ).not.toContain(opp.id);
    });
  });
});
