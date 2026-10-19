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
import { buildOpportunity, referenceQuote, type Flow } from './crm-flow';
import { auditOf, outboxOf } from './crm-support';

// Preço de referência R$ 19.800: margem de contribuição de 28,7% (ver margin.test.ts).
// Preço mínimo para 20% de margem: R$ 17.217,93.
describe('CRM · Cotação e Margin Guard (e2e)', () => {
  let t: TestApp;
  let a: SeededTenant;
  let b: SeededTenant;
  let flow: Flow;
  let owner: string;
  let admin: string;
  let manager: string;
  let seller: string;
  let sdr: string;
  let adminB: string;

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
  const del = (path: string, token: string) => t.http.delete(`${API}${path}`).set(bearer(token));
  const createQuote = (
    opportunityId: string,
    overrides: Record<string, unknown> = {},
    token = seller,
  ) => post(`/opportunities/${opportunityId}/quotes`, token, referenceQuote(overrides));
  const policy = (minMarginRate: number, extra: Record<string, unknown> = {}) =>
    post('/margin-policies', manager, { name: `Mínimo ${minMarginRate}`, minMarginRate, ...extra });
  const resetPolicies = () =>
    t.prisma.system.marginPolicy.updateMany({
      where: { tenantId: a.id },
      data: { deletedAt: new Date() },
    });

  beforeAll(async () => {
    t = await createTestApp();
    a = await seedTenant(t.prisma, 'quote');
    b = await seedTenant(t.prisma, 'quoteb');
    owner = await tokenFor(t.http, a.owner);
    admin = await tokenFor(t.http, a.admin);
    manager = await tokenFor(t.http, a.manager);
    seller = await tokenFor(t.http, a.salesperson);
    sdr = await tokenFor(t.http, a.sdr);
    adminB = await tokenFor(t.http, b.admin);
    flow = { t, tenant: a, seller, admin };
  });
  afterAll(() => t.close());

  describe('políticas de margem', () => {
    it('gestor cria, lista, altera e remove; tudo na auditoria', async () => {
      await resetPolicies();
      const created = await policy(0.2);
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({
        minMarginRate: 0.2,
        projectType: null,
        teamId: null,
        active: true,
      });
      expect(
        (await get('/margin-policies', seller)).body.map((p: { id: string }) => p.id),
      ).toContain(created.body.id);

      const updated = await patch(`/margin-policies/${created.body.id}`, manager, {
        minMarginRate: 0.25,
      });
      expect(updated.body.minMarginRate).toBe(0.25);
      expect((await del(`/margin-policies/${created.body.id}`, manager)).status).toBe(200);
      expect(
        (await get('/margin-policies', seller)).body.map((p: { id: string }) => p.id),
      ).not.toContain(created.body.id);

      for (const action of [
        'margin_policy.created',
        'margin_policy.updated',
        'margin_policy.deleted',
      ])
        expect((await auditOf(t, a.id, action)).some((l) => l.entityId === created.body.id)).toBe(
          true,
        );
    });

    it('valida a taxa (0 a 1) e o time; vendedor e SDR não gerenciam', async () => {
      expect((await policy(1.5)).status).toBe(422);
      expect((await policy(-0.1)).status).toBe(422);
      expect((await policy(0.2, { teamId: '0192b0c0-0000-7000-8000-00000000dead' })).status).toBe(
        404,
      );
      expect(
        (await post('/margin-policies', seller, { name: 'x', minMarginRate: 0.1 })).status,
      ).toBe(403);
      expect((await get('/margin-policies', sdr)).status).toBe(403);
      expect((await t.http.get(`${API}/margin-policies`)).status).toBe(401);
    });

    it('vale a mais específica: time + tipo > time > tipo > geral; empate fica com a mais recente', async () => {
      await resetPolicies();
      const general = (await policy(0.1)).body;
      const onGrid = (await policy(0.15, { projectType: 'ON_GRID' })).body;
      const ready = await buildOpportunity(flow);
      expect((await createQuote(ready.opportunityId)).body.policyId).toBe(onGrid.id);

      const team = (await policy(0.2, { teamId: a.teamId })).body;
      expect((await createQuote(ready.opportunityId)).body.policyId).toBe(team.id);
      const both = (await policy(0.3, { teamId: a.teamId, projectType: 'ON_GRID' })).body;
      expect((await createQuote(ready.opportunityId)).body.policyId).toBe(both.id);

      // Política para outro tipo de projeto não se aplica.
      await resetPolicies();
      await policy(0.4, { projectType: 'OFF_GRID' });
      const fallback = (await policy(0.1)).body;
      const quote = await createQuote(ready.opportunityId);
      expect(quote.body.policyId).toBe(fallback.id);
      expect(general.id).not.toBe(fallback.id);

      // Política desativada é ignorada.
      await patch(`/margin-policies/${fallback.id}`, manager, { active: false });
      expect((await get(`/quotes/${quote.body.id}`, seller)).body.marginStatus).toBe('NO_POLICY');
    });

    it('a outra empresa não enxerga nem altera as políticas', async () => {
      await resetPolicies();
      const mine = (await policy(0.2)).body;
      expect((await get('/margin-policies', adminB)).body).toEqual([]);
      expect(
        (await patch(`/margin-policies/${mine.id}`, adminB, { minMarginRate: 0.01 })).status,
      ).toBe(404);
      expect((await del(`/margin-policies/${mine.id}`, adminB)).status).toBe(404);
    });
  });

  describe('cotação', () => {
    it('cria a versão 1 com a margem calculada, vincula o último cálculo e registra tudo', async () => {
      await resetPolicies();
      await policy(0.2);
      const ready = await buildOpportunity(flow);
      const res = await createQuote(ready.opportunityId);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        version: 1,
        calculationSessionId: ready.calculationId,
        priceCents: 1_980_000,
        marginStatus: 'WITHIN_POLICY',
        minMarginRate: 0.2,
        approvalStatus: 'NONE',
        releasedForProposal: true,
        locked: false,
      });
      expect(res.body.margin).toMatchObject({
        materialsCents: 850_000,
        directCostsCents: 1_120_000,
        totalCostsCents: 1_411_000,
        contributionMarginCents: 569_000,
      });
      expect(res.body.margin.marginRate).toBeCloseTo(0.2874, 3);
      expect(res.body.minPriceCents).toBe(1_721_793);

      const second = await createQuote(ready.opportunityId, { title: 'Cenário B' });
      expect(second.body.version).toBe(2);
      const list = (await get(`/opportunities/${ready.opportunityId}/quotes`, seller)).body;
      expect(list.map((q: { version: number }) => q.version)).toEqual([2, 1]);

      expect(
        (await auditOf(t, a.id, 'quote.created')).some((l) => l.entityId === res.body.id),
      ).toBe(true);
      expect(
        (await outboxOf(t, a.id, 'QuoteCreated')).some((e) => e.projectCode === ready.projectCode),
      ).toBe(true);
      const timeline = (await get(`/opportunities/${ready.opportunityId}/timeline`, seller)).body;
      expect(
        timeline.some(
          (e: { type: string; summary: string }) =>
            e.type === 'QUOTE_CREATED' && /Cotação v1 criada: margem 28,7%/.test(e.summary),
        ),
      ).toBe(true);
    });

    it('sem política da empresa a cotação nasce sem situação e não é liberada', async () => {
      await resetPolicies();
      const ready = await buildOpportunity(flow);
      const res = await createQuote(ready.opportunityId);
      expect(res.body).toMatchObject({
        marginStatus: 'NO_POLICY',
        minMarginRate: null,
        minPriceCents: null,
        releasedForProposal: false,
      });
      const ask = await post(`/quotes/${res.body.id}/request-approval`, seller, {
        justification: 'Preciso de aprovação',
      });
      expect(ask.status).toBe(422);
      expect(ask.body.message).toMatch(/margem mínima/);
    });

    it('valida os dados: itens, taxas, preço e cálculo de outra oportunidade', async () => {
      const ready = await buildOpportunity(flow);
      expect((await createQuote(ready.opportunityId, { items: [] })).status).toBe(422);
      expect((await createQuote(ready.opportunityId, { priceCents: 0 })).status).toBe(422);
      expect(
        (
          await createQuote(ready.opportunityId, {
            costs: { ...referenceQuote().costs, taxRate: 1.5 },
          })
        ).status,
      ).toBe(422);
      const other = await buildOpportunity(flow);
      const wrong = await createQuote(ready.opportunityId, {
        calculationSessionId: other.calculationId,
      });
      expect(wrong.status).toBe(422);
      expect(wrong.body.message).toMatch(/não está vinculado/);
    });

    it('edita enquanto não estiver travada; mudança de números recalcula a margem e derruba a aprovação', async () => {
      await resetPolicies();
      await policy(0.4);
      const ready = await buildOpportunity(flow);
      const quote = (await createQuote(ready.opportunityId)).body;
      expect(quote.marginStatus).toBe('BELOW_POLICY');
      await post(`/quotes/${quote.id}/request-approval`, seller, {
        justification: 'Cliente estratégico, fecha hoje.',
      });
      const approvalId = (await get('/approvals?status=PENDING', manager)).body.data.find(
        (x: { quoteId: string }) => x.quoteId === quote.id,
      ).id;

      const edited = await patch(`/quotes/${quote.id}`, seller, { priceCents: 2_200_000 });
      expect(edited.status).toBe(200);
      expect(edited.body.priceCents).toBe(2_200_000);
      expect(edited.body.margin.marginRate).toBeGreaterThan(quote.margin.marginRate);
      expect(edited.body.approvalStatus).toBe('NONE');
      const old = (await get('/approvals?status=REJECTED', manager)).body.data.find(
        (x: { id: string }) => x.id === approvalId,
      );
      expect(old.decisionJustification).toMatch(/perdeu a validade/);

      // Só o título: não mexe em nada da aprovação.
      expect(
        (await patch(`/quotes/${quote.id}`, seller, { title: 'Novo título' })).body.title,
      ).toBe('Novo título');
      expect((await outboxOf(t, a.id, 'QuoteChanged')).length).toBeGreaterThan(0);
    });

    it('exclui cotação não travada; cotação some das listagens', async () => {
      const ready = await buildOpportunity(flow);
      const quote = (await createQuote(ready.opportunityId)).body;
      expect((await del(`/quotes/${quote.id}`, seller)).status).toBe(200);
      expect((await get(`/quotes/${quote.id}`, seller)).status).toBe(404);
      expect((await get(`/opportunities/${ready.opportunityId}/quotes`, seller)).body).toEqual([]);
    });

    it('oportunidade encerrada não recebe nem altera cotações', async () => {
      const ready = await buildOpportunity(flow);
      const quote = (await createQuote(ready.opportunityId)).body;
      await post(`/opportunities/${ready.opportunityId}/stage`, seller, {
        stage: 'LOST',
        lostReason: 'Desistiu',
      });
      expect((await createQuote(ready.opportunityId)).status).toBe(409);
      expect((await patch(`/quotes/${quote.id}`, seller, { title: 'x' })).status).toBe(409);
    });
  });

  describe('aprovação de margem (RF-CRM-053)', () => {
    it('abaixo do mínimo: vendedor pede, gestor aprova com justificativa, a cotação é liberada', async () => {
      await resetPolicies();
      await policy(0.35);
      const ready = await buildOpportunity(flow);
      const quote = (await createQuote(ready.opportunityId)).body;
      expect(quote).toMatchObject({ marginStatus: 'BELOW_POLICY', releasedForProposal: false });
      expect(
        (await outboxOf(t, a.id, 'MarginThresholdViolated')).some(
          (e) => e.projectCode === ready.projectCode,
        ),
      ).toBe(true);

      const asked = await post(`/quotes/${quote.id}/request-approval`, seller, {
        justification: 'Cliente estratégico, fecha hoje.',
      });
      expect(asked.status).toBe(200);
      expect(asked.body.approvalStatus).toBe('PENDING');
      expect(
        (
          await post(`/quotes/${quote.id}/request-approval`, seller, {
            justification: 'Cliente estratégico, fecha hoje.',
          })
        ).status,
      ).toBe(409);

      const pending = (await get('/approvals?status=PENDING', manager)).body;
      const approval = pending.data.find((x: { quoteId: string }) => x.quoteId === quote.id);
      expect(approval).toMatchObject({
        type: 'MARGIN',
        status: 'PENDING',
        quoteVersion: 1,
        projectCode: ready.projectCode,
        minMarginRate: 0.35,
        requestedByName: expect.any(String),
      });
      expect(approval.marginRate).toBeCloseTo(0.2874, 3);

      const decided = await post(`/approvals/${approval.id}/decide`, manager, {
        approve: true,
        justification: 'Aprovado: volume compensa.',
      });
      expect(decided.status).toBe(200);
      expect(decided.body).toMatchObject({
        status: 'APPROVED',
        decidedByName: expect.any(String),
        decisionJustification: 'Aprovado: volume compensa.',
      });
      const after = (await get(`/quotes/${quote.id}`, seller)).body;
      expect(after).toMatchObject({ approvalStatus: 'APPROVED', releasedForProposal: true });

      expect(
        (
          await post(`/approvals/${approval.id}/decide`, manager, {
            approve: false,
            justification: 'Mudei de ideia agora',
          })
        ).status,
      ).toBe(409);
      for (const action of ['approval.requested', 'approval.approved'])
        expect((await auditOf(t, a.id, action)).length).toBeGreaterThan(0);
      expect((await outboxOf(t, a.id, 'MarginApprovalRequested')).length).toBeGreaterThan(0);
      expect((await outboxOf(t, a.id, 'MarginApprovalDecided')).length).toBeGreaterThan(0);
    });

    it('recusa mantém a cotação bloqueada; dá para pedir de novo depois de recusada', async () => {
      await resetPolicies();
      await policy(0.35);
      const ready = await buildOpportunity(flow);
      const quote = (await createQuote(ready.opportunityId)).body;
      await post(`/quotes/${quote.id}/request-approval`, seller, {
        justification: 'Primeira tentativa de aprovação',
      });
      const approval = (await get('/approvals?status=PENDING', manager)).body.data.find(
        (x: { quoteId: string }) => x.quoteId === quote.id,
      );
      const rejected = await post(`/approvals/${approval.id}/decide`, owner, {
        approve: false,
        justification: 'Margem baixa demais',
      });
      expect(rejected.body.status).toBe('REJECTED');
      expect((await get(`/quotes/${quote.id}`, seller)).body).toMatchObject({
        approvalStatus: 'REJECTED',
        releasedForProposal: false,
      });
      const again = await post(`/quotes/${quote.id}/request-approval`, seller, {
        justification: 'Segunda tentativa, nova negociação',
      });
      expect(again.status).toBe(200);
    });

    it('dentro da política não precisa de aprovação', async () => {
      await resetPolicies();
      await policy(0.2);
      const ready = await buildOpportunity(flow);
      const quote = (await createQuote(ready.opportunityId)).body;
      const res = await post(`/quotes/${quote.id}/request-approval`, seller, {
        justification: 'Só por garantia',
      });
      expect(res.status).toBe(409);
    });

    it('segregação de funções: quem pediu não decide (gestor); o proprietário pode; vendedor e admin não aprovam', async () => {
      await resetPolicies();
      await policy(0.35);
      const ready = await buildOpportunity(flow);
      const quote = (await createQuote(ready.opportunityId, {}, manager)).body;
      await post(`/quotes/${quote.id}/request-approval`, manager, {
        justification: 'Pedido do próprio gestor',
      });
      const approval = (await get('/approvals?status=PENDING', manager)).body.data.find(
        (x: { quoteId: string }) => x.quoteId === quote.id,
      );
      const self = await post(`/approvals/${approval.id}/decide`, manager, {
        approve: true,
        justification: 'Aprovando o meu pedido',
      });
      expect(self.status).toBe(403);
      expect(self.body.message).toMatch(/não pode decidir o próprio pedido/);
      expect(
        (
          await post(`/approvals/${approval.id}/decide`, seller, {
            approve: true,
            justification: 'Aprovando como vendedor',
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await post(`/approvals/${approval.id}/decide`, admin, {
            approve: true,
            justification: 'Aprovando como admin',
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await post(`/approvals/${approval.id}/decide`, owner, {
            approve: true,
            justification: 'Aprovado pelo proprietário',
          })
        ).status,
      ).toBe(200);
    });

    it('a justificativa é obrigatória (10+ caracteres)', async () => {
      await resetPolicies();
      await policy(0.35);
      const ready = await buildOpportunity(flow);
      const quote = (await createQuote(ready.opportunityId)).body;
      expect(
        (await post(`/quotes/${quote.id}/request-approval`, seller, { justification: 'curto' }))
          .status,
      ).toBe(422);
      await post(`/quotes/${quote.id}/request-approval`, seller, {
        justification: 'Justificativa suficiente',
      });
      const approval = (await get('/approvals?status=PENDING', manager)).body.data.find(
        (x: { quoteId: string }) => x.quoteId === quote.id,
      );
      expect(
        (
          await post(`/approvals/${approval.id}/decide`, manager, {
            approve: true,
            justification: 'ok',
          })
        ).status,
      ).toBe(422);
    });

    it('mudar a política depois não reescreve a cotação: a situação mostrada acompanha a política de hoje', async () => {
      await resetPolicies();
      const loose = (await policy(0.2)).body;
      const ready = await buildOpportunity(flow);
      const quote = (await createQuote(ready.opportunityId)).body;
      expect(quote.marginStatus).toBe('WITHIN_POLICY');
      await patch(`/margin-policies/${loose.id}`, manager, { minMarginRate: 0.5 });
      expect((await get(`/quotes/${quote.id}`, seller)).body).toMatchObject({
        marginStatus: 'BELOW_POLICY',
        releasedForProposal: false,
      });
      expect(
        (await t.prisma.system.quote.findUniqueOrThrow({ where: { id: quote.id } })).marginStatus,
      ).toBe('WITHIN_POLICY');
    });

    it('a fila de aprovações é só para quem aprova e é isolada por empresa', async () => {
      expect((await get('/approvals', seller)).status).toBe(403);
      expect((await get('/approvals', sdr)).status).toBe(403);
      const ownerB = await tokenFor(t.http, b.owner);
      expect((await get('/approvals', ownerB)).body.data).toEqual([]);
      const mine = (await get('/approvals', manager)).body.data;
      const theirs = (await get('/approvals', owner)).body.data;
      expect(mine.length).toBeGreaterThan(0);
      expect(theirs.length).toBe(mine.length);
    });
  });

  describe('permissões e isolamento', () => {
    it('SDR não vê cotações; a outra empresa não vê nem altera', async () => {
      const ready = await buildOpportunity(flow);
      const quote = (await createQuote(ready.opportunityId)).body;
      expect((await get(`/opportunities/${ready.opportunityId}/quotes`, sdr)).status).toBe(403);
      expect((await createQuote(ready.opportunityId, {}, sdr)).status).toBe(403);
      expect((await get(`/quotes/${quote.id}`, adminB)).status).toBe(404);
      expect((await patch(`/quotes/${quote.id}`, adminB, { title: 'x' })).status).toBe(404);
      expect((await del(`/quotes/${quote.id}`, adminB)).status).toBe(404);
      expect(
        (
          await post(`/quotes/${quote.id}/request-approval`, adminB, {
            justification: 'Justificativa longa',
          })
        ).status,
      ).toBe(404);
      expect((await createQuote(ready.opportunityId, {}, adminB)).status).toBe(404);
    });
  });
});
