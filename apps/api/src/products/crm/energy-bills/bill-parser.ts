import type {
  CustomerGroup,
  EnergyBillField,
  ExtractedBillFields,
  PhaseSystem,
} from '@voltex/shared';

/**
 * Leitura de fatura de energia (RF-CRM-031). A interface permite trocar a leitura por OCR/IA depois; o que existe hoje
 * é uma leitura **heurística de PDF com camada de texto**, e por isso TODA fatura passa por revisão humana (RN-014):
 * nenhum valor lido chega ao cálculo sem confirmação.
 */
export interface BillParseInput {
  buffer: Buffer;
  mimeType: string;
  /** Nomes de concessionárias cadastradas pelo tenant: ajudam a reconhecer a distribuidora no texto. */
  distributorNames: readonly string[];
}

export interface BillParseResult {
  fields: ExtractedBillFields;
  parserName: string;
  parserVersion: string;
  /** Quantos caracteres de texto o arquivo tinha (0 = imagem ou PDF escaneado, sem camada de texto). */
  textLength: number;
}

export interface BillParserProvider {
  readonly name: string;
  readonly version: string;
  parse(input: BillParseInput): Promise<BillParseResult>;
}

export const BILL_PARSER = Symbol('BILL_PARSER');

/** Campos abaixo disto são destacados na tela de revisão. */
export const LOW_CONFIDENCE_THRESHOLD = 0.75;

const MONTHS: Record<string, number> = {
  JAN: 1,
  FEV: 2,
  MAR: 3,
  ABR: 4,
  MAI: 5,
  JUN: 6,
  JUL: 7,
  AGO: 8,
  SET: 9,
  OUT: 10,
  NOV: 11,
  DEZ: 12,
};
const MONTH_NAMES = Object.keys(MONTHS).join('|');

const fold = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

const pad = (n: number) => String(n).padStart(2, '0');
const toMonth = (year: string, month: number) =>
  `${year.length === 2 ? `20${year}` : year}-${pad(month)}`;
const brNumber = (raw: string) => Number(raw.replace(/\./g, '').replace(',', '.'));

function put<K extends EnergyBillField>(
  fields: ExtractedBillFields,
  key: K,
  value: NonNullable<ExtractedBillFields[K]>['value'],
  confidence: number,
) {
  (fields as Record<string, unknown>)[key] = { value, confidence };
}

/**
 * Extrai os campos do texto da fatura. Função pura (testável sem PDF). Cada campo traz a confiança da leitura;
 * o que não for encontrado simplesmente não aparece.
 */
