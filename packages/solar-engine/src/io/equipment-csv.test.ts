import { describe, expect, it } from 'vitest';
import { parseDelimited, detectDelimiter } from './delimited.js';
import { ImportParseError } from './import-types.js';
import { equipmentCsvTemplate, parseEquipmentCsv } from './equipment-csv.js';

describe('CSV genérico', () => {
  it('detecta o separador e respeita aspas, aspas duplicadas e quebras de linha', () => {
    expect(detectDelimiter('a;b;c')).toBe(';');
    expect(detectDelimiter('a,b,c')).toBe(',');
    expect(detectDelimiter('a\tb')).toBe('\t');
    expect(detectDelimiter('abc')).toBe(',');
    const rows = parseDelimited('\uFEFFa;b\r\n"x;y";"diz ""oi"""\n\n"linha\nquebrada";2');
    expect(rows).toEqual([
      ['a', 'b'],
      ['x;y', 'diz "oi"'],
      ['linha\nquebrada', '2'],
    ]);
  });

  it('última linha sem quebra e linhas em branco', () => {
    expect(parseDelimited('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(parseDelimited('\n\n')).toEqual([]);
  });
});

const moduleCsv = [
  'fabricante;modelo;tecnologia;pmax_wp;vmpp_v;impp_a;voc_v;isc_a;beta_voc_pct_c;alpha_isc_pct_c;gamma_pmax_pct_c;comprimento_mm;largura_mm;bifacial;custo_referencia_reais;coluna_extra',
  'Fabricante Teste;FT-550M;Monocristalino;550;41,7;13,19;49,7;13,98;-0,27;0,05;-0,34;2278;1134;sim;612,50;x',
  'Fabricante Teste;FT-400P;poli;400;;;;;;;;;;;;',
].join('\n');

describe('planilha de módulos', () => {
  it('lê números com vírgula, enumerações em português, booleano e custo', () => {
    const r = parseEquipmentCsv('MODULE', moduleCsv);
    expect(r.errors).toEqual([]);
    expect(r.ignoredColumns).toEqual(['coluna_extra']);
    const [a, b] = r.items;
    expect(a?.spec).toMatchObject({
      technology: 'MONO_SI',
      pmaxWp: 550,
      vmppV: 41.7,
      betaVocPctPerC: -0.27,
      lengthMm: 2278,
      bifacial: true,
    });
    expect(a?.fieldConfidence.pmaxWp).toBe('HIGH');
    expect(a?.referenceCostCents).toBe(61250);
    expect(a?.missing).toEqual([]);
    // Células vazias = não informado.
    expect(b?.spec).toEqual({ technology: 'POLY_SI', pmaxWp: 400 });
    expect(b?.missing).toContain('vocV');
    expect(b?.referenceCostCents).toBeUndefined();
  });

  it('erros por linha: número inválido, inteiro fracionado, sim/não, enumeração e identidade faltando', () => {
    const csv = [
      'fabricante;modelo;tecnologia;pmax_wp;celulas_em_serie;bifacial',
      'A;M1;mono;abc;72;sim',
      'A;M2;mono;500;72,5;sim',
      'A;M3;mono;500;72;talvez',
      'A;M4;vidro;500;72;sim',
      ';M5;mono;500;72;sim',
      'A;M6;mono;500;72;não',
    ].join('\n');
    const r = parseEquipmentCsv('MODULE', csv);
    expect(r.errors.map((e) => e.row)).toEqual([2, 3, 4, 5, 6]);
    expect(r.errors[0]?.message).toMatch(/pmax_wp/);
    expect(r.errors[1]?.message).toMatch(/celulas_em_serie/);
    expect(r.errors[2]?.message).toMatch(/sim ou não/);
    expect(r.errors[3]?.message).toMatch(/tecnologia/);
    expect(r.errors[4]?.message).toMatch(/obrigatórios/);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]?.spec.bifacial).toBe(false);
  });

  it('cabeçalhos com acento e caixa diferentes funcionam; sem fabricante/modelo recusa; vazia recusa', () => {
    const r = parseEquipmentCsv('MODULE', 'Fabricante;MODELO;Tecnologia\nA;B;Mono');
    expect(r.items).toHaveLength(1);
    expect(() => parseEquipmentCsv('MODULE', 'a;b\n1;2')).toThrow(ImportParseError);
    expect(() => parseEquipmentCsv('MODULE', '')).toThrow(/vazia/);
  });
});

describe('inversores, proteções e cabos', () => {
  it('inversor: fases por texto e topologia', () => {
    const csv = [
      'fabricante;modelo;topologia;potencia_ca_nominal_w;tensao_cc_maxima_v;mppt_min_v;mppt_max_v;numero_mppt;corrente_max_por_mppt_a;tensao_ca_v;fases;limitacao_exportacao',
      'F;I1;string;5000;1100;140;1000;2;16;220;monofásico;sim',
      'F;I2;microinversor;2000;60;22;55;4;14;220;trifasico;não',
    ].join('\n');
    const r = parseEquipmentCsv('INVERTER', csv);
    expect(r.errors).toEqual([]);
    expect(r.items[0]?.spec).toMatchObject({
      topology: 'STRING',
      phases: 1,
      exportLimitation: true,
    });
    expect(r.items[1]?.spec).toMatchObject({ topology: 'MICRO', phases: 3 });
    expect(r.items[0]?.missing).toEqual([]);
  });

  it('proteção e cabo', () => {
    const p = parseEquipmentCsv(
      'PROTECTION',
      'fabricante;modelo;tipo_protecao;corrente_nominal_a;tensao_nominal_v;norma\nF;P1;fusível cc;15;1000;IEC 60269-6',
    );
    expect(p.items[0]?.spec).toMatchObject({
      protectionKind: 'FUSE_DC',
      ratedCurrentA: 15,
      standard: 'IEC 60269-6',
    });
    const c = parseEquipmentCsv(
      'CABLE',
      'fabricante;modelo;tipo_cabo;secao_mm2;condutor;tensao_nominal_v\nF;C1;solar cc;6;cobre;1800',
    );
    expect(c.items[0]?.spec).toMatchObject({
      cableKind: 'DC_SOLAR',
      crossSectionMm2: 6,
      conductor: 'CU',
    });
    expect(c.items[0]?.missing).toEqual([]);
  });

  it('o modelo de planilha de cada tipo começa com fabricante e modelo e termina no custo', () => {
    for (const kind of ['MODULE', 'INVERTER', 'PROTECTION', 'CABLE'] as const) {
      const header = equipmentCsvTemplate(kind).trim().split(';');
      expect(header.slice(0, 2)).toEqual(['fabricante', 'modelo']);
      expect(header.at(-1)).toBe('custo_referencia_reais');
    }
    // O modelo gerado é aceito pelo próprio leitor.
    expect(parseEquipmentCsv('MODULE', equipmentCsvTemplate('MODULE')).items).toEqual([]);
  });
});
