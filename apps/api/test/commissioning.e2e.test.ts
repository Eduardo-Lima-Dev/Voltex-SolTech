import { randomUUID } from 'node:crypto';
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
import { ensureMarginPolicy, signedDeal } from './crm-delivery-flow';
import type { Flow } from './crm-flow';
import { auditOf, outboxOf, pngBuffer, tokenWithRole } from './crm-support';

const HOUR = 3_600_000;
const iso = (h: number) => new Date(Date.now() + h * HOUR).toISOString();

const MODULE = { vocV: 40, iscA: 10, betaVocPctPerC: -0.3, alphaIscPctPerC: 0.05 };
const MODULE_ID = '00000000-0000-4000-8000-0000000000aa';

const src = 'Regra de teste do roteiro';
/** Regra do responsável técnico (valores de EXEMPLO, só para o teste). */
const RULE = {
  tests: [
    {
      code: 'GROUND_CONTINUITY',
      label: 'Continuidade do aterramento',
      group: 'Cat. 1',
      kind: 'CHECK',
      source: src,
    },
    {
      code: 'STRING_VOC',
      label: 'Voc da string',
      group: 'Cat. 1',
      kind: 'MEASURE',
      scope: 'STRING',
      unit: 'V',
      expected: 'VOC_STRING',
      tolerancePct: 3,
      source: src,
    },
    {
      code: 'STRING_ISC',
      label: 'Isc da string',
      group: 'Cat. 1',
      kind: 'MEASURE',
      scope: 'STRING',
      unit: 'A',
      expected: 'ISC_STRING',
      tolerancePct: 5,
      source: src,
    },
    {
      code: 'WET_INSULATION',
      label: 'Isolamento',
      group: 'Adicionais',
      kind: 'MEASURE',
      scope: 'STRING',
      unit: 'MΩ',
      min: 1,
      required: false,
      source: src,
    },
    {
      code: 'STARTUP_AC',
      label: 'Disjuntor CA acionado',
      group: 'Start-up',
      kind: 'CHECK',
      scope: 'INVERTER',
      source: src,
    },
    {
      code: 'STRING_IV_CURVE',
      label: 'Curva I×V',
      group: 'Cat. 2',
      kind: 'CHECK',
      scope: 'STRING',
      level: 'EXTENDED',
      source: src,
    },
  ],
};

