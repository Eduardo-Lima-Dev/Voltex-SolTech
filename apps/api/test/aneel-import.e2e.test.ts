import { Readable } from 'node:stream';
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
import { auditOf } from './crm-support';

const HEADER =
  '"DatGeracaoConjuntoDados";"DscREH";"SigAgente";"NumCNPJDistribuidora";"DatInicioVigencia";"DatFimVigencia";"DscBaseTarifaria";"DscSubGrupo";"DscModalidadeTarifaria";"DscClasse";"DscSubClasse";"DscDetalhe";"NomPostoTarifario";"DscUnidadeTerciaria";"SigAgenteAcessante";"VlrTUSD";"VlrTE"';
const row = (
  agent: string,
  cnpj: string,
  tusd: string,
  te: string,
  extra: Record<string, string> = {},
) => {
  const v = {
    from: '2026-01-01',
    to: '2099-12-31',
    group: 'B1',
    base: 'Tarifa de Aplicação',
    ...extra,
  };
  return `"2026-10-18";"RESOLUÇÃO HOMOLOGATÓRIA Nº 9.999, DE 1 DE JANEIRO DE 2026";"${agent}";"${cnpj}";"${v.from}";"${v.to}";"${v.base}";"${v.group}";"Convencional";"Residencial";"Residencial";"Não se aplica";"Não se aplica";"MWh";"Não se aplica";"${tusd}";"${te}"`;
};