export function extractBillFields(
  text: string,
  distributorNames: readonly string[] = [],
): ExtractedBillFields {
  const fields: ExtractedBillFields = {};
  const flat = text.replace(/\r/g, '');

  // Unidade consumidora: "Unidade Consumidora", "UC" ou "Instalação" (cada distribuidora usa um termo).
  const ucPatterns: [RegExp, number][] = [
    [/unidade\s+consumidora[^0-9A-Za-z]{0,20}([0-9][0-9.\-/]{4,18}[0-9])/i, 0.85],
    [/\bUC\b[\s:.\-nº°]{0,6}([0-9][0-9.\-/]{4,18}[0-9])/i, 0.8],
    [/instala[çc][ãa]o[\s:.\-nº°]{0,6}([0-9][0-9.\-/]{4,18}[0-9])/i, 0.7],
    [/c[óo]digo\s+do\s+cliente[\s:.-]{0,6}([0-9]{5,15})/i, 0.6],
  ];
  for (const [pattern, confidence] of ucPatterns) {
    const match = pattern.exec(flat);
    if (match?.[1]) {
      put(fields, 'ucNumber', match[1], confidence);
      break;
    }
  }

  // Distribuidora: só reconhece as cadastradas pelo tenant (nunca inventa uma lista).
  const folded = fold(flat);
  const byLength = [...distributorNames].sort((a, b) => b.length - a.length);
  const distributor = byLength.find(
    (name) => name.trim().length >= 3 && folded.includes(fold(name)),
  );
  if (distributor) put(fields, 'distributorName', distributor, 0.9);

  // Mês de referência.
  const refNumeric =
    /(?:m[eê]s\s+de\s+refer[eê]ncia|refer[eê]ncia|referente\s+a)[\s:.-]{0,6}(0[1-9]|1[0-2])\/(20\d{2})/i.exec(
      flat,
    );
  const refNamed = new RegExp(
    `(?:m[eê]s\\s+de\\s+refer[eê]ncia|refer[eê]ncia|referente\\s+a)[\\s:.\\-]{0,6}(${MONTH_NAMES})[\\/\\s.\\-]{0,2}(\\d{2}|\\d{4})`,
    'i',
  ).exec(flat);
  if (refNumeric) put(fields, 'referenceMonth', `${refNumeric[2]}-${refNumeric[1]}`, 0.8);
  else if (refNamed)
    put(
      fields,
      'referenceMonth',
      toMonth(refNamed[2] as string, MONTHS[(refNamed[1] as string).toUpperCase()] as number),
      0.75,
    );

  // Histórico de consumo: "AGO/26 480" ou "08/2026 480", preferindo a região depois de "histórico".
  const historyStart = fold(flat).search(
    /historico\s+de\s+consumo|consumo\s+dos\s+ultimos|hist[oó]rico/,
  );
  const region = historyStart >= 0 ? flat.slice(historyStart) : flat;
  const points = new Map<string, number>();
  const named = new RegExp(
    `\\b(${MONTH_NAMES})[\\/\\s.\\-]{0,2}(\\d{4}|\\d{2})\\s+(\\d{1,3}(?:\\.\\d{3})+|\\d{1,6})(?:,\\d+)?\\b`,
    'gi',
  );
  for (const m of region.matchAll(named)) {
    const month = toMonth(m[2] as string, MONTHS[(m[1] as string).toUpperCase()] as number);
    if (!points.has(month)) points.set(month, brNumber(m[3] as string));
  }
  const numeric =
    /(?<![\d/])(0[1-9]|1[0-2])\/(20\d{2})\s+(\d{1,3}(?:\.\d{3})+|\d{1,6})(?:,\d+)?\b/g;
  for (const m of region.matchAll(numeric)) {
    const month = `${m[2]}-${m[1]}`;
    if (!points.has(month)) points.set(month, brNumber(m[3] as string));
  }
  if (points.size >= 2) {
    const history = [...points.entries()]
      .map(([month, kwh]) => ({ month, kwh }))
      .sort((a, b) => a.month.localeCompare(b.month))
      .slice(-24);
    put(fields, 'consumptionHistory', history, history.length >= 12 ? 0.8 : 0.65);
  }

  // Valores e datas.
  const total =
    /total\s+a\s+pagar[^0-9]{0,15}R?\$?\s*([0-9]{1,3}(?:\.[0-9]{3})*,[0-9]{2})/i.exec(flat) ??
    /valor\s+total[^0-9]{0,15}R?\$?\s*([0-9]{1,3}(?:\.[0-9]{3})*,[0-9]{2})/i.exec(flat);
  if (total?.[1]) put(fields, 'totalAmountCents', Math.round(brNumber(total[1]) * 100), 0.75);

  const due = /vencimento[^0-9]{0,15}(\d{2})\/(\d{2})\/(\d{4})/i.exec(flat);
  if (due) put(fields, 'dueDate', `${due[3]}-${due[2]}-${due[1]}`, 0.8);

  // Ligação e grupo tarifário.
  const phase = /\b(monof[áa]sico|bif[áa]sico|trif[áa]sico)\b/i.exec(flat);
  if (phase?.[1]) {
    const key = fold(phase[1]);
    const system: PhaseSystem = key.startsWith('mono')
      ? 'SINGLE_PHASE'
      : key.startsWith('bi')
        ? 'TWO_PHASE'
        : 'THREE_PHASE';
    put(fields, 'phaseSystem', system, 0.8);
  }
  const groupLabeled = /grupo\s*:?\s*([AB])\b/i.exec(flat);
  if (groupLabeled?.[1])
    put(fields, 'customerGroup', groupLabeled[1].toUpperCase() as CustomerGroup, 0.75);
  else if (/\bB[1-4]\b/.test(flat)) put(fields, 'customerGroup', 'B', 0.65);
  else if (/\bA(?:1|2|3A?|4|S)\b/.test(flat)) put(fields, 'customerGroup', 'A', 0.65);

  const name = /(?:^|\n)\s*(?:nome|cliente)\s*[:-]\s*([^\n]{3,80})/i.exec(flat);
  if (name?.[1]) put(fields, 'customerName', name[1].trim(), 0.5);

  return fields;
}

/** Média das confianças dos campos lidos; `null` quando nada foi lido. */
export function overallConfidence(fields: ExtractedBillFields): number | null {
  const values = Object.values(fields).map((f) => (f as { confidence: number }).confidence);
  if (values.length === 0) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
}
