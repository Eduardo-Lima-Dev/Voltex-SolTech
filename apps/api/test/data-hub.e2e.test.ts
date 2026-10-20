import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  API,
  bearer,
  createTestApp,
  seedTenant,
  tokenFor,
  pdfBuffer,
  type SeededTenant,
  type TestApp,
} from './helpers';
import type { DataHubHttp } from '../src/platform/data-hub/data-hub-http';

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(
      resolve(__dirname, '../../../packages/solar-engine/src/io/fixtures', name),
      'utf8',
    ),
  );

const HEADER =
  '"DatGeracaoConjuntoDados";"DscREH";"SigAgente";"NumCNPJDistribuidora";"DatInicioVigencia";"DatFimVigencia";"DscBaseTarifaria";"DscSubGrupo";"DscModalidadeTarifaria";"DscClasse";"DscSubClasse";"DscDetalhe";"NomPostoTarifario";"DscUnidadeTerciaria";"SigAgenteAcessante";"VlrTUSD";"VlrTE"';
const aneelRow = (agent: string, tusd: string, te: string) =>
  `"2026-10-18";"RESOLUÇÃO HOMOLOGATÓRIA Nº 9.999, DE 1 DE JANEIRO DE 2026";"${agent}";"11222333000181";"2026-01-01";"2099-12-31";"Tarifa de Aplicação";"B1";"Convencional";"Residencial";"Residencial";"Não se aplica";"Não se aplica";"MWh";"Não se aplica";"${tusd}";"${te}"`;

/** Cada execução usa uma coordenada própria: o cache de clima é global e o banco de teste persiste. */
const run = Math.floor(Math.random() * 9000) + 1000;
const lat = -(10 + (run % 20) + (run % 97) / 100);
const lng = -(40 + (run % 15) + (run % 89) / 100);