describe('Importação de tarifas da ANEEL (e2e)', () => {
  let t: TestApp;
  let a: SeededTenant;
  let b: SeededTenant;
  let admin: string;
  let seller: string;
  let adminB: string;
  let current = '';

  const run = (token: string) =>
    t.http.post(`${API}/reference-data/aneel/import`).set(bearer(token));

  beforeAll(async () => {
    t = await createTestApp();
    const { AneelSource } = await import('../src/platform/reference-data/aneel-import.service');
    t.app.get(AneelSource).open = async () => Readable.from([current]);
    a = await seedTenant(t.prisma, 'aneel');
    b = await seedTenant(t.prisma, 'aneelb');
    admin = await tokenFor(t.http, a.admin);
    seller = await tokenFor(t.http, a.salesperson);
    adminB = await tokenFor(t.http, b.admin);
  });
  afterAll(() => t.close());

  it('cadastra concessionárias (com CNPJ) e a tarifa residencial vigente, citando a fonte', async () => {
    current = `${HEADER}\n${row('ENEL-X', '11222333000181', '500,00', '300,00')}\n${row('LUZ-Y', '44555666000199', '400,00', '250,00')}\n${row('SO-GRUPO-A', '77888999000155', '100,00', '100,00', { group: 'A4' })}\n`;
    const res = await run(admin);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      rowsRead: 3,
      distributorsCreated: 3,
      tariffsCreated: 2,
      tariffsUpdated: 0,
      tariffsUnchanged: 0,
      source: {
        dataset: 'tarifas-distribuidoras-energia-eletrica',
        license: expect.stringContaining('ODbL'),
      },
    });

    const distributors = await t.http.get(`${API}/distributors`).set(bearer(seller));
    const enel = distributors.body.find((d: { name: string }) => d.name === 'ENEL-X');
    expect(enel).toMatchObject({ cnpj: '11222333000181', state: null });
    const tariffs = await t.http.get(`${API}/tariffs?distributorId=${enel.id}`).set(bearer(seller));
    expect(tariffs.body).toHaveLength(1);
    expect(tariffs.body[0]).toMatchObject({
      customerGroup: 'B',
      energyCentsPerKwh: 80,
      modality: 'Convencional (ANEEL, sem impostos)',
    });
    expect(tariffs.body[0].source).toMatch(/ANEEL Dados Abertos.*sem impostos/);
    expect(tariffs.body[0].source).toContain('RESOLUÇÃO HOMOLOGATÓRIA');
    expect((await auditOf(t, a.id, 'aneel.imported')).length).toBe(1);

    // a distribuidora só do Grupo A foi cadastrada, mas sem tarifa
    const groupA = distributors.body.find((d: { name: string }) => d.name === 'SO-GRUPO-A');
    expect(
      (await t.http.get(`${API}/tariffs?distributorId=${groupA.id}`).set(bearer(seller))).body,
    ).toEqual([]);
  });

  it('é idempotente; atualiza o valor quando a ANEEL reajusta e preserva edições manuais da concessionária', async () => {
    const again = await run(admin);
    expect(again.body).toMatchObject({
      distributorsCreated: 0,
      tariffsCreated: 0,
      tariffsUpdated: 0,
      tariffsUnchanged: 2,
    });

    const enel = (await t.http.get(`${API}/distributors`).set(bearer(seller))).body.find(
      (d: { name: string }) => d.name === 'ENEL-X',
    );
    await t.http.patch(`${API}/distributors/${enel.id}`).set(bearer(admin)).send({ state: 'ce' });

    current = `${HEADER}\n${row('ENEL-X', '11222333000181', '520,00', '300,00')}\n${row('LUZ-Y', '44555666000199', '400,00', '250,00')}\n`;
    const adjusted = await run(admin);
    expect(adjusted.body).toMatchObject({
      tariffsCreated: 0,
      tariffsUpdated: 1,
      tariffsUnchanged: 1,
    });
    const after = (await t.http.get(`${API}/distributors`).set(bearer(seller))).body.find(
      (d: { name: string }) => d.name === 'ENEL-X',
    );
    expect(after.state).toBe('CE');
    const tariffs = (
      await t.http.get(`${API}/tariffs?distributorId=${enel.id}`).set(bearer(seller))
    ).body;
    expect(tariffs).toHaveLength(1);
    expect(tariffs[0].energyCentsPerKwh).toBe(82);
  });

  it('um novo período de vigência vira outra tarifa e o histórico permanece', async () => {
    current = `${HEADER}\n${row('ENEL-X', '11222333000181', '520,00', '300,00', { from: '2026-01-01', to: '2026-12-31' })}\n${row('ENEL-X', '11222333000181', '560,00', '300,00', { from: '2027-01-01', to: '2027-12-31' })}\n`;
    const res = await run(admin);
    expect(res.body.tariffsCreated).toBe(1);
    const enel = (await t.http.get(`${API}/distributors`).set(bearer(seller))).body.find(
      (d: { name: string }) => d.name === 'ENEL-X',
    );
    const tariffs = (
      await t.http.get(`${API}/tariffs?distributorId=${enel.id}`).set(bearer(seller))
    ).body;
    expect(tariffs.map((x: { energyCentsPerKwh: number }) => x.energyCentsPerKwh).sort()).toEqual([
      82, 86,
    ]);
  });

  it('só quem gerencia regras importa; cada empresa recebe os seus próprios cadastros', async () => {
    expect((await run(seller)).status).toBe(403);
    expect((await t.http.post(`${API}/reference-data/aneel/import`)).status).toBe(401);
    expect((await t.http.get(`${API}/distributors`).set(bearer(adminB))).body).toEqual([]);
    current = `${HEADER}\n${row('ENEL-X', '11222333000181', '500,00', '300,00')}\n`;
    expect((await run(adminB)).body).toMatchObject({ distributorsCreated: 1, tariffsCreated: 1 });
    expect((await t.http.get(`${API}/distributors`).set(bearer(adminB))).body).toHaveLength(1);
  });

  it('falha de rede ao buscar o arquivo vira 503 com mensagem clara', async () => {
    const { AneelSource } = await import('../src/platform/reference-data/aneel-import.service');
    const source = t.app.get(AneelSource);
    const original = source.open;
    const { ServiceUnavailableException } = await import('@nestjs/common');
    source.open = async () => {
      throw new ServiceUnavailableException(
        'Não foi possível acessar o portal de Dados Abertos da ANEEL',
      );
    };
    const res = await run(admin);
    expect(res.status).toBe(503);
    expect(res.body.message).toMatch(/Dados Abertos da ANEEL/);
    source.open = original;
  });
});
