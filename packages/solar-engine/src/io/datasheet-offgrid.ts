import type { EquipmentKind, FieldConfidence } from '@voltex/shared';
import { missingFields, toNumber, type ParsedEquipment } from './import-types.js';

/**
 * Leitor de ficha técnica para os tipos do Off-Grid (bateria, controlador de carga, inversor off-grid/híbrido e
 * gerador). Procura os valores por rótulos em português e em inglês, e também no título do produto ("48V 100AH").
 * Tudo entra com confiança MÉDIA (rótulo achado no texto) ou BAIXA (deduzido do título ou do contexto): a pessoa confere
 * na prévia. O que não achar aparece em `missing`.
 */
export const OFFGRID_DATASHEET_VERSION = 'datasheet-offgrid-1.0.0';

type OffgridKind = Extract<
  EquipmentKind,
  'BATTERY' | 'CHARGE_CONTROLLER' | 'OFFGRID_INVERTER' | 'GENERATOR'
>;
export const isOffgridKind = (kind: EquipmentKind | undefined): kind is OffgridKind =>
  kind === 'BATTERY' ||
  kind === 'CHARGE_CONTROLLER' ||
  kind === 'OFFGRID_INVERTER' ||
  kind === 'GENERATOR';

const strip = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[ \t]+/g, ' ');

const N = '(\\d+(?:[.,]\\d+)?)';

interface Finder {
  /** Primeira ocorrência de `label ... número unidade`, devolvida em `unit` convertida pelo `convert`. */
  (labels: string[], unit: string, range: [number, number]): number | undefined;
}

function finder(text: string): Finder {
  return (labels, unit, [min, max]) => {
    for (const label of labels) {
      const re = new RegExp(`${label}[^\\n\\d]{0,28}?[:=]?\\s*${N}\\s*${unit}`, 'i');
      const m = text.match(re);
      const v = m ? toNumber(m[1]) : undefined;
      if (v !== undefined && v >= min && v <= max) return v;
    }
    return undefined;
  };
}

type Put = (field: string, value: unknown, confidence?: FieldConfidence) => void;