describe('Central de Dados Externos (e2e)', () => {
  let t: TestApp;
  let a: SeededTenant;
  let b: SeededTenant;
  let admin: string;
  let adminB: string;
  let seller: string;
  let engineer: string;
  let calls: string[] = [];
  let respond: (url: string) => unknown = () => {
    throw new Error('sem resposta gravada');
  };
  let pages: Record<string, { body: Buffer; contentType: string }> = {};
  let csv = '';
  // Obtida logo após subir o app: `createTestApp` reimporta os módulos, e outra instância teria classes diferentes.
  let queue: { process: (job: { name: string }) => Promise<unknown> };

  const get = (path: string, token: string) => t.http.get(`${API}${path}`).set(bearer(token));
  const post = (path: string, token: string, body: object = {}) =>
    t.http.post(`${API}${path}`).set(bearer(token)).send(body);

  beforeAll(async () => {
    t = await createTestApp();
    const { DataHubHttp } = await import('../src/platform/data-hub/data-hub-http');
    const { AneelSource } = await import('../src/platform/reference-data/aneel-import.service');
    const { DataHubQueue } = await import('../src/platform/data-hub/data-hub.queue');
    queue = t.app.get(DataHubQueue);
    const http = t.app.get(DataHubHttp) as DataHubHttp;
    http.getJson = async (url) => {
      calls.push(url);
      return respond(url);
    };
    http.getBuffer = async (url) => {
      calls.push(url);
      const page = pages[url];
      if (!page) throw new Error('página fora do ar');
      return { body: page.body, contentType: page.contentType };
    };
    t.app.get(AneelSource).open = async () => Readable.from([csv]);

    a = await seedTenant(t.prisma, 'hub');
    b = await seedTenant(t.prisma, 'hubb');
    admin = await tokenFor(t.http, a.admin);
    adminB = await tokenFor(t.http, b.admin);
    seller = await tokenFor(t.http, a.salesperson);
    const eng = await t.prisma.system.user.create({
      data: {
        tenantId: a.id,
        name: 'Engenharia',
        email: `eng.${a.id.slice(0, 6)}@hub.test`,
        passwordHash: (await t.prisma.system.user.findUniqueOrThrow({ where: { id: a.owner.id } }))
          .passwordHash,
        role: 'ENGINEERING',
      },
    });
    engineer = await tokenFor(t.http, { id: eng.id, email: eng.email, role: 'ENGINEERING' });
  });
  afterAll(() => t.close());

  describe('fontes', () => {
    it('lista as fontes com licença e situação; leitura exige permissão de regras', async () => {
      const res = await get('/data-hub/sources', admin);
      expect(res.status).toBe(200);
      type Row = { key: string; licenseStatus: string; enabled: boolean; attribution: string };
      const byKey: Record<string, Row> = Object.fromEntries(
        (res.body as Row[]).map((s) => [s.key, s]),
      );
      expect(Object.keys(byKey).sort()).toEqual(['aneel-tariffs', 'nasa-power', 'pvgis']);
      expect(byKey['aneel-tariffs']?.licenseStatus).toBe('CLEARED');
      // Termos ainda não conferidos: a tela mostra a pendência (nada de "liberado" por omissão).
      expect(byKey['nasa-power']?.licenseStatus).toBe('PENDING_REVIEW');
      expect(byKey['pvgis']?.licenseStatus).toBe('PENDING_REVIEW');
      expect(byKey['nasa-power']?.attribution).toContain('NASA POWER');
      expect((await get('/data-hub/sources', seller)).status).toBe(403);
    });
  });

  describe('clima', () => {
    it('busca a climatologia, guarda em cache e não consulta a internet de novo', async () => {
      calls = [];
      respond = () => fixture('nasa-clim.json');
      const first = await get(`/data-hub/weather?latitude=${lat}&longitude=${lng}`, engineer);
      expect(first.status).toBe(200);
      expect(first.body).toMatchObject({
        source: 'nasa-power',
        kind: 'CLIMATOLOGY',
        cached: false,
        licenseStatus: 'PENDING_REVIEW',
      });
      expect(first.body.summary.ghiKwhM2Day[0]).toBe(5.8658);
      expect(first.body.attribution).toContain('NASA POWER');
      expect(first.body.warnings.join(' ')).toMatch(/termos de uso/);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toContain('/temporal/climatology/point');

      // Coordenada arredondada na mesma grade: mesmo cache.
      const again = await get(
        `/data-hub/weather?latitude=${lat + 0.001}&longitude=${lng - 0.001}`,
        engineer,
      );
      expect(again.body.cached).toBe(true);
      expect(calls).toHaveLength(1);

      const collection = await t.prisma.system.dataCollection.findFirstOrThrow({
        where: { source: { key: 'nasa-power' }, status: 'SUCCEEDED' },
        orderBy: { startedAt: 'desc' },
      });
      expect(collection.contentHash).toMatch(/^[0-9a-f]{64}$/);

      // Quem não tem permissão de projeto não consulta.
      expect((await get(`/data-hub/weather?latitude=${lat}&longitude=${lng}`, seller)).status).toBe(
        403,
      );
    });

    it('série horária do PVGIS fica comprimida e o resumo vem pronto', async () => {
      calls = [];
      respond = () => fixture('pvgis-series.json');
      const res = await get(
        `/data-hub/weather?source=pvgis&kind=hourly&year=2020&latitude=${lat}&longitude=${lng}`,
        engineer,
      );
      expect(res.status).toBe(200);
      expect(res.body.summary).toMatchObject({ hours: 72, missingHours: 0 });
      expect(calls[0]).toContain('/seriescalc');
      expect(calls[0]).toContain('angle=0');
      const row = await t.prisma.system.weatherSeries.findFirstOrThrow({
        where: { source: { key: 'pvgis' }, kind: 'HOURLY', period: '2020' },
      });
      expect(row.payload?.length).toBeGreaterThan(100);
    });

    it('valida o pedido: PVGIS não tem climatologia aqui e a série horária exige o ano', async () => {
      expect(
        (await get(`/data-hub/weather?source=pvgis&latitude=${lat}&longitude=${lng}`, engineer))
          .status,
      ).toBe(400);
      expect(
        (await get(`/data-hub/weather?kind=hourly&latitude=${lat}&longitude=${lng}`, engineer))
          .status,
      ).toBe(422);
      expect((await get('/data-hub/weather?latitude=99&longitude=0', engineer)).status).toBe(422);
    });

    it('falhas da fonte viram erro claro e ficam registradas', async () => {
      const { ExternalFetchError, ExternalRateLimitedError } =
        await import('../src/platform/data-hub/data-hub-http');
      const q = (n: number) => `/data-hub/weather?latitude=${lat - n}&longitude=${lng - n}`;

      respond = () => {
        throw new ExternalFetchError('power.larc.nasa.gov respondeu 500', 500);
      };
      expect((await get(q(1), engineer)).status).toBe(502);

      respond = () => {
        throw new ExternalRateLimitedError('https://power.larc.nasa.gov/x');
      };
      const limited = await get(q(2), engineer);
      expect(limited.status).toBe(503);
      expect(limited.body.message).toMatch(/limitou/);

      respond = () => ({ mudou: 'o formato' });
      const odd = await get(q(3), engineer);
      expect(odd.status).toBe(502);
      expect(odd.body.message).toMatch(/inesperada/);

      const failed = await t.prisma.system.dataCollection.count({
        where: { status: 'FAILED', source: { key: 'nasa-power' } },
      });
      expect(failed).toBeGreaterThanOrEqual(3);
      // Nada foi guardado em cache por uma coleta que falhou.
      respond = () => fixture('nasa-clim.json');
      expect((await get(q(1), engineer)).body.cached).toBe(false);
    });

    it('horizonte do PVGIS em cache, com o azimute convertido', async () => {
      calls = [];
      respond = () => fixture('pvgis-horizon.json');
      const q = `/data-hub/horizon?latitude=${lat}&longitude=${lng}`;
      const first = await get(q, engineer);
      expect(first.status).toBe(200);
      expect(first.body.points[0]).toEqual({ azimuthDegrees: 0, heightDegrees: 0.4 });
      expect(first.body.cached).toBe(false);
      expect((await get(q, engineer)).body.cached).toBe(true);
      expect(calls).toHaveLength(1);
    });

    it('fonte desligada no servidor: serve o que está em cache e recusa o que exigiria a internet', async () => {
      const off = await createTestApp({ DATA_HUB_ENABLED_SOURCES: '' });
      try {
        const token = await tokenFor(off.http, a.admin);
        const cached = await off.http
          .get(`${API}/data-hub/weather?latitude=${lat}&longitude=${lng}`)
          .set(bearer(token));
        expect(cached.status).toBe(200);
        expect(cached.body.cached).toBe(true);
        const fresh = await off.http
          .get(`${API}/data-hub/weather?latitude=${lat - 7}&longitude=${lng - 7}`)
          .set(bearer(token));
        expect(fresh.status).toBe(503);
        expect(fresh.body.message).toMatch(/desligada/);
        const sources = await off.http.get(`${API}/data-hub/sources`).set(bearer(token));
        expect((sources.body as { enabled: boolean }[]).every((s) => !s.enabled)).toBe(true);
      } finally {
        await off.close();
      }
    });
  });

  describe('fontes vigiadas e caixa de atualizações', () => {
    const URL_A = 'https://203.0.113.10/norma-distribuidora';
    let watchId = '';

    it('recusa endereços internos e que não sejam http(s)', async () => {
      for (const url of [
        'http://localhost:3000/x',
        'http://127.0.0.1/x',
        'http://10.0.0.5/x',
        'http://192.168.1.1/x',
        'http://169.254.169.254/latest',
        'http://[::1]/x',
        'ftp://203.0.113.10/x',
      ]) {
        const res = await post('/data-hub/watches', admin, { label: 'Interna', url });
        expect([400, 422], url).toContain(res.status);
      }
    });

    it('cadastra, faz a coleta-base e detecta mudança com a diferença', async () => {
      const created = await post('/data-hub/watches', admin, { label: 'Norma XYZ', url: URL_A });
      expect(created.status).toBe(201);
      watchId = created.body.id;
      expect((await post('/data-hub/watches', admin, { label: 'Outra', url: URL_A })).status).toBe(
        409,
      );

      const html = (lines: string[]) => ({
        body: Buffer.from(
          `<html><body><script>x()</script>${lines.map((l) => `<p>${l}</p>`).join('')}</body></html>`,
        ),
        contentType: 'text/html; charset=utf-8',
      });
      pages = { [URL_A]: html(['Art. 1 Texto A', 'Art. 2 Texto B']) };
      const baseline = await post(`/data-hub/watches/${watchId}/check`, admin);
      expect(baseline.body.status).toBe('BASELINE');
      expect((await get('/data-hub/updates', admin)).body).toEqual([]);

      expect((await post(`/data-hub/watches/${watchId}/check`, admin)).body.status).toBe(
        'UNCHANGED',
      );

      pages = { [URL_A]: html(['Art. 1 Texto A', 'Art. 2 Texto B revisado', 'Art. 3 Novo']) };
      const changed = await post(`/data-hub/watches/${watchId}/check`, admin);
      expect(changed.body.status).toBe('CHANGED');
      expect(changed.body.watch.changedAt).not.toBeNull();

      const inbox = (await get('/data-hub/updates?status=PENDING', admin)).body as {
        id: string;
        type: string;
        diff: { added: string[]; removed: string[] };
        origin: { source: string; url: string; contentHash: string };
      }[];
      expect(inbox).toHaveLength(1);
      expect(inbox[0]?.type).toBe('WATCH_CHANGE');
      expect(inbox[0]?.diff.added).toEqual(['Art. 2 Texto B revisado', 'Art. 3 Novo']);
      expect(inbox[0]?.diff.removed).toEqual(['Art. 2 Texto B']);
      expect(inbox[0]?.origin).toMatchObject({ source: 'source-watch', url: URL_A });
      expect(inbox[0]?.origin.contentHash).toMatch(/^[0-9a-f]{64}$/);

      // Repetir a coleta com o mesmo texto não duplica a proposta.
      expect((await post(`/data-hub/watches/${watchId}/check`, admin)).body.status).toBe(
        'UNCHANGED',
      );
      expect((await get('/data-hub/updates', admin)).body).toHaveLength(1);

      const event = await t.prisma.system.outboxEvent.findFirstOrThrow({
        where: { tenantId: a.id, type: 'ExternalSourceChanged' },
      });
      expect(event.payload).toMatchObject({ watchId, addedLines: 2, removedLines: 1 });
    });

    it('página fora do ar ou sem texto vira erro registrado, sem derrubar nada', async () => {
      pages = {};
      const down = await post(`/data-hub/watches/${watchId}/check`, admin);
      expect(down.body.status).toBe('ERROR');
      expect(down.body.watch.lastError).toMatch(/fora do ar/);

      pages = { [URL_A]: { body: pdfBuffer(), contentType: 'application/pdf' } };
      const empty = await post(`/data-hub/watches/${watchId}/check`, admin);
      expect(empty.body.status).toBe('ERROR');
      expect(empty.body.watch.lastError).toMatch(/PDF/);
    });

    it('decisão: descartar exige motivo; aprovar registra quem decidiu; não decide duas vezes', async () => {
      const [proposal] = (await get('/data-hub/updates?status=PENDING', admin)).body as {
        id: string;
      }[];
      const id = proposal?.id as string;
      expect(
        (await post(`/data-hub/updates/${id}/decide`, seller, { decision: 'APPROVE' })).status,
      ).toBe(403);
      expect(
        (await post(`/data-hub/updates/${id}/decide`, admin, { decision: 'DISCARD' })).status,
      ).toBe(422);
      const approved = await post(`/data-hub/updates/${id}/decide`, admin, {
        decision: 'APPROVE',
        reason: 'Mudança conferida pelo responsável técnico',
      });
      expect(approved.status).toBe(200);
      expect(approved.body).toMatchObject({ status: 'APPROVED', decidedById: a.admin.id });
      expect(
        (
          await post(`/data-hub/updates/${id}/decide`, admin, {
            decision: 'DISCARD',
            reason: 'tarde demais',
          })
        ).status,
      ).toBe(409);
      const audit = await t.prisma.system.auditLog.findFirst({
        where: { tenantId: a.id, action: 'update_proposal.approved', entityId: id },
      });
      expect(audit).not.toBeNull();
      const event = await t.prisma.system.outboxEvent.findFirst({
        where: { tenantId: a.id, type: 'UpdateProposalDecided' },
      });
      expect(event?.payload).toMatchObject({ proposalId: id, decision: 'APPROVE' });
    });

    it('cada empresa só vê as próprias fontes e propostas', async () => {
      expect((await get('/data-hub/watches', adminB)).body).toEqual([]);
      expect((await get('/data-hub/updates', adminB)).body).toEqual([]);
      expect((await post(`/data-hub/watches/${watchId}/check`, adminB)).status).toBe(404);
      const [mine] = (await get('/data-hub/updates', admin)).body as { id: string }[];
      expect((await get(`/data-hub/updates/${mine?.id}`, adminB)).status).toBe(404);
    });

    it('editar, desligar e remover; leitura e escrita exigem as permissões certas', async () => {
      expect((await get('/data-hub/watches', engineer)).status).toBe(200);
      expect(
        (await post('/data-hub/watches', engineer, { label: 'X', url: URL_A + '2' })).status,
      ).toBe(403);
      const patched = await t.http
        .patch(`${API}/data-hub/watches/${watchId}`)
        .set(bearer(admin))
        .send({ enabled: false, label: 'Norma XYZ (desligada)' });
      expect(patched.body).toMatchObject({ enabled: false, label: 'Norma XYZ (desligada)' });
      const removed = await t.http.delete(`${API}/data-hub/watches/${watchId}`).set(bearer(admin));
      expect(removed.status).toBe(200);
      expect((await get('/data-hub/watches', admin)).body).toEqual([]);
    });
  });

  describe('tarifas da ANEEL viram propostas', () => {
    let distributorId = '';

    it('só propõe o que mudou, só para quem tem a concessionária, e aprovar cria a tarifa', async () => {
      const dist = await t.prisma.system.distributor.create({
        data: { tenantId: a.id, name: 'HUBDIST' },
      });
      distributorId = dist.id;
      csv = [
        HEADER,
        aneelRow('HUBDIST', '500,00', '300,00'),
        aneelRow('OUTRA', '100,00', '100,00'),
      ].join('\n');

      const first = await post('/data-hub/tariffs/scan', admin);
      expect(first.status).toBe(200);
      expect(first.body).toMatchObject({ proposed: 1, alreadyProposed: 0, distributorsChecked: 1 });
      // A empresa B não tem essa concessionária: nada para ela.
      expect((await post('/data-hub/tariffs/scan', adminB)).body).toMatchObject({ proposed: 0 });

      const again = await post('/data-hub/tariffs/scan', admin);
      expect(again.body).toMatchObject({ proposed: 0, alreadyProposed: 1 });

      const [proposal] = (await get('/data-hub/updates?type=TARIFF', admin)).body as {
        id: string;
        title: string;
        proposed: { energyCentsPerKwh: number };
        origin: { license: string };
      }[];
      expect(proposal?.title).toContain('HUBDIST');
      expect(proposal?.proposed.energyCentsPerKwh).toBe(80);
      expect(proposal?.origin.license).toContain('ODbL');
      // Enquanto ninguém decide, nada vira tarifa.
      expect(await t.prisma.system.tariff.count({ where: { distributorId } })).toBe(0);

      const approved = await post(`/data-hub/updates/${proposal?.id}/decide`, admin, {
        decision: 'APPROVE',
      });
      expect(approved.status).toBe(200);
      const tariff = await t.prisma.system.tariff.findFirstOrThrow({ where: { distributorId } });
      expect(tariff).toMatchObject({ energyCentsPerKwh: 80, customerGroup: 'B', tenantId: a.id });
      expect(tariff.source).toContain('ANEEL Dados Abertos');

      // Já aplicada: a próxima busca não propõe de novo.
      expect((await post('/data-hub/tariffs/scan', admin)).body).toMatchObject({
        proposed: 0,
        unchanged: 1,
      });

      // Tarifa reajustada: nova proposta, com o valor anterior na diferença.
      csv = [HEADER, aneelRow('HUBDIST', '600,00', '300,00')].join('\n');
      expect((await post('/data-hub/tariffs/scan', admin)).body).toMatchObject({ proposed: 1 });
      const pending = (await get('/data-hub/updates?type=TARIFF&status=PENDING', admin)).body as {
        diff: { previousEnergyCentsPerKwh: number };
        proposed: { energyCentsPerKwh: number };
      }[];
      expect(pending[0]?.diff.previousEnergyCentsPerKwh).toBe(80);
      expect(pending[0]?.proposed.energyCentsPerKwh).toBe(90);
    });

    it('descartar não altera nenhuma tarifa', async () => {
      const [pending] = (await get('/data-hub/updates?type=TARIFF&status=PENDING', admin)).body as {
        id: string;
      }[];
      const res = await post(`/data-hub/updates/${pending?.id}/decide`, admin, {
        decision: 'DISCARD',
        reason: 'Aguardando o reajuste oficial',
      });
      expect(res.body.status).toBe('DISCARDED');
      const tariff = await t.prisma.system.tariff.findFirstOrThrow({ where: { distributorId } });
      expect(tariff.energyCentsPerKwh).toBe(80);
    });
  });

  describe('fila e agendamento', () => {
    it('a varredura das fontes vigiadas percorre as empresas e a de tarifas respeita a fonte ligada', async () => {
      pages = {
        'https://203.0.113.20/lei': { body: Buffer.from('Lei texto 1'), contentType: 'text/plain' },
      };
      const w = await post('/data-hub/watches', adminB, {
        label: 'Lei',
        url: 'https://203.0.113.20/lei',
        kind: 'LAW',
      });
      expect(w.status).toBe(201);
      const first = await queue.process({ name: 'watch-all' });
      expect(first).toMatchObject({ tenants: 1, changed: 0, errors: 0 });
      pages = {
        'https://203.0.113.20/lei': { body: Buffer.from('Lei texto 2'), contentType: 'text/plain' },
      };
      expect(await queue.process({ name: 'watch-all' })).toMatchObject({ changed: 1 });
      expect((await get('/data-hub/updates', adminB)).body).toHaveLength(1);

      csv = [HEADER].join('\n');
      expect(await queue.process({ name: 'tariff-scan' })).toMatchObject({ proposed: 0 });
      expect(await queue.process({ name: 'desconhecido' })).toBeUndefined();
    });
  });
});
