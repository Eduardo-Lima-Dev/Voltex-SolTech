import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ImportParseError } from './import-types.js';
import {
  flattenPvsyst,
  parseOndInverter,
  parsePanModule,
  parsePvsystFile,
  pvsystObjectType,
} from './pvsyst.js';

const read = (name: string) => readFileSync(resolve(__dirname, 'fixtures', name), 'utf8');

describe('.PAN (módulo)', () => {
  const pan = read('exemplo.pan');

  it('lê as grandezas elétricas e converte as unidades do PVsyst', () => {
    const r = parsePanModule(pan);
    expect(r).toMatchObject({
      kind: 'MODULE',
      manufacturer: 'Fabricante Teste',
      model: 'FT-550M-72',
    });
    expect(r.spec).toMatchObject({
      technology: 'MONO_SI',
      pmaxWp: 550,
      vmppV: 41.7,
      imppA: 13.19,
      vocV: 49.7,
      iscA: 13.98,
      gammaPmaxPctPerC: -0.34,
      cellsInSeries: 144,
      lengthMm: 2278,
      widthMm: 1134,
      thicknessMm: 35,
      weightKg: 28,
      maxSystemVoltageV: 1500,
      bifacial: true,
    });
    // muVocSpec −134,2 mV/°C ÷ (49,7 V × 10) = −0,27 %/°C; muISC 6,99 mA/°C ÷ (13,98 A × 10) = 0,05 %/°C.
    expect(r.spec.betaVocPctPerC).toBeCloseTo(-0.27, 3);
    expect(r.spec.alphaIscPctPerC).toBeCloseTo(0.05, 3);
    expect(r.spec.efficiencyPct).toBeCloseTo(21.29, 1);
  });

  it('marca a confiança de cada campo e não deixa faltar nada obrigatório', () => {
    const r = parsePanModule(pan);
    expect(r.fieldConfidence).toMatchObject({
      pmaxWp: 'HIGH',
      gammaPmaxPctPerC: 'HIGH',
      betaVocPctPerC: 'MEDIUM',
      lengthMm: 'MEDIUM',
      efficiencyPct: 'LOW',
    });
    expect(r.missing).toEqual([]);
    expect(r.notes.join(' ')).toMatch(/mV\/°C/);
    expect(r.notes.join(' ')).toMatch(/NOCT/);
  });

  it('reproduz o trecho real de um módulo de filme fino (conversões conferidas à mão)', () => {
    const real = `PVObject_=pvModule
  Version=7.26
  PVObject_Commercial=pvCommercial
    Manufacturer=First Solar
    Model=FS-6470A-P
    Width=1.245
    Height=2.024
    Weight=35.0
  End of PVObject pvCommercial
  Technol=mtCdTe
  NCelS=264
  PNom=470.0
  Isc=2.61
  Voc=224.3
  Imp=2.458
  Vmp=191.1
  muISC=1.044
  muVocSpec=-628.0400000000001
  muPmpReq=-0.32
  VMaxIEC=1500
End of PVObject pvModule`;
    const r = parsePanModule(real);
    expect(r.spec.technology).toBe('THIN_FILM');
    // 1,044 mA/°C ÷ 2,61 A = 0,04 %/°C; −628,04 mV/°C ÷ 224,3 V = −0,28 %/°C.
    expect(r.spec.alphaIscPctPerC).toBeCloseTo(0.04, 3);
    expect(r.spec.betaVocPctPerC).toBeCloseTo(-0.28, 3);
    expect(r.spec.lengthMm).toBe(2024);
  });

  it('tecnologia desconhecida vira OUTRA com confiança baixa; sem fabricante/modelo recusa', () => {
    const r = parsePanModule(pan.replace('mtSiMono', 'mtNova'));
    expect(r.spec.technology).toBe('OTHER');
    expect(r.fieldConfidence.technology).toBe('LOW');
    expect(() => parsePanModule('PVObject_=pvModule\n  Voc=40\nEnd of PVObject pvModule')).toThrow(
      ImportParseError,
    );
  });

  it('o que falta no arquivo aparece em `missing`', () => {
    const r = parsePanModule(pan.replace(/muVocSpec=[^\n]*\n/, '').replace(/Width=[^\n]*\n/, ''));
    expect(r.missing).toEqual(expect.arrayContaining(['betaVocPctPerC', 'lengthMm', 'widthMm']));
  });
});

describe('.OND (inversor)', () => {
  const ond = read('exemplo.ond');

  it('lê o arquivo no formato real do fabricante (BOM, CRLF, seções aninhadas)', () => {
    const r = parseOndInverter(ond);
    expect(r).toMatchObject({
      kind: 'INVERTER',
      manufacturer: 'Fabricante Teste',
      model: 'FT-350K-12',
    });
    expect(r.spec).toMatchObject({
      pAcNomW: 350000,
      pAcMaxW: 350000,
      vAcV: 800,
      phases: 3,
      mpptMinV: 480,
      mpptMaxV: 1500,
      vDcMaxV: 1500,
      efficiencyMaxPct: 99,
      efficiencyEuroPct: 98.8,
      iAcMaxA: 252.6,
      mpptCount: 12,
      inputsPerMppt: 2,
      topology: 'STRING',
    });
  });

  it('a corrente por MPPT é DERIVADA (IMaxDC total ÷ MPPT) e fica com confiança baixa e aviso', () => {
    const r = parseOndInverter(ond);
    expect(r.spec.iMaxPerMpptA).toBe(40);
    expect(r.fieldConfidence.iMaxPerMpptA).toBe('LOW');
    expect(r.fieldConfidence.topology).toBe('LOW');
    expect(r.fieldConfidence.pAcNomW).toBe('MEDIUM');
    expect(r.notes.join(' ')).toMatch(/TOTAL/);
    expect(r.missing).toEqual([]);
  });

  it('monofásico e arquivo sem MPPT', () => {
    const mono = parseOndInverter(ond.replace('MonoTri=Tri', 'MonoTri=Mono'));
    expect(mono.spec.phases).toBe(1);
    const semMppt = parseOndInverter(ond.replace(/NbMPPT=\d+\r?\n/g, ''));
    expect(semMppt.missing).toEqual(expect.arrayContaining(['mpptCount', 'iMaxPerMpptA']));
  });
});

describe('detecção e utilitários', () => {
  it('reconhece o tipo pelo cabeçalho e recusa outros arquivos', () => {
    expect(pvsystObjectType(read('exemplo.pan'))).toBe('pvModule');
    expect(pvsystObjectType(read('exemplo.ond'))).toBe('pvGInverter');
    expect(pvsystObjectType('qualquer coisa')).toBeNull();
    expect(parsePvsystFile(read('exemplo.pan')).kind).toBe('MODULE');
    expect(parsePvsystFile(read('exemplo.ond')).kind).toBe('INVERTER');
    expect(() => parsePvsystFile('<html></html>')).toThrow(/não reconhecido/);
  });

  it('flattenPvsyst guarda o primeiro valor, aceita espaço antes do = e ignora "End of"', () => {
    const map = flattenPvsyst('A=1\nA=2\nPInEffMax =153\nEnd of X=9\nsem igual');
    expect(map.get('A')).toBe('1');
    expect(map.get('PInEffMax')).toBe('153');
    expect(map.has('End of X')).toBe(false);
  });
});