function batteryFields(text: string, title: string, put: Put): void {
  const find = finder(text);
  const t = strip(title);
  const fromTitle = (re: RegExp): number | undefined => {
    const m = t.match(re);
    return m ? toNumber(m[1]) : undefined;
  };
  const voltage =
    find(['tensao nominal', 'nominal voltage', 'rated voltage', 'tensao'], 'v', [2, 800]) ??
    fromTitle(new RegExp(`${N}\\s*v\\b`));
  if (voltage !== undefined)
    put(
      'nominalVoltageV',
      voltage,
      find(['tensao nominal', 'nominal voltage'], 'v', [2, 800]) ? 'MEDIUM' : 'LOW',
    );
  const ah =
    find(
      ['capacidade nominal', 'nominal capacity', 'rated capacity', 'capacidade', 'capacity'],
      'ah',
      [1, 5000],
    ) ?? fromTitle(new RegExp(`${N}\\s*ah\\b`));
  if (ah !== undefined)
    put(
      'capacityAh',
      ah,
      find(['capacidade nominal', 'nominal capacity', 'capacity'], 'ah', [1, 5000])
        ? 'MEDIUM'
        : 'LOW',
    );
  const dod = find(
    ['profundidade de descarga', 'depth of discharge', 'dod', 'descarga maxima'],
    '%',
    [5, 100],
  );
  if (dod !== undefined) put('maxDodPct', dod, 'MEDIUM');
  const cycles = text.match(new RegExp(`${N}\\s*(?:ciclos|cycles)`));
  const cycleN = cycles ? toNumber(cycles[1]) : undefined;
  if (cycleN !== undefined && cycleN >= 100 && cycleN <= 20000)
    put('cycleLife', Math.round(cycleN), 'MEDIUM');
  const charge = find(
    ['corrente de carga', 'charge current', 'max charge', 'carga maxima', 'carga max'],
    'a',
    [1, 1000],
  );
  if (charge !== undefined) put('maxChargeCurrentA', charge, 'MEDIUM');
  const discharge = find(
    ['corrente de descarga', 'discharge current', 'max discharge', 'descarga continua'],
    'a',
    [1, 2000],
  );
  if (discharge !== undefined) put('maxDischargeCurrentA', discharge, 'MEDIUM');
  const eff = find(['eficiencia', 'efficiency', 'round trip'], '%', [40, 100]);
  if (eff !== undefined) put('roundTripEfficiencyPct', eff, 'MEDIUM');
  const weight = find(['peso', 'weight'], 'kg', [0.1, 5000]);
  if (weight !== undefined) put('weightKg', weight, 'MEDIUM');
  const hay = `${text} ${t}`;
  if (/lifepo4|lfp|litio ferro|lithium iron/.test(hay)) put('chemistry', 'LFP', 'MEDIUM');
  else if (/\bnmc\b|ion de litio|ion-litio|li-ion|lithium/.test(hay))
    put('chemistry', hay.includes('litio') || hay.includes('lithium') ? 'LFP' : 'NMC', 'LOW');
  else if (/opzs/.test(hay)) put('chemistry', 'OPZS', 'MEDIUM');
  else if (/opzv/.test(hay)) put('chemistry', 'OPZV', 'MEDIUM');
  else if (/\bagm\b/.test(hay)) put('chemistry', 'LEAD_AGM', 'MEDIUM');
  else if (/\bgel\b/.test(hay)) put('chemistry', 'LEAD_GEL', 'MEDIUM');
  else if (/chumbo|lead.?acid|estacionaria|stationary/.test(hay))
    put('chemistry', 'LEAD_FLOODED', 'LOW');
  const hours = text.match(new RegExp(`\\bc\\s?(\\d{1,3})\\b`));
  if (hours && ah !== undefined) put('capacityHours', Number(hours[1]), 'LOW');
}

function controllerFields(text: string, title: string, put: Put): void {
  const find = finder(text);
  const t = strip(title);
  const hay = `${text} ${t}`;
  if (/\bmppt\b/.test(hay)) put('technology', 'MPPT', 'MEDIUM');
  else if (/\bpwm\b/.test(hay)) put('technology', 'PWM', 'MEDIUM');
  const current =
    find(
      ['corrente de carga', 'charge current', 'rated charge', 'corrente nominal', 'rated current'],
      'a',
      [1, 500],
    ) ??
    (() => {
      const m = t.match(new RegExp(`${N}\\s*a\\b`));
      return m ? toNumber(m[1]) : undefined;
    })();
  if (current !== undefined) put('ratedChargeCurrentA', current, 'MEDIUM');
  const voc = find(
    [
      'tensao maxima de entrada',
      'max pv input',
      'max pv voltage',
      'max input voltage',
      'voc max',
      'tensao maxima fv',
      'max. pv',
    ],
    'v',
    [10, 1000],
  );
  if (voc !== undefined) put('pvVocMaxV', voc, 'MEDIUM');
  const bat = t.match(/(12|24|48)\s*v/) ?? text.match(/(12|24|48)\s*v\b/);
  const multi = /12\s*\/\s*24(?:\s*\/\s*48)?\s*v/.test(hay);
  if (bat) put('batteryVoltageV', Number(multi ? 48 : bat[1]), 'LOW');
  if (multi) put('autoVoltage', true, 'LOW');
  const range = hay.match(new RegExp(`mppt[^\\n\\d]{0,40}${N}\\s*(?:-|a|~|to)\\s*${N}\\s*v`));
  if (range) {
    put('mpptMinV', toNumber(range[1]), 'MEDIUM');
    put('mpptMaxV', toNumber(range[2]), 'MEDIUM');
  }
  const pv = find(
    ['potencia fv maxima', 'max pv power', 'potencia maxima fv', 'max. pv power'],
    'w',
    [10, 100000],
  );
  if (pv !== undefined) put('pvPowerMaxW', pv, 'MEDIUM');
  const eff = find(['eficiencia', 'efficiency'], '%', [50, 100]);
  if (eff !== undefined) put('efficiencyPct', eff, 'MEDIUM');
}

