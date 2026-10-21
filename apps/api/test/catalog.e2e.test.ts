import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

const fixture = (name: string) =>
  readFileSync(resolve(__dirname, '../../../packages/solar-engine/src/io/fixtures', name));

/** PDF mínimo com texto (xref correto) para a leitura de ficha técnica. */
function textPdf(lines: string[]): Buffer {
  const esc = (l: string) => l.replace(/[()\\]/g, '\\$&');
  const content = `BT /F1 12 Tf 50 750 Td 14 TL ${lines.map((l) => `(${esc(l)}) Tj T*`).join(' ')} ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

const suffix = Math.random().toString(36).slice(2, 8);
const moduleSpec = (over: Record<string, unknown> = {}) => ({
  technology: 'MONO_SI',
  pmaxWp: 550,
  vmppV: 41.7,
  imppA: 13.19,
  vocV: 49.7,
  iscA: 13.98,
  betaVocPctPerC: -0.27,
  alphaIscPctPerC: 0.05,
  gammaPmaxPctPerC: -0.34,
  lengthMm: 2278,
  widthMm: 1134,
  ...over,
});
const newModule = (model: string, over: Record<string, unknown> = {}) => ({
  kind: 'MODULE',
  manufacturer: `Fab ${suffix}`,
  model,
  spec: moduleSpec(over),
});

describe('Catálogo técnico (e2e)', () => {
  let t: TestApp;
  let a: SeededTenant;
  let b: SeededTenant;
  let admin: string;
  let adminB: string;
  let seller: string;
  let engineer: string;
  let lead: string;
  let priceService: {
    currentPrice: (id: string, at: Date) => Promise<{ priceCents: number } | null>;
  };
  let ctx: { run: <T>(v: { tenantId: string }, fn: () => Promise<T>) => Promise<T> };
  // Obtida logo após subir o app: outro `createTestApp` reimporta os módulos e muda as classes.
  let queue: { process: (job: { name: string }) => Promise<unknown> };

  const get = (path: string, token: string) => t.http.get(`${API}${path}`).set(bearer(token));
  const post = (path: string, token: string, body: object = {}) =>
    t.http.post(`${API}${path}`).set(bearer(token)).send(body);
  const patch = (path: string, token: string, body: object) =>
    t.http.patch(`${API}${path}`).set(bearer(token)).send(body);

  const makeUser = async (tenant: SeededTenant, role: 'ENGINEERING' | 'TECHNICAL_LEAD') => {
    const owner = await t.prisma.system.user.findUniqueOrThrow({ where: { id: tenant.owner.id } });
    const user = await t.prisma.system.user.create({
      data: {
        tenantId: tenant.id,
        name: role,
        email: `${role.toLowerCase()}.${tenant.id.slice(0, 6)}@cat.test`,
        passwordHash: owner.passwordHash,
        role,
      },
    });
    return tokenFor(t.http, { id: user.id, email: user.email, role });
  };

  beforeAll(async () => {
    t = await createTestApp();
    a = await seedTenant(t.prisma, 'cat');
    b = await seedTenant(t.prisma, 'catb');
    admin = await tokenFor(t.http, a.admin);
    adminB = await tokenFor(t.http, b.admin);
    seller = await tokenFor(t.http, a.salesperson);
    engineer = await makeUser(a, 'ENGINEERING');
    lead = await makeUser(a, 'TECHNICAL_LEAD');
    const { DataHubQueue } = await import('../src/platform/data-hub/data-hub.queue');
    queue = t.app.get(DataHubQueue);
    const { PriceListService } = await import('../src/platform/catalog/price-list.service');
    const { RequestContext } = await import('../src/common/context/request-context');
    priceService = t.app.get(PriceListService);
    ctx = t.app.get(RequestContext);
  });
  afterAll(() => t.close());

  describe('cadastro e governança', () => {
    let moduleId = '';

    it('cria rascunho, recusa duplicado e ficha inválida; só quem gerencia o catálogo escreve', async () => {
      const created = await post('/catalog/items', engineer, newModule('M-550'));
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({
        status: 'DRAFT',
        revision: 1,
        origin: 'MANUAL',
        inmetroStatus: 'NOT_VERIFIED',
      });
      moduleId = created.body.id;

      expect((await post('/catalog/items', engineer, newModule('M-550'))).status).toBe(409);
      const bad = await post(
        '/catalog/items',
        engineer,
        newModule('M-X', { pmaxWp: -1, technology: 'VIDRO' }),
      );
      expect(bad.status).toBe(422);
      expect((await post('/catalog/items', seller, newModule('M-Y'))).status).toBe(403);
      expect((await get('/catalog/items', seller)).status).toBe(403);
    });

    it('o detalhe traz a conferência física e o aviso de INMETRO não conferido', async () => {
      const res = await get(`/catalog/items/${moduleId}`, engineer);
      expect(res.status).toBe(200);
      expect(res.body.issues.map((i: { code: string }) => i.code)).toEqual([
        'INMETRO_NOT_VERIFIED',
      ]);
      expect(res.body.revisions).toEqual([]);
    });

    it('lista com filtros e busca; edita o rascunho; exclui rascunho', async () => {
      const list = await get(`/catalog/items?kind=MODULE&search=m-550`, engineer);
      expect(list.body.data).toHaveLength(1);
      expect(list.body.meta.total).toBe(1);
      const edited = await patch(`/catalog/items/${moduleId}`, engineer, {
        spec: moduleSpec({ pmaxWp: 551 }),
        referenceCostCents: 60000,
        notes: 'conferido',
      });
      expect(edited.body.spec.pmaxWp).toBe(551);
      expect(edited.body.referenceCostCents).toBe(60000);
      const invalid = await patch(`/catalog/items/${moduleId}`, engineer, { spec: { pmaxWp: 1 } });
      expect(invalid.status).toBe(422);

      const tmp = await post('/catalog/items', engineer, newModule('M-TMP'));
      expect(
        (await t.http.delete(`${API}/catalog/items/${tmp.body.id}`).set(bearer(engineer))).status,
      ).toBe(200);
      expect((await get(`/catalog/items/${tmp.body.id}`, engineer)).status).toBe(404);
    });

    it('aprovar exige o responsável técnico e bloqueia ficha com erro físico', async () => {
      const broken = await post('/catalog/items', engineer, newModule('M-BAD', { vmppV: 60 }));
      expect((await post(`/catalog/items/${broken.body.id}/approve`, engineer)).status).toBe(403);
      const refused = await post(`/catalog/items/${broken.body.id}/approve`, lead);
      expect(refused.status).toBe(422);
      expect(refused.body.data.issues.map((i: { code: string }) => i.code)).toContain(
        'VMPP_NOT_BELOW_VOC',
      );
      await patch(`/catalog/items/${broken.body.id}`, engineer, {
        spec: moduleSpec({ pmaxWp: 550 }),
      });

      const approved = await post(`/catalog/items/${moduleId}/approve`, lead);
      expect(approved.status).toBe(200);
      expect(approved.body).toMatchObject({ status: 'APPROVED', approvedAt: expect.any(String) });
      // Aviso, não erro: aprovou mesmo sem o INMETRO conferido.
      expect(approved.body.issues[0].severity).toBe('WARNING');
      expect((await post(`/catalog/items/${moduleId}/approve`, lead)).status).toBe(409);
    });

    it('aprovado é imutável: API e banco recusam edição e exclusão', async () => {
      expect((await patch(`/catalog/items/${moduleId}`, engineer, { notes: 'x' })).status).toBe(
        409,
      );
      expect(
        (await t.http.delete(`${API}/catalog/items/${moduleId}`).set(bearer(engineer))).status,
      ).toBe(409);
      await expect(
        t.prisma.system.equipmentItem.update({
          where: { id: moduleId },
          data: { spec: moduleSpec({ pmaxWp: 1 }) },
        }),
      ).rejects.toThrow(/imutável/);
      await expect(
        t.prisma.system.equipmentItem.delete({ where: { id: moduleId } }),
      ).rejects.toThrow();
      await expect(
        t.prisma.system.equipmentItem.update({
          where: { id: moduleId },
          data: { status: 'DRAFT' },
        }),
      ).rejects.toThrow();
    });

    it('nova revisão: copia a ficha, aposenta a anterior ao aprovar e guarda o histórico', async () => {
      const rev = await post(`/catalog/items/${moduleId}/revise`, engineer);
      expect(rev.status).toBe(201);
      expect(rev.body).toMatchObject({ status: 'DRAFT', revision: 2, supersedesId: moduleId });
      expect((await post(`/catalog/items/${moduleId}/revise`, engineer)).status).toBe(409);
      await patch(`/catalog/items/${rev.body.id}`, engineer, {
        spec: moduleSpec({ pmaxWp: 552, vmppV: 41.85 }),
      });
      expect((await post(`/catalog/items/${rev.body.id}/approve`, lead)).status).toBe(200);

      const old = await get(`/catalog/items/${moduleId}`, engineer);
      expect(old.body.status).toBe('RETIRED');
      expect(old.body.revisions).toEqual([
        expect.objectContaining({ revision: 2, status: 'APPROVED' }),
      ]);
      const approved = await get(
        '/catalog/items?kind=MODULE&status=APPROVED&search=M-550',
        engineer,
      );
      expect(approved.body.data).toHaveLength(1);
      expect(approved.body.data[0].revision).toBe(2);
      // Aposentado não volta a valer.
      await expect(
        t.prisma.system.equipmentItem.update({
          where: { id: moduleId },
          data: { status: 'APPROVED' },
        }),
      ).rejects.toThrow();
      expect((await post(`/catalog/items/${moduleId}/retire`, lead)).status).toBe(409);
    });

    it('aposentar um item aprovado e conferir o INMETRO (só módulo e inversor)', async () => {
      const m = await post('/catalog/items', engineer, newModule('M-INM'));
      await post(`/catalog/items/${m.body.id}/approve`, lead);
      const checked = await post(`/catalog/items/${m.body.id}/inmetro`, engineer, {
        status: 'VERIFIED',
        registration: '012345/2025',
      });
      expect(checked.body).toMatchObject({
        inmetroStatus: 'VERIFIED',
        inmetroRegistration: '012345/2025',
        inmetroCheckedBy: expect.any(String),
      });
      // A conferência é permitida mesmo com o item aprovado (o gatilho só protege a ficha).
      const detail = await get(`/catalog/items/${m.body.id}`, engineer);
      expect(detail.body.issues).toEqual([]);
      expect((await post(`/catalog/items/${m.body.id}/retire`, lead)).body.status).toBe('RETIRED');

      const cable = await post('/catalog/items', engineer, {
        kind: 'CABLE',
        manufacturer: `Cabos ${suffix}`,
        model: '6mm',
        spec: { cableKind: 'DC_SOLAR', crossSectionMm2: 6, voltageRatingV: 1800 },
      });
      expect(cable.status).toBe(201);
      expect(
        (await post(`/catalog/items/${cable.body.id}/inmetro`, engineer, { status: 'VERIFIED' }))
          .status,
      ).toBe(400);
    });

    it('anexa a ficha técnica em PDF; recusa documento inexistente', async () => {
      const m = await post('/catalog/items', engineer, newModule('M-DOC'));
      const up = await t.http
        .post(`${API}/documents`)
        .set(bearer(engineer))
        .attach('file', textPdf(['Ficha']), {
          filename: 'ficha.pdf',
          contentType: 'application/pdf',
        });
      expect(up.status).toBe(201);
      const res = await post(`/catalog/items/${m.body.id}/datasheet`, engineer, {
        documentId: up.body.id,
      });
      expect(res.body.datasheetDocumentId).toBe(up.body.id);
      expect(
        (
          await post(`/catalog/items/${m.body.id}/datasheet`, engineer, {
            documentId: '00000000-0000-4000-8000-000000000000',
          })
        ).status,
      ).toBe(404);
    });

    it('cada empresa só vê o seu catálogo', async () => {
      expect((await get('/catalog/items', adminB)).body.data).toEqual([]);
      expect((await get(`/catalog/items/${moduleId}`, adminB)).status).toBe(404);
      const own = await post('/catalog/items', adminB, newModule('M-550'));
      expect(own.status).toBe(201); // mesmo fabricante e modelo, outra empresa
    });
  });

  describe('importação', () => {
    const preview = (
      token: string,
      format: string,
      file: Buffer | undefined,
      name: string,
      kind?: string,
    ) => {
      let req = t.http
        .post(`${API}/catalog/import/preview?format=${format}${kind ? `&kind=${kind}` : ''}`)
        .set(bearer(token));
      if (file) req = req.attach('file', file, { filename: name });
      return req;
    };

    it('CSV: prévia com validação física, custo e linhas com erro; modelo de planilha para baixar', async () => {
      const tpl = await get('/catalog/import/template?kind=MODULE', engineer);
      expect(tpl.text).toMatch(/^fabricante;modelo;tecnologia/);
      const csv = [
        'fabricante;modelo;tecnologia;pmax_wp;vmpp_v;impp_a;voc_v;isc_a;beta_voc_pct_c;alpha_isc_pct_c;gamma_pmax_pct_c;comprimento_mm;largura_mm;custo_referencia_reais',
        `Fab CSV ${suffix};CSV-1;mono;550;41,7;13,19;49,7;13,98;-0,27;0,05;-0,34;2278;1134;600,00`,
        `Fab CSV ${suffix};CSV-2;mono;550;60;13,19;49,7;13,98;-0,27;0,05;-0,34;2278;1134;`,
        `Fab CSV ${suffix};CSV-3;mono;abc;;;;;;;;;;`,
      ].join('\n');
      const res = await preview(engineer, 'csv', Buffer.from(csv), 'modulos.csv', 'MODULE');
      expect(res.status).toBe(200);
      expect(res.body.candidates).toHaveLength(2);
      expect(res.body.candidates[0]).toMatchObject({
        model: 'CSV-1',
        exists: false,
        origin: 'CSV',
        referenceCostCents: 60000,
      });
      expect(res.body.candidates[0].issues).toEqual([]);
      expect(res.body.candidates[1].issues.map((i: { code: string }) => i.code)).toContain(
        'VMPP_NOT_BELOW_VOC',
      );
      expect(res.body.errors).toEqual([expect.objectContaining({ row: 4 })]);
      // Prévia não grava nada.
      expect((await get(`/catalog/items?search=CSV-1`, engineer)).body.data).toHaveLength(0);

      expect((await preview(engineer, 'csv', Buffer.from(csv), 'm.csv')).status).toBe(400); // sem kind
      expect((await preview(engineer, 'csv', undefined, 'x')).status).toBe(400); // sem arquivo
      expect((await preview(seller, 'csv', Buffer.from(csv), 'm.csv', 'MODULE')).status).toBe(403);
    });

    it('.PAN e .OND: campos lidos, convertidos e com confiança; arquivo trocado é recusado', async () => {
      const pan = await preview(engineer, 'pan', fixture('exemplo.pan'), 'modulo.PAN');
      const c = pan.body.candidates[0];
      expect(c).toMatchObject({
        kind: 'MODULE',
        manufacturer: 'Fabricante Teste',
        model: 'FT-550M-72',
        origin: 'PAN',
        missing: [],
      });
      expect(c.spec.betaVocPctPerC).toBeCloseTo(-0.27, 3);
      expect(c.fieldConfidence.betaVocPctPerC).toBe('MEDIUM');
      expect(pan.body.notes.join(' ')).toMatch(/mV\/°C/);

      const ond = await preview(engineer, 'ond', fixture('exemplo.ond'), 'inversor.OND');
      expect(ond.body.candidates[0]).toMatchObject({
        kind: 'INVERTER',
        model: 'FT-350K-12',
        origin: 'OND',
      });
      expect(ond.body.candidates[0].fieldConfidence.iMaxPerMpptA).toBe('LOW');

      const swapped = await preview(engineer, 'ond', fixture('exemplo.pan'), 'x.ond');
      expect(swapped.body.candidates).toEqual([]);
      expect(swapped.body.errors[0].message).toMatch(/módulo/);
      const junk = await preview(engineer, 'pan', Buffer.from('<html/>'), 'x.pan');
      expect(junk.body.errors[0].message).toMatch(/não reconhecido/);
    });

    it('ficha em PDF: campos sugeridos com confiança e o que falta; PDF sem texto é explicado', async () => {
      const pdf = textPdf([
        'Maximum Power (Pmax) 550 W',
        'Voltage at Maximum Power (Vmp) 41.7 V',
        'Current at Maximum Power (Imp) 13.19 A',
        'Open Circuit Voltage (Voc) 49.7 V',
        'Short Circuit Current (Isc) 13.98 A',
        'Temperature Coefficient of Voc -0.27 %/C',
        'Dimensions 2278 x 1134 x 35 mm',
      ]);
      const res = await preview(engineer, 'datasheet-pdf', pdf, 'ficha.pdf');
      expect(res.status).toBe(200);
      const c = res.body.candidates[0];
      expect(c).toMatchObject({ kind: 'MODULE', origin: 'DATASHEET_PDF', manufacturer: '' });
      expect(c.spec).toMatchObject({ pmaxWp: 550, vmppV: 41.7, vocV: 49.7, lengthMm: 2278 });
      expect(c.missing).toEqual(
        expect.arrayContaining(['alphaIscPctPerC', 'gammaPmaxPctPerC', 'technology']),
      );

      const empty = await preview(engineer, 'datasheet-pdf', textPdf(['x']), 'vazio.pdf');
      expect(empty.body.errors[0].message).toMatch(/sem texto|texto legível/);
      const broken = await preview(
        engineer,
        'datasheet-pdf',
        Buffer.from('%PDF-1.4 quebrado'),
        'q.pdf',
      );
      expect(broken.body.errors[0].message).toMatch(/PDF/);
    });

    it('confirmar grava rascunhos; modelo que já existe vira nova revisão; rascunho aberto bloqueia', async () => {
      const item = (model: string) => ({
        kind: 'MODULE',
        manufacturer: `Fab CSV ${suffix}`,
        model,
        spec: moduleSpec(),
        origin: 'CSV',
        fieldConfidence: { pmaxWp: 'HIGH' },
        referenceCostCents: 60000,
      });
      const res = await post('/catalog/import/commit', engineer, {
        items: [item('CSV-1'), item('CSV-9')],
      });
      expect(res.status).toBe(201);
      expect(res.body.created).toHaveLength(2);
      expect(res.body.created[0]).toMatchObject({
        status: 'DRAFT',
        origin: 'CSV',
        referenceCostCents: 60000,
      });

      // Já existe rascunho do mesmo modelo: conflito, e nada é gravado (tudo ou nada).
      const dup = await post('/catalog/import/commit', engineer, {
        items: [item('CSV-10'), item('CSV-1')],
      });
      expect(dup.status).toBe(409);
      expect((await get('/catalog/items?search=CSV-10', engineer)).body.data).toHaveLength(0);

      // Aprovado + importação do mesmo modelo = nova revisão.
      const first = res.body.created[0].id;
      await post(`/catalog/items/${first}/approve`, lead);
      const again = await post('/catalog/import/commit', engineer, { items: [item('CSV-1')] });
      expect(again.body.created[0]).toMatchObject({ revision: 2, supersedesId: first });
      const pre = await preview(
        engineer,
        'csv',
        Buffer.from(`fabricante;modelo\nFab CSV ${suffix};CSV-1`),
        'x.csv',
        'MODULE',
      );
      expect(pre.body.candidates[0].exists).toBe(true);

      const invalid = await post('/catalog/import/commit', engineer, {
        items: [{ ...item('Z'), spec: { pmaxWp: 1 } }],
      });
      expect(invalid.status).toBe(422);
    });
  });

  describe('tabelas de preço', () => {
    const importPrices = (csv: string, dryRun = false) =>
      t.http
        .post(`${API}/catalog/prices/import?dryRun=${dryRun}`)
        .set(bearer(engineer))
        .attach('file', Buffer.from(csv), { filename: 'precos.csv' });

    it('liga preços ao equipamento aprovado, aceita insumo avulso e informa o que não casou', async () => {
      const approved = (await get('/catalog/items?status=APPROVED&search=CSV-1', engineer)).body
        .data[0];
      const csv = [
        'fabricante;modelo;descricao;fornecedor;sku;preco_reais;vigencia_inicio;vigencia_fim',
        `Fab CSV ${suffix};CSV-1;;Distribuidora A;SKU-1;612,50;01/10/2026;31/12/2099`,
        `Fab CSV ${suffix};CSV-1;;Distribuidora B;;580,00;2025-01-01;2025-12-31`,
        ';;Estrutura de fixação por módulo;Distribuidora A;;85,90;01/10/2026;',
        `Ninguém;Modelo X;;Distribuidora A;;10,00;01/10/2026;`,
        `Fab CSV ${suffix};CSV-1;;;;10,00;01/10/2026;`,
        `Fab CSV ${suffix};CSV-1;;Distribuidora A;;abc;01/10/2026;`,
        `Fab CSV ${suffix};CSV-1;;Distribuidora A;;10,00;32/13/2026;`,
        `Fab CSV ${suffix};CSV-1;;Distribuidora A;;10,00;01/10/2026;01/09/2026`,
        ';;;Distribuidora A;;10,00;01/10/2026;',
      ].join('\n');

      const dry = await importPrices(csv, true);
      expect(dry.body).toMatchObject({ rowsRead: 9, created: 0, dryRun: true });
      expect(dry.body.unmatched).toEqual([{ row: 5, manufacturer: 'Ninguém', model: 'Modelo X' }]);
      expect(dry.body.errors.map((e: { row: number }) => e.row)).toEqual([6, 7, 8, 9, 10]);
      expect((await get('/catalog/prices', engineer)).body).toEqual([]);

      const real = await importPrices(csv);
      expect(real.body).toMatchObject({ created: 3, dryRun: false });
      const all = (await get('/catalog/prices', engineer)).body as {
        equipmentId: string | null;
        priceCents: number;
        description: string;
      }[];
      expect(all).toHaveLength(3);
      expect(all.find((p) => p.description.startsWith('Estrutura'))).toMatchObject({
        equipmentId: null,
        priceCents: 8590,
      });
      const forItem = (await get(`/catalog/prices?equipmentId=${approved.id}`, engineer)).body;
      expect(forItem.map((p: { priceCents: number }) => p.priceCents).sort()).toEqual([
        58000, 61250,
      ]);

      const at = (date: string) =>
        ctx.run({ tenantId: a.id }, () => priceService.currentPrice(approved.id, new Date(date)));
      expect((await at('2026-11-01T00:00:00Z'))?.priceCents).toBe(61250);
      expect(await at('2020-01-01T00:00:00Z')).toBeNull();
    });

    it('planilha sem as colunas obrigatórias, vazia ou sem permissão é recusada', async () => {
      expect((await importPrices('fabricante;modelo\nA;B')).status).toBe(400);
      expect((await importPrices('')).status).toBe(400);
      const res = await t.http
        .post(`${API}/catalog/prices/import`)
        .set(bearer(seller))
        .attach('file', Buffer.from('x'), { filename: 'p.csv' });
      expect(res.status).toBe(403);
      expect((await get('/catalog/prices/template', engineer)).text).toMatch(
        /^fabricante;modelo;descricao;fornecedor/,
      );
    });
  });

  describe('biblioteca de referência (CEC)', () => {
    const cec = [
      'Name,Manufacturer,Technology,Bifacial,STC,PTC,A_c,N_s,I_sc_ref,V_oc_ref,I_mp_ref,V_mp_ref,Alpha_sc,Beta_oc,T_NOCT,gamma_r',
      ',,,,W,W,m2,,A,V,A,V,A/C,V/C,C,%/C',
      `Ref ${suffix} R-550,Ref ${suffix},Mono-c-Si,0,550,520,2.58,144,13.98,49.7,13.19,41.7,0.00699,-0.13419,45,-0.34`,
    ].join('\n');

    it('a carga exige a fonte ligada no servidor (licença ainda não conferida)', async () => {
      const res = await t.http
        .post(`${API}/catalog/references/import?kind=MODULE`)
        .set(bearer(engineer))
        .attach('file', Buffer.from(cec), { filename: 'cec.csv' });
      expect(res.status).toBe(503);
      expect(res.body.message).toMatch(/desligada/);
    });

    it('com a fonte ligada: carrega, lista com atribuição, pede os campos que faltam e adota como rascunho', async () => {
      const on = await createTestApp({ DATA_HUB_ENABLED_SOURCES: 'cec-library' });
      try {
        const token = await tokenFor(on.http, a.admin);
        const load = await on.http
          .post(`${API}/catalog/references/import?kind=MODULE`)
          .set(bearer(token))
          .attach('file', Buffer.from(cec), { filename: 'cec.csv' });
        expect(load.body).toEqual({ read: 1, created: 1, updated: 0 });
        const again = await on.http
          .post(`${API}/catalog/references/import?kind=MODULE`)
          .set(bearer(token))
          .attach('file', Buffer.from(cec), { filename: 'cec.csv' });
        expect(again.body).toEqual({ read: 1, created: 0, updated: 0 });
        const bad = await on.http
          .post(`${API}/catalog/references/import?kind=MODULE`)
          .set(bearer(token))
          .attach('file', Buffer.from('a,b\n1,2'), { filename: 'x.csv' });
        expect(bad.status).toBe(422);

        const list = await on.http
          .get(`${API}/catalog/references?search=${suffix}`)
          .set(bearer(token));
        expect(list.body.data).toHaveLength(1);
        const ref = list.body.data[0];
        expect(ref).toMatchObject({ kind: 'MODULE', model: 'R-550', source: 'cec-library' });
        expect(ref.attribution).toContain('CEC');

        // A biblioteca não traz as dimensões: a adoção pede os campos que faltam.
        const missing = await on.http
          .post(`${API}/catalog/references/${ref.id}/adopt`)
          .set(bearer(token))
          .send({});
        expect(missing.status).toBe(422);
        expect(missing.body.details.map((i: { path: string }) => i.path)).toEqual(
          expect.arrayContaining(['lengthMm', 'widthMm']),
        );

        const adopted = await on.http
          .post(`${API}/catalog/references/${ref.id}/adopt`)
          .set(bearer(token))
          .send({ spec: { lengthMm: 2278, widthMm: 1134 } });
        expect(adopted.status).toBe(201);
        expect(adopted.body).toMatchObject({
          status: 'DRAFT',
          origin: 'CEC',
          manufacturer: `Ref ${suffix}`,
          model: 'R-550',
        });
        const row = await t.prisma.system.equipmentItem.findUniqueOrThrow({
          where: { id: adopted.body.id },
        });
        expect(row.externalRecordId).toBe(ref.id);
        expect(
          (
            await on.http
              .post(`${API}/catalog/references/${ref.id}/adopt`)
              .set(bearer(token))
              .send({ spec: { lengthMm: 2278, widthMm: 1134 } })
          ).status,
        ).toBe(409);
        expect(
          (
            await on.http
              .post(`${API}/catalog/references/00000000-0000-4000-8000-000000000000/adopt`)
              .set(bearer(token))
              .send({})
          ).status,
        ).toBe(404);
      } finally {
        await on.close();
      }
    });
  });

  describe('conferência semestral do INMETRO', () => {
    it('módulo aprovado sem conferência gera uma proposta, uma só; aprovar registra a revisão', async () => {
      const m = await post('/catalog/items', engineer, newModule('M-DUE'));
      await post(`/catalog/items/${m.body.id}/approve`, lead);
      const first = (await queue.process({ name: 'inmetro-due' })) as { proposed: number };
      expect(first.proposed).toBeGreaterThanOrEqual(1);
      expect(
        ((await queue.process({ name: 'inmetro-due' })) as { proposed: number }).proposed,
      ).toBe(0);

      const inbox = (await get('/data-hub/updates?type=CATALOG_ITEM&status=PENDING', admin))
        .body as {
        id: string;
        title: string;
      }[];
      const mine = inbox.find((p) => p.title.includes('M-DUE'));
      expect(mine?.title).toContain('INMETRO');
      const done = await post(`/data-hub/updates/${mine?.id}/decide`, admin, {
        decision: 'APPROVE',
      });
      expect(done.status).toBe(200);

      // Depois de conferir, o item sai da lista de vencidos.
      await post(`/catalog/items/${m.body.id}/inmetro`, engineer, {
        status: 'VERIFIED',
        registration: '1/2026',
      });
      const later = (await queue.process({ name: 'inmetro-due' })) as { proposed: number };
      const titles = (
        (await get('/data-hub/updates?type=CATALOG_ITEM&status=PENDING', admin)).body as {
          title: string;
        }[]
      ).map((p) => p.title);
      expect(titles.some((x) => x.includes('M-DUE'))).toBe(false);
      expect(later.proposed).toBeGreaterThanOrEqual(0);
    });
  });

  describe('busca de equipamentos do Off-Grid e carga da biblioteca CEC', () => {
    it('sem digitar, lista o que já existe do tipo; ao digitar, filtra; palavras do título classificam documentos sem tipo', async () => {
      const battery = await t.http
        .post(`${API}/catalog/items`)
        .set(bearer(engineer))
        .send({
          kind: 'BATTERY',
          manufacturer: `Bat ${suffix}`,
          model: 'LFP100-L',
          spec: { chemistry: 'LFP', nominalVoltageV: 51.2, capacityAh: 100, maxDodPct: 90 },
        });
      expect(battery.status).toBe(201);
      const link = await t.prisma.system.catalogSourceLink.create({
        data: { tenantId: a.id, url: `https://exemplo.test/${suffix}`, label: 'Fonte de teste' },
      });
      await t.prisma.system.catalogSourceDocument.create({
        data: {
          tenantId: a.id,
          linkId: link.id,
          url: `https://exemplo.test/${suffix}/bateria.pdf`,
          title: `Bateria Estacionária ${suffix} 48V 100AH`,
          brand: 'Marca',
          fileType: 'pdf',
          docType: 'DATASHEET',
          equipmentHint: 'OTHER',
          pageUrl: `https://exemplo.test/${suffix}`,
          confidence: 'LOW',
        },
      });
      const empty = await t.http.get(`${API}/catalog/search?kind=BATTERY`).set(bearer(engineer));
      expect(empty.status).toBe(200);
      const names = (empty.body as { model: string; origin: string }[]).map(
        (r) => `${r.origin}:${r.model}`,
      );
      expect(names).toEqual(expect.arrayContaining(['CATALOG:LFP100-L']));
      expect(names.some((n) => n.startsWith('LINK:') && n.includes(suffix))).toBe(true);
      const typed = await t.http
        .get(`${API}/catalog/search?kind=BATTERY&q=LFP100`)
        .set(bearer(engineer));
      expect((typed.body as unknown[]).length).toBe(1);
      const none = await t.http
        .get(`${API}/catalog/search?kind=GENERATOR&q=zzzinexistente`)
        .set(bearer(engineer));
      expect(none.body).toEqual([]);
    });

    it('documentos de proteção e cabo sem tipo são classificados pelas palavras do título', async () => {
      const link = await t.prisma.system.catalogSourceLink.create({
        data: {
          tenantId: a.id,
          url: `https://exemplo.test/prot-${suffix}`,
          label: 'Fonte de proteções',
        },
      });
      for (const title of [`Disjuntor 2P 32A curva C ${suffix}`, `Cabo solar 6mm² ${suffix}`]) {
        await t.prisma.system.catalogSourceDocument.create({
          data: {
            tenantId: a.id,
            linkId: link.id,
            url: `https://exemplo.test/prot-${suffix}/${encodeURIComponent(title)}.pdf`,
            title,
            brand: 'Marca',
            fileType: 'pdf',
            docType: 'DATASHEET',
            equipmentHint: 'OTHER',
            pageUrl: `https://exemplo.test/prot-${suffix}`,
            confidence: 'LOW',
          },
        });
      }
      const prot = await t.http
        .get(`${API}/catalog/search?kind=PROTECTION&q=${suffix}`)
        .set(bearer(engineer));
      expect((prot.body as { model: string }[]).map((r) => r.model)).toEqual([
        `Disjuntor 2P 32A curva C ${suffix}`,
      ]);
      const cable = await t.http.get(`${API}/catalog/search?kind=CABLE`).set(bearer(engineer));
      expect(
        (cable.body as { model: string }[]).some((r) => r.model.startsWith('Cabo solar')),
      ).toBe(true);
    });

    it('sincroniza a biblioteca CEC/SAM pela internet (resposta gravada) e a busca a encontra', async () => {
      const on = await createTestApp({ DATA_HUB_ENABLED_SOURCES: 'cec-library' });
      try {
        const { DataHubHttp } = await import('../src/platform/data-hub/data-hub-http');
        const http = on.app.get(DataHubHttp) as {
          getBuffer: (url: string) => Promise<{ body: Buffer; contentType: string | null }>;
        };
        const modules = [
          'Name,Manufacturer,Technology,Bifacial,STC,PTC,A_c,Length,Width,N_s,I_sc_ref,V_oc_ref,I_mp_ref,V_mp_ref,alpha_sc,beta_oc,T_NOCT,gamma_pmp',
          'Units,,,,,,m2,m,m,,A,V,A,V,A/K,V/K,C,%/K',
          `Sync ${suffix} S-400,Sync ${suffix},Mono-c-Si,0,400,380,1.9,1.8,1.05,72,10.5,48,9.9,40.5,0.005,-0.14,45,-0.37`,
        ].join('\n');
        const inverters = [
          'Name,Vac,Pso,Paco,Pdco,Vdco,C0,C1,C2,C3,Pnt,Vdcmax,Idcmax,Mppt_low,Mppt_high',
          'Units,V,W,W,W,V,1/W,1/V,1/V,1/V,W,V,A,V,V',
          `Sync ${suffix}: SI-5000 [240V],240,30,5000,5200,360,0,0,0,0,1,600,15,200,550`,
        ].join('\n');
        const urls: string[] = [];
        http.getBuffer = async (url) => {
          urls.push(url);
          return {
            body: Buffer.from(url.includes('Modules') ? modules : inverters),
            contentType: 'text/csv',
          };
        };
        const token = await tokenFor(on.http, a.admin);
        const res = await on.http.post(`${API}/catalog/references/sync`).set(bearer(token));
        expect([res.status, JSON.stringify(res.body)]).toEqual([200, expect.anything()]);
        expect(res.body.modules.created).toBe(1);
        expect(res.body.inverters.created).toBe(1);
        expect(urls.every((u) => u.startsWith('https://raw.githubusercontent.com/NREL/SAM/'))).toBe(
          true,
        );
        const found = await on.http
          .get(`${API}/catalog/search?kind=MODULE&q=Sync%20${suffix}`)
          .set(bearer(token));
        expect((found.body as { origin: string }[]).some((r) => r.origin === 'REFERENCE')).toBe(
          true,
        );
        const again = await on.http.post(`${API}/catalog/references/sync`).set(bearer(token));
        expect(again.body.modules).toEqual({ read: 1, created: 0, updated: 0 });
      } finally {
        await on.close();
      }
    });
  });
});
