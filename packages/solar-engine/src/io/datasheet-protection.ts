import type { EquipmentKind, FieldConfidence } from '@voltex/shared';
import { missingFields, toNumber, type ParsedEquipment } from './import-types.js';

/**
 * Leitor de ficha técnica para proteções (disjuntor, DPS, fusível, seccionadora, DR, string box) e cabos. Reconhece o
 * tipo pelas palavras do título e do texto e procura corrente, tensão, polos, curva, capacidade de interrupção,
 * sensibilidade, seção, isolação e norma. Confiança MÉDIA quando achou o rótulo, BAIXA quando deduziu do título.
 */
export const DATASHEET_PROTECTION_VERSION = 'datasheet-protection-1.0.0';

type ProtectionKind = Extract<EquipmentKind, 'PROTECTION' | 'CABLE'>;
export const isProtectionKind = (kind: EquipmentKind | undefined): kind is ProtectionKind =>
  kind === 'PROTECTION' || kind === 'CABLE';

const strip = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[ \t]+/g, ' ');

const N = '(\\d+(?:[.,]\\d+)?)';

type Put = (field: string, value: unknown, confidence?: FieldConfidence) => void;

const first = (text: string, re: RegExp): number | undefined => {
  const m = text.match(re);
  return m ? toNumber(m[1]) : undefined;
};

function protectionFields(text: string, title: string, put: Put): void {
  const t = strip(title);
  const hay = `${t}\n${text}`;
  const dc = /\b(cc|dc)\b|corrente continua|fotovoltaic|solar|\bpv\b/.test(hay);
  if (/string ?box|caixa de juncao|quadro (de )?string/.test(hay))
    put('protectionKind', 'STRING_BOX', 'LOW');
  else if (/\bdr\b|diferencial|residual|\brcd\b|\brccb\b|\bidr\b/.test(hay))
    put('protectionKind', 'RCD', 'MEDIUM');
  else if (/\bdps\b|surge|descarga atmosferica|supressor/.test(hay))
    put('protectionKind', dc ? 'SURGE_DC' : 'SURGE_AC', 'MEDIUM');
  else if (/fusivel|fuse/.test(hay)) put('protectionKind', 'FUSE_DC', 'MEDIUM');
  else if (
    /seccionador|seccionadora|interruptor.?seccionador|disconnector|isolator switch|chave seccionadora/.test(
      hay,
    )
  )
    put('protectionKind', 'DISCONNECTOR_DC', 'MEDIUM');
  else if (/disjuntor|breaker|\bmcb\b|\bmccb\b|minidisjuntor/.test(hay))
    put('protectionKind', 'BREAKER_AC', 'MEDIUM');

  // Corrente nominal: "corrente nominal 32 A", "In 32A", ou "32A" no título.
  const current =
    first(
      hay,
      new RegExp(
        `(?:corrente nominal|rated current|corrente assinalada)[^\\n\\d]{0,20}${N}\\s*a\\b`,
      ),
    ) ??
    first(hay, new RegExp(`\\bin\\s*[:=]?\\s*${N}\\s*a\\b`)) ??
    first(t, new RegExp(`${N}\\s*a\\b`)) ??
    first(hay, new RegExp(`${N}\\s*a\\b(?=\\s*[,;/\\n]|\\s+\\d|\\s*$)`));
  if (current !== undefined && current > 0 && current <= 6300)
    put('ratedCurrentA', current, 'MEDIUM');

  // Tensão: "1000 V", "1000 Vcc", "Ue 230 V", "1,5 kV".
  const kv = first(hay, new RegExp(`${N}\\s*kv\\b`));
  const volts =
    first(
      hay,
      new RegExp(
        `(?:tensao nominal|tensao de operacao|tensao maxima|rated voltage|ue|un|uc)[^\\n\\d]{0,20}${N}\\s*v`,
      ),
    ) ??
    first(hay, new RegExp(`${N}\\s*v\\s?(?:cc|dc|ca|ac)\\b`)) ??
    (kv !== undefined ? kv * 1000 : undefined) ??
    first(t, new RegExp(`${N}\\s*v\\b`));
  if (volts !== undefined && volts >= 6 && volts <= 3000) put('ratedVoltageV', volts, 'MEDIUM');

  const poles = /tetrapolar|\b4\s?p\b|4 polos/.test(hay)
    ? 4
    : /tripolar|\b3\s?p\b|3 polos/.test(hay)
      ? 3
      : /bipolar|\b2\s?p\b|2 polos/.test(hay)
        ? 2
        : /unipolar|\b1\s?p\b|1 polo/.test(hay)
          ? 1
          : undefined;
  if (poles !== undefined) put('poles', poles, 'MEDIUM');

  const curve = hay.match(/curva\s*([bcdkz])\b/);
  if (curve) put('curve', (curve[1] as string).toUpperCase(), 'MEDIUM');
  const ka =
    first(
      hay,
      new RegExp(
        `(?:capacidade de interrupcao|poder de corte|breaking capacity|icn|icu|ics)[^\\n\\d]{0,20}${N}\\s*ka`,
      ),
    ) ?? first(hay, new RegExp(`${N}\\s*ka\\b`));
  if (ka !== undefined && ka > 0 && ka <= 150) put('breakingCapacityKa', ka, 'MEDIUM');
  const ma =
    first(
      hay,
      new RegExp(`(?:sensibilidade|i\\s?delta\\s?n|idn|residual current)[^\\n\\d]{0,20}${N}\\s*ma`),
    ) ?? first(t, new RegExp(`${N}\\s*ma\\b`));
  if (ma !== undefined && ma > 0 && ma <= 1000) put('sensitivityMa', ma, 'MEDIUM');
  const std = hay.match(
    /(iec\s?\d{4,5}(?:-\d+(?:-\d+)?)?|nbr\s?(?:nm\s?)?\d{3,5}(?:-\d+)?|en\s?\d{4,5}(?:-\d+)?)/,
  );
  if (std) put('standard', (std[1] as string).toUpperCase().replace(/\s+/g, ' '), 'LOW');
}

