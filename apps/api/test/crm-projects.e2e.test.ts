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
import { auditOf, outboxOf, tokenWithRole } from './crm-support';

describe('CRM · Projeto e homologação (e2e)', () => {
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
  let techLead: { token: string; id: string };
  let operations: string;
  let installer: string;
  let engineering: { token: string; id: string };

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
  const status = (
    id: string,
    to: string,
    extra: Record<string, unknown> = {},
    token = operations,
  ) => post(`/projects/${id}/status`, token, { status: to, ...extra });
  const project = async (id: string) => (await get(`/projects/${id}`, owner)).body;
  const completeRequired = async (id: string) => {
    const p = await project(id);
    for (const item of p.checklist.filter(
      (i: { required: boolean; status: string }) => i.required && i.status === 'PENDING',
    ))
      expect(
        (await patch(`/projects/${id}/checklist/${item.id}`, operations, { status: 'DONE' }))
          .status,
      ).toBe(200);
  };
  const publishAll = async () => {
    const { OutboxPublisher } = await import('../src/platform/events/outbox-publisher.service');
    await t.app.get(OutboxPublisher).publishPending(500, a.id);
  };

  beforeAll(async () => {
    t = await createTestApp();
    a = await seedTenant(t.prisma, 'project');
    b = await seedTenant(t.prisma, 'projectb');
    owner = await tokenFor(t.http, a.owner);
    admin = await tokenFor(t.http, a.admin);
    manager = await tokenFor(t.http, a.manager);
    seller = await tokenFor(t.http, a.salesperson);
    sdr = await tokenFor(t.http, a.sdr);
    adminB = await tokenFor(t.http, b.admin);
    techLead = await tokenWithRole(t, a, 'TECHNICAL_LEAD');
    engineering = await tokenWithRole(t, a, 'ENGINEERING');
    operations = (await tokenWithRole(t, a, 'OPERATIONS')).token;
    installer = (await tokenWithRole(t, a, 'INSTALLER')).token;
    flow = { t, tenant: a, seller, admin };
    await ensureMarginPolicy(flow, manager);
  });
  afterAll(() => t.close());

  describe('criação e checklist (base EnergIF 2023)', () => {
    it('o projeto nasce com o checklist da base, a fonte de cada item e o aviso de que não foi revisado', async () => {
      const deal = await signedDeal(flow, manager);
      const p = await project(deal.projectId);
      expect(p).toMatchObject({
        projectCode: deal.projectCode,
        status: 'DOCUMENTATION',
        pendingRequired: 6,
        responsibleId: null,
      });
      expect(p.rules).toMatchObject({ ref: 'energif-2023@1', scope: 'BUILT_IN', reviewedBy: null });
      expect(p.rules.notes).toMatch(/2023/);
      const codes = p.checklist.map((i: { code: string }) => i.code);
      expect(codes).toEqual(
        expect.arrayContaining([
          'FORM',
          'ART_TRT',
          'SINGLE_LINE',
          'INVERTER_CERT',
          'POWER_OF_ATTORNEY',
          'MEMORIAL',
          'SCHEDULE',
          'CREDIT_UCS',
        ]),
      );
      for (const item of p.checklist) expect(item.source).toMatch(/EnergIF/);
      // Microgeração: o cronograma não se aplica.
      expect(p.generationClass).toBe('MICRO');
      expect(p.checklist.find((i: { code: string }) => i.code === 'SCHEDULE')).toMatchObject({
        status: 'NOT_APPLICABLE',
        required: true,
      });
      expect(
        p.checklist.filter(
          (i: { required: boolean; status: string }) => i.required && i.status === 'PENDING',
        ),
      ).toHaveLength(6);
      expect(p.deadlineSuggestions.map((d: { code: string }) => d.code)).toEqual([
        'ACCESS_OPINION',
      ]);
      expect(p.deadlineSuggestions[0].source).toMatch(/EF-R06/);
    });

    it('lista e busca por situação e texto; consulta pela oportunidade', async () => {
      const deal = await signedDeal(flow, manager, { name: 'Cliente Busca Única' });
      const list = (await get('/projects?search=Busca%20%C3%9Anica', owner)).body;
      expect(list.data.map((x: { id: string }) => x.id)).toEqual([deal.projectId]);
      expect(list.data[0]).toMatchObject({
        pendingRequired: 6,
        overdue: false,
        status: 'DOCUMENTATION',
      });
      expect((await get('/projects?status=APPROVED&search=Busca', owner)).body.data).toEqual([]);
      expect((await get(`/opportunities/${deal.opportunityId}/project`, owner)).body.id).toBe(
        deal.projectId,
      );
      expect((await get('/projects?status=XYZ', owner)).status).toBe(422);
    });
  });

  describe('acompanhamento', () => {
    it('responsável técnico: só engenharia/responsável técnico; operação atribui', async () => {
      const deal = await signedDeal(flow, manager);
      expect(
        (await patch(`/projects/${deal.projectId}`, operations, { responsibleId: techLead.id }))
          .body.responsibleName,
      ).toMatch(/TECHNICAL_LEAD/);
      expect(
        (
          await patch(`/projects/${deal.projectId}`, operations, {
            responsibleId: a.salesperson.id,
          })
        ).status,
      ).toBe(422);
      expect(
        (
          await patch(`/projects/${deal.projectId}`, operations, {
            responsibleId: '0192b0c0-0000-7000-8000-00000000dead',
          })
        ).status,
      ).toBe(422);
      expect(
        (await patch(`/projects/${deal.projectId}`, operations, { responsibleId: engineering.id }))
          .status,
      ).toBe(200);
      expect(
        (await patch(`/projects/${deal.projectId}`, operations, { responsibleId: null })).body
          .responsibleId,
      ).toBeNull();
      expect(
        (await patch(`/projects/${deal.projectId}`, installer, { responsibleId: techLead.id }))
          .status,
      ).toBe(403);
      expect(
        (await get(`/projects?responsibleId=${techLead.id}`, owner)).body.data.every(
          (x: { id: string }) => x.id !== deal.projectId,
        ),
      ).toBe(true);
    });

    it('itens: concluir registra quem e quando; dispensar exige observação; documento precisa existir', async () => {
      const deal = await signedDeal(flow, manager);
      const p = await project(deal.projectId);
      const item = p.checklist.find((i: { code: string }) => i.code === 'MEMORIAL');
      const done = await patch(`/projects/${deal.projectId}/checklist/${item.id}`, operations, {
        status: 'DONE',
        note: 'Memorial revisado',
      });
      const updated = done.body.checklist.find((i: { code: string }) => i.code === 'MEMORIAL');
      expect(updated).toMatchObject({
        status: 'DONE',
        note: 'Memorial revisado',
        completedByName: expect.stringContaining('OPERATIONS'),
      });
      expect(updated.completedAt).toBeTruthy();
      expect(done.body.pendingRequired).toBe(5);

      const waive = await patch(`/projects/${deal.projectId}/checklist/${item.id}`, operations, {
        status: 'WAIVED',
        note: '',
      });
      expect(waive.status).toBe(422);
      const ok = await patch(`/projects/${deal.projectId}/checklist/${item.id}`, operations, {
        status: 'WAIVED',
        note: 'A distribuidora dispensou por e-mail',
      });
      expect(ok.body.pendingRequired).toBe(5);
      const reopened = await patch(`/projects/${deal.projectId}/checklist/${item.id}`, operations, {
        status: 'PENDING',
      });
      expect(
        reopened.body.checklist.find((i: { code: string }) => i.code === 'MEMORIAL'),
      ).toMatchObject({ status: 'PENDING', completedAt: null });
      expect(
        (
          await patch(`/projects/${deal.projectId}/checklist/${item.id}`, operations, {
            documentId: '0192b0c0-0000-7000-8000-00000000dead',
          })
        ).status,
      ).toBe(422);
      expect(
        (
          await patch(
            `/projects/${deal.projectId}/checklist/0192b0c0-0000-7000-8000-00000000dead`,
            operations,
            { status: 'DONE' },
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await patch(`/projects/${deal.projectId}/checklist/${item.id}`, seller, {
            status: 'DONE',
          })
        ).status,
      ).toBe(403);
      expect((await auditOf(t, a.id, 'project.checklist_item_updated')).length).toBeGreaterThan(0);
    });

    it('fluxo completo: pendências bloqueiam o protocolo; prazos sugeridos têm fonte; vistoria; homologado', async () => {
      const deal = await signedDeal(flow, manager);
      const early = await status(deal.projectId, 'SUBMITTED', { protocolNumber: 'PROTO-1' });
      expect(early.status).toBe(422);
      expect(early.body.code).toBe('CHECKLIST_INCOMPLETE');
      expect(early.body.data.pending).toHaveLength(6);
      await completeRequired(deal.projectId);
      expect((await status(deal.projectId, 'SUBMITTED')).status).toBe(422); // sem protocolo

      const submitted = await status(deal.projectId, 'SUBMITTED', {
        protocolNumber: 'PROTO-2026-1',
      });
      expect(submitted.status).toBe(200);
      expect(submitted.body).toMatchObject({
        status: 'SUBMITTED',
        protocolNumber: 'PROTO-2026-1',
        overdue: false,
      });
      expect(submitted.body.accessOpinionDueSource).toMatch(/^Sugerido: .*EF-R06/);
      const days =
        (new Date(submitted.body.accessOpinionDueAt).getTime() -
          new Date(submitted.body.submittedAt).getTime()) /
        86_400_000;
      expect(Math.round(days)).toBe(60);
      expect(submitted.body.deadlineSuggestions.map((d: { code: string }) => d.code)).toEqual([
        'INSPECTION',
      ]);

      expect((await status(deal.projectId, 'APPROVED')).status).toBe(422); // não pula a vistoria
      const inspection = await status(deal.projectId, 'INSPECTION');
      expect(inspection.body.status).toBe('INSPECTION');
      expect(
        Math.round(
          (new Date(inspection.body.inspectionDueAt).getTime() -
            new Date(inspection.body.inspectionRequestedAt).getTime()) /
            86_400_000,
        ),
      ).toBe(7);

      const approved = await status(deal.projectId, 'APPROVED');
      expect(approved.body).toMatchObject({ status: 'APPROVED' });
      expect(approved.body.approvedAt).toBeTruthy();
      expect(approved.body.deadlineSuggestions.map((d: { code: string }) => d.code)).toEqual([
        'POST_APPROVAL_EXECUTION',
      ]);
      expect((await status(deal.projectId, 'CANCELLED', { reason: 'tarde demais' })).status).toBe(
        422,
      );

      await publishAll();
      for (const type of ['HomologationStarted', 'HomologationApproved'])
        expect(
          (await outboxOf(t, a.id, type)).some((e) => e.projectCode === deal.projectCode),
          type,
        ).toBe(true);
      const timeline = (await get(`/opportunities/${deal.opportunityId}/timeline`, owner)).body;
      expect(
        timeline.filter((e: { type: string }) => e.type === 'PROJECT_STATUS_CHANGED'),
      ).toHaveLength(3);
      expect((await auditOf(t, a.id, 'project.status_changed')).length).toBeGreaterThanOrEqual(3);
    });

    it('prazo informado vale mais que o sugerido; vencido marca atraso na lista', async () => {
      const deal = await signedDeal(flow, manager);
      await completeRequired(deal.projectId);
      const due = new Date(Date.now() + 10 * 86_400_000).toISOString();
      const submitted = await status(deal.projectId, 'SUBMITTED', {
        protocolNumber: 'PROTO-9',
        dueAt: due,
      });
      expect(submitted.body.accessOpinionDueSource).toBe('Informado pelo usuário');
      expect(new Date(submitted.body.accessOpinionDueAt).toISOString()).toBe(due);
      await t.prisma.system.project.update({
        where: { id: deal.projectId },
        data: { accessOpinionDueAt: new Date(Date.now() - 86_400_000) },
      });
      expect((await project(deal.projectId)).overdue).toBe(true);
      expect(
        (await get('/projects?status=SUBMITTED', owner)).body.data.find(
          (x: { id: string }) => x.id === deal.projectId,
        ).overdue,
      ).toBe(true);
    });

    it('a distribuidora pediu pendências: volta a reunir documentos (com motivo); cancelar pede motivo e trava tudo', async () => {
      const deal = await signedDeal(flow, manager);
      await completeRequired(deal.projectId);
      await status(deal.projectId, 'SUBMITTED', { protocolNumber: 'PROTO-3' });
      expect((await status(deal.projectId, 'DOCUMENTATION')).status).toBe(422);
      const back = await status(deal.projectId, 'DOCUMENTATION', {
        reason: 'Pediu o unifilar assinado pelo responsável técnico',
      });
      expect(back.body.status).toBe('DOCUMENTATION');
      expect(back.body.submittedAt).toBeTruthy();
      await publishAll();
      expect(
        (await outboxOf(t, a.id, 'HomologationPending')).some(
          (e) => e.projectCode === deal.projectCode,
        ),
      ).toBe(true);

      expect((await status(deal.projectId, 'CANCELLED')).status).toBe(422);
      const cancelled = await status(deal.projectId, 'CANCELLED', {
        reason: 'Cliente desistiu da instalação',
      });
      expect(cancelled.body.status).toBe('CANCELLED');
      expect((await status(deal.projectId, 'SUBMITTED', { protocolNumber: 'X' })).status).toBe(422);
      const item = (await project(deal.projectId)).checklist[0];
      expect(
        (
          await patch(`/projects/${deal.projectId}/checklist/${item.id}`, operations, {
            status: 'PENDING',
          })
        ).status,
      ).toBe(409);
      expect(
        (await patch(`/projects/${deal.projectId}`, operations, { responsibleId: null })).status,
      ).toBe(409);
      expect((await status(deal.projectId, 'CANCELLED', { reason: 'de novo' })).status).toBe(409);
    });

    it('concessionária só muda enquanto reúne documentos', async () => {
      const deal = await signedDeal(flow, manager);
      const unit = await t.prisma.system.consumerUnit.findUniqueOrThrow({
        where: { id: deal.unitId },
      });
      await completeRequired(deal.projectId);
      await status(deal.projectId, 'SUBMITTED', { protocolNumber: 'PROTO-4' });
      expect(
        (await patch(`/projects/${deal.projectId}`, operations, { distributorId: null })).status,
      ).toBe(409);
      expect(
        (
          await patch(`/projects/${deal.projectId}`, operations, {
            distributorId: unit.distributorId,
          })
        ).status,
      ).toBe(200); // sem mudança: aceito
    });
  });

  describe('permissões e isolamento', () => {
    it('instalador e vendedor leem; SDR não vê; só quem escreve altera', async () => {
      const deal = await signedDeal(flow, manager);
      for (const token of [installer, seller, owner])
        expect((await get(`/projects/${deal.projectId}`, token)).status).toBe(200);
      expect((await get('/projects', sdr)).status).toBe(403);
      expect(
        (await status(deal.projectId, 'SUBMITTED', { protocolNumber: 'X1' }, installer)).status,
      ).toBe(403);
      expect((await t.http.get(`${API}/projects`)).status).toBe(401);
    });

    it('a outra empresa não enxerga nem altera', async () => {
      const deal = await signedDeal(flow, manager);
      expect((await get(`/projects/${deal.projectId}`, adminB)).status).toBe(404);
      expect(
        (await patch(`/projects/${deal.projectId}`, adminB, { responsibleId: null })).status,
      ).toBe(404);
      expect(
        (await status(deal.projectId, 'CANCELLED', { reason: 'Outra empresa tentando' }, adminB))
          .status,
      ).toBe(404);
      expect(
        (await get('/projects', adminB)).body.data.every(
          (x: { id: string }) => x.id !== deal.projectId,
        ),
      ).toBe(true);
    });
  });

  // Por último: publicar regras da empresa muda o padrão dos projetos criados depois.
  describe('regras versionadas por distribuidora', () => {
    it('publica regra com fonte; o projeto novo usa a da distribuidora e o antigo mantém a sua', async () => {
      const first = await signedDeal(flow, manager);
      const unit = await t.prisma.system.consumerUnit.findUniqueOrThrow({
        where: { id: first.unitId },
      });
      const rule = {
        distributorId: unit.distributorId,
        source: 'Norma técnica da distribuidora, rev. 2026 (conferida em 19/10/2026)',
        reviewedBy: 'Rafael Responsável Técnico',
        items: [
          {
            code: 'FORM',
            title: 'Formulário da distribuidora',
            required: true,
            condition: 'ALWAYS',
            source: 'Norma da distribuidora, item 3.1',
          },
          {
            code: 'UNIFILAR',
            title: 'Diagrama unifilar assinado',
            required: true,
            condition: 'ALWAYS',
            source: 'Norma da distribuidora, item 3.2',
          },
          {
            code: 'EXTRA',
            title: 'Foto do padrão de entrada',
            required: false,
            condition: 'ALWAYS',
            source: 'Norma da distribuidora, item 3.3',
          },
        ],
        deadlines: [
          {
            code: 'ACCESS_OPINION',
            label: 'Parecer de acesso',
            days: 30,
            source: 'Norma da distribuidora, item 5',
          },
        ],
      };
      const published = await post('/homologation/checklists', owner, rule);
      expect(published.status).toBe(201);
      expect(published.body).toMatchObject({
        version: 1,
        scope: 'DISTRIBUTOR',
        reviewedBy: 'Rafael Responsável Técnico',
      });
      const v2 = await post('/homologation/checklists', owner, {
        ...rule,
        notes: 'Segunda versão',
      });
      expect(v2.body.version).toBe(2);
      expect(
        (await auditOf(t, a.id, 'homologation_checklist.published')).length,
      ).toBeGreaterThanOrEqual(2);

      const effective = (
        await get(`/homologation/checklists/effective?distributorId=${unit.distributorId}`, owner)
      ).body;
      expect(effective).toMatchObject({ version: 2, scope: 'DISTRIBUTOR' });
      const list = (await get('/homologation/checklists', owner)).body;
      expect(list.map((r: { ref: string }) => r.ref)).toEqual(
        expect.arrayContaining([
          'energif-2023@1',
          `distribuidora:${unit.distributorId}@2`,
          `distribuidora:${unit.distributorId}@1`,
        ]),
      );
      expect(
        list.find(
          (r: { version: number; distributorId: string | null }) =>
            r.distributorId === unit.distributorId && r.version === 2,
        ).distributorName,
      ).toMatch(/Dist Fluxo/);

      // O projeto antigo segue com a base; o novo (mesma distribuidora) usa a versão 2.
      expect((await project(first.projectId)).rules.ref).toBe('energif-2023@1');
      const second = await signedDeal(flow, manager);
      // O segundo oportunidade tem OUTRA distribuidora (cada fluxo cria a sua): reaponta a UC para a mesma.
      expect((await project(second.projectId)).rules.ref).toBe('energif-2023@1');
      await patch(`/projects/${second.projectId}`, operations, {
        distributorId: unit.distributorId,
      });
      const reapplied = await project(second.projectId);
      expect(reapplied.rules).toMatchObject({
        ref: `distribuidora:${unit.distributorId}@2`,
        scope: 'DISTRIBUTOR',
      });
      const codes = reapplied.checklist.map((i: { code: string }) => i.code);
      expect(codes).toEqual(expect.arrayContaining(['FORM', 'UNIFILAR', 'EXTRA']));
      expect(codes).not.toContain('MEMORIAL');
      expect(reapplied.deadlineSuggestions[0]).toMatchObject({ days: 30 });
      expect(reapplied.deadlineSuggestions[0].source).toMatch(/Norma da distribuidora/);

      // Um terceiro projeto, já nascendo com a distribuidora regulada, usa a regra publicada.
      expect(unit.distributorId).toBeTruthy();
    });

    it('valida: fonte obrigatória, códigos únicos, prazos sem repetição, concessionária existente', async () => {
      const base = {
        items: [
          {
            code: 'A_DOC',
            title: 'Documento A',
            required: true,
            condition: 'ALWAYS',
            source: 'Fonte A',
          },
        ],
        source: 'Fonte oficial qualquer',
      };
      expect((await post('/homologation/checklists', owner, { ...base, source: '' })).status).toBe(
        422,
      );
      expect(
        (
          await post('/homologation/checklists', owner, {
            ...base,
            items: [...base.items, ...base.items],
          })
        ).status,
      ).toBe(422);
      expect(
        (
          await post('/homologation/checklists', owner, {
            ...base,
            items: [{ ...base.items[0], code: 'minúsculo' }],
          })
        ).status,
      ).toBe(422);
      expect(
        (
          await post('/homologation/checklists', owner, {
            ...base,
            deadlines: [
              { code: 'INSPECTION', label: 'Vistoria', days: 7, source: 'x1' },
              { code: 'INSPECTION', label: 'Vistoria', days: 8, source: 'x2' },
            ],
          })
        ).status,
      ).toBe(422);
      expect(
        (
          await post('/homologation/checklists', owner, {
            ...base,
            distributorId: '0192b0c0-0000-7000-8000-00000000dead',
          })
        ).status,
      ).toBe(404);
      const own = await post('/homologation/checklists', owner, base);
      expect(own.body).toMatchObject({ scope: 'TENANT', distributorId: null });
    });

    it('permissões: gerenciar é do proprietário/administrador/responsável técnico; ler, de quem lê regras', async () => {
      const base = {
        items: [
          {
            code: 'A_DOC',
            title: 'Documento A',
            required: true,
            condition: 'ALWAYS',
            source: 'Fonte A',
          },
        ],
        source: 'Fonte oficial qualquer',
      };
      expect((await post('/homologation/checklists', seller, base)).status).toBe(403);
      expect((await post('/homologation/checklists', manager, base)).status).toBe(403);
      expect((await post('/homologation/checklists', techLead.token, base)).status).toBe(201);
      expect((await get('/homologation/checklists', engineering.token)).status).toBe(200);
      expect((await get('/homologation/checklists', sdr)).status).toBe(403);
      expect(
        (await get('/homologation/checklists', adminB)).body.every(
          (r: { id: string | null }) => r.id === null,
        ),
      ).toBe(true);
    });
  });
});
