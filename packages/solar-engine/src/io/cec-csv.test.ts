import { describe, expect, it } from 'vitest';
import { ImportParseError } from './import-types.js';
import { parseCecInverters, parseCecModules } from './cec-csv.js';

const MODULES = [
  'Name,Manufacturer,Technology,Bifacial,STC,PTC,A_c,N_s,I_sc_ref,V_oc_ref,I_mp_ref,V_mp_ref,Alpha_sc,Beta_oc,T_NOCT,gamma_r',
  ',,,,W,W,m2,,A,V,A,V,A/C,V/C,C,%/C',
  'Fabricante Teste FT-550M,Fabricante Teste,Mono-c-Si,0,550,520,2.58,144,13.98,49.7,13.19,41.7,0.00699,-0.13419,45,-0.34',
  'Outro OT-300,Outro,Thin Film,1,300,280,1.6,100,2.1,90,1.9,75,0.001,-0.25,46,-0.3',
  'Sem Numeros,X,Mono,0,,,,,,,,,,,,',
].join('\n');

describe('módulos CEC', () => {
  it('converte coeficientes absolutos em %/°C, separa fabricante e modelo e ignora a linha de unidades', () => {
    const items = parseCecModules(MODULES);
    expect(items).toHaveLength(2);
    const [a, b] = items;
    expect(a).toMatchObject({ manufacturer: 'Fabricante Teste', model: 'FT-550M' });
    expect(a?.spec).toMatchObject({
      pmaxWp: 550,
      vmppV: 41.7,
      imppA: 13.19,
      vocV: 49.7,
      iscA: 13.98,
      gammaPmaxPctPerC: -0.34,
      noctC: 45,
      cellsInSeries: 144,
      technology: 'MONO_SI',
      bifacial: false,
    });
    // 0,00699 A/°C ÷ 13,98 A = 0,05 %/°C; −0,13419 V/°C ÷ 49,7 V = −0,27 %/°C.
    expect(a?.spec.alphaIscPctPerC).toBeCloseTo(0.05, 3);
    expect(a?.spec.betaVocPctPerC).toBeCloseTo(-0.27, 3);
    expect(b?.spec).toMatchObject({ technology: 'THIN_FILM', bifacial: true });
  });

  it('sem dimensões na planilha: comprimento e largura ficam em `missing`, e há aviso de mercado', () => {
    const [a] = parseCecModules(MODULES);
    expect(a?.missing).toEqual(['lengthMm', 'widthMm']);
    expect(a?.notes.join(' ')).toMatch(/norte-americano/);
  });

  it('tecnologia desconhecida e fabricante só no nome', () => {
    const [m] = parseCecModules('Name,STC,Technology\nAcme AC-100,100,Cristal\n');
    expect(m?.manufacturer).toBe('Acme');
    expect(m?.spec.technology).toBe('OTHER');
    expect(m?.fieldConfidence.technology).toBe('LOW');
  });

  it('arquivo que não é CEC recusa', () => {
    expect(() => parseCecModules('a,b\n1,2')).toThrow(ImportParseError);
  });
});

const INVERTERS = [
  'Name,Vac,Pso,Paco,Pdco,Vdco,C0,C1,C2,C3,Pnt,Vdcmax,Idcmax,Mppt_low,Mppt_high',
  'Fabricante Teste: FT-5000-TL [220V],220,20,5000,5200,360,0,0,0,0,1,600,15,100,550',
  'Micro Co.: MICRO-0.3-I-OUTD [208V],208,2,300,310,40,0,0,0,0,0.1,60,10,22,48',
  'Linha Sem Potencia,208,,,,,,,,,,,,,',
].join('\n');

describe('inversores CEC', () => {
  it('separa fabricante, modelo e tensão do nome; marca como baixa a confiança do que é aproximado', () => {
    const items = parseCecInverters(INVERTERS);
    expect(items).toHaveLength(2);
    const [a, b] = items;
    expect(a).toMatchObject({ manufacturer: 'Fabricante Teste', model: 'FT-5000-TL' });
    expect(a?.spec).toMatchObject({
      pAcNomW: 5000,
      vDcMaxV: 600,
      mpptMinV: 100,
      mpptMaxV: 550,
      vAcV: 220,
      topology: 'STRING',
    });
    expect(a?.fieldConfidence.iMaxPerMpptA).toBe('LOW');
    expect(a?.fieldConfidence.pDcMaxW).toBe('LOW');
    expect(b?.spec.topology).toBe('MICRO');
    expect(a?.missing).toEqual(expect.arrayContaining(['mpptCount', 'phases']));
  });

  it('nome sem dois-pontos e sem tensão usa a coluna Vac', () => {
    const [i] = parseCecInverters('Name,Vac,Paco,Pdco\nXyz Modelo 1,240,3000,3100\n');
    expect(i?.manufacturer).toBe('Xyz');
    expect(i?.spec.vAcV).toBe(240);
    expect(i?.fieldConfidence.vAcV).toBe('LOW');
  });
});

describe('formato real da biblioteca SAM', () => {
  const REAL = [
    'Name,Manufacturer,Technology,Bifacial,STC,PTC,A_c,Length,Width,N_s,I_sc_ref,V_oc_ref,I_mp_ref,V_mp_ref,alpha_sc,beta_oc,T_NOCT,a_ref,I_L_ref,I_o_ref,R_s,R_sh_ref,Adjust,gamma_pmp,BIPV,Version,Date',
    'Units,,,,,,m2,m,m,,A,V,A,V,A/K,V/K,C,V,A,A,Ohm,Ohm,%,%/K,,,',
    '[0],lib_manufacturer,cec_material,lib,x,x,x,x,x,x,x,x,x,x,x,x,x,x,x,x,x,x,x,x,x,x,x',
    'Ablytek 6MN6A270,Ablytek,Mono-c-Si,0,270,243,1.63,1.65,0.99,60,9.34,38.63,8.81,30.72,0.0055,-0.1167,47.4,1.6,9.4,5e-11,0.3,300,10,-0.38,N,SAM 2015,1/1/2020',
  ].join('\n');

  it('lê colunas em minúsculas, o coeficiente de potência em %/K e as dimensões em metros', () => {
    const [m] = parseCecModules(REAL);
    expect(m?.spec).toMatchObject({
      pmaxWp: 270,
      gammaPmaxPctPerC: -0.38,
      lengthMm: 1650,
      widthMm: 990,
    });
    expect(m?.spec.betaVocPctPerC).toBeCloseTo(-0.3021, 3);
    expect(m?.spec.alphaIscPctPerC).toBeCloseTo(0.0589, 3);
    expect(m?.missing).toEqual([]);
  });
});
