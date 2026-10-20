import { describe, expect, it } from 'vitest';
import { extractModuleDatasheet } from './datasheet-fields.js';

const SHEET = `
FABRICANTE TESTE  Módulo monocristalino N-type TOPCon bifacial
Electrical Characteristics (STC)
Maximum Power (Pmax) 545 W 550 W 555 W
Voltage at Maximum Power (Vmp) 41.5 V 41.7 V 41.9 V
Current at Maximum Power (Imp) 13.14 A 13.19 A 13.24 A
Open Circuit Voltage (Voc) 49.5 V 49.7 V 49.9 V
Short Circuit Current (Isc) 13.93 A 13.98 A 14.03 A
Module Efficiency 21.1 % 21.3 % 21.5 %
Temperature Coefficient of Voc −0.27 %/°C
Temperature Coefficient of Isc +0.05 %/°C
Temperature Coefficient of Pmax -0.34 %/°C
NOCT 45 ± 2 °C
Maximum System Voltage 1500 V
Maximum Series Fuse Rating 25 A
Dimensions 2278 × 1134 × 35 mm
Weight 28.0 kg
`;

describe('ficha técnica de módulo', () => {
  it('lê os rótulos em inglês, com coeficientes de sinal unicode e tabela de vários modelos', () => {
    const r = extractModuleDatasheet(SHEET);
    expect(r.spec).toMatchObject({
      pmaxWp: 545,
      vmppV: 41.5,
      imppA: 13.14,
      vocV: 49.5,
      iscA: 13.93,
      efficiencyPct: 21.1,
      betaVocPctPerC: -0.27,
      alphaIscPctPerC: 0.05,
      gammaPmaxPctPerC: -0.34,
      noctC: 45,
      maxSystemVoltageV: 1500,
      maxSeriesFuseA: 25,
      lengthMm: 2278,
      widthMm: 1134,
      thicknessMm: 35,
      weightKg: 28,
      technology: 'MONO_SI',
      bifacial: true,
    });
  });

  it('colunas de modelos diferentes: usa o primeiro, com confiança média e aviso', () => {
    const r = extractModuleDatasheet(SHEET);
    expect(r.fieldConfidence.pmaxWp).toBe('MEDIUM');
    expect(r.fieldConfidence.betaVocPctPerC).toBe('HIGH');
    expect(r.notes.join(' ')).toMatch(/pmaxWp.*3 valores diferentes/);
    expect(r.notes.join(' ')).toMatch(/Fabricante e modelo/);
    expect(r.manufacturer).toBe('');
    expect(r.missing).toEqual([]);
  });

  it('lê rótulos em português', () => {
    const r = extractModuleDatasheet(`Potência máxima 410 Wp
Tensão em Pmax 31,2 V
Corrente em Pmax 13,14 A
Tensão de circuito aberto 37,6 V
Corrente de curto-circuito 13,90 A
Coeficiente de temperatura de Voc -0,29 %/°C
Coeficiente de temperatura de Pmax -0,36 %/°C
Coeficiente de temperatura de Isc 0,05 %/°C
Peso 22,5 kg
policristalino`);
    expect(r.spec).toMatchObject({
      pmaxWp: 410,
      vmppV: 31.2,
      imppA: 13.14,
      vocV: 37.6,
      iscA: 13.9,
      betaVocPctPerC: -0.29,
      gammaPmaxPctPerC: -0.36,
      weightKg: 22.5,
      technology: 'POLY_SI',
    });
  });

  it('coeficiente sem sinal é assumido negativo com confiança baixa e aviso', () => {
    const r = extractModuleDatasheet('Temperature Coefficient of Voc 0.27 %/°C');
    expect(r.spec.betaVocPctPerC).toBe(-0.27);
    expect(r.fieldConfidence.betaVocPctPerC).toBe('LOW');
    expect(r.notes.join(' ')).toMatch(/sem sinal/);
  });

  it('descarta números fora da faixa plausível e dimensões que não são de módulo', () => {
    const r = extractModuleDatasheet('Maximum Power 9000 W\nCaixa 300 × 200 × 100 mm\nVoc 49,5 V');
    expect(r.spec.pmaxWp).toBeUndefined();
    expect(r.spec.lengthMm).toBeUndefined();
    expect(r.spec.vocV).toBe(49.5);
    expect(r.missing).toContain('pmaxWp');
  });

  it('texto sem nada reconhecível devolve tudo faltando e avisa', () => {
    const r = extractModuleDatasheet('Lorem ipsum');
    expect(r.spec).toEqual({});
    expect(r.missing.length).toBeGreaterThan(5);
  });

  it('avisa quando a ficha cobre uma faixa de potências; polisilício e multicristalino', () => {
    const r = extractModuleDatasheet('Pmax 540 W\n540-560 W\nmulticrystalline');
    expect(r.notes.join(' ')).toMatch(/faixa de potências/);
    expect(r.spec.technology).toBe('POLY_SI');
  });
});
