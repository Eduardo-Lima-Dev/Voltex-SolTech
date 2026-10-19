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
import { acceptedDeal, ensureMarginPolicy } from './crm-delivery-flow';
import { buildOpportunity, type Flow } from './crm-flow';
import { auditOf, outboxOf, pngBuffer, textPdf } from './crm-support';

describe('CRM · Contrato (e2e)', () => {
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
  let tplManager: string;
  let tplSeller: string;
  let tplTenantId: string;

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
  const generate = (id: string, body: Record<string, unknown> = {}, token = manager) =>
    post(`/opportunities/${id}/contracts`, token, body);
  const sign = async (
    id: string,
    token = manager,
    fields: Record<string, string> = {},
    file?: { buffer: Buffer; name: string; type: string },
  ) => {
    let req = t.http.post(`${API}/contracts/${id}/sign`).set(bearer(token));
    for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
    const f = file ?? {
      buffer: await textPdf('Contrato assinado'),
      name: 'assinado.pdf',
      type: 'application/pdf',
    };
    return req.attach('file', f.buffer, { filename: f.name, contentType: f.type });
  };
  const stageOf = async (id: string) => (await get(`/opportunities/${id}`, owner)).body;

  beforeAll(async () => {
    t = await createTestApp();
    a = await seedTenant(t.prisma, 'contract');
    b = await seedTenant(t.prisma, 'contractb');
    owner = await tokenFor(t.http, a.owner);
    admin = await tokenFor(t.http, a.admin);
    manager = await tokenFor(t.http, a.manager);
    seller = await tokenFor(t.http, a.salesperson);
    sdr = await tokenFor(t.http, a.sdr);
    adminB = await tokenFor(t.http, b.admin);
    const tpl = await seedTenant(t.prisma, 'contracttpl');
    tplManager = await tokenFor(t.http, tpl.manager);
    tplSeller = await tokenFor(t.http, tpl.salesperson);
    tplTenantId = tpl.id;
    flow = { t, tenant: a, seller, admin };
    await ensureMarginPolicy(flow, manager);
  });
  afterAll(() => t.close());

  describe('modelo', () => {
    it('sem modelo da empresa vale o modelo-base, que avisa não ter revisão jurídica', async () => {
      const res = await get('/contract-template', tplManager);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ isDefault: true, version: null });
      expect(res.body.body).toMatch(/MODELO-BASE/);
      expect(res.body.variables.map((v: { key: string }) => v.key)).toContain('cliente.nome');
    });

    it('publica versões; recusa variável desconhecida; vendedor lê mas não altera', async () => {
      const body =
        'CONTRATO\n\nContratante: {{cliente.nome}}. Valor: {{contrato.valor}}. Projeto {{projeto.codigo}}. '.padEnd(
          80,
          'x',
        );
      const bad = await put('/contract-template', tplManager, {
        body: `${body} {{cliente.nomee}}`,
      });
      expect(bad.status).toBe(422);
      expect(bad.body.code).toBe('UNKNOWN_TEMPLATE_VARIABLES');
      expect(bad.body.data.unknown).toEqual(['cliente.nomee']);
      expect((await put('/contract-template', tplManager, { body: 'curto' })).status).toBe(422);
      expect((await put('/contract-template', tplSeller, { body })).status).toBe(403);
      expect((await get('/contract-template', tplSeller)).status).toBe(200);

      const v1 = await put('/contract-template', tplManager, { name: 'Modelo da empresa', body });
      expect(v1.body).toMatchObject({ isDefault: false, version: 1, name: 'Modelo da empresa' });
      const v2 = await put('/contract-template', tplManager, {
        name: 'Modelo da empresa',
        body: `${body} v2`,
      });
      expect(v2.body.version).toBe(2);
      expect(
        (await auditOf(t, tplTenantId, 'contract_template.published')).length,
      ).toBeGreaterThanOrEqual(2);
      // Versões antigas são imutáveis no banco.
      const row = await t.prisma.system.contractTemplate.findFirstOrThrow({
        where: { tenantId: tplTenantId, version: 1 },
      });
      await expect(
        t.prisma.system.contractTemplate.update({ where: { id: row.id }, data: { body: 'x' } }),
      ).rejects.toThrow(/imutável/);
    });
  });

  describe('geração', () => {
    it('gera o contrato da proposta aceita: variáveis preenchidas, valor do cenário, PDF e linha do tempo', async () => {
      const deal = await acceptedDeal(flow);
      expect((await stageOf(deal.opportunityId)).stage).toBe('CONTRACT');
      const res = await generate(deal.opportunityId, {
        customerDocument: '123.456.789-09',
        companyDocument: '12.345.678/0001-90',
        customerAddress: 'Rua das Flores, 10 — Fortaleza/CE',
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        version: 1,
        status: 'DRAFT',
        proposalVersion: 1,
        valueCents: 1_980_000,
        projectId: null,
        scenarioLabel: 'Proposta',
      });
      expect(res.body.body).toContain('R$ 19.800,00');
      expect(res.body.body).toContain('Maria da Silva'.length ? deal.projectCode : '');
      expect(res.body.body).toContain('123.456.789-09');
      expect(res.body.body).toContain('30% de entrada + 6x');
      expect(res.body.body).not.toMatch(/\{\{/);
      expect(res.body.templateIsDefault).toBe(true);
      expect(res.body.pdfDocumentId).toBeTruthy();

      const url = (await get(`/contracts/${res.body.id}/pdf-url`, manager)).body.url as string;
      expect((await fetch(url)).status).toBe(200);
      expect(
        (await auditOf(t, a.id, 'contract.generated')).some((l) => l.entityId === res.body.id),
      ).toBe(true);
      expect(
        (await outboxOf(t, a.id, 'ContractGenerated')).some(
          (e) => e.projectCode === deal.projectCode,
        ),
      ).toBe(true);
      const timeline = (await get(`/opportunities/${deal.opportunityId}/timeline`, owner)).body;
      expect(timeline.some((e: { type: string }) => e.type === 'CONTRACT_GENERATED')).toBe(true);
    });

    it('dados que faltam aparecem como "(não informado)" e ficam listados', async () => {
      const deal = await acceptedDeal(flow);
      const res = await generate(deal.opportunityId);
      expect(res.body.missingVariables).toEqual(
        expect.arrayContaining(['cliente.documento', 'empresa.documento']),
      );
      expect(res.body.body).toContain('(não informado)');
    });

    it('com mais de um cenário exige o escolhido; usa o preço dele', async () => {
      const deal = await acceptedDeal(flow, { quotes: 2 });
      const missing = await generate(deal.opportunityId);
      expect(missing.status).toBe(422);
      expect(missing.body.code).toBe('SCENARIO_REQUIRED');
      expect(missing.body.data.scenarios).toHaveLength(2);
      const other = missing.body.data.scenarios[1];
      const res = await generate(deal.opportunityId, { quoteId: other.quoteId });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ valueCents: 2_100_000, scenarioLabel: 'Opção 2' });
      expect(
        (await generate(deal.opportunityId, { quoteId: '0192b0c0-0000-7000-8000-00000000dead' }))
          .status,
      ).toBe(409);
    });

    it('bloqueios: etapa errada, proposta não aceita, contrato ativo duplicado', async () => {
      const early = await buildOpportunity(flow);
      const wrongStage = await generate(early.opportunityId);
      expect(wrongStage.status).toBe(422);
      expect(wrongStage.body.code).toBe('WRONG_STAGE');

      const deal = await acceptedDeal(flow);
      const first = await generate(deal.opportunityId);
      const dup = await generate(deal.opportunityId);
      expect(dup.status).toBe(409);
      expect(dup.body.code).toBe('CONTRACT_EXISTS');

      // Sem proposta aceita: força a proposta de volta a "enviada".
      const other = await acceptedDeal(flow);
      await t.prisma.system.proposal.update({
        where: { id: other.proposalId },
        data: { status: 'SENT' },
      });
      expect((await generate(other.opportunityId)).status).toBe(422);
      expect(first.status).toBe(201);
    });

    it('rascunho pode ser cancelado (com motivo) e gerar outro; o texto não muda no banco', async () => {
      const deal = await acceptedDeal(flow);
      const v1 = (await generate(deal.opportunityId)).body;
      expect((await post(`/contracts/${v1.id}/cancel`, manager, { reason: 'x' })).status).toBe(422);
      await expect(
        t.prisma.system.contract.update({ where: { id: v1.id }, data: { body: 'adulterado' } }),
      ).rejects.toThrow(/imutável/);
      const cancelled = await post(`/contracts/${v1.id}/cancel`, manager, {
        reason: 'Dados do cliente estavam errados',
      });
      expect(cancelled.body).toMatchObject({
        status: 'CANCELLED',
        cancelReason: 'Dados do cliente estavam errados',
      });
      const v2 = await generate(deal.opportunityId, { customerDocument: '987.654.321-00' });
      expect(v2.body.version).toBe(2);
      expect(v2.body.body).toContain('987.654.321-00');
      expect(
        (await get(`/opportunities/${deal.opportunityId}/contracts`, manager)).body.map(
          (c: { version: number }) => c.version,
        ),
      ).toEqual([2, 1]);
      await expect(t.prisma.system.contract.delete({ where: { id: v1.id } })).rejects.toThrow(
        /imutável/,
      );
    });

    it('usa o modelo publicado pela empresa e registra a versão', async () => {
      const own = await seedTenant(t.prisma, 'contractown');
      const ownOwner = await tokenFor(t.http, own.owner);
      const ownManager = await tokenFor(t.http, own.manager);
      const ownSeller = await tokenFor(t.http, own.salesperson);
      const ownAdmin = await tokenFor(t.http, own.admin);
      const ownFlow: Flow = { t, tenant: own, seller: ownSeller, admin: ownAdmin };
      await ensureMarginPolicy(ownFlow, ownManager);
      const body =
        'CONTRATO PRÓPRIO\n\nCliente {{cliente.nome}} compra {{projeto.potencia_kwp}} kWp por {{contrato.valor}}.'.padEnd(
          90,
          '.',
        );
      await put('/contract-template', ownManager, { body });
      const deal = await acceptedDeal(ownFlow);
      const res = await post(`/opportunities/${deal.opportunityId}/contracts`, ownManager);
      expect(res.body).toMatchObject({ templateIsDefault: false, templateVersion: 1 });
      expect(res.body.body).toMatch(
        /CONTRATO PRÓPRIO\n\nCliente .+ compra .+ kWp por R\$ 19\.800,00\./,
      );
      expect(ownOwner).toBeTruthy();
    });
  });

  describe('assinatura → ganho → projeto', () => {
    it('contrato assinado fecha o ganho e cria o projeto com o mesmo Project ID, na mesma transação', async () => {
      const deal = await acceptedDeal(flow);
      const contract = (await generate(deal.opportunityId)).body;
      const res = await sign(contract.id, manager, {
        signedByName: 'Maria da Silva',
        signedAt: '2026-10-19T14:00:00.000Z',
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: 'SIGNED',
        signedByName: 'Maria da Silva',
        signedDocumentId: expect.any(String),
        projectId: expect.any(String),
      });

      const opp = await stageOf(deal.opportunityId);
      expect(opp).toMatchObject({ stage: 'WON', status: 'WON' });
      const project = (await get(`/projects/${res.body.projectId}`, owner)).body;
      expect(project).toMatchObject({
        projectCode: deal.projectCode,
        opportunityId: deal.opportunityId,
        contractId: contract.id,
        status: 'DOCUMENTATION',
        valueCents: 1_980_000,
      });
      expect(project.checklist.length).toBeGreaterThan(5);

      await publishAll();
      for (const type of ['ContractSigned', 'DealWon', 'ProjectCreated'])
        expect(
          (await outboxOf(t, a.id, type)).some((e) => e.projectCode === deal.projectCode),
          type,
        ).toBe(true);
      for (const action of ['contract.signed', 'project.created'])
        expect((await auditOf(t, a.id, action)).length).toBeGreaterThan(0);
      const timeline = (await get(`/opportunities/${deal.opportunityId}/timeline`, owner)).body.map(
        (e: { type: string }) => e.type,
      );
      expect(timeline).toEqual(
        expect.arrayContaining(['CONTRACT_SIGNED', 'PROJECT_CREATED', 'STAGE_CHANGED']),
      );

      // O arquivo assinado é baixável e o contrato não muda mais.
      const signedUrl = (await get(`/contracts/${contract.id}/signed-url`, manager)).body
        .url as string;
      expect((await fetch(signedUrl)).status).toBe(200);
      await expect(
        t.prisma.system.contract.update({
          where: { id: contract.id },
          data: { pdfDocumentId: null },
        }),
      ).rejects.toThrow(/imutável/);
      // Primeira tarefa do projeto nasce automática.
      const tasks = await t.prisma.system.task.findMany({
        where: { opportunityId: deal.opportunityId, origin: 'automation:contract-signed' },
      });
      expect(tasks).toHaveLength(1);
    });

    it('o ganho só nasce pelo contrato: mover à mão para Ganho continua recusado', async () => {
      const deal = await acceptedDeal(flow);
      const res = await post(`/opportunities/${deal.opportunityId}/stage`, owner, { stage: 'WON' });
      expect(res.status).toBe(422);
      expect(JSON.stringify(res.body)).toMatch(/contrato é assinado/);
    });

    it('recusa arquivo ausente ou de tipo inválido, contrato já assinado ou cancelado, e data futura', async () => {
      const deal = await acceptedDeal(flow);
      const contract = (await generate(deal.opportunityId)).body;
      expect(
        (await t.http.post(`${API}/contracts/${contract.id}/sign`).set(bearer(manager))).status,
      ).toBeGreaterThanOrEqual(400);
      expect(
        (
          await sign(
            contract.id,
            manager,
            {},
            { buffer: Buffer.from('texto'), name: 'x.txt', type: 'text/plain' },
          )
        ).status,
      ).toBeGreaterThanOrEqual(400);
      expect(
        (await sign(contract.id, manager, { signedAt: '2099-01-01T00:00:00.000Z' })).status,
      ).toBe(422);
      expect(
        (
          await sign(
            contract.id,
            manager,
            {},
            { buffer: pngBuffer(), name: 'foto.png', type: 'image/png' },
          )
        ).status,
      ).toBe(200);
      expect((await sign(contract.id)).status).toBe(409);
      expect(
        (
          await post(`/contracts/${contract.id}/cancel`, manager, {
            reason: 'Tentando cancelar assinado',
          })
        ).status,
      ).toBe(409);
      expect((await stageOf(deal.opportunityId)).status).toBe('WON');
    });

    it('falha ao criar o projeto desfaz o ganho (tudo ou nada)', async () => {
      const deal = await acceptedDeal(flow);
      const contract = (await generate(deal.opportunityId)).body;
      // Provoca conflito: já existe um projeto com o mesmo código na empresa.
      const clash = await acceptedDeal(flow);
      const clashContract = (await generate(clash.opportunityId)).body;
      await t.prisma.system.$executeRawUnsafe(
        `UPDATE opportunities SET project_code = project_code WHERE id = '${clash.opportunityId}'`,
      );
      const created = await sign(clashContract.id);
      expect(created.status).toBe(200);
      await t.prisma.system.$executeRawUnsafe(`ALTER TABLE projects DISABLE TRIGGER ALL`);
      try {
        await t.prisma.system.project.updateMany({
          where: { opportunityId: clash.opportunityId },
          data: { projectCode: deal.projectCode },
        });
      } finally {
        await t.prisma.system.$executeRawUnsafe(`ALTER TABLE projects ENABLE TRIGGER ALL`);
      }
      const res = await sign(contract.id);
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect((await stageOf(deal.opportunityId)).status).toBe('OPEN');
      expect(
        (await t.prisma.system.contract.findUniqueOrThrow({ where: { id: contract.id } })).status,
      ).toBe('DRAFT');
    });
  });

  describe('permissões e isolamento', () => {
    it('vendedor lê mas não gera nem assina; SDR não vê; admin e proprietário gerenciam', async () => {
      const deal = await acceptedDeal(flow);
      expect((await generate(deal.opportunityId, {}, seller)).status).toBe(403);
      expect((await get(`/opportunities/${deal.opportunityId}/contracts`, sdr)).status).toBe(403);
      const contract = (await generate(deal.opportunityId, {}, admin)).body;
      expect((await get(`/contracts/${contract.id}`, seller)).status).toBe(200);
      expect((await sign(contract.id, seller)).status).toBe(403);
      expect((await t.http.get(`${API}/contracts/${contract.id}`)).status).toBe(401);
      expect((await sign(contract.id, owner)).status).toBe(200);
    });

    it('a outra empresa não enxerga nem altera', async () => {
      const deal = await acceptedDeal(flow);
      const contract = (await generate(deal.opportunityId)).body;
      expect((await get(`/contracts/${contract.id}`, adminB)).status).toBe(404);
      expect((await generate(deal.opportunityId, {}, adminB)).status).toBe(404);
      expect(
        (
          await post(`/contracts/${contract.id}/cancel`, adminB, {
            reason: 'Tentativa de outra empresa',
          })
        ).status,
      ).toBe(404);
      expect((await sign(contract.id, adminB)).status).toBe(404);
      expect((await get(`/opportunities/${deal.opportunityId}/contracts`, adminB)).status).toBe(
        404,
      );
    });
  });

  async function publishAll() {
    const { OutboxPublisher } = await import('../src/platform/events/outbox-publisher.service');
    await t.app.get(OutboxPublisher).publishPending(500, a.id);
  }
});