function cableFields(text: string, title: string, put: Put): void {
  const t = strip(title);
  const hay = `${t}\n${text}`;
  put(
    'cableKind',
    /solar|fotovoltaic|\bpv\b|pv1-f|h1z2z2|en 50618|nbr 16612|\bcc\b|\bdc\b/.test(hay)
      ? 'DC_SOLAR'
      : 'AC',
    /solar|fotovoltaic|pv1-f|h1z2z2/.test(hay) ? 'MEDIUM' : 'LOW',
  );
  const section =
    first(
      hay,
      new RegExp(`(?:secao nominal|secao|cross.?section|bitola)[^\\n\\d]{0,20}${N}\\s*mm`),
    ) ??
    first(hay, new RegExp(`${N}\\s*mm\\s?(?:2|²)`)) ??
    first(hay, new RegExp(`\\d\\s?x\\s?${N}\\s*mm`));
  if (section !== undefined && section >= 0.5 && section <= 630)
    put('crossSectionMm2', section, 'MEDIUM');
  put(
    'conductor',
    /aluminio|\bal\b/.test(hay) && !/cobre/.test(hay) ? 'AL' : 'CU',
    /cobre|copper|aluminio/.test(hay) ? 'MEDIUM' : 'LOW',
  );
  const insulation = hay.match(/\b(xlpe|epr|hepr|pvc|lszh|hffr|epdm|borracha)\b/);
  if (insulation) put('insulation', (insulation[1] as string).toUpperCase(), 'MEDIUM');
  const kv = hay.match(new RegExp(`${N}\\s*/\\s*${N}\\s*kv`));
  const v =
    (kv ? (toNumber(kv[2] as string) as number) * 1000 : undefined) ??
    first(
      hay,
      new RegExp(
        `(?:tensao nominal|tensao de isolamento|rated voltage|tensao)[^\\n\\d]{0,20}${N}\\s*kv`,
      ),
    ) ??
    undefined;
  const direct = first(
    hay,
    new RegExp(
      `(?:tensao nominal|tensao de isolamento|rated voltage|tensao)[^\\n\\d]{0,20}${N}\\s*v\\b`,
    ),
  );
  const volts = kv ? v : v !== undefined ? v * 1000 : direct;
  if (volts !== undefined && volts >= 50 && volts <= 50000) put('voltageRatingV', volts, 'MEDIUM');
  const temp =
    first(
      hay,
      new RegExp(
        `(?:temperatura (?:maxima )?(?:do condutor|de operacao)|max\\.? conductor temp)[^\\n\\d]{0,20}${N}\\s*(?:°|º)?\\s*c`,
      ),
    ) ?? first(hay, new RegExp(`${N}\\s*(?:°|º)\\s*c\\b`));
  if (temp !== undefined && temp >= 60 && temp <= 250) put('maxConductorTempC', temp, 'LOW');
  const std = hay.match(
    /(nbr\s?\d{4,5}|en\s?\d{4,5}(?:-\d+)?|iec\s?\d{4,5}(?:-\d+)?|ul\s?\d{3,4})/,
  );
  if (std) put('standard', (std[1] as string).toUpperCase().replace(/\s+/g, ' '), 'LOW');
}

export function extractProtectionDatasheet(
  kind: ProtectionKind,
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
  if (kind === 'PROTECTION') protectionFields(text, title, put);
  else cableFields(text, title, put);
  const found = Object.keys(spec).length;
  const notes = [
    found === 0
      ? 'Não consegui ler valores neste PDF: preencha à mão olhando a ficha.'
      : `Li ${found} campo(s) da ficha e do título; confira os marcados como "presumido" ou "convertido".`,
  ];
  // Cada tipo de proteção exige campos diferentes (corrente, tensão, sensibilidade): avisa o que ainda falta.
  const missing = missingFields(kind, spec);
  if (kind === 'PROTECTION') {
    const need: Record<string, string[]> = {
      FUSE_DC: ['ratedCurrentA', 'ratedVoltageV'],
      DISCONNECTOR_DC: ['ratedCurrentA', 'ratedVoltageV'],
      SURGE_DC: ['ratedVoltageV'],
      SURGE_AC: ['ratedVoltageV'],
      BREAKER_AC: ['ratedCurrentA', 'ratedVoltageV'],
      RCD: ['ratedCurrentA', 'sensitivityMa'],
      STRING_BOX: ['ratedCurrentA', 'ratedVoltageV'],
    };
    for (const f of need[String(spec.protectionKind)] ?? [])
      if (spec[f] === undefined && !missing.includes(f)) missing.push(f);
  }
  return { kind, manufacturer, model: title, spec, fieldConfidence, missing, notes };
}
