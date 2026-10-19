import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { parseAneelCsv } from './aneel-import.service';

const HEADER =
  '"DatGeracaoConjuntoDados";"DscREH";"SigAgente";"NumCNPJDistribuidora";"DatInicioVigencia";"DatFimVigencia";"DscBaseTarifaria";"DscSubGrupo";"DscModalidadeTarifaria";"DscClasse";"DscSubClasse";"DscDetalhe";"NomPostoTarifario";"DscUnidadeTerciaria";"SigAgenteAcessante";"VlrTUSD";"VlrTE"';

/** Linha no formato real do arquivo da ANEEL (valores SINTÉTICOS). */
const row = (o: Partial<Record<string, string>> = {}) => {
  const v = {
    reh: 'RESOLUÇÃO HOMOLOGATÓRIA Nº 9.999, DE 1 DE JANEIRO DE 2026',
    agent: 'DIST-A',
    cnpj: '11222333000181',
    from: '2026-01-01',
    to: '2026-12-31',
    base: 'Tarifa de Aplicação',
    group: 'B1',
    modality: 'Convencional',
    klass: 'Residencial',
    sub: 'Residencial',
    detail: 'Não se aplica',
    posto: 'Não se aplica',
    unit: 'MWh',
    tusd: '500,00',
    te: '300,00',
    ...o,
  };
  return `"2026-10-18";"${v.reh}";"${v.agent}";"${v.cnpj}";"${v.from}";"${v.to}";"${v.base}";"${v.group}";"${v.modality}";"${v.klass}";"${v.sub}";"${v.detail}";"${v.posto}";"${v.unit}";"Não se aplica";"${v.tusd}";"${v.te}"`;
};
const csv = (...rows: string[]) => Readable.from([`${HEADER}\n${rows.join('\n')}\n`]);
const TODAY = new Date('2026-10-18T12:00:00Z');

describe('parseAneelCsv', () => {
  it('converte R$/MWh (TUSD + TE) em centavos por kWh', async () => {
    const parsed = await parseAneelCsv(csv(row()), TODAY);
    expect(parsed.tariffs).toHaveLength(1);
    expect(parsed.tariffs[0]).toMatchObject({
      agent: 'DIST-A',
      cnpj: '11222333000181',
      tusdPerMwh: 500,
      tePerMwh: 300,
      energyCentsPerKwh: 80, // (500 + 300) R$/MWh = R$ 0,80/kWh = 80 centavos
    });
    expect(parsed.tariffs[0]!.validFrom.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(parsed.tariffs[0]!.validTo?.toISOString()).toBe('2026-12-31T00:00:00.000Z');
  });

  it('lê números com vírgula decimal e ponto de milhar, e ",00" como zero', async () => {
    const parsed = await parseAneelCsv(csv(row({ tusd: '1.234,56', te: ',00' })), TODAY);
    expect(parsed.tariffs[0]!.energyCentsPerKwh).toBe(123.456);
  });

  it('guarda só o escopo: B1 residencial convencional, tarifa de aplicação, em MWh e vigente', async () => {
    const parsed = await parseAneelCsv(
      csv(
        row({ agent: 'OK' }),
        row({ agent: 'BASE-ECON', base: 'Base Econômica' }),
        row({ agent: 'BRANCA', modality: 'Branca' }),
        row({ agent: 'PREPAGO', modality: 'Convencional pré-pagamento' }),
        row({ agent: 'COMERCIAL', klass: 'Comercial', sub: 'Comercial' }),
        row({ agent: 'GRUPO-A', group: 'A4' }),
        row({ agent: 'EM-KWH', unit: 'kWh' }),
        row({ agent: 'ENCERRADA', from: '2024-01-01', to: '2025-01-01' }),
        row({ agent: 'COM-DETALHE', detail: 'Irrigação' }),
        row({ agent: 'ZERADA', tusd: '0,00', te: '0,00' }),
      ),
      TODAY,
    );
    expect(parsed.tariffs.map((t) => t.agent)).toEqual(['OK']);
    // Todas as distribuidoras aparecem, mesmo as sem tarifa no escopo (para o cadastro de concessionárias).
    expect([...parsed.agents.keys()]).toEqual(
      expect.arrayContaining(['OK', 'BASE-ECON', 'GRUPO-A', 'ENCERRADA']),
    );
    expect(parsed.rowsRead).toBe(10);
  });

  it('descarta linhas repetidas e mantém vigências diferentes da mesma distribuidora', async () => {
    const parsed = await parseAneelCsv(
      csv(row(), row(), row({ from: '2027-01-01', to: '2027-12-31', tusd: '550,00' })),
      TODAY,
    );
    expect(parsed.tariffs).toHaveLength(2);
    expect(parsed.tariffs.map((t) => t.energyCentsPerKwh)).toEqual([80, 85]);
  });

  it('aceita BOM e tarifa sem fim de vigência', async () => {
    const stream = Readable.from([`\uFEFF${HEADER}\n${row({ to: '' })}\n`]);
    const parsed = await parseAneelCsv(stream, TODAY);
    expect(parsed.tariffs).toHaveLength(1);
    expect(parsed.tariffs[0]!.validTo).toBeNull();
  });

  it('arquivo só com cabeçalho não devolve nada', async () => {
    const parsed = await parseAneelCsv(csv(), TODAY);
    expect(parsed).toMatchObject({ rowsRead: 0, tariffs: [] });
  });
});
