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
import { buildOpportunity, type Flow } from './crm-flow';
import { tokenWithRole } from './crm-support';

describe('Engenharia: gestão do pedido e do projeto (9K, e2e)', () => {
  let t: TestApp;
  let a: SeededTenant;
  let b: SeededTenant;
  let flow: Flow;
  let engineer: string;
  let engineerId: string;
  let lead: string;
  let leadId: string;
  let installer: string;
  let seller: string;
  let sellerId: string;
  let adminB: string;
  let opportunityId = '';
  let requestId = '';
  let projectId = '';
  let distributorId = '';

  const get = (path: string, token: string) => t.http.get(`${API}${path}`).set(bearer(token));
  const post = (path: string, token: string, body: object = {}) =>
    t.http.post(`${API}${path}`).set(bearer(token)).send(body);
  const patch = (path: string, token: string, body: object) =>
    t.http.patch(`${API}${path}`).set(bearer(token)).send(body);
  const put = (path: string, token: string, body: object) =>
    t.http.put(`${API}${path}`).set(bearer(token)).send(body);

  beforeAll(async () => {
    t = await createTestApp();
    a = await seedTenant(t.prisma, 'mgm');
    b = await seedTenant(t.prisma, 'mgmb');
    const e = await tokenWithRole(t, a, 'ENGINEERING');
    engineer = e.token;
    engineerId = e.id;
    const l = await tokenWithRole(t, a, 'TECHNICAL_LEAD');
    lead = l.token;
    leadId = l.id;
    installer = (await tokenWithRole(t, a, 'INSTALLER')).token;
    seller = await tokenFor(t.http, a.salesperson);
    sellerId = a.salesperson.id;
    adminB = await tokenFor(t.http, b.admin);
    flow = { t, tenant: a, seller, admin: await tokenFor(t.http, a.admin) };
    const ready = await buildOpportunity(flow);
    opportunityId = ready.opportunityId;
    // O vendedor é o responsável pela oportunidade (recebe os pedidos de informação).
    await t.prisma.system.opportunity.update({
      where: { id: opportunityId },
      data: { ownerId: sellerId },
    });
    const request = await t.prisma.system.engineeringRequest.create({
      data: { tenantId: a.id, opportunityId, reason: 'Semáforo amarelo: sombreamento relevante' },
    });
    requestId = request.id;
    distributorId = (
      await t.prisma.system.distributor.findFirstOrThrow({ where: { tenantId: a.id } })
    ).id;
  });
  afterAll(() => t.close());

  describe('pedido', () => {
    it('o detalhe traz o contexto do CRM (cliente, imóvel, UC, cálculo, consumo) e os próximos estados', async () => {
      const res = await get(`/engineering/requests/${requestId}`, engineer);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: 'PENDING',
        priority: 'NORMAL',
        overdue: false,
        allowedTransitions: ['IN_PROGRESS', 'CANCELLED'],
      });
      expect(res.body.context.account.name).toMatch(/./);
      expect(res.body.context.site).toMatchObject({ state: expect.any(String) });
      expect(res.body.context.consumerUnit).toMatchObject({ number: expect.any(String) });
      expect(res.body.context.calculation.systemKwp).toBeGreaterThan(0);
      expect(res.body.context.consumptionHistory.length).toBeGreaterThan(0);
      expect(res.body.context.seller.id).toBe(sellerId);
      expect(res.body.events).toEqual([]);
    });

    it('vendedor não vê a engenharia', async () => {
      expect((await get(`/engineering/requests/${requestId}`, seller)).status).toBe(403);
    });

    it('fluxo de estados: assumir, aguardar visita (exige motivo), voltar; transição inválida é recusada', async () => {
      expect((await post(`/engineering/requests/${requestId}/assign`, engineer)).body.status).toBe(
        'IN_PROGRESS',
      );
      const bad = await post(`/engineering/requests/${requestId}/status`, engineer, {
        status: 'DONE',
        note: 'x',
      });
      expect(bad.status).toBe(422);
      expect(bad.body.code).toBe('INVALID_REQUEST_TRANSITION');
      expect(
        (
          await post(`/engineering/requests/${requestId}/status`, engineer, {
            status: 'WAITING_VISIT',
          })
        ).status,
      ).toBe(422);
      const wait = await post(`/engineering/requests/${requestId}/status`, engineer, {
        status: 'WAITING_VISIT',
        note: 'Visita marcada para sexta',
      });
      expect(wait.body.status).toBe('WAITING_VISIT');
      const detail = (await get(`/engineering/requests/${requestId}`, engineer)).body;
      expect(detail.allowedTransitions).toEqual(['IN_PROGRESS', 'CANCELLED']);
      expect(detail.events[0]).toMatchObject({
        type: 'STATUS',
        text: 'Visita marcada para sexta',
        data: { from: 'IN_PROGRESS', to: 'WAITING_VISIT' },
        actorName: expect.any(String),
      });
    });

    it('comentário entra na linha do tempo; a pergunta ao vendedor vira tarefa no CRM e o pedido aguarda a informação', async () => {
      await post(`/engineering/requests/${requestId}/status`, engineer, { status: 'IN_PROGRESS' });
      const c = await post(`/engineering/requests/${requestId}/comments`, engineer, {
        text: 'Cliente tem sombra de árvore ao norte.',
      });
      expect(c.status).toBe(201);
      expect(c.body.events[0]).toMatchObject({
        type: 'COMMENT',
        text: 'Cliente tem sombra de árvore ao norte.',
      });
      const info = await post(`/engineering/requests/${requestId}/info-requests`, engineer, {
        question: 'Qual a altura da árvore e a distância até o telhado?',
      });
      expect(info.status).toBe(201);
      expect(info.body.status).toBe('WAITING_INFO');
      expect(info.body.events[0].type).toBe('INFO_REQUEST');
      const tasks = await t.prisma.system.task.findMany({
        where: { opportunityId, origin: 'engineering' },
      });
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toMatchObject({
        assigneeId: sellerId,
        description: 'Qual a altura da árvore e a distância até o telhado?',
      });
      await post(`/engineering/requests/${requestId}/status`, engineer, { status: 'IN_PROGRESS' });
    });

    it('prioridade e prazo: só quem coordena; pedido vencido fica marcado', async () => {
      expect(
        (await patch(`/engineering/requests/${requestId}/plan`, engineer, { priority: 'HIGH' }))
          .status,
      ).toBe(403);
      const past = new Date(Date.now() - 86_400_000).toISOString();
      const res = await patch(`/engineering/requests/${requestId}/plan`, lead, {
        priority: 'URGENT',
        dueAt: past,
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ priority: 'URGENT', overdue: true });
      const events = (await get(`/engineering/requests/${requestId}`, lead)).body.events;
      expect(events[0].type).toBe('PRIORITY');
    });

    it('reatribuir: só quem coordena; mostra a mudança na linha do tempo', async () => {
      expect(
        (await post(`/engineering/requests/${requestId}/reassign`, engineer, { userId: leadId }))
          .status,
      ).toBe(403);
      const res = await post(`/engineering/requests/${requestId}/reassign`, lead, {
        userId: leadId,
      });
      expect(res.body.assigneeId).toBe(leadId);
      await post(`/engineering/requests/${requestId}/reassign`, lead, { userId: engineerId });
    });

    it('painel: totais por estado, atrasados, urgentes e carga por engenheiro; restrito a quem coordena', async () => {
      expect((await get('/engineering/dashboard', engineer)).status).toBe(403);
      const res = await get('/engineering/dashboard', lead);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ open: 1, overdue: 1, urgent: 1, unassigned: 0 });
      expect(res.body.byStatus.IN_PROGRESS).toBe(1);
      expect(res.body.byAssignee[0]).toMatchObject({ id: engineerId, open: 1 });
      expect(res.body.upcoming[0].id).toBe(requestId);
    });

    it('isolamento entre empresas', async () => {
      expect((await get(`/engineering/requests/${requestId}`, adminB)).status).toBe(404);
    });
  });

  describe('projeto', () => {
    it('cria a partir do pedido; a ficha começa vazia e a linha do tempo mostra o histórico do pedido', async () => {
      const created = await post(`/engineering/projects/from-request/${requestId}`, engineer, {
        latitude: -15.78,
        longitude: -47.93,
      });
      expect(created.status).toBe(200);
      projectId = created.body.id;
      expect(created.body.profile).toMatchObject({
        targetKwp: null,
        generationClass: null,
        artNumber: null,
      });
      const timeline = await get(`/engineering/projects/${projectId}/timeline`, engineer);
      expect(timeline.body.map((e: { type: string }) => e.type)).toEqual(
        expect.arrayContaining(['COMMENT', 'INFO_REQUEST']),
      );
    });

    it('ficha: UC, distribuidora, potência-alvo (a classe vem dela) e ART; referências inexistentes são recusadas', async () => {
      const res = await patch(`/engineering/projects/${projectId}`, engineer, {
        distributorId,
        targetKwp: 5.5,
        artType: 'ART',
        artNumber: 'CE20261234567',
        councilRegistration: 'CREA-CE 123456',
      });
      expect(res.status).toBe(200);
      expect(res.body.profile).toMatchObject({
        distributorId,
        targetKwp: 5.5,
        generationClass: 'MICRO',
        artType: 'ART',
        artNumber: 'CE20261234567',
      });
      const bad = await patch(`/engineering/projects/${projectId}`, engineer, {
        siteId: '0198a000-0000-7000-8000-00000000dead',
      });
      expect(bad.status).toBe(422);
      expect(
        (await patch(`/engineering/projects/${projectId}`, installer, { notes: 'x' })).status,
      ).toBe(403);
    });

    it('pacote de documentos (EF-R04): micro não pede cronograma; mini pede; item dispensado exige observação', async () => {
      const micro = await get(`/engineering/projects/${projectId}/documents`, engineer);
      const codes = micro.body.map((d: { code: string }) => d.code);
      expect(codes).toEqual(
        expect.arrayContaining([
          'FORM',
          'ART_TRT',
          'SINGLE_LINE',
          'INVERTER_CERT',
          'POWER_OF_ATTORNEY',
          'MEMORIAL',
        ]),
      );
      expect(codes).not.toContain('SCHEDULE');
      expect(micro.body.find((d: { code: string }) => d.code === 'ART_TRT').suggestion).toMatch(
        /CE20261234567/,
      );
      expect(micro.body[0].source).toMatch(/EF-R04/);

      await patch(`/engineering/projects/${projectId}`, engineer, { targetKwp: 150 });
      const mini = await get(`/engineering/projects/${projectId}/documents`, engineer);
      expect(mini.body.map((d: { code: string }) => d.code)).toContain('SCHEDULE');

      expect(
        (
          await patch(`/engineering/projects/${projectId}/documents/FORM`, engineer, {
            status: 'NOT_APPLICABLE',
          })
        ).status,
      ).toBe(422);
      const ready = await patch(`/engineering/projects/${projectId}/documents/FORM`, engineer, {
        status: 'READY',
        note: 'Preenchido e assinado',
      });
      expect(ready.body.find((d: { code: string }) => d.code === 'FORM')).toMatchObject({
        status: 'READY',
        note: 'Preenchido e assinado',
      });
      await patch(`/engineering/projects/${projectId}`, engineer, { targetKwp: 5.5 });
      expect(
        (await get(`/engineering/projects/${projectId}/documents`, engineer)).body.map(
          (d: { code: string }) => d.code,
        ),
      ).not.toContain('SCHEDULE');
    });
  });

  describe('levantamento do local', () => {
    const survey = (over: Record<string, unknown> = {}) => ({
      data: {
        visitedAt: '2026-10-21',
        visitedBy: 'Instalador Teste',
        supply: {
          type: 'BI',
          lineVoltageV: 220,
          phaseVoltageV: 127,
          breakerA: 50,
          condition: 'GOOD',
        },
        grounding: { exists: true, adequate: false, resistanceOhm: 18, notes: 'Haste antiga' },
        roof: {
          type: 'CERAMIC',
          condition: 'GOOD',
          usableAreaM2: 40,
          tiltDegrees: 20,
          azimuthDegrees: 0,
          buildingHeightM: 6,
        },
        obstacles: [
          { id: 'o1', description: "Caixa d'água", heightM: 1.5, distanceM: 3, azimuthDegrees: 90 },
        ],
        loads: [
          {
            id: 'l1',
            name: 'Ar-condicionado 12000 BTU',
            powerW: 1200,
            quantity: 2,
            hoursPerDay: 6,
            daysPerMonth: 30,
          },
          {
            id: 'l2',
            name: 'Chuveiro',
            powerW: 5500,
            quantity: 1,
            hoursPerDay: 0.5,
            daysPerMonth: 30,
          },
        ],
        adequacies: [{ id: 'a1', description: 'Trocar disjuntor geral para 63 A', done: false }],
        ...over,
      },
    });

    it('rascunho incompleto lista o que falta e não conclui', async () => {
      const draft = await put(`/engineering/projects/${projectId}/survey`, installer, {
        data: { supply: { type: 'BI' } },
      });
      expect(draft.status).toBe(200);
      expect(draft.body.status).toBe('DRAFT');
      expect(draft.body.missing).toEqual(
        expect.arrayContaining(['Data da visita', 'Disjuntor geral (A)', 'Área útil (m²)']),
      );
      const complete = await post(`/engineering/projects/${projectId}/survey/complete`, installer);
      expect(complete.status).toBe(422);
      expect(complete.body.code).toBe('SURVEY_INCOMPLETE');
    });

    it('instalador preenche e conclui em campo; concluir libera o pedido que aguardava a visita', async () => {
      await post(`/engineering/requests/${requestId}/status`, engineer, {
        status: 'WAITING_VISIT',
        note: 'Aguardando a visita',
      });
      const saved = await put(`/engineering/projects/${projectId}/survey`, installer, survey());
      expect(saved.body.missing).toEqual([]);
      const done = await post(`/engineering/projects/${projectId}/survey/complete`, installer);
      expect(done.status).toBe(200);
      expect(done.body).toMatchObject({ status: 'COMPLETED', completedAt: expect.any(String) });
      expect((await get(`/engineering/requests/${requestId}`, engineer)).body.status).toBe(
        'IN_PROGRESS',
      );
      expect(
        (await get(`/engineering/projects/${projectId}/timeline`, engineer)).body[0].type,
      ).toBe('SURVEY');
    });

    it('concluído não edita; só a engenharia reabre (instalador não)', async () => {
      expect(
        (await put(`/engineering/projects/${projectId}/survey`, installer, survey())).status,
      ).toBe(409);
      expect(
        (await post(`/engineering/projects/${projectId}/survey/reopen`, installer)).status,
      ).toBe(403);
      expect(
        (await post(`/engineering/projects/${projectId}/survey/reopen`, engineer)).body.status,
      ).toBe('DRAFT');
    });

    it('instalador não acessa o projeto em geral, só o levantamento', async () => {
      expect((await get(`/engineering/projects/${projectId}`, installer)).status).toBe(403);
      expect((await get(`/engineering/projects/${projectId}/survey`, installer)).status).toBe(200);
    });

    it('fotos precisam existir; outra empresa não acessa o levantamento', async () => {
      const bad = await put(
        `/engineering/projects/${projectId}/survey`,
        engineer,
        survey({ photoDocumentIds: ['0198a000-0000-7000-8000-00000000dead'] }),
      );
      expect(bad.status).toBe(422);
      expect((await get(`/engineering/projects/${projectId}/survey`, adminB)).status).toBe(404);
    });
  });

  describe('análise de carga', () => {
    it('junta o consumo da fatura, as cargas da visita e sugere a potência pelo rendimento do cálculo preliminar', async () => {
      await put(`/engineering/projects/${projectId}/survey`, engineer, {
        data: {
          loads: [
            {
              id: 'l1',
              name: 'Ar-condicionado',
              powerW: 1200,
              quantity: 2,
              hoursPerDay: 6,
              daysPerMonth: 30,
            },
            {
              id: 'l2',
              name: 'Chuveiro',
              powerW: 5500,
              quantity: 1,
              hoursPerDay: 0.5,
              daysPerMonth: 30,
            },
          ],
        },
      });
      const res = await get(`/engineering/projects/${projectId}/load-analysis`, engineer);
      expect(res.status).toBe(200);
      expect(res.body.monthly.length).toBeGreaterThan(0);
      expect(res.body.averageKwh).toBeGreaterThan(0);
      expect(res.body.maxKwh).toBeGreaterThanOrEqual(res.body.averageKwh);
      // 1,2 kW × 2 × 6 h × 30 d = 432 kWh; 5,5 kW × 0,5 h × 30 d = 82,5 kWh.
      expect(res.body.loads).toEqual([
        { id: 'l1', name: 'Ar-condicionado', monthlyKwh: 432 },
        { id: 'l2', name: 'Chuveiro', monthlyKwh: 82.5 },
      ]);
      expect(res.body.loadsMonthlyKwh).toBe(514.5);
      expect(res.body.annualYieldKwhPerKwp).toBeGreaterThan(0);
      expect(res.body.suggestedKwp).toBeCloseTo(
        (res.body.averageKwh * 12) / res.body.annualYieldKwhPerKwp,
        1,
      );
    });
  });
});