describe('Comissionamento e aceite do cliente (e2e)', () => {
  let t: TestApp;
  let a: SeededTenant;
  let b: SeededTenant;
  let flow: Flow;
  let owner: string;
  let manager: string;
  let seller: string;
  let sdr: string;
  let adminB: string;
  let operations: string;
  let lead: string;
  let installer: { token: string; id: string };
  let installer2: { token: string; id: string };
  let crewId: string;

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
  const publishAll = async () => {
    const { OutboxPublisher } = await import('../src/platform/events/outbox-publisher.service');
    await t.app.get(OutboxPublisher).publishPending(1000, a.id);
  };
  const sync = (token: string, actions: unknown[]) =>
    post('/operations/field/sync', token, { actions });
  const act = (workOrderId: string, extra: Record<string, unknown>) => ({
    clientActionId: randomUUID(),
    workOrderId,
    capturedAt: new Date().toISOString(),
    ...extra,
  });

  const activateRule = async (definition: unknown, registration = 'CREA-DF 123456') => {
    const created = await post('/rules', lead, {
      key: 'ops.commissioning',
      definition,
      sources: [{ type: 'INTERNAL_POLICY', reference: src }],
    });
    expect(created.status).toBe(201);
    const activated = await post(`/rules/${created.body.id}/activate`, lead, {
      reviewedBy: 'Eng. Teste',
      reviewedByRegistration: registration,
    });
    expect(activated.status).toBe(200);
    return created.body.id as string;
  };

  const approveProject = async (projectId: string) => {
    const project = (await get(`/projects/${projectId}`, owner)).body;
    for (const item of project.checklist.filter(
      (i: { required: boolean; status: string }) => i.required && i.status === 'PENDING',
    ))
      await patch(`/projects/${projectId}/checklist/${item.id}`, operations, { status: 'DONE' });
    for (const [status, extra] of [
      ['SUBMITTED', { protocolNumber: `PROTO-${randomUUID().slice(0, 6)}` }],
      ['INSPECTION', {}],
      ['APPROVED', {}],
    ] as const)
      await post(`/projects/${projectId}/status`, operations, { status, ...extra });
  };

  /** Projeto técnico aprovado de mentira: 2 strings de 10 módulos no inversor 1. */
  const technicalSnapshot = async (): Promise<string> => {
    const project = await t.prisma.system.engineeringProject.create({
      data: { tenantId: a.id, code: `ENG-${randomUUID().slice(0, 6)}`, name: 'Técnico' },
    });
    const version = await t.prisma.system.engineeringVersion.create({
      data: { tenantId: a.id, projectId: project.id, number: 1, design: {} },
    });
    const snapshot = await t.prisma.system.engineeringSnapshot.create({
      data: {
        tenantId: a.id,
        projectId: project.id,
        versionId: version.id,
        hash: 'h',
        content: {
          version: {
            design: {
              site: { latitude: -15.79, longitude: -47.88 },
              defaultModuleId: MODULE_ID,
              surfaces: [
                {
                  id: 's1',
                  name: 'Água',
                  azimuthDegrees: 0,
                  tiltDegrees: 20,
                  widthM: 10,
                  depthM: 5,
                },
              ],
              inverters: [
                {
                  id: 'i1',
                  inverterId: '00000000-0000-4000-8000-0000000000bb',
                  name: 'Sala técnica',
                  mppts: [
                    { strings: [{ id: 'g1', surfaceId: 's1', modulesInSeries: 10, parallel: 2 }] },
                  ],
                },
              ],
            },
          },
          equipment: [{ id: MODULE_ID, kind: 'MODULE', spec: MODULE }],
        },
      },
    });
    return snapshot.id;
  };

  /** Instalação concluída e comissionamento pendente. `withSnapshot` liga o projeto técnico de mentira. */
  const installed = async (withSnapshot = false) => {
    const deal = await signedDeal(flow, manager);
    await publishAll();
    await approveProject(deal.projectId);
    await publishAll();
    const inst = await t.prisma.system.installation.findFirstOrThrow({
      where: { projectId: deal.projectId },
    });
    if (withSnapshot)
      await t.prisma.system.installation.update({
        where: { id: inst.id },
        data: { engineeringSnapshotId: await technicalSnapshot() },
      });
    const item = await post(`/operations/installations/${inst.id}/materials`, operations, {
      category: 'MODULE',
      description: 'Módulo',
      quantity: 20,
      unit: 'un',
    });
    await post(`/operations/materials/${item.body.id}/receive`, operations);
    const order = await post('/operations/work-orders', operations, {
      installationId: inst.id,
      type: 'INSTALLATION',
      title: 'Instalar',
      crewId,
      scheduledStart: iso(24),
      scheduledEnd: iso(32),
    });
    expect(order.status).toBe(201);
    expect(
      (await post(`/operations/work-orders/${order.body.id}/start`, installer.token)).status,
    ).toBe(200);
    expect(
      (await post(`/operations/work-orders/${order.body.id}/complete`, installer.token)).status,
    ).toBe(200);
    await publishAll();
    const dto = (await get(`/operations/installations/${inst.id}`, operations)).body;
    const commissioningOrder = dto.workOrders.find(
      (o: { type: string }) => o.type === 'COMMISSIONING',
    );
    // Agenda a ordem de comissionamento para a equipe e a inicia em campo.
    await patch(`/operations/work-orders/${commissioningOrder.id}`, operations, {
      crewId,
      scheduledStart: iso(48),
      scheduledEnd: iso(52),
    });
    return { deal, id: inst.id, orderId: commissioningOrder.id as string };
  };

  const startCommissioning = async (orderId: string) => {
    expect((await post(`/operations/work-orders/${orderId}/start`, installer.token)).status).toBe(
      200,
    );
  };

  const record = async (installationId: string) =>
    (await get(`/operations/installations/${installationId}/commissioning`, operations)).body
      .current;

  /** Registra todos os ensaios obrigatórios (conferências conformes; medições dentro da tolerância) pelo escritório. */
  const fillAll = async (
    rec: { id: string; tests: { id: string; kind: string; code: string; required: boolean }[] },
    overrides: Record<string, unknown> = {},
  ) => {
    await patch(`/operations/commissioning/${rec.id}`, operations, {
      conditions: { irradianceWm2: 800, moduleTempC: 45 },
    });
    for (const test of rec.tests) {
      if (!test.required && !(test.code in overrides)) continue;
      const body =
        (overrides[test.code] as object | undefined) ??
        (test.kind === 'CHECK'
          ? { passed: true }
          : test.code === 'STRING_VOC'
            ? { value: 376 }
            : test.code === 'STRING_ISC'
              ? { value: 8.08 }
              : { value: 5 });
      const res = await patch(`/operations/commissioning/tests/${test.id}`, operations, body);
      expect(res.status).toBe(200);
    }
  };

  beforeAll(async () => {
    t = await createTestApp();
    a = await seedTenant(t.prisma, 'comm');
    b = await seedTenant(t.prisma, 'commb');
    owner = await tokenFor(t.http, a.owner);
    manager = await tokenFor(t.http, a.manager);
    seller = await tokenFor(t.http, a.salesperson);
    sdr = await tokenFor(t.http, a.sdr);
    adminB = await tokenFor(t.http, b.admin);
    operations = (await tokenWithRole(t, a, 'OPERATIONS')).token;
    lead = (await tokenWithRole(t, a, 'TECHNICAL_LEAD')).token;
    installer = await tokenWithRole(t, a, 'INSTALLER');
    installer2 = await tokenWithRole(t, a, 'INSTALLER');
    flow = { t, tenant: a, seller, admin: owner };
    await ensureMarginPolicy(flow, manager);
    crewId = (
      await post('/operations/crews', operations, {
        name: 'Equipe Ensaio',
        memberIds: [installer.id],
      })
    ).body.id;
  });
  afterAll(() => t.close());

  describe('sem regra ativa: modelo-base provisório', () => {
    it('o registro nasce com a estrutura do livro, sem limites, e a aprovação fica travada pela regra provisória', async () => {
      const { id } = await installed();
      const rec = await record(id);
      expect(rec).toMatchObject({
        provisional: true,
        status: 'IN_PROGRESS',
        attempt: 1,
        level: 'STANDARD',
      });
      expect(rec.ruleRef).toBe('base-energif-2023@1');
      expect(rec.ruleNote).toMatch(/provisório/);
      // Sem projeto técnico: só ensaios do sistema; os de string e de inversor foram pulados, com o motivo.
      expect(rec.tests.every((x: { scope: string }) => x.scope === 'SYSTEM')).toBe(true);
      expect(rec.skipped.map((s: { code: string }) => s.code)).toContain('STRING_ISC');
      expect(rec.notes.join(' ')).toMatch(/projeto técnico/);
      expect(
        rec.tests.every(
          (x: { tolerancePct: number | null; min: number | null; max: number | null }) =>
            x.tolerancePct === null && x.min === null && x.max === null,
        ),
      ).toBe(true);
      expect(rec.blockers.join(' ')).toMatch(/provisório/);
    });

    it('mesmo com tudo registrado e conforme, o responsável técnico não consegue aprovar enquanto a regra é provisória; pode reprovar', async () => {
      const { id, orderId } = await installed();
      await startCommissioning(orderId);
      const rec = await record(id);
      await fillAll(rec);
      // Medição sem regra para julgar (GROUND_RESISTANCE opcional) também fica "sem regra".
      const ground = rec.tests.find((x: { code: string }) => x.code === 'GROUND_RESISTANCE');
      const measured = await patch(`/operations/commissioning/tests/${ground.id}`, operations, {
        value: 3.2,
      });
      expect(measured.body).toMatchObject({ result: 'PENDING_RULE', measuredValue: 3.2 });
      expect(measured.body.reason).toMatch(/não define tolerância/);
      expect(
        (await post(`/operations/work-orders/${orderId}/complete`, installer.token)).status,
      ).toBe(200);
      const submitted = await record(id);
      expect(submitted.status).toBe('SUBMITTED');
      const blocked = await post(`/operations/commissioning/${submitted.id}/decision`, lead, {
        decision: 'APPROVE',
      });
      expect(blocked.status).toBe(422);
      expect(blocked.body.code).toBe('COMMISSIONING_BLOCKED');
      expect(blocked.body.data.blockers.join(' ')).toMatch(/provisório/);
      expect(blocked.body.data.blockers.join(' ')).toMatch(/não consegue julgar/);
      // Reprovar vale: a instalação volta a "em instalação" e o motivo fica registrado.
      const rejected = await post(`/operations/commissioning/${submitted.id}/decision`, lead, {
        decision: 'REJECT',
        note: 'Falta medir o aterramento',
      });
      expect(rejected.status).toBe(200);
      expect(rejected.body).toMatchObject({
        status: 'REJECTED',
        decisionNote: 'Falta medir o aterramento',
      });
      const inst = (await get(`/operations/installations/${id}`, operations)).body;
      expect(inst.status).toBe('IN_PROGRESS');
      expect(inst.history[0].reason).toMatch(
        /Reprovado no comissionamento: Falta medir o aterramento/,
      );
      expect(
        await t.prisma.system.task.count({
          where: { tenantId: a.id, automationKey: `commissioning-fix:${submitted.id}` },
        }),
      ).toBe(1);
    });
  });

  describe('a regra de comissionamento', () => {
    it('exige o registro no conselho de quem revisa e valida o modelo de ensaios', async () => {
      const bad = await post('/rules', lead, {
        key: 'ops.commissioning',
        definition: {
          tests: [
            {
              code: 'X1',
              label: 'Ensaio',
              group: 'Grupo',
              kind: 'MEASURE',
              unit: 'V',
              tolerancePct: 5,
              source: src,
            },
          ],
        },
        sources: [{ type: 'INTERNAL_POLICY', reference: src }],
      });
      expect(bad.status).toBe(422);
      expect(JSON.stringify(bad.body)).toMatch(/valor esperado/);
      const created = await post('/rules', lead, {
        key: 'ops.commissioning',
        definition: RULE,
        sources: [{ type: 'INTERNAL_POLICY', reference: src }],
      });
      expect(created.status).toBe(201);
      const noRegistration = await post(`/rules/${created.body.id}/activate`, lead, {
        reviewedBy: 'Eng. Teste',
      });
      expect(noRegistration.status).toBe(422);
      expect(
        (
          await post(`/rules/${created.body.id}/activate`, lead, {
            reviewedBy: 'Eng. Teste',
            reviewedByRegistration: 'CREA-DF 1',
          })
        ).status,
      ).toBe(200);
    });
  });

  describe('com regra ativa e projeto técnico', () => {
    beforeAll(async () => {
      await activateRule(RULE);
    });

    it('gera um ensaio por string, por inversor e por sistema, com os dados do módulo, na ordem do modelo', async () => {
      const { id } = await installed(true);
      const rec = await record(id);
      expect(rec).toMatchObject({ provisional: false, level: 'STANDARD', internalTestRule: false });
      expect(rec.ruleReviewedBy).toBe('Eng. Teste');
      const byCode = (code: string) => rec.tests.filter((x: { code: string }) => x.code === code);
      expect(byCode('GROUND_CONTINUITY')).toHaveLength(1);
      expect(byCode('STRING_VOC')).toHaveLength(2);
      expect(byCode('STARTUP_AC')).toHaveLength(1);
      expect(byCode('STRING_IV_CURVE')).toHaveLength(0); // categoria 2, só no nível ampliado
      expect(byCode('STRING_VOC')[0].subjectLabel).toBe(
        'Inversor 1 (Sala técnica) · MPPT 1 · string 1.1',
      );
      expect(byCode('STRING_VOC')[0].electrical).toMatchObject({
        modulesInSeries: 10,
        vocStcV: 40,
      });
      expect(byCode('STRING_VOC')[0]).toMatchObject({
        tolerancePct: 5 - 2,
        expectedKind: 'VOC_STRING',
      });
      expect(rec.tests.map((x: { position: number }) => x.position)).toEqual(
        [...rec.tests.map((x: { position: number }) => x.position)].sort(
          (p: number, q: number) => p - q,
        ),
      );
    });

    it('calcula o esperado pela temperatura e pela irradiância medidas e julga pela tolerância da regra', async () => {
      const { id } = await installed(true);
      const rec = await record(id);
      const voc = rec.tests.filter((x: { code: string }) => x.code === 'STRING_VOC');
      const isc = rec.tests.filter((x: { code: string }) => x.code === 'STRING_ISC');
      // Sem as condições, o esperado não existe: "sem dado".
      const early = await patch(`/operations/commissioning/tests/${voc[0].id}`, operations, {
        value: 376,
      });
      expect(early.body).toMatchObject({ result: 'PENDING_DATA', expectedValue: null });
      expect(early.body.reason).toMatch(/temperatura do módulo/);
      // Condições do registro: a medição já gravada é rejulgada.
      const cond = await patch(`/operations/commissioning/${rec.id}`, operations, {
        conditions: { irradianceWm2: 800, moduleTempC: 45, ambientC: 31 },
      });
      expect(cond.status).toBe(200);
      const after = cond.body.tests.find((x: { id: string }) => x.id === voc[0].id);
      expect(after.result).toBe('PASS');
      expect(after.expectedValue).toBeCloseTo(376, 6);
      expect(after.basis).toMatch(/10 × Voc do módulo a 45 °C/);
      // Voc 6,4 % acima do esperado: reprovado.
      const bad = await patch(`/operations/commissioning/tests/${voc[1].id}`, operations, {
        value: 400,
      });
      expect(bad.body.result).toBe('FAIL');
      expect(bad.body.deviationPct).toBeCloseTo(6.38, 1);
      expect(bad.body.reason).toMatch(/Desvio de 6\.4 % \(tolerância de 3 %\)/);
      // Isc: 8,08 A esperados a 800 W/m² e 45 °C.
      const good = await patch(`/operations/commissioning/tests/${isc[0].id}`, operations, {
        value: 8.0,
      });
      expect(good.body).toMatchObject({ result: 'PASS' });
      expect(good.body.expectedValue).toBeCloseTo(8.08, 6);
      // Uma medição pode ter a sua própria irradiância (ela muda ao longo do dia).
      const own = await patch(`/operations/commissioning/tests/${isc[1].id}`, operations, {
        value: 5.9,
        irradianceWm2: 600,
      });
      expect(own.body.expectedValue).toBeCloseTo(6.06, 6);
      expect(own.body.result).toBe('PASS');
      // Mudar a temperatura do registro rejulga as medições sem condição própria.
      const warmer = await patch(`/operations/commissioning/${rec.id}`, operations, {
        conditions: { moduleTempC: 65 },
      });
      const vocAfter = warmer.body.tests.find((x: { id: string }) => x.id === voc[0].id);
      expect(vocAfter.expectedValue).toBeCloseTo(10 * 40 * (1 - 0.003 * 40), 6);
      expect(vocAfter.result).toBe('FAIL');
      const iscOwn = warmer.body.tests.find((x: { id: string }) => x.id === isc[1].id);
      expect(iscOwn.expectedValue).toBeCloseTo(6.12, 6); // mantém a irradiância própria (600); sem temperatura própria vale a do registro (65 °C)
    });

    it('conferência exige "conforme"; medição exige valor; valor fora do tipo é recusado', async () => {
      const { id } = await installed(true);
      const rec = await record(id);
      const check = rec.tests.find((x: { code: string }) => x.code === 'GROUND_CONTINUITY');
      const measure = rec.tests.find((x: { code: string }) => x.code === 'STRING_ISC');
      expect(
        (await patch(`/operations/commissioning/tests/${check.id}`, operations, { value: 3 }))
          .status,
      ).toBe(422);
      expect(
        (await patch(`/operations/commissioning/tests/${measure.id}`, operations, { passed: true }))
          .status,
      ).toBe(422);
      expect(
        (await patch(`/operations/commissioning/tests/${check.id}`, operations, {})).status,
      ).toBe(422);
      const fail = await patch(`/operations/commissioning/tests/${check.id}`, operations, {
        passed: false,
        note: 'Fio solto',
      });
      expect(fail.body).toMatchObject({ result: 'FAIL', note: 'Fio solto', passed: false });
      const fixed = await patch(`/operations/commissioning/tests/${check.id}`, operations, {
        passed: true,
      });
      expect(fixed.body).toMatchObject({ result: 'PASS', note: 'Fio solto' });
      const cleared = await patch(`/operations/commissioning/tests/${check.id}`, operations, {
        passed: null,
      });
      expect(cleared.body.result).toBe('PENDING');
    });

    it('trocar o nível só vale antes de registrar algo e acrescenta os ensaios da categoria 2', async () => {
      const { id } = await installed(true);
      const rec = await record(id);
      const extended = await patch(`/operations/commissioning/${rec.id}`, operations, {
        level: 'EXTENDED',
      });
      expect(extended.status).toBe(200);
      expect(extended.body.level).toBe('EXTENDED');
      expect(
        extended.body.tests.filter((x: { code: string }) => x.code === 'STRING_IV_CURVE'),
      ).toHaveLength(2);
      const check = extended.body.tests.find(
        (x: { code: string }) => x.code === 'GROUND_CONTINUITY',
      );
      await patch(`/operations/commissioning/tests/${check.id}`, operations, { passed: true });
      const locked = await patch(`/operations/commissioning/${rec.id}`, operations, {
        level: 'STANDARD',
      });
      expect(locked.status).toBe(422);
      expect(locked.body.code).toBe('LEVEL_LOCKED');
    });

    it('sem projeto técnico, as strings são informadas à mão e o esperado não é calculado ("sem dado")', async () => {
      const { id } = await installed(false);
      const rec = await record(id);
      expect(rec.tests.filter((x: { code: string }) => x.code === 'STRING_VOC')).toHaveLength(0);
      const added = await post(`/operations/commissioning/${rec.id}/strings`, operations, {
        labels: ['String A', 'String B', 'string a'],
      });
      expect(added.status).toBe(200);
      const voc = added.body.tests.filter((x: { code: string }) => x.code === 'STRING_VOC');
      expect(voc.map((x: { subjectLabel: string }) => x.subjectLabel)).toEqual([
        'String A',
        'String B',
      ]);
      expect(voc[0].electrical).toBeNull();
      await patch(`/operations/commissioning/${rec.id}`, operations, {
        conditions: { moduleTempC: 40 },
      });
      const measured = await patch(`/operations/commissioning/tests/${voc[0].id}`, operations, {
        value: 380,
      });
      expect(measured.body).toMatchObject({ result: 'PENDING_DATA' });
      expect(measured.body.reason).toMatch(/dados do módulo/);
      // Repetir os mesmos nomes não duplica.
      const again = await post(`/operations/commissioning/${rec.id}/strings`, operations, {
        labels: ['String A'],
      });
      expect(
        again.body.tests.filter((x: { code: string }) => x.code === 'STRING_VOC'),
      ).toHaveLength(2);
    });

    it('enviar exige os obrigatórios registrados; os opcionais podem ficar em branco', async () => {
      const { id } = await installed(true);
      const rec = await record(id);
      const early = await post(`/operations/commissioning/${rec.id}/submit`, operations);
      expect(early.status).toBe(422);
      expect(early.body.code).toBe('REQUIRED_TESTS_PENDING');
      await fillAll(rec);
      const ok = await post(`/operations/commissioning/${rec.id}/submit`, operations);
      expect(ok.status).toBe(200);
      expect(ok.body.status).toBe('SUBMITTED');
      // Depois de enviado, nada mais muda.
      const test = rec.tests[0];
      expect(
        (await patch(`/operations/commissioning/tests/${test.id}`, operations, { passed: false }))
          .status,
      ).toBe(422);
      expect(
        (
          await patch(`/operations/commissioning/${rec.id}`, operations, {
            conditions: { moduleTempC: 10 },
          })
        ).status,
      ).toBe(422);
      expect((await post(`/operations/commissioning/${rec.id}/submit`, operations)).status).toBe(
        422,
      );
    });
  });

  describe('aprovação, relatório e aceite do cliente', () => {
    beforeAll(async () => {
      await activateRule(RULE);
    });

    it('só o responsável técnico decide; reprovado não aprova; corrigido, aprova, gera o relatório e abre o aceite', async () => {
      const { id, orderId } = await installed(true);
      await startCommissioning(orderId);
      const rec = await record(id);
      await fillAll(rec, { STRING_ISC: { value: 7.0 } }); // 7,0 A contra 8,08 A esperados: reprova
      expect(
        (await post(`/operations/work-orders/${orderId}/complete`, installer.token)).status,
      ).toBe(200);
      const submitted = await record(id);
      expect(submitted.status).toBe('SUBMITTED');
      expect(submitted.summary.failed).toBe(2);
      expect(
        (
          await post(`/operations/commissioning/${submitted.id}/decision`, operations, {
            decision: 'APPROVE',
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await post(`/operations/commissioning/${submitted.id}/decision`, installer.token, {
            decision: 'APPROVE',
          })
        ).status,
      ).toBe(403);
      const blocked = await post(`/operations/commissioning/${submitted.id}/decision`, lead, {
        decision: 'APPROVE',
      });
      expect(blocked.status).toBe(422);
      expect(blocked.body.data.blockers.join(' ')).toMatch(/2 ensaio\(s\) reprovado\(s\)/);
      expect(
        (
          await post(`/operations/commissioning/${submitted.id}/decision`, lead, {
            decision: 'REJECT',
          })
        ).status,
      ).toBe(422); // reprovar exige o motivo

      // Reprova, a obra é refeita e uma nova tentativa passa.
      expect(
        (
          await post(`/operations/commissioning/${submitted.id}/decision`, lead, {
            decision: 'REJECT',
            note: 'Strings com corrente baixa',
          })
        ).status,
      ).toBe(200);
      expect((await t.prisma.system.installation.findUniqueOrThrow({ where: { id } })).status).toBe(
        'IN_PROGRESS',
      );
      expect(
        (await post(`/operations/installations/${id}/status`, operations, { status: 'INSTALLED' }))
          .status,
      ).toBe(200);
      const inst2 = (await get(`/operations/installations/${id}`, operations)).body;
      const newOrder = inst2.workOrders.find(
        (o: { type: string; status: string }) =>
          o.type === 'COMMISSIONING' && o.status === 'PENDING',
      );
      expect(newOrder).toBeDefined();
      await patch(`/operations/work-orders/${newOrder.id}`, operations, {
        crewId,
        scheduledStart: iso(60),
        scheduledEnd: iso(64),
      });
      expect(
        (await post(`/operations/work-orders/${newOrder.id}/start`, installer.token)).status,
      ).toBe(200);
      const second = await record(id);
      expect(second).toMatchObject({ attempt: 2, status: 'IN_PROGRESS' });
      expect(
        (await get(`/operations/installations/${id}/commissioning`, operations)).body.previous[0],
      ).toMatchObject({
        attempt: 1,
        status: 'REJECTED',
        decisionNote: 'Strings com corrente baixa',
      });
      await fillAll(second);
      expect(
        (await post(`/operations/work-orders/${newOrder.id}/complete`, installer.token)).status,
      ).toBe(200);
      const resubmitted = await record(id);
      expect(resubmitted.blockers).toEqual([]);

      const approved = await post(`/operations/commissioning/${resubmitted.id}/decision`, lead, {
        decision: 'APPROVE',
        note: 'Conforme',
      });
      expect(approved.status).toBe(200);
      expect(approved.body).toMatchObject({
        status: 'APPROVED',
        hasReport: true,
        decisionNote: 'Conforme',
      });
      expect((await t.prisma.system.installation.findUniqueOrThrow({ where: { id } })).status).toBe(
        'CUSTOMER_ACCEPTANCE',
      );
      expect(
        (await outboxOf(t, a.id, 'CommissioningCompleted')).some(
          (e) => (e.payload as { installationId: string }).installationId === id,
        ),
      ).toBe(true);
      expect(
        await t.prisma.system.task.count({
          where: { tenantId: a.id, automationKey: `acceptance-request:${id}` },
        }),
      ).toBe(1);
      expect(
        (await auditOf(t, a.id, 'commissioning.approved')).some(
          (e) => e.entityId === resubmitted.id,
        ),
      ).toBe(true);
      // Relatório: link temporário do PDF guardado.
      const report = await get(`/operations/commissioning/${resubmitted.id}/report`, operations);
      expect(report.status).toBe(200);
      expect(report.body.url).toMatch(/^https?:\/\//);
      const doc = await t.prisma.system.document.findFirstOrThrow({
        where: { entityType: 'CommissioningRecord', entityId: resubmitted.id },
      });
      expect(doc.mimeType).toBe('application/pdf');
      expect(doc.filename).toMatch(/^relatorio-comissionamento-/);
      // Decidir de novo não vale.
      expect(
        (
          await post(`/operations/commissioning/${resubmitted.id}/decision`, lead, {
            decision: 'REJECT',
            note: 'tarde',
          })
        ).status,
      ).toBe(422);
    });

    it('o relatório só existe depois de aprovado', async () => {
      const { id } = await installed(true);
      const rec = await record(id);
      expect((await get(`/operations/commissioning/${rec.id}/report`, operations)).status).toBe(
        404,
      );
    });

    it('aceite do cliente: exige comissionamento aprovado; em campo exige a assinatura; finaliza e publica o evento', async () => {
      const { id, orderId } = await installed(true);
      await startCommissioning(orderId);
      const rec = await record(id);
      // Nada de pular etapas manualmente: sem aprovação do comissionamento não há aceite.
      const manual = await post(`/operations/installations/${id}/status`, operations, {
        status: 'CUSTOMER_ACCEPTANCE',
      });
      expect(manual.status).toBe(422);
      expect(manual.body.code).toBe('COMMISSIONING_NOT_APPROVED');
      await fillAll(rec);
      // Assinatura do cliente colhida em campo, na ordem de comissionamento.
      const sign = await t.http
        .post(`${API}/operations/field/work-orders/${orderId}/signature`)
        .set(bearer(installer.token))
        .field('clientActionId', randomUUID())
        .field('signedByName', 'Maria da Silva')
        .attach('file', pngBuffer(), { filename: 'a.png', contentType: 'image/png' });
      expect(sign.status).toBe(200);
      await post(`/operations/work-orders/${orderId}/complete`, installer.token);
      const submitted = await record(id);
      expect(
        (
          await post(`/operations/commissioning/${submitted.id}/decision`, lead, {
            decision: 'APPROVE',
          })
        ).status,
      ).toBe(200);

      const early = await post(`/operations/installations/${id}/status`, operations, {
        status: 'DONE',
      });
      expect(early.status).toBe(422);
      expect(early.body.code).toBe('ACCEPTANCE_REQUIRED');
      const noSignature = await post(`/operations/installations/${id}/acceptance`, operations, {
        acceptedByName: 'Maria da Silva',
        channel: 'FIELD',
      });
      expect(noSignature.status).toBe(422);
      expect(noSignature.body.code).toBe('NO_FIELD_SIGNATURE');
      const other = await post(`/operations/installations/${id}/acceptance`, operations, {
        acceptedByName: 'Maria',
        channel: 'OFFICE',
        workOrderId: randomUUID(),
      });
      expect(other.status).toBe(422);

      const accepted = await post(`/operations/installations/${id}/acceptance`, operations, {
        acceptedByName: 'Maria da Silva',
        channel: 'FIELD',
        workOrderId: orderId,
        note: 'Cliente conferiu a instalação',
      });
      expect(accepted.status).toBe(200);
      expect(accepted.body).toMatchObject({
        status: 'DONE',
        acceptance: {
          acceptedByName: 'Maria da Silva',
          channel: 'FIELD',
          note: 'Cliente conferiu a instalação',
          hasSignature: true,
        },
      });
      expect(accepted.body.doneAt).not.toBeNull();
      expect(accepted.body.history[0].reason).toMatch(/Aceite do cliente \(em campo\)/);
      expect(
        (await outboxOf(t, a.id, 'CustomerAccepted')).some(
          (e) => (e.payload as { installationId: string }).installationId === id,
        ),
      ).toBe(true);
      // Aceitar duas vezes não vale.
      expect(
        (
          await post(`/operations/installations/${id}/acceptance`, operations, {
            acceptedByName: 'Maria',
            channel: 'OFFICE',
          })
        ).status,
      ).toBe(422);
    });

    it('aceite registrado pelo escritório (sem assinatura de campo)', async () => {
      const { id, orderId } = await installed(true);
      await startCommissioning(orderId);
      await fillAll(await record(id));
      await post(`/operations/work-orders/${orderId}/complete`, installer.token);
      await post(`/operations/commissioning/${(await record(id)).id}/decision`, lead, {
        decision: 'APPROVE',
      });
      const accepted = await post(`/operations/installations/${id}/acceptance`, operations, {
        acceptedByName: 'João Cliente',
        channel: 'OFFICE',
      });
      expect(accepted.status).toBe(200);
      expect(accepted.body.acceptance).toMatchObject({ channel: 'OFFICE', hasSignature: false });
      const row = await t.prisma.system.installation.findUniqueOrThrow({ where: { id } });
      expect(row).toMatchObject({ acceptedByName: 'João Cliente', acceptedChannel: 'OFFICE' });
    });
  });

  describe('app de campo', () => {
    beforeAll(async () => {
      await activateRule(RULE);
    });

    it('a ordem de comissionamento traz os ensaios para o técnico; medições e condições entram pela sincronização', async () => {
      const { id, orderId } = await installed(true);
      const mine = (await get('/operations/field/work-orders', installer.token)).body.find(
        (o: { id: string }) => o.id === orderId,
      );
      expect(mine.commissioning).toMatchObject({
        status: 'IN_PROGRESS',
        level: 'STANDARD',
        provisional: false,
      });
      expect(mine.commissioning.tests.length).toBeGreaterThan(5);
      const voc = mine.commissioning.tests.filter((x: { code: string }) => x.code === 'STRING_VOC');
      await startCommissioning(orderId);
      const res = await sync(installer.token, [
        act(orderId, { type: 'CONDITIONS', conditions: { irradianceWm2: 800, moduleTempC: 45 } }),
        act(orderId, { type: 'MEASURE', testId: voc[0].id, value: 380 }),
        act(orderId, {
          type: 'MEASURE',
          testId: mine.commissioning.tests.find(
            (x: { code: string }) => x.code === 'GROUND_CONTINUITY',
          ).id,
          passed: true,
          note: 'Ok',
        }),
      ]);
      expect(res.body.map((r: { status: string }) => r.status)).toEqual([
        'APPLIED',
        'APPLIED',
        'APPLIED',
      ]);
      const rec = await record(id);
      expect(rec.conditions).toMatchObject({ irradianceWm2: 800, moduleTempC: 45 });
      expect(rec.tests.find((x: { id: string }) => x.id === voc[0].id)).toMatchObject({
        result: 'PASS',
        measuredValue: 380,
      });
      expect(rec.tests.find((x: { code: string }) => x.code === 'GROUND_CONTINUITY')).toMatchObject(
        { result: 'PASS', note: 'Ok', measuredById: installer.id },
      );
      // Reenviar o mesmo lote não repete.
      const again = await sync(installer.token, [
        act(orderId, { type: 'MEASURE', testId: voc[1].id, value: 3 }),
      ]);
      expect(again.body[0].status).toBe('APPLIED');
    });

    it('recusa: ordem que não é de comissionamento, ensaio de outra instalação, técnico fora da escala e registro já enviado', async () => {
      const first = await installed(true);
      const second = await installed(true);
      await startCommissioning(first.orderId);
      await startCommissioning(second.orderId);
      const recA = await record(first.id);
      const recB = await record(second.id);
      const testB = recB.tests[0];
      // Ensaio de outra instalação.
      const crossed = await sync(installer.token, [
        act(first.orderId, { type: 'MEASURE', testId: testB.id, passed: true }),
      ]);
      expect(crossed.body[0]).toMatchObject({
        status: 'REJECTED',
        message: expect.stringMatching(/não é do comissionamento desta ordem/),
      });
      // Técnico que não está escalado.
      const stranger = await sync(installer2.token, [
        act(first.orderId, { type: 'MEASURE', testId: recA.tests[0].id, passed: true }),
      ]);
      expect(stranger.body[0].status).toBe('REJECTED');
      // Ordem de instalação (não é de comissionamento).
      const inst = (await get(`/operations/installations/${first.id}`, operations)).body;
      const installOrder = inst.workOrders.find((o: { type: string }) => o.type === 'INSTALLATION');
      const wrongType = await sync(installer.token, [
        act(installOrder.id, { type: 'CONDITIONS', conditions: { moduleTempC: 30 } }),
      ]);
      expect(wrongType.body[0]).toMatchObject({
        status: 'REJECTED',
        message: expect.stringMatching(/não é de comissionamento/),
      });
      // Concluir sem os obrigatórios é recusado (a ordem continua em execução).
      const early = await sync(installer.token, [act(first.orderId, { type: 'COMPLETE' })]);
      expect(early.body[0]).toMatchObject({
        status: 'REJECTED',
        message: expect.stringMatching(/Faltam \d+ ensaio\(s\) obrigatório\(s\)/),
      });
      expect(
        (await t.prisma.system.workOrder.findUniqueOrThrow({ where: { id: first.orderId } }))
          .status,
      ).toBe('IN_PROGRESS');
      // Depois de enviado para revisão, novas medições são recusadas.
      await fillAll(recA);
      expect(
        (await sync(installer.token, [act(first.orderId, { type: 'COMPLETE' })])).body[0].status,
      ).toBe('APPLIED');
      const late = await sync(installer.token, [
        act(first.orderId, { type: 'MEASURE', testId: recA.tests[0].id, passed: false }),
      ]);
      expect(late.body[0]).toMatchObject({
        status: 'REJECTED',
        message: expect.stringMatching(/já foi enviado para revisão/),
      });
    });
  });

  describe('permissões e isolamento', () => {
    it('quem não tem permissão não vê; outra empresa não acessa', async () => {
      const { id } = await installed(true);
      const rec = await record(id);
      expect((await get(`/operations/installations/${id}/commissioning`, sdr)).status).toBe(403);
      expect((await get(`/operations/installations/${id}/commissioning`, seller)).status).toBe(403);
      expect((await get(`/operations/installations/${id}/commissioning`, lead)).status).toBe(200);
      expect(
        (await patch(`/operations/commissioning/${rec.id}`, lead, { level: 'EXTENDED' })).status,
      ).toBe(403); // líder técnico aprova, não preenche
      expect((await get(`/operations/commissioning/${rec.id}`, adminB)).status).toBe(404);
      expect(
        (
          await patch(`/operations/commissioning/tests/${rec.tests[0].id}`, adminB, {
            passed: true,
          })
        ).status,
      ).toBe(404);
      expect((await post(`/operations/installations/${id}/commissioning`, adminB)).status).toBe(
        404,
      );
    });

    it('abrir o comissionamento só depois da instalação concluída', async () => {
      const deal = await signedDeal(flow, manager);
      await publishAll();
      const inst = await t.prisma.system.installation.findFirstOrThrow({
        where: { projectId: deal.projectId },
      });
      const res = await post(`/operations/installations/${inst.id}/commissioning`, operations);
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('INSTALLATION_NOT_INSTALLED');
    });

    it('o registro guarda o modelo congelado: trocar a regra depois não muda o que valeu para ele', async () => {
      const { id } = await installed(true);
      const before = await record(id);
      await activateRule({
        tests: [
          { code: 'UNICO', label: 'Único ensaio', group: 'Novo', kind: 'CHECK', source: src },
        ],
      });
      const unchanged = await record(id);
      expect(unchanged.ruleRef).toBe(before.ruleRef);
      expect(unchanged.tests.length).toBe(before.tests.length);
      await activateRule(RULE);
    });
  });
});
