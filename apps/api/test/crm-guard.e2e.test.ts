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
import { buildOpportunity, consistentCalcInput, type Flow } from './crm-flow';
import { auditOf, outboxOf, tokenWithRole } from './crm-support';

describe('CRM · Triagem (Project Guard) (e2e)', () => {
  let t: TestApp;
  let a: SeededTenant;
  let b: SeededTenant;
  let flow: Flow;
  let admin: string;
  let manager: string;
  let seller: string;
  let sdr: string;
  let engineering: string;
  let adminB: string;
  let publish: () => Promise<number>;

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
  const codes = (evaluation: { checks: { code: string }[] }) =>
    evaluation.checks.map((c) => c.code);
  const evaluate = (id: string, token = seller) =>
    post(`/opportunities/${id}/guard/evaluate`, token);
  const stage = (id: string, to: string, token = seller) =>
    post(`/opportunities/${id}/stage`, token, { stage: to });

  beforeAll(async () => {
    t = await createTestApp();
    const { OutboxPublisher } = await import('../src/platform/events/outbox-publisher.service');
    const publisher = t.app.get(OutboxPublisher);
    publish = () => publisher.publishPending(500, a.id);
    a = await seedTenant(t.prisma, 'guard');
    b = await seedTenant(t.prisma, 'guardb');
    admin = await tokenFor(t.http, a.admin);
    manager = await tokenFor(t.http, a.manager);
    seller = await tokenFor(t.http, a.salesperson);
    sdr = await tokenFor(t.http, a.sdr);
    adminB = await tokenFor(t.http, b.admin);
    engineering = (await tokenWithRole(t, a, 'ENGINEERING')).token;
    flow = { t, tenant: a, seller, admin };
  });
  afterAll(() => t.close());

  describe('avaliação', () => {
    it('sem nada avaliado, a visão vem vazia; sem cálculo a triagem é vermelha e rastreável', async () => {
      const ready = await buildOpportunity(flow, { withCalculation: false });
      expect((await get(`/opportunities/${ready.opportunityId}/guard`, seller)).body).toEqual({
        current: null,
        history: [],
      });

      const res = await evaluate(ready.opportunityId);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        version: 1,
        status: 'RED',
        needsHumanReview: true,
        stale: false,
        releasedForQuote: false,
        algorithmVersion: 'guard-1.0.0',
        ruleSetRef: 'builtin@1',
      });
      expect(codes(res.body)).toContain('NO_CALCULATION');
      expect(res.body.inputs.calculationSessionId).toBeNull();
      expect(res.body.inputs.billSnapshotId).toBeTruthy();
      expect(res.body.createdByName).toContain('vendedor');

      expect(
        (await auditOf(t, a.id, 'guard.evaluated')).some((l) => l.entityId === res.body.id),
      ).toBe(true);
      expect(
        (await outboxOf(t, a.id, 'ProjectGuardEvaluated')).some(
          (e) => e.projectCode === ready.projectCode,
        ),
      ).toBe(true);
      const timeline = (await get(`/opportunities/${ready.opportunityId}/timeline`, seller)).body;
      expect(timeline[0]).toMatchObject({ type: 'GUARD_EVALUATED' });
      expect(timeline[0].summary).toMatch(/Triagem v1: vermelha/);
    });

    it('oportunidade completa e coerente: verde, sem alertas relevantes, liberada para a cotação', async () => {
      const ready = await buildOpportunity(flow);
      const res = await evaluate(ready.opportunityId);
      expect(res.body.status).toBe('GREEN');
      expect(res.body.checks.filter((c: { severity: string }) => c.severity !== 'INFO')).toEqual(
        [],
      );
      expect(res.body).toMatchObject({
        releasedForQuote: true,
        needsHumanReview: false,
        missingFields: [],
      });
      expect(res.body.inputs.calculationSessionId).toBe(ready.calculationId);
    });

    it('reavaliar sem mudanças devolve a mesma avaliação (sem criar versão nova)', async () => {
      const ready = await buildOpportunity(flow);
      const first = await evaluate(ready.opportunityId);
      const again = await evaluate(ready.opportunityId);
      expect(again.body.id).toBe(first.body.id);
      expect(again.body.version).toBe(1);
      expect(
        (await get(`/opportunities/${ready.opportunityId}/guard`, seller)).body.history,
      ).toEqual([]);
    });

    it('sem fatura validada fica amarela, com o que falta', async () => {
      const ready = await buildOpportunity(flow, { withBill: false });
      const res = await evaluate(ready.opportunityId);
      expect(res.body.status).toBe('YELLOW');
      expect(codes(res.body)).toContain('BILL_NOT_VALIDATED');
      expect(res.body.missingFields).toContain('fatura.validada');
      expect(res.body.releasedForQuote).toBe(false);
    });

    it('levantamento incompleto, aterramento inadequado e visita pendente aparecem como pontos de atenção', async () => {
      const ready = await buildOpportunity(flow, {
        intake: { groundingAdequate: false, technicalVisitRequired: true },
      });
      await patch(`/sites/${ready.siteId}`, seller, {
        intake: {
          roofType: 'CERAMIC',
          roofAzimuthDegrees: 0,
          tiltDegrees: 15,
          shading: 'NONE',
          availableAreaM2: 80,
          entryBreakerAmps: 63,
          groundingAdequate: false,
          technicalVisitRequired: true,
        },
      });
      // o intake mudou depois do cálculo? Não: os campos usados no cálculo são os mesmos.
      const res = await evaluate(ready.opportunityId);
      expect(res.body.status).toBe('YELLOW');
      expect(codes(res.body)).toEqual(
        expect.arrayContaining(['GROUNDING_INADEQUATE', 'TECHNICAL_VISIT_PENDING']),
      );
    });

    it('pedido de engenharia aberto pelo semáforo amarelo exige revisão de engenharia', async () => {
      const ready = await buildOpportunity(flow);
      const ctx = (await get(`/opportunities/${ready.opportunityId}/calculation-context`, seller))
        .body;
      await post(`/opportunities/${ready.opportunityId}/calculations`, seller, {
        input: {
          ...consistentCalcInput({ ...ctx, consumptionMonthlyKwh: ctx.consumptionMonthlyKwh }),
          customerGroup: 'A',
        },
      });
      const res = await evaluate(ready.opportunityId);
      expect(res.body.needsEngineeringReview).toBe(true);
      expect(codes(res.body)).toEqual(
        expect.arrayContaining(['CALCULATION_YELLOW', 'ENGINEERING_PENDING']),
      );
      expect(res.body.status).not.toBe('GREEN');
    });

    it('não reavalia oportunidade encerrada', async () => {
      const ready = await buildOpportunity(flow);
      await post(`/opportunities/${ready.opportunityId}/stage`, seller, {
        stage: 'LOST',
        lostReason: 'Desistiu',
      });
      expect((await evaluate(ready.opportunityId)).status).toBe(409);
    });
  });

  describe('invalidação e histórico (RF-GUARD-006)', () => {
    it('mudar o levantamento do imóvel invalida a avaliação vigente e a nova mostra o que mudou', async () => {
      const ready = await buildOpportunity(flow);
      const v1 = await evaluate(ready.opportunityId);
      expect(v1.body.status).toBe('GREEN');

      await patch(`/sites/${ready.siteId}`, seller, {
        intake: {
          roofType: 'CERAMIC',
          roofAzimuthDegrees: 0,
          tiltDegrees: 30,
          shading: 'NONE',
          availableAreaM2: 80,
          entryBreakerAmps: 63,
          groundingAdequate: true,
        },
      });
      // Mesmo antes de o evento chegar, a consulta já sabe que as premissas mudaram.
      let current = (await get(`/opportunities/${ready.opportunityId}/guard`, seller)).body.current;
      expect(current).toMatchObject({ id: v1.body.id, stale: true, releasedForQuote: false });

      await publish();
      current = (await get(`/opportunities/${ready.opportunityId}/guard`, seller)).body.current;
      expect(current.invalidatedAt).toBeTruthy();
      expect(current.invalidatedReason).toBe('site_intake_changed');

      const v2 = await evaluate(ready.opportunityId);
      expect(v2.body).toMatchObject({ version: 2, status: 'RED', stale: false });
      expect(
        v2.body.checks.find((c: { code: string }) => c.code === 'CALCULATION_STALE').message,
      ).toContain('a inclinação');

      const overview = (await get(`/opportunities/${ready.opportunityId}/guard`, seller)).body;
      expect(overview.current.version).toBe(2);
      expect(overview.history.map((h: { version: number }) => h.version)).toEqual([1]);
      expect(overview.history[0].stale).toBe(true);
    });

    it('um novo cálculo ou uma nova confirmação da fatura também invalidam (via eventos)', async () => {
      const ready = await buildOpportunity(flow);
      await evaluate(ready.opportunityId);
      const ctx = (await get(`/opportunities/${ready.opportunityId}/calculation-context`, seller))
        .body;
      await post(`/opportunities/${ready.opportunityId}/calculations`, seller, {
        input: consistentCalcInput(ctx),
      });
      await publish();
      const current = (await get(`/opportunities/${ready.opportunityId}/guard`, seller)).body
        .current;
      expect(current.invalidatedReason).toBe('novo cálculo vinculado');
      expect(current.stale).toBe(true);

      const fresh = await evaluate(ready.opportunityId);
      expect(fresh.body).toMatchObject({ version: 2, status: 'GREEN' });
      const bill = (await get(`/energy-bills?opportunityId=${ready.opportunityId}`, seller))
        .body[0];
      const months = Array.from({ length: 12 }, (_, i) => ({
        month: `2026-${String(i + 1).padStart(2, '0')}`,
        kwh: 500,
      }));
      await post(`/energy-bills/${bill.id}/validate`, seller, {
        fields: { ucNumber: '12345678-9', consumptionHistory: months },
      });
      await publish();
      expect(
        (await get(`/opportunities/${ready.opportunityId}/guard`, seller)).body.current
          .invalidatedReason,
      ).toBe('fatura de energia confirmada novamente');
    });

    it('o relatório é imutável no banco: só a invalidação pode ser gravada, e uma vez', async () => {
      const ready = await buildOpportunity(flow);
      const v1 = (await evaluate(ready.opportunityId)).body;
      await expect(
        t.prisma.system.triageSnapshot.update({ where: { id: v1.id }, data: { status: 'RED' } }),
      ).rejects.toThrow(/imutável/);
      await expect(
        t.prisma.system.triageSnapshot.update({
          where: { id: v1.id },
          data: { checks: [{ code: 'X' }] },
        }),
      ).rejects.toThrow(/imutável/);
      await expect(t.prisma.system.triageSnapshot.delete({ where: { id: v1.id } })).rejects.toThrow(
        /imutável/,
      );

      await t.prisma.system.triageSnapshot.update({
        where: { id: v1.id },
        data: { invalidatedAt: new Date(), invalidatedReason: 'teste' },
      });
      await expect(
        t.prisma.system.triageSnapshot.update({
          where: { id: v1.id },
          data: { invalidatedReason: 'outra' },
        }),
      ).rejects.toThrow(/já foi invalidada/);
    });
  });

  describe('trava de etapa: cotação só com a triagem liberada', () => {
    it('sem avaliação, vermelha ou desatualizada: não entra em Cotação, com a explicação', async () => {
      const ready = await buildOpportunity(flow);
      const none = await stage(ready.opportunityId, 'QUOTING');
      expect(none.status).toBe(422);
      expect(none.body).toMatchObject({ code: 'GUARD_REQUIRED', data: { status: null } });
      expect(none.body.message).toMatch(/Avalie a triagem/);

      const red = await buildOpportunity(flow, { withCalculation: false });
      await evaluate(red.opportunityId);
      const blocked = await stage(red.opportunityId, 'QUOTING');
      expect(blocked.status).toBe(422);
      expect(blocked.body.message).toMatch(/A triagem está vermelha/);
      expect(blocked.body.data.status).toBe('RED');

      await evaluate(ready.opportunityId);
      await patch(`/sites/${ready.siteId}`, seller, {
        intake: {
          roofType: 'CERAMIC',
          roofAzimuthDegrees: 90,
          tiltDegrees: 15,
          shading: 'NONE',
          availableAreaM2: 80,
          entryBreakerAmps: 63,
          groundingAdequate: true,
        },
      });
      const stale = await stage(ready.opportunityId, 'QUOTING');
      expect(stale.status).toBe(422);
      expect(stale.body.message).toMatch(/premissas mudaram/);
    });

    it('triagem verde libera a cotação; a etapa muda', async () => {
      const ready = await buildOpportunity(flow);
      await evaluate(ready.opportunityId);
      const res = await stage(ready.opportunityId, 'QUOTING');
      expect(res.status).toBe(200);
      expect(res.body.stage).toBe('QUOTING');
    });
  });

  describe('liberação formal (RF-GUARD-004)', () => {
    it('gestor libera uma triagem amarela com justificativa; fica na auditoria e libera a cotação', async () => {
      const ready = await buildOpportunity(flow, { withBill: false });
      const yellow = (await evaluate(ready.opportunityId)).body;
      expect((await stage(ready.opportunityId, 'QUOTING')).status).toBe(422);

      const res = await post(`/opportunities/${ready.opportunityId}/guard/override`, manager, {
        evaluationId: yellow.id,
        justification: 'Cliente enviará a fatura na visita; consumo conferido por telefone.',
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ releasedForQuote: true, status: 'YELLOW' });
      expect(res.body.override).toMatchObject({
        decidedByName: expect.stringContaining('manager'),
        justification: expect.stringContaining('Cliente enviará'),
      });

      expect(
        (await auditOf(t, a.id, 'guard.overridden')).some((l) => l.entityId === yellow.id),
      ).toBe(true);
      expect(
        (await outboxOf(t, a.id, 'ProjectGuardOverridden')).some(
          (e) => e.projectCode === ready.projectCode,
        ),
      ).toBe(true);
      expect(
        (await get(`/opportunities/${ready.opportunityId}/timeline`, seller)).body[0].type,
      ).toBe('GUARD_OVERRIDDEN');
      expect((await stage(ready.opportunityId, 'QUOTING')).status).toBe(200);
    });

    it('vermelho também pode ser liberado, mas só por quem tem a permissão (vendedor e SDR não)', async () => {
      const ready = await buildOpportunity(flow, { withCalculation: false });
      const red = (await evaluate(ready.opportunityId)).body;
      const body = {
        evaluationId: red.id,
        justification: 'Cálculo será feito pela engenharia depois da vistoria.',
      };
      expect(
        (await post(`/opportunities/${ready.opportunityId}/guard/override`, seller, body)).status,
      ).toBe(403);
      expect(
        (await post(`/opportunities/${ready.opportunityId}/guard/override`, sdr, body)).status,
      ).toBe(403);
      const ok = await post(`/opportunities/${ready.opportunityId}/guard/override`, admin, body);
      expect(ok.status).toBe(200);
      expect(ok.body.status).toBe('RED');
      expect(ok.body.releasedForQuote).toBe(true);
    });

    it('exige justificativa de 10+ caracteres; recusa verde, avaliação antiga, desatualizada ou já liberada', async () => {
      const ready = await buildOpportunity(flow, { withBill: false });
      const yellow = (await evaluate(ready.opportunityId)).body;
      const path = `/opportunities/${ready.opportunityId}/guard/override`;
      expect(
        (await post(path, manager, { evaluationId: yellow.id, justification: 'curto' })).status,
      ).toBe(422);
      expect(
        (
          await post(path, manager, {
            evaluationId: '0192b0c0-0000-7000-8000-00000000dead',
            justification: 'Justificativa longa o bastante',
          })
        ).status,
      ).toBe(409);
      expect(
        (
          await post(path, manager, {
            evaluationId: yellow.id,
            justification: 'Justificativa longa o bastante',
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await post(path, manager, {
            evaluationId: yellow.id,
            justification: 'Justificativa longa o bastante',
          })
        ).status,
      ).toBe(409);

      const green = await buildOpportunity(flow);
      const greenEval = (await evaluate(green.opportunityId)).body;
      expect(
        (
          await post(`/opportunities/${green.opportunityId}/guard/override`, manager, {
            evaluationId: greenEval.id,
            justification: 'Justificativa longa o bastante',
          })
        ).status,
      ).toBe(409);

      const stale = await buildOpportunity(flow, { withBill: false });
      const staleEval = (await evaluate(stale.opportunityId)).body;
      await patch(`/sites/${stale.siteId}`, seller, {
        intake: {
          roofType: 'CERAMIC',
          roofAzimuthDegrees: 180,
          tiltDegrees: 15,
          shading: 'NONE',
          availableAreaM2: 80,
          entryBreakerAmps: 63,
          groundingAdequate: true,
        },
      });
      const late = await post(`/opportunities/${stale.opportunityId}/guard/override`, manager, {
        evaluationId: staleEval.id,
        justification: 'Justificativa longa o bastante',
      });
      expect(late.status).toBe(409);
      expect(late.body.message).toMatch(/premissas mudaram/);
    });

    it('a liberação some quando as premissas mudam (vale só para aquela avaliação)', async () => {
      const ready = await buildOpportunity(flow, { withBill: false });
      const yellow = (await evaluate(ready.opportunityId)).body;
      await post(`/opportunities/${ready.opportunityId}/guard/override`, manager, {
        evaluationId: yellow.id,
        justification: 'Justificativa longa o bastante',
      });
      await patch(`/sites/${ready.siteId}`, seller, {
        intake: {
          roofType: 'CERAMIC',
          roofAzimuthDegrees: 0,
          tiltDegrees: 15,
          shading: 'NONE',
          availableAreaM2: 120,
          entryBreakerAmps: 63,
          groundingAdequate: true,
        },
      });
      const current = (await get(`/opportunities/${ready.opportunityId}/guard`, seller)).body
        .current;
      expect(current.stale).toBe(true);
      expect(current.releasedForQuote).toBe(false);
      expect((await stage(ready.opportunityId, 'QUOTING')).status).toBe(422);
    });

    it('a liberação é imutável no banco', async () => {
      const ready = await buildOpportunity(flow, { withBill: false });
      const yellow = (await evaluate(ready.opportunityId)).body;
      const res = await post(`/opportunities/${ready.opportunityId}/guard/override`, manager, {
        evaluationId: yellow.id,
        justification: 'Justificativa longa o bastante',
      });
      const row = await t.prisma.system.triageOverride.findFirstOrThrow({
        where: { id: res.body.override.id },
      });
      await expect(
        t.prisma.system.triageOverride.update({
          where: { id: row.id },
          data: { justification: 'adulterada' },
        }),
      ).rejects.toThrow(/imutável/);
      await expect(
        t.prisma.system.triageOverride.delete({ where: { id: row.id } }),
      ).rejects.toThrow(/imutável/);
    });
  });

  describe('permissões e isolamento', () => {
    it('SDR não vê a triagem; engenharia só consulta; sem token é 401', async () => {
      const ready = await buildOpportunity(flow);
      await evaluate(ready.opportunityId);
      expect((await get(`/opportunities/${ready.opportunityId}/guard`, sdr)).status).toBe(403);
      expect((await get(`/opportunities/${ready.opportunityId}/guard`, engineering)).status).toBe(
        200,
      );
      expect((await evaluate(ready.opportunityId, engineering)).status).toBe(403);
      expect((await t.http.get(`${API}/opportunities/${ready.opportunityId}/guard`)).status).toBe(
        401,
      );
    });

    it('a outra empresa não vê, avalia nem libera', async () => {
      const ready = await buildOpportunity(flow, { withBill: false });
      const yellow = (await evaluate(ready.opportunityId)).body;
      expect((await get(`/opportunities/${ready.opportunityId}/guard`, adminB)).status).toBe(404);
      expect((await evaluate(ready.opportunityId, adminB)).status).toBe(404);
      expect(
        (
          await post(`/opportunities/${ready.opportunityId}/guard/override`, adminB, {
            evaluationId: yellow.id,
            justification: 'Justificativa longa o bastante',
          })
        ).status,
      ).toBe(404);
    });
  });
});