describe('Visualização: posição das superfícies no projeto (9L)', () => {
  it('a posição na planta é validada e guardada no desenho', async () => {
    const t = await createTestApp();
    try {
      const a = await seedTenant(t.prisma, 'vis');
      const eng = (await tokenWithRole(t, a, 'ENGINEERING')).token;
      const created = await t.http
        .post(`${API}/engineering/projects`)
        .set(bearer(eng))
        .send({ name: 'Visual', site: { latitude: -15.78, longitude: -47.93 } });
      const versionId = created.body.versions[0].id;
      const surface = (positionM: object) => ({
        id: 's1',
        name: 'Norte',
        azimuthDegrees: 0,
        tiltDegrees: 20,
        widthM: 10,
        depthM: 5,
        positionM,
      });
      const design = (positionM: object) => ({
        design: {
          schemaVersion: 1,
          site: { latitude: -15.78, longitude: -47.93 },
          surfaces: [surface(positionM)],
        },
      });
      const ok = await t.http
        .put(`${API}/engineering/versions/${versionId}/design`)
        .set(bearer(eng))
        .send(design({ x: 12.5, y: -3 }));
      expect(ok.status).toBe(200);
      expect(ok.body.design.surfaces[0].positionM).toEqual({ x: 12.5, y: -3 });
      const bad = await t.http
        .put(`${API}/engineering/versions/${versionId}/design`)
        .set(bearer(eng))
        .send(design({ x: 99999, y: 0 }));
      expect(bad.status).toBe(422);
    } finally {
      await t.close();
    }
  });
});