function inverterFields(text: string, title: string, put: Put): void {
  const find = finder(text);
  const t = strip(title);
  const hay = `${text} ${t}`;
  put(
    'topology',
    /hibrid|hybrid|grid.?tie|on.?grid.*off.?grid|rede/.test(hay) && /hibrid|hybrid/.test(hay)
      ? 'HYBRID'
      : 'OFFGRID',
    'LOW',
  );
  const kw = hay.match(new RegExp(`${N}\\s*kw\\b`));
  const power =
    find(
      [
        'potencia nominal',
        'rated power',
        'potencia continua',
        'continuous power',
        'potencia de saida',
        'output power',
      ],
      'w',
      [100, 200000],
    ) ??
    (kw && toNumber(kw[1]) !== undefined ? (toNumber(kw[1]) as number) * 1000 : undefined) ??
    (() => {
      const w = t.match(new RegExp(`${N}\\s*w\\b`));
      return w ? toNumber(w[1]) : undefined;
    })();
  if (power !== undefined && power >= 100) put('pContinuousW', power, 'MEDIUM');
  const surge = find(
    ['potencia de surto', 'surge power', 'peak power', 'potencia de pico', 'potencia pico'],
    'w',
    [100, 400000],
  );
  if (surge !== undefined) put('pSurgeW', surge, 'MEDIUM');
  const bat =
    t.match(/(12|24|48|96)\s*v/) ??
    text.match(
      new RegExp(`(?:tensao da bateria|battery voltage|dc input)[^\\n\\d]{0,30}(12|24|48|96)`),
    );
  if (bat) put('batteryVoltageV', Number(bat[1]), 'LOW');
  const vac = text.match(/\b(110|115|120|127|220|230|240)\s*v(?:ac)?\b/);
  if (vac) put('vAcV', Number(vac[1]), 'LOW');
  if (/trifasic|three.?phase|3\s?ph|3p\b/.test(hay)) put('phases', 3, 'LOW');
  else if (/bifasic|split.?phase|2\s?ph/.test(hay)) put('phases', 2, 'LOW');
  else if (/monofasic|single.?phase|1\s?ph|1p\b/.test(hay)) put('phases', 1, 'LOW');
  const eff = find(
    ['eficiencia maxima', 'max efficiency', 'peak efficiency', 'eficiencia'],
    '%',
    [50, 100],
  );
  if (eff !== undefined) put('efficiencyPct', eff, 'MEDIUM');
  const charger = find(
    ['corrente de carga', 'charge current', 'carregador', 'max charge'],
    'a',
    [1, 500],
  );
  if (charger !== undefined) put('chargerCurrentA', charger, 'MEDIUM');
  put('sineWave', !/onda modificada|modified sine|square/.test(hay), 'LOW');
  put('gridInput', /entrada de rede|grid input|ac input|rede eletrica|on.?grid/.test(hay), 'LOW');
  put('generatorInput', /gerador|generator/.test(hay), 'LOW');
  if (/\bmppt\b/.test(hay)) {
    put('mpptBuiltIn', true, 'LOW');
    const voc = find(
      ['tensao maxima de entrada', 'max pv input', 'max pv voltage', 'voc max', 'max. pv'],
      'v',
      [10, 1000],
    );
    if (voc !== undefined) put('pvVocMaxV', voc, 'MEDIUM');
    const cur = find(
      ['corrente maxima de entrada', 'max pv input current', 'max input current', 'corrente mppt'],
      'a',
      [1, 200],
    );
    if (cur !== undefined) put('mpptCurrentA', cur, 'MEDIUM');
    const range = hay.match(new RegExp(`mppt[^\\n\\d]{0,40}${N}\\s*(?:-|a|~|to)\\s*${N}\\s*v`));
    if (range) {
      put('mpptMinV', toNumber(range[1]), 'MEDIUM');
      put('mpptMaxV', toNumber(range[2]), 'MEDIUM');
    }
  }
}

