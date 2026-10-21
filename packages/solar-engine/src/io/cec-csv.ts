import type { FieldConfidence } from '@voltex/shared';
import { parseDelimited } from './delimited.js';
import { ImportParseError, missingFields, toNumber, type ParsedEquipment } from './import-types.js';

/**
 * Leitor das planilhas da biblioteca CEC/SAM (módulos e inversores de referência, mercado norte-americano).
 * As colunas seguem o formato conhecido do pvlib (`CEC Modules.csv`, `CEC Inverters.csv`); o leitor localiza o
 * cabeçalho pelo nome e ignora as linhas de unidades. **A licença dos arquivos ainda não foi conferida**
 * (`docs/referencias/fontes-externas.md`): a fonte `cec-library` fica desligada até lá.
 */
export const CEC_IO_VERSION = 'cec-io-1.0.0';

function table(text: string, firstColumn: string): { header: string[]; rows: string[][] } {
  const all = parseDelimited(text, ',');
  const at = all.findIndex((r) => (r[0] ?? '').trim().toLowerCase() === firstColumn.toLowerCase());
  if (at < 0)
    throw new ImportParseError(
      `Cabeçalho "${firstColumn}" não encontrado: não é uma planilha CEC.`,
    );
  return { header: (all[at] as string[]).map((h) => h.trim()), rows: all.slice(at + 1) };
}

const TECHNOLOGY: [RegExp, 'MONO_SI' | 'POLY_SI' | 'THIN_FILM'][] = [
  [/mono/i, 'MONO_SI'],
  [/multi|poly/i, 'POLY_SI'],
  [/thin|cdte|cigs|a-si|film/i, 'THIN_FILM'],
];

const r4 = (v: number): number => Math.round(v * 10_000) / 10_000;

export function parseCecModules(text: string): ParsedEquipment[] {
  const { header, rows } = table(text, 'Name');
  // O SAM publica os nomes das colunas ora em maiúsculas, ora em minúsculas (alpha_sc, gamma_pmp...).
  const lower = header.map((h) => h.toLowerCase());
  const at = (name: string) => lower.indexOf(name.toLowerCase());
  const col = (cells: string[], ...names: string[]) => {
    for (const name of names) {
      const v = toNumber(cells[at(name)]);
      if (v !== undefined) return v;
    }
    return undefined;
  };
  const str = (cells: string[], name: string) => (cells[at(name)] ?? '').trim();
  const out: ParsedEquipment[] = [];
  for (const cells of rows) {
    const stc = col(cells, 'STC');
    // Linhas de unidades e de rodapé não têm potência numérica.
    if (stc === undefined) continue;
    const name = str(cells, 'Name');
    const manufacturer = str(cells, 'Manufacturer') || name.split(' ')[0] || '';
    const model = name.startsWith(manufacturer)
      ? name.slice(manufacturer.length).trim() || name
      : name;
    const isc = col(cells, 'I_sc_ref');
    const voc = col(cells, 'V_oc_ref');
    const spec: Record<string, unknown> = {};
    const conf: Record<string, FieldConfidence> = {};
    const put = (field: string, value: unknown, level: FieldConfidence = 'HIGH') => {
      if (value === undefined) return;
      spec[field] = value;
      conf[field] = level;
    };
    put('pmaxWp', stc);
    put('iscA', isc);
    put('vocV', voc);
    put('imppA', col(cells, 'I_mp_ref'));
    put('vmppV', col(cells, 'V_mp_ref'));
    const alpha = col(cells, 'Alpha_sc', 'alpha_sc');
    if (alpha !== undefined && isc) put('alphaIscPctPerC', r4((alpha / isc) * 100), 'MEDIUM');
    const beta = col(cells, 'Beta_oc', 'beta_oc');
    if (beta !== undefined && voc) put('betaVocPctPerC', r4((beta / voc) * 100), 'MEDIUM');
    put('gammaPmaxPctPerC', col(cells, 'gamma_r', 'gamma_pmp'));
    const length = col(cells, 'Length');
    const width = col(cells, 'Width');
    if (length !== undefined && width !== undefined && length > 0.2 && width > 0.2) {
      put('lengthMm', Math.round(Math.max(length, width) * 1000), 'MEDIUM');
      put('widthMm', Math.round(Math.min(length, width) * 1000), 'MEDIUM');
    }
    put('noctC', col(cells, 'T_NOCT'));
    const ns = col(cells, 'N_s');
    if (ns !== undefined && Number.isInteger(ns)) put('cellsInSeries', ns);
    const tech = str(cells, 'Technology');
    const mapped = TECHNOLOGY.find(([re]) => re.test(tech))?.[1];
    put('technology', mapped ?? 'OTHER', mapped ? 'MEDIUM' : 'LOW');
    put('bifacial', col(cells, 'Bifacial') === 1);
    out.push({
      kind: 'MODULE',
      manufacturer,
      model,
      spec,
      fieldConfidence: conf,
      missing: missingFields('MODULE', spec),
      notes: [
        'Coeficientes convertidos de A/°C e V/°C para %/°C. Se a planilha não trouxer comprimento e largura, informe-os.',
        'Equipamento do mercado norte-americano: confira se é vendido e homologado no Brasil.',
      ],
    });
  }
  return out;
}

export function parseCecInverters(text: string): ParsedEquipment[] {
  const { header, rows } = table(text, 'Name');
  const col = (cells: string[], name: string) => toNumber(cells[header.indexOf(name)]);
  const out: ParsedEquipment[] = [];
  for (const cells of rows) {
    const paco = col(cells, 'Paco');
    if (paco === undefined) continue;
    const name = (cells[header.indexOf('Name')] ?? '').trim();
    // "Fabricante: Modelo [220V]"
    const colon = name.indexOf(':');
    const manufacturer = colon > 0 ? name.slice(0, colon).trim() : name.split(' ')[0] || '';
    const model = (colon > 0 ? name.slice(colon + 1) : name)
      .replace(/\s*\[[^\]]*\]\s*$/, '')
      .trim();
    const voltage = /\[(\d+)\s*V?\]/.exec(name)?.[1];
    const spec: Record<string, unknown> = {};
    const conf: Record<string, FieldConfidence> = {};
    const put = (field: string, value: unknown, level: FieldConfidence = 'HIGH') => {
      if (value === undefined) return;
      spec[field] = value;
      conf[field] = level;
    };
    put('pAcNomW', paco);
    put('pDcMaxW', col(cells, 'Pdco'), 'LOW');
    put('vDcMaxV', col(cells, 'Vdcmax'));
    put('mpptMinV', col(cells, 'Mppt_low'));
    put('mpptMaxV', col(cells, 'Mppt_high'));
    put('iMaxPerMpptA', col(cells, 'Idcmax'), 'LOW');
    put('vAcV', voltage ? Number(voltage) : col(cells, 'Vac'), voltage ? 'MEDIUM' : 'LOW');
    put('topology', /micro/i.test(name) ? 'MICRO' : 'STRING', 'LOW');
    out.push({
      kind: 'INVERTER',
      manufacturer,
      model,
      spec,
      fieldConfidence: conf,
      missing: missingFields('INVERTER', spec),
      notes: [
        'A planilha não traz o número de MPPT nem as fases: informe. A corrente CC máxima (Idcmax) pode ser a total, não por MPPT.',
        'Equipamento do mercado norte-americano: confira se é vendido e homologado no Brasil.',
      ],
    });
  }
  return out;
}
