import type { FieldConfidence } from '@voltex/shared';
import { ImportParseError, missingFields, toNumber, type ParsedEquipment } from './import-types.js';

/**
 * Leitor dos arquivos de equipamento do PVsyst: `.PAN` (módulo) e `.OND` (inversor). São texto `chave=valor` com
 * seções aninhadas. **O formato não tem especificação pública**: este leitor foi escrito a partir de arquivos reais
 * (um `.OND` publicado pelo fabricante e o trecho de um `.PAN` postado em fórum público) e só lê as chaves
 * conferidas neles. O que não é lido direto vem marcado com confiança menor e a pessoa confere na prévia.
 * Memorial e limites: `docs/07-desenvolvimento/catalogo-tecnico.md`.
 */
export const PVSYST_IO_VERSION = 'pvsyst-io-1.0.0';

/** Primeiro valor de cada chave (as seções aninhadas repetem nomes como `Comment` e `Mode`). */
export function flattenPvsyst(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const rawLine of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    const eq = line.indexOf('=');
    if (eq <= 0 || line.startsWith('End of')) continue;
    const key = line.slice(0, eq).trim();
    if (!map.has(key)) map.set(key, line.slice(eq + 1).trim());
  }
  return map;
}

const num = (map: Map<string, string>, key: string): number | undefined => toNumber(map.get(key));

const round = (value: number, digits: number): number => {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
};

const TECHNOLOGY: Record<string, 'MONO_SI' | 'POLY_SI' | 'THIN_FILM' | 'OTHER'> = {
  mtSiMono: 'MONO_SI',
  mtSiHIT: 'MONO_SI',
  mtSiPoly: 'POLY_SI',
  mtSiAmorph: 'THIN_FILM',
  mtCdTe: 'THIN_FILM',
  mtCIS: 'THIN_FILM',
  mtuSiTandem: 'THIN_FILM',
};

/** Detecta o tipo pelo cabeçalho (`PVObject_=pvModule` ou `pvGInverter`). */
export function pvsystObjectType(text: string): 'pvModule' | 'pvGInverter' | null {
  const first =
    text
      .replace(/^\uFEFF/, '')
      .trimStart()
      .split(/\r?\n/, 1)[0] ?? '';
  const match = /^PVObject_\s*=\s*(\w+)/.exec(first.trim());
  if (match?.[1] === 'pvModule' || match?.[1] === 'pvGInverter') return match[1];
  return null;
}

export function parsePanModule(text: string): ParsedEquipment {
  const f = flattenPvsyst(text);
  const manufacturer = f.get('Manufacturer');
  const model = f.get('Model');
  if (!manufacturer || !model)
    throw new ImportParseError('O arquivo não traz fabricante e modelo (Manufacturer/Model).');

  const spec: Record<string, unknown> = {};
  const confidence: Record<string, FieldConfidence> = {};
  const notes: string[] = [];
  const set = (field: string, value: unknown, level: FieldConfidence) => {
    if (value === undefined || (typeof value === 'number' && !Number.isFinite(value))) return;
    spec[field] = value;
    confidence[field] = level;
  };

  const technol = f.get('Technol');
  if (technol) {
    set('technology', TECHNOLOGY[technol] ?? 'OTHER', technol in TECHNOLOGY ? 'HIGH' : 'LOW');
    if (!(technol in TECHNOLOGY))
      notes.push(`Tecnologia "${technol}" não reconhecida: marcada como OUTRA.`);
  }
  const voc = num(f, 'Voc');
  const isc = num(f, 'Isc');
  set('pmaxWp', num(f, 'PNom'), 'HIGH');
  set('vmppV', num(f, 'Vmp'), 'HIGH');
  set('imppA', num(f, 'Imp'), 'HIGH');
  set('vocV', voc, 'HIGH');
  set('iscA', isc, 'HIGH');

  // muVocSpec em mV/°C do módulo; muISC em mA/°C; muPmpReq já em %/°C.
  const muVoc = num(f, 'muVocSpec');
  if (muVoc !== undefined && voc) {
    set('betaVocPctPerC', round(muVoc / (voc * 10), 4), 'MEDIUM');
    notes.push('Coeficiente de Voc convertido de mV/°C para %/°C (muVocSpec ÷ Voc).');
  }
  const muIsc = num(f, 'muISC');
  if (muIsc !== undefined && isc) {
    set('alphaIscPctPerC', round(muIsc / (isc * 10), 4), 'MEDIUM');
    notes.push('Coeficiente de Isc convertido de mA/°C para %/°C (muISC ÷ Isc).');
  }
  set('gammaPmaxPctPerC', num(f, 'muPmpReq'), 'HIGH');
  const cells = num(f, 'NCelS');
  if (cells !== undefined && Number.isInteger(cells)) set('cellsInSeries', cells, 'HIGH');

  // Dimensões em metros no arquivo: a maior é o comprimento.
  const a = num(f, 'Height');
  const b = num(f, 'Width');
  if (a !== undefined && b !== undefined) {
    set('lengthMm', Math.round(Math.max(a, b) * 1000), 'MEDIUM');
    set('widthMm', Math.round(Math.min(a, b) * 1000), 'MEDIUM');
    notes.push('Dimensões convertidas de metros para milímetros.');
  }
  const depth = num(f, 'Depth');
  if (depth !== undefined && depth > 0) set('thicknessMm', Math.round(depth * 1000), 'MEDIUM');
  const weight = num(f, 'Weight');
  if (weight !== undefined && weight > 0) set('weightKg', weight, 'HIGH');
  set('maxSystemVoltageV', num(f, 'VMaxIEC') ?? num(f, 'VMaxUL'), 'HIGH');
  const bifacial = num(f, 'BifacialityFactor');
  set('bifacial', bifacial !== undefined && bifacial > 0, bifacial === undefined ? 'LOW' : 'HIGH');

  const pmax = spec.pmaxWp as number | undefined;
  const l = spec.lengthMm as number | undefined;
  const w = spec.widthMm as number | undefined;
  if (pmax && l && w) {
    set('efficiencyPct', round((pmax / (((l * w) / 1_000_000) * 1000)) * 100, 2), 'LOW');
    notes.push('Eficiência calculada pela potência e pela área (o arquivo não a traz).');
  }
  notes.push('O arquivo não traz NOCT nem garantia de potência: preencha à mão se precisar.');
  return {
    kind: 'MODULE',
    manufacturer,
    model,
    spec,
    fieldConfidence: confidence,
    missing: missingFields('MODULE', spec),
    notes,
  };
}

