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
import { SAMPLE_BILL, auditOf, outboxOf, pngBuffer, textPdf, tokenWithRole } from './crm-support';

const fields = (o: Record<string, unknown> = {}) => ({
  ucNumber: '12345678-9',
  customerGroup: 'B',
  phaseSystem: 'TWO_PHASE',
  tariffCentsPerKwh: 102.5,
  consumptionHistory: [
    { month: '2026-06', kwh: 400 },
    { month: '2026-05', kwh: 430 },
    { month: '2026-07', kwh: 405 },
  ],
  ...o,
});

describe('CRM · Fatura de energia (e2e)', () => {
  let t: TestApp;
  let a: SeededTenant;
  let b: SeededTenant;
  let admin: string;
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
  const upload = async (
    token: string,
    file: Buffer,
    target: Record<string, string>,
    filename = 'fatura.pdf',
    mime = 'application/pdf',
  ) => {
    const req = t.http.post(`${API}/energy-bills`).set(bearer(token));
    for (const [k, v] of Object.entries(target)) req.field(k, v);
    return req.attach('file', file, { filename, contentType: mime });
  };
  const newOpp = async (stages: string[] = []) => {
    const acc = (
      await post('/accounts', seller, { name: `Cliente ${Math.random().toString(36).slice(2, 8)}` })
    ).body;
    const unit = (
      await post(`/accounts/${acc.id}/consumer-units`, seller, {
        number: `UC${Math.floor(Math.random() * 1e6)}`,
        customerGroup: 'B',
      })
    ).body;
    const opp = (
      await post('/opportunities', seller, { accountId: acc.id, consumerUnitId: unit.id })
    ).body;
    for (const stage of stages) await post(`/opportunities/${opp.id}/stage`, seller, { stage });
    return { acc, unit, opp };
  };

  beforeAll(async () => {
    t = await createTestApp();
    a = await seedTenant(t.prisma, 'bill');
    b = await seedTenant(t.prisma, 'billb');
    admin = await tokenFor(t.http, a.admin);
    seller = await tokenFor(t.http, a.salesperson);
    sdr = await tokenFor(t.http, a.sdr);
    adminB = await tokenFor(t.http, b.admin);
    engineering = (await tokenWithRole(t, a, 'ENGINEERING')).token;
    await post('/distributors', admin, { name: 'Energia Elétrica do Norte', state: 'CE' });
  });
  afterAll(() => t.close());

  describe('envio e leitura', () => {
    it('guarda o PDF, lê os campos com confiança, reconhece a distribuidora cadastrada e aguarda revisão', async () => {
      const { opp, unit } = await newOpp(['FIRST_CONTACT', 'QUALIFICATION', 'BILL_PENDING']);
      const res = await upload(seller, await textPdf(SAMPLE_BILL), { opportunityId: opp.id });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        status: 'PARSED',
        filename: 'fatura.pdf',
        opportunityId: opp.id,
        consumerUnitId: unit.id,
        parserName: 'pdf-text-heuristic',
        snapshotId: null,
      });
      expect(res.body.extracted.ucNumber).toEqual({ value: '12345678-9', confidence: 0.85 });
      expect(res.body.extracted.distributorName.value).toBe('Energia Elétrica do Norte');
      expect(res.body.extracted.phaseSystem.value).toBe('TWO_PHASE');
      expect(res.body.extracted.consumptionHistory.value).toHaveLength(12);
      expect(res.body.extracted.customerName.confidence).toBeLessThan(0.75);
      expect(res.body.overallConfidence).toBeGreaterThan(0.6);

      const doc = await t.prisma.system.document.findUniqueOrThrow({
        where: { id: res.body.documentId },
      });
      expect(doc).toMatchObject({
        entityType: 'EnergyBill',
        entityId: res.body.id,
        mimeType: 'application/pdf',
        tenantId: a.id,
      });
      const timeline = (await get(`/opportunities/${opp.id}/timeline`, seller)).body;
      expect(timeline[0]).toMatchObject({ type: 'BILL_UPLOADED' });
      expect(timeline[0].summary).toMatch(/campos lidos, aguardando revisão/);
      const parsed = (await outboxOf(t, a.id, 'EnergyBillParsed')).find(
        (e) => (e.payload as { billId: string }).billId === res.body.id,
      );
      expect(parsed?.projectCode).toBe(opp.projectCode);
      expect(
        (await auditOf(t, a.id, 'energy_bill.uploaded')).some((l) => l.entityId === res.body.id),
      ).toBe(true);
      // a oportunidade continua em "Fatura pendente" até alguém confirmar os campos
      expect((await get(`/opportunities/${opp.id}`, seller)).body.stage).toBe('BILL_PENDING');
    });

    it('imagem é aceita e guardada, mas sem leitura automática (preenchimento manual na revisão)', async () => {
      const { opp } = await newOpp();
      const res = await upload(
        seller,
        pngBuffer(),
        { opportunityId: opp.id },
        'foto.png',
        'image/png',
      );
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        status: 'UPLOADED',
        extracted: {},
        overallConfidence: null,
      });
      expect((await get(`/opportunities/${opp.id}/timeline`, seller)).body[0].summary).toMatch(
        /sem leitura automática/,
      );
    });

    it('PDF sem texto reconhecível também segue para preenchimento manual', async () => {
      const { opp } = await newOpp();
      const res = await upload(seller, await textPdf('Documento qualquer sem dados de fatura'), {
        opportunityId: opp.id,
      });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('UPLOADED');
    });

    it('exige o arquivo e um alvo; recusa tipo inválido e alvo de outra empresa', async () => {
      const { opp, unit } = await newOpp();
      expect(
        (
          await t.http
            .post(`${API}/energy-bills`)
            .set(bearer(seller))
            .field('opportunityId', opp.id)
        ).status,
      ).toBe(400);
      expect((await upload(seller, await textPdf('x'), {})).status).toBe(422);
      expect(
        (
          await upload(
            seller,
            Buffer.from('texto puro'),
            { opportunityId: opp.id },
            'a.txt',
            'text/plain',
          )
        ).status,
      ).toBeGreaterThanOrEqual(400);
      expect((await upload(adminB, await textPdf('x'), { opportunityId: opp.id })).status).toBe(
        404,
      );
      expect((await upload(adminB, await textPdf('x'), { consumerUnitId: unit.id })).status).toBe(
        422,
      );
      expect(
        (
          await upload(seller, await textPdf('x'), {
            opportunityId: '0192b0c0-0000-7000-8000-00000000dead',
          })
        ).status,
      ).toBe(404);
    });

    it('lista e consulta as faturas da oportunidade e gera link de download', async () => {
      const { opp } = await newOpp();
      const one = await upload(seller, await textPdf(SAMPLE_BILL), { opportunityId: opp.id });
      await upload(seller, pngBuffer(), { opportunityId: opp.id }, 'foto.png', 'image/png');
      const list = await get(`/energy-bills?opportunityId=${opp.id}`, seller);
      expect(list.body).toHaveLength(2);
      expect((await get(`/energy-bills/${one.body.id}`, seller)).body.id).toBe(one.body.id);
      const url = await get(`/energy-bills/${one.body.id}/download-url`, seller);
      expect(url.status).toBe(200);
      expect(url.body.url).toMatch(/^http/);
      expect(url.body.expiresIn).toBe(300);
    });
  });

  describe('revisão e validação', () => {
    it('confirmar grava o snapshot imutável, valida a fatura, atualiza a UC e tira a oportunidade de "Fatura pendente"', async () => {
      const { opp, unit } = await newOpp(['FIRST_CONTACT', 'QUALIFICATION', 'BILL_PENDING']);
      const bill = (await upload(seller, await textPdf(SAMPLE_BILL), { opportunityId: opp.id }))
        .body;

      const res = await post(`/energy-bills/${bill.id}/validate`, seller, {
        fields: fields(),
        note: 'Conferido com o cliente',
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'VALIDATED', snapshotId: expect.any(String) });
      expect(res.body.validatedAt).toBeTruthy();

      const snaps = await get(`/energy-bills/${bill.id}/snapshots`, seller);
      expect(snaps.body).toHaveLength(1);
      expect(snaps.body[0]).toMatchObject({
        note: 'Conferido com o cliente',
        validatedById: a.salesperson.id,
      });
      expect(snaps.body[0].fields.ucNumber).toBe('12345678-9');

      await expect(
        t.prisma.system.energyBillSnapshot.update({
          where: { id: snaps.body[0].id },
          data: { note: 'adulterado' },
        }),
      ).rejects.toThrow(/imutável/);
      await expect(
        t.prisma.system.energyBillSnapshot.delete({ where: { id: snaps.body[0].id } }),
      ).rejects.toThrow(/imutável/);

      expect((await get(`/opportunities/${opp.id}`, seller)).body.stage).toBe('PRE_SIZING');
      const timeline = (await get(`/opportunities/${opp.id}/timeline`, seller)).body.map(
        (e: { type: string }) => e.type,
      );
      expect(timeline).toEqual(expect.arrayContaining(['BILL_VALIDATED', 'STAGE_CHANGED']));
      const unitNow = await t.prisma.system.consumerUnit.findUniqueOrThrow({
        where: { id: unit.id },
      });
      expect(unitNow.phaseSystem).toBe('TWO_PHASE');
      const validated = (await outboxOf(t, a.id, 'EnergyBillValidated')).find(
        (e) => (e.payload as { billId: string }).billId === bill.id,
      );
      expect(validated?.payload).toMatchObject({
        snapshotId: snaps.body[0].id,
        opportunityId: opp.id,
      });
      expect(validated?.projectCode).toBe(opp.projectCode);
      expect(
        (await auditOf(t, a.id, 'energy_bill.validated')).some((l) => l.entityId === bill.id),
      ).toBe(true);
    });

    it('a confirmação pode corrigir os campos lidos; sem UC ou sem consumo é recusada com mensagem por campo', async () => {
      const { opp } = await newOpp();
      const bill = (
        await upload(seller, pngBuffer(), { opportunityId: opp.id }, 'foto.png', 'image/png')
      ).body;
      const noMonths = await post(`/energy-bills/${bill.id}/validate`, seller, {
        fields: fields({ consumptionHistory: [] }),
      });
      expect(noMonths.status).toBe(422);
      expect(noMonths.body.details.map((d: { path: string }) => d.path)).toContain(
        'fields.consumptionHistory',
      );
      const { ucNumber: _omit, ...noUc } = fields();
      const missingUc = await post(`/energy-bills/${bill.id}/validate`, seller, { fields: noUc });
      expect(missingUc.body.details.map((d: { path: string }) => d.path)).toContain(
        'fields.ucNumber',
      );
      expect(
        (
          await post(`/energy-bills/${bill.id}/validate`, seller, {
            fields: fields({ consumptionHistory: [{ month: '2026-13', kwh: 5 }] }),
          })
        ).status,
      ).toBe(422);
      expect(
        (await post(`/energy-bills/${bill.id}/validate`, seller, { fields: fields() })).status,
      ).toBe(200);
    });

    it('cada confirmação gera um snapshot novo; o contexto do cálculo usa o mais recente, em ordem de mês', async () => {
      const { opp } = await newOpp();
      const bill = (await upload(seller, await textPdf(SAMPLE_BILL), { opportunityId: opp.id }))
        .body;
      await post(`/energy-bills/${bill.id}/validate`, seller, {
        fields: fields({ tariffCentsPerKwh: 99 }),
      });
      const second = await post(`/energy-bills/${bill.id}/validate`, seller, {
        fields: fields({ tariffCentsPerKwh: 105 }),
      });

      expect((await get(`/energy-bills/${bill.id}/snapshots`, seller)).body).toHaveLength(2);
      const ctx = (await get(`/opportunities/${opp.id}/calculation-context`, seller)).body;
      expect(ctx.billSnapshotId).toBe(second.body.snapshotId);
      expect(ctx.consumptionMonthlyKwh).toEqual([430, 400, 405]); // 2026-05, 2026-06, 2026-07
      expect(ctx.consumptionHistory).toEqual([
        { month: '2026-05', kwh: 430 },
        { month: '2026-06', kwh: 400 },
        { month: '2026-07', kwh: 405 },
      ]);
      expect(ctx.tariffCentsPerKwh).toBe(105); // a tarifa da fatura (com impostos) vale mais que a do cadastro
      expect(ctx.customerGroup).toBe('B');
      expect(ctx.phaseSystem).toBe('TWO_PHASE');
    });

    it('com mais de 12 meses, o contexto usa os 12 mais recentes', async () => {
      const { opp } = await newOpp();
      const bill = (
        await upload(seller, pngBuffer(), { opportunityId: opp.id }, 'foto.png', 'image/png')
      ).body;
      const months = Array.from({ length: 15 }, (_, i) => ({
        month: `${2025 + Math.floor((i + 3) / 12)}-${String(((i + 3) % 12) + 1).padStart(2, '0')}`,
        kwh: 100 + i,
      }));
      await post(`/energy-bills/${bill.id}/validate`, seller, {
        fields: fields({ consumptionHistory: months }),
      });
      const ctx = (await get(`/opportunities/${opp.id}/calculation-context`, seller)).body;
      expect(ctx.consumptionMonthlyKwh).toHaveLength(12);
      expect(ctx.consumptionMonthlyKwh.at(-1)).toBe(114);
    });

    it('recusar guarda o motivo e registra na linha do tempo; depois ainda dá para validar', async () => {
      const { opp } = await newOpp();
      const bill = (
        await upload(seller, pngBuffer(), { opportunityId: opp.id }, 'foto.png', 'image/png')
      ).body;
      expect((await post(`/energy-bills/${bill.id}/reject`, seller, { reason: '' })).status).toBe(
        422,
      );
      const rejected = await post(`/energy-bills/${bill.id}/reject`, seller, {
        reason: 'Foto ilegível',
      });
      expect(rejected.body).toMatchObject({ status: 'REJECTED', rejectedReason: 'Foto ilegível' });
      expect((await get(`/opportunities/${opp.id}/timeline`, seller)).body[0].summary).toBe(
        'Fatura recusada: Foto ilegível',
      );
      const again = await post(`/energy-bills/${bill.id}/validate`, seller, { fields: fields() });
      expect(again.body).toMatchObject({ status: 'VALIDATED', rejectedReason: null });
    });
  });

  describe('permissões e isolamento', () => {
    it('SDR envia e valida; engenharia não acessa faturas; sem token é 401', async () => {
      // O SDR trabalha na própria carteira: envia a fatura da unidade de uma conta dele, não de uma oportunidade.
      const acc = (await post('/accounts', sdr, { name: 'Conta do SDR' })).body;
      const unit = (await post(`/accounts/${acc.id}/consumer-units`, sdr, { number: '7771234' }))
        .body;
      const bill = await upload(sdr, await textPdf(SAMPLE_BILL), { consumerUnitId: unit.id });
      expect(bill.status).toBe(201);
      expect(
        (await post(`/energy-bills/${bill.body.id}/validate`, sdr, { fields: fields() })).status,
      ).toBe(200);
      expect((await get('/energy-bills', engineering)).status).toBe(403);
      expect(
        (await upload(engineering, await textPdf('x'), { consumerUnitId: unit.id })).status,
      ).toBe(403);
      expect((await t.http.get(`${API}/energy-bills`)).status).toBe(401);
    });

    it('outra empresa não vê, valida, recusa nem baixa as faturas desta', async () => {
      const { opp } = await newOpp();
      const bill = (await upload(seller, await textPdf(SAMPLE_BILL), { opportunityId: opp.id }))
        .body;
      expect((await get(`/energy-bills/${bill.id}`, adminB)).status).toBe(404);
      expect((await get(`/energy-bills/${bill.id}/snapshots`, adminB)).status).toBe(404);
      expect((await get(`/energy-bills/${bill.id}/download-url`, adminB)).status).toBe(404);
      expect(
        (await post(`/energy-bills/${bill.id}/validate`, adminB, { fields: fields() })).status,
      ).toBe(404);
      expect(
        (await post(`/energy-bills/${bill.id}/reject`, adminB, { reason: 'invasor' })).status,
      ).toBe(404);
      expect((await get('/energy-bills', adminB)).body).toEqual([]);
    });
  });
});
