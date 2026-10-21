import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildLayoutLines } from './layout.js';
import { extractInverterDatasheet } from './datasheet-inverter.js';

const fixture = (name: string) =>
  JSON.parse(readFileSync(resolve(__dirname, 'fixtures', name), 'utf8')) as {
    documentText: string;
    lines: { cells: { text: string; x0: number; x1: number }[] }[];
  };
const read = (name: string) => {
  const f = fixture(name);
  return extractInverterDatasheet(f.lines, f.documentText);
};

/** Tabelas reais (texto das fichas públicas de fabricantes): uma coluna por modelo, células que cobrem vários modelos. */
describe('ficha de inversor em PDF (colunas por modelo)', () => {
  it('CSI 350 kW: dois modelos, valores por coluna e valores compartilhados', () => {
    const [a, b] = read('inverter-csi-350k.json');
    expect([a?.model, b?.model]).toEqual(['CSI-350K-T800 1A-E', 'CSI-350K-T800 1B-E']);
    expect(a?.manufacturer).toBe('CSI Solar');
    expect(a?.spec).toMatchObject({
      topology: 'STRING',
      vDcMaxV: 1500,
      vStartV: 550,
      mpptMinV: 500,
      mpptMaxV: 1500,
      mpptCount: 12,
      inputsPerMppt: 2,
      iMaxPerMpptA: 40,
      iscMaxPerMpptA: 60,
      vAcV: 800,
      phases: 3,
      iAcMaxA: 254,
      pAcMaxW: 352000,
      efficiencyMaxPct: 99.01,
      efficiencyEuroPct: 98.8,
    });
    expect(b?.spec).toMatchObject({ mpptCount: 16, iMaxPerMpptA: 32, inputsPerMppt: 2 });
    expect(a?.missing).toEqual([]);
  });

  it('sem potência nominal na ficha: vem do nome do modelo, com confiança baixa e aviso', () => {
    const [a] = read('inverter-csi-350k.json');
    expect(a?.spec.pAcNomW).toBe(350000);
    expect(a?.fieldConfidence.pAcNomW).toBe('LOW');
    expect(a?.notes.join(' ')).toMatch(/nome do modelo/);
  });

  it('CSI 15–25 kW: cinco modelos; faixa MPPT ausente vira campo faltando (não inventa)', () => {
    const list = read('inverter-csi-15-25k.json');
    expect(list.map((i) => i.spec.pAcNomW)).toEqual([15000, 17000, 20000, 23000, 25000]);
    expect(list.map((i) => i.spec.iAcMaxA)).toEqual([22.8, 25.8, 30.4, 34.9, 37.9]);
    for (const item of list) {
      expect(item.spec).toMatchObject({
        mpptCount: 2,
        inputsPerMppt: 2,
        iMaxPerMpptA: 32,
        iscMaxPerMpptA: 40,
        vDcMaxV: 1100,
        phases: 3,
        vAcV: 380,
        exportLimitation: true,
      });
      expect(item.missing).toEqual(['mpptMinV', 'mpptMaxV']);
    }
    expect(list[0]?.fieldConfidence.vAcV).toBe('MEDIUM');
  });

  it('célula que cobre vários modelos é atribuída pela posição, com confiança baixa', () => {
    const list = read('inverter-csi-15-25k.json');
    expect(list[4]?.spec.pAcMaxW).toBe(25000);
    expect(list[4]?.fieldConfidence.pAcMaxW).toBe('LOW');
    expect(list[0]?.notes.join(' ')).toMatch(/cobre mais de um modelo/);
  });

  it('GT3: seis modelos, correntes diferentes por MPPT usam o menor valor e dão aviso', () => {
    const list = read('inverter-gt3-12-25k.json');
    expect(list).toHaveLength(6);
    expect(list.map((i) => i.model)).toEqual([
      'GT3-12KD1',
      'GT3-15KD1',
      'GT3-17KD1',
      'GT3-20KD1',
      'GT3-22KD1',
      'GT3-25KD1',
    ]);
    expect(list[0]?.spec).toMatchObject({
      pDcMaxW: 18000,
      pAcNomW: 12000,
      pAcMaxW: 13200,
      mpptMinV: 140,
      mpptMaxV: 1000,
      vStartV: 160,
      mpptCount: 2,
      inputsPerMppt: 2,
      iMaxPerMpptA: 20,
      iscMaxPerMpptA: 26,
      vAcV: 380,
      phases: 3,
    });
    expect(list[5]?.spec).toMatchObject({
      pAcNomW: 25000,
      iMaxPerMpptA: 40,
      iscMaxPerMpptA: 52,
      iAcMaxA: 39.7,
      efficiencyMaxPct: 98.6,
      efficiencyEuroPct: 98.2,
    });
    expect(list[0]?.notes.join(' ')).toMatch(/usado o menor/);
    expect(list[0]?.manufacturer).toBe('');
    expect(list[0]?.missing).toEqual([]);
  });

  it('Chint (português, um valor por modelo e pares por MPPT): três modelos', () => {
    const list = read('inverter-chint-scal.json');
    expect(list.map((i) => i.model)).toEqual([
      'CPS SCA7.5KTL-PSM/EU',
      'CPS SCA8KTL-PSM/EU',
      'CPS SCA10KTL-PSM/EU',
    ]);
    expect(list[0]?.manufacturer).toBe('Chint');
    expect(list[0]?.spec).toMatchObject({
      pDcMaxW: 12750,
      vDcMaxV: 550,
      mpptMinV: 60,
      mpptMaxV: 540,
      vStartV: 90,
      mpptCount: 2,
      inputsPerMppt: 2,
      iMaxPerMpptA: 20,
      iscMaxPerMpptA: 26,
      pAcNomW: 7500,
      pAcMaxW: 8250,
      vAcV: 220,
      phases: 1,
      iAcMaxA: 37.5,
      efficiencyMaxPct: 97.7,
      efficiencyEuroPct: 97.3,
    });
    expect(list[2]?.spec).toMatchObject({ pDcMaxW: 17000, pAcNomW: 10000, iAcMaxA: 45.5 });
    expect(list.every((i) => i.missing.length === 0)).toBe(true);
  });

  it('Deye híbrido (inglês, nome do modelo e rótulos quebrados em duas linhas): sete modelos', () => {
    const list = read('inverter-deye-hybrid.json');
    expect(list).toHaveLength(7);
    expect(list[0]?.model).toBe('SUN-3.6K-SG05LP1-EU-SM2-P');
    expect(list[6]?.model).toBe('SUN-10K-SG05LP1-EU-SM2-P');
    expect(list[0]?.spec).toMatchObject({
      topology: 'HYBRID',
      phases: 1,
      pDcMaxW: 7200,
      pAcNomW: 3600,
      pAcMaxW: 3960,
      vDcMaxV: 500,
      vStartV: 125,
      mpptMinV: 150,
      mpptMaxV: 425,
      mpptCount: 2,
      inputsPerMppt: 1,
      iMaxPerMpptA: 18,
      iscMaxPerMpptA: 27,
      iAcMaxA: 17.3,
      vAcV: 220,
      efficiencyMaxPct: 97.6,
      efficiencyEuroPct: 96.5,
    });
    expect(list[6]?.spec).toMatchObject({
      pAcNomW: 10000,
      inputsPerMppt: 2,
      iMaxPerMpptA: 32,
      iscMaxPerMpptA: 48,
      iAcMaxA: 47.9,
    });
    expect(list.every((i) => i.missing.length === 0)).toBe(true);
  });

  it('Huawei (milhar com ponto, nome do modelo em duas linhas, rótulo com nota de rodapé)', () => {
    const list = read('inverter-huawei-l1.json');
    expect(list.map((i) => i.model).slice(0, 3)).toEqual([
      'SUN2000-2KTL-L1',
      'SUN2000-3KTL-L1',
      'SUN2000-3.68KTL-L1',
    ]);
    expect(list[0]?.manufacturer).toBe('Huawei');
    expect(list[5]?.spec).toMatchObject({
      pDcMaxW: 7500,
      pAcNomW: 5000,
      pAcMaxW: 5500,
      vDcMaxV: 600,
      vStartV: 100,
      mpptMinV: 90,
      mpptMaxV: 530,
      mpptCount: 2,
      inputsPerMppt: 1,
      iMaxPerMpptA: 13.5,
      iscMaxPerMpptA: 20,
      iAcMaxA: 25,
      phases: 1,
      efficiencyMaxPct: 98.4,
      efficiencyEuroPct: 97.8,
    });
    expect(list.every((i) => i.missing.length === 0)).toBe(true);
  });

  it('APsystems DS3-H (microinversor, um modelo, "Máxima…" por extenso, "20A x 2", VA como potência)', () => {
    const [m, ...rest] = read('inverter-apsystems-ds3h.json');
    expect(rest).toEqual([]);
    expect(m?.manufacturer).toBe('APsystems');
    expect(m?.model).toBe('DS3-H');
    expect(m?.spec).toMatchObject({
      topology: 'MICRO',
      mpptMinV: 28,
      mpptMaxV: 45,
      vDcMaxV: 60,
      iMaxPerMpptA: 20,
      iscMaxPerMpptA: 20,
      mpptCount: 2,
      pAcNomW: 1050,
      pAcMaxW: 1050,
      vAcV: 220,
      phases: 1,
      iAcMaxA: 4.8,
      efficiencyMaxPct: 96.5,
      efficiencyEuroPct: 95,
    });
    expect(m?.missing).toEqual([]);
    // O que foi deduzido vem com confiança menor e aviso.
    expect(m?.fieldConfidence.pAcNomW).toBe('MEDIUM');
    expect(m?.fieldConfidence.phases).toBe('LOW');
    expect(m?.fieldConfidence.iAcMaxA).toBe('LOW');
    expect(m?.notes.join(' ')).toMatch(/potência contínua máxima.*nominal/);
  });

  it('Elgin string (faixa MPPT com "de operação" no meio, 16A/16A por MPPT, "1F/N/PE")', () => {
    const [m] = read('inverter-elgin-string.json');
    expect(m?.manufacturer).toBe('Elgin');
    expect(m?.spec).toMatchObject({
      vDcMaxV: 550,
      vStartV: 80,
      mpptMinV: 80,
      mpptMaxV: 520,
      iMaxPerMpptA: 16,
      iscMaxPerMpptA: 20,
      mpptCount: 2,
      pAcNomW: 3600,
      vAcV: 220,
      phases: 1,
    });
    expect(m?.missing).toEqual([]);
  });

  it('Elgin híbrido (faixa entre parênteses, "Nº de MPPT/N° de Strings", potência só no nome)', () => {
    const [m] = read('inverter-elgin-hybrid.json');
    expect(m?.spec).toMatchObject({
      topology: 'HYBRID',
      pDcMaxW: 7000,
      vDcMaxV: 500,
      mpptMinV: 150,
      mpptMaxV: 425,
      mpptCount: 2,
      inputsPerMppt: 1,
      iMaxPerMpptA: 13,
      pAcMaxW: 5500,
      pAcNomW: 5000,
    });
    expect(m?.spec.vAcV).toBeGreaterThanOrEqual(100); // tensão da bateria (60 V) não vale como tensão de rede
    expect(m?.missing).toEqual([]);
  });

  it('sem linha de modelos não há o que ler; sem coluna o valor único vale para todos', () => {
    expect(extractInverterDatasheet([{ cells: [{ text: 'Texto solto', x0: 0, x1: 50 }] }])).toEqual(
      [],
    );
    const mono = extractInverterDatasheet(
      [
        {
          cells: [
            { text: 'Modelo', x0: 0, x1: 20 },
            { text: 'MONO-5K', x0: 100, x1: 140 },
          ],
        },
        {
          cells: [
            { text: 'Potência nominal de saída', x0: 0, x1: 90 },
            { text: '5 kW', x0: 100, x1: 130 },
          ],
        },
        {
          cells: [
            { text: 'Tensão nominal de saída', x0: 0, x1: 90 },
            { text: '220 V', x0: 100, x1: 130 },
          ],
        },
        {
          cells: [
            { text: 'Máx. tensão de entrada', x0: 0, x1: 90 },
            { text: '600 V', x0: 100, x1: 130 },
          ],
        },
      ],
      'Inversor monofásico de string Growatt',
    );
    expect(mono[0]?.spec).toMatchObject({ pAcNomW: 5000, vAcV: 220, phases: 1, vDcMaxV: 600 });
    expect(mono[0]?.manufacturer).toBe('Growatt');
  });
});

describe('buildLayoutLines', () => {
  it('agrupa por linha, junta palavras próximas e separa colunas distantes', () => {
    const lines = buildLayoutLines([
      { text: 'Tensão', x: 10, y: 100, width: 30 },
      { text: 'máxima', x: 43, y: 100.5, width: 30 },
      { text: '1100V', x: 200, y: 100, width: 25 },
      { text: 'Linha 2', x: 10, y: 80, width: 30 },
      { text: ' ', x: 5, y: 80, width: 1 },
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0]?.cells.map((c) => c.text)).toEqual(['Tensão máxima', '1100V']);
    expect(lines[1]?.cells).toHaveLength(1);
  });
});