function generatorFields(text: string, title: string, put: Put): void {
  const find = finder(text);
  const t = strip(title);
  const hay = `${text} ${t}`;
  if (/diesel/.test(hay)) put('fuel', 'DIESEL', 'MEDIUM');
  else if (/etanol|flex/.test(hay)) put('fuel', 'ETHANOL', 'LOW');
  else if (/\bgnv\b|\bglp\b|\bgas\b/.test(hay)) put('fuel', 'GAS', 'LOW');
  else if (/gasolina|petrol|gasoline/.test(hay)) put('fuel', 'GASOLINE', 'MEDIUM');
  const kva = hay.match(new RegExp(`${N}\\s*kva`));
  const kw = hay.match(new RegExp(`${N}\\s*kw\\b`));
  const w =
    find(
      ['potencia nominal', 'potencia continua', 'rated power', 'potencia'],
      'w',
      [200, 2000000],
    ) ??
    (kw && toNumber(kw[1]) !== undefined ? (toNumber(kw[1]) as number) * 1000 : undefined) ??
    (kva && toNumber(kva[1]) !== undefined ? (toNumber(kva[1]) as number) * 800 : undefined);
  if (w !== undefined)
    put(
      'pContinuousW',
      Math.round(w),
      kw || find(['potencia nominal', 'rated power'], 'w', [200, 2000000]) ? 'MEDIUM' : 'LOW',
    );
  const standby = find(
    ['potencia maxima', 'potencia de emergencia', 'max power', 'standby'],
    'w',
    [200, 2000000],
  );
  if (standby !== undefined) put('pStandbyW', standby, 'MEDIUM');
  const vac = text.match(/\b(110|115|120|127|220|230|240|380|440)\s*v\b/);
  if (vac) put('vAcV', Number(vac[1]), 'LOW');
  if (/trifasic|three.?phase|3\s?ph/.test(hay)) put('phases', 3, 'LOW');
  else if (/monofasic|single.?phase|1\s?ph/.test(hay)) put('phases', 1, 'LOW');
  const fuel = find(
    ['consumo', 'fuel consumption', 'consumo de combustivel'],
    'l\\s*/\\s*h',
    [0.1, 500],
  );
  if (fuel !== undefined) put('fuelLitersPerHour', fuel, 'MEDIUM');
  if (/partida automatica|auto start|ats\b/.test(hay)) put('autoStart', true, 'LOW');
}

/** Lê o texto de uma ficha (já extraído do PDF) para um dos tipos do Off-Grid. `title` ajuda quando o texto é pobre. */
export function extractOffgridDatasheet(
  kind: OffgridKind,
  rawText: string,
  title = '',
  manufacturer = '',
): ParsedEquipment {
  const text = strip(rawText);
  const spec: Record<string, unknown> = {};
  const fieldConfidence: Record<string, FieldConfidence> = {};
  const put: Put = (field, value, confidence = 'MEDIUM') => {
    if (value === undefined || spec[field] !== undefined) return;
    spec[field] = value;
    fieldConfidence[field] = confidence;
  };
  if (kind === 'BATTERY') batteryFields(text, title, put);
  else if (kind === 'CHARGE_CONTROLLER') controllerFields(text, title, put);
  else if (kind === 'OFFGRID_INVERTER') inverterFields(text, title, put);
  else generatorFields(text, title, put);

  const found = Object.keys(spec).length;
  return {
    kind,
    manufacturer,
    model: title,
    spec,
    fieldConfidence,
    missing: missingFields(kind, spec),
    notes: [
      found === 0
        ? 'Não consegui ler valores neste PDF: preencha à mão olhando a ficha.'
        : `Li ${found} campo(s) da ficha e do título; os marcados como "presumido" ou "convertido" precisam de conferência.`,
    ],
  };
}