export function parseOndInverter(text: string): ParsedEquipment {
  const f = flattenPvsyst(text);
  const manufacturer = f.get('Manufacturer');
  const model = f.get('Model');
  if (!manufacturer || !model)
    throw new ImportParseError('O arquivo não traz fabricante e modelo (Manufacturer/Model).');

  const spec: Record<string, unknown> = {};
  const confidence: Record<string, FieldConfidence> = {};
  const notes: string[] = [];
  const set = (field: string, value: unknown, level: FieldConfidence) => {
    if (value === undefined || (typeof value === 'number' && !Number.isFinite(value))) return;
    spec[field] = value;
    confidence[field] = level;
  };

  // Potências em kW no arquivo (UnitAffEnum=kW).
  const pNom = num(f, 'PNomConv');
  const pMax = num(f, 'PMaxOUT');
  if (pNom !== undefined) {
    set('pAcNomW', Math.round(pNom * 1000), 'MEDIUM');
    notes.push('Potências convertidas de kW para W.');
  }
  if (pMax !== undefined) set('pAcMaxW', Math.round(pMax * 1000), 'MEDIUM');
  set('vAcV', num(f, 'VOutConv'), 'HIGH');
  const phases = f.get('MonoTri');
  if (phases === 'Tri') set('phases', 3, 'HIGH');
  else if (phases === 'Mono') set('phases', 1, 'HIGH');
  set('mpptMinV', num(f, 'VMppMin'), 'HIGH');
  set('mpptMaxV', num(f, 'VMPPMax'), 'HIGH');
  set('vDcMaxV', num(f, 'VAbsMax'), 'HIGH');
  set('efficiencyMaxPct', num(f, 'EfficMax'), 'HIGH');
  set('efficiencyEuroPct', num(f, 'EfficEuro'), 'HIGH');
  set('iAcMaxA', num(f, 'IMaxAC'), 'HIGH');

  const mppt = num(f, 'NbMPPT');
  const inputs = num(f, 'NbInputs');
  if (mppt !== undefined && Number.isInteger(mppt) && mppt > 0) {
    set('mpptCount', mppt, 'HIGH');
    if (inputs !== undefined)
      set('inputsPerMppt', Math.max(1, Math.round(inputs / mppt)), 'MEDIUM');
    const iMaxDc = num(f, 'IMaxDC');
    if (iMaxDc !== undefined && iMaxDc > 0) {
      set('iMaxPerMpptA', round(iMaxDc / mppt, 2), 'LOW');
      notes.push(
        'O arquivo traz a corrente CC máxima TOTAL (IMaxDC): dividida igualmente pelos MPPT. Confira a corrente por MPPT na ficha.',
      );
    }
  }
  // O arquivo não diz a topologia: assume inversor de string.
  set('topology', 'STRING', 'LOW');
  notes.push('Topologia assumida como STRING; ajuste se for microinversor ou híbrido.');
  notes.push('O arquivo não traz a tensão de partida nem o curto-circuito admissível por MPPT.');
  return {
    kind: 'INVERTER',
    manufacturer,
    model,
    spec,
    fieldConfidence: confidence,
    missing: missingFields('INVERTER', spec),
    notes,
  };
}

/** Lê um `.PAN` ou `.OND` pelo cabeçalho do arquivo. */
export function parsePvsystFile(text: string): ParsedEquipment {
  const type = pvsystObjectType(text);
  if (type === 'pvModule') return parsePanModule(text);
  if (type === 'pvGInverter') return parseOndInverter(text);
  throw new ImportParseError(
    'Arquivo não reconhecido: o cabeçalho deveria ser PVObject_=pvModule (.PAN) ou PVObject_=pvGInverter (.OND).',
  );
}
