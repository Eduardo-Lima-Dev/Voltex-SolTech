import type { FieldConfidence } from '@voltex/shared';
import { missingFields, toNumber, type ParsedEquipment } from './import-types.js';

/**
 * Leitura assistida da ficha técnica (PDF com camada de texto) de um **módulo**. Procura os rótulos usuais em
 * inglês e português e devolve o que achou, com a confiança de cada campo. Datasheets trazem várias potências na mesma
 * tabela (uma coluna por modelo): quando um rótulo aparece com valores diferentes, o primeiro é usado com confiança
 * MÉDIA e um aviso. **É sugestão: a pessoa confere cada campo contra o PDF na prévia.** PDF escaneado não tem texto.
 */
export const DATASHEET_IO_VERSION = 'datasheet-io-1.0.0';

const MINUS = /[−–—]/g;
const NUM = '(\\d+(?:[.,]\\d+)?)';
const SIGNED = '([+\\-−–]?\\s*\\d+(?:[.,]\\d+)?)';

interface Rule {
  field: string;
  /** Rótulos aceitos (regex) seguidos do número. */
  pattern: RegExp;
  /** Faixa plausível: valor fora dela é descartado (evita pegar outro número da linha). */
  range: [number, number];
  /** Coeficientes de temperatura sem sinal impresso: assume negativo, com confiança baixa. */
  assumeNegative?: boolean;
  /** Unidade que se repete nas colunas de outros modelos da mesma linha (para detectar tabelas de vários modelos). */
  columnUnit?: string;
}

const rules: Rule[] = [
  {
    field: 'pmaxWp',
    pattern: new RegExp(
      `(?:maximum\\s+power(?:\\s*\\(pmax\\))?|potência\\s+máxima|nominal\\s+(?:maximum\\s+)?power|pmax|pmpp)[^\\d\\n]{0,40}?${NUM}\\s*wp?\\b`,
      'gi',
    ),
    range: [50, 800],
    columnUnit: 'wp?',
  },
  {
    field: 'vmppV',
    pattern: new RegExp(
      `(?:voltage\\s+at\\s+(?:maximum\\s+power|pmax)|vmp+|tensão\\s+(?:de\\s+)?máxima\\s+potência|tensão\\s+(?:em|na)\\s+pmax)[^\\d\\n]{0,40}?${NUM}\\s*v\\b`,
      'gi',
    ),
    range: [5, 100],
    columnUnit: 'v',
  },
  {
    field: 'imppA',
    pattern: new RegExp(
      `(?:current\\s+at\\s+(?:maximum\\s+power|pmax)|imp+|corrente\\s+(?:de\\s+)?máxima\\s+potência|corrente\\s+(?:em|na)\\s+pmax)[^\\d\\n]{0,40}?${NUM}\\s*a\\b`,
      'gi',
    ),
    range: [0.5, 30],
    columnUnit: 'a',
  },
  {
    field: 'vocV',
    pattern: new RegExp(
      `(?:open[\\s-]circuit\\s+voltage|voc|tensão\\s+de\\s+circuito\\s+aberto)(?!\\s*(?:temperature|coefficient|coeficiente))[^\\d\\n%/]{0,30}?${NUM}\\s*v\\b`,
      'gi',
    ),
    range: [5, 120],
    columnUnit: 'v',
  },
  {
    field: 'iscA',
    pattern: new RegExp(
      `(?:short[\\s-]circuit\\s+current|isc|corrente\\s+de\\s+curto[\\s-]circuito)(?!\\s*(?:temperature|coefficient|coeficiente))[^\\d\\n%/]{0,30}?${NUM}\\s*a\\b`,
      'gi',
    ),
    range: [0.5, 30],
    columnUnit: 'a',
  },
  {
    field: 'betaVocPctPerC',
    pattern: new RegExp(
      `(?:temperature\\s+coefficient\\s+of\\s+voc|coeficiente\\s+de\\s+temperatura\\s+(?:de|da)\\s+voc|β\\s*voc|beta\\s*voc)[^\\d+\\-−–\\n]{0,25}${SIGNED}\\s*%`,
      'gi',
    ),
    range: [-1.5, 0.5],
    assumeNegative: true,
  },
  {
    field: 'alphaIscPctPerC',
    pattern: new RegExp(
      `(?:temperature\\s+coefficient\\s+of\\s+isc|coeficiente\\s+de\\s+temperatura\\s+(?:de|da)\\s+isc|α\\s*isc|alpha\\s*isc)[^\\d+\\-−–\\n]{0,25}${SIGNED}\\s*%`,
      'gi',
    ),
    range: [-0.5, 0.5],
  },
  {
    field: 'gammaPmaxPctPerC',
    pattern: new RegExp(
      `(?:temperature\\s+coefficient\\s+of\\s+pmax|coeficiente\\s+de\\s+temperatura\\s+(?:de|da)\\s+pmax|γ\\s*pmax|gamma\\s*pmax)[^\\d+\\-−–\\n]{0,25}${SIGNED}\\s*%`,
      'gi',
    ),
    range: [-1.5, 0.5],
    assumeNegative: true,
  },
  {
    field: 'noctC',
    pattern: new RegExp(
      `noct[^\\d\\n]{0,25}${NUM}\\s*(?:±\\s*\\d+(?:[.,]\\d+)?\\s*)?°?\\s*c\\b`,
      'gi',
    ),
    range: [30, 60],
  },
  {
    field: 'maxSystemVoltageV',
    pattern: new RegExp(
      `(?:maximum\\s+system\\s+voltage|tensão\\s+máxima\\s+do\\s+sistema)[^\\d\\n]{0,25}${NUM}\\s*v`,
      'gi',
    ),
    range: [500, 2000],
  },
  {
    field: 'maxSeriesFuseA',
    pattern: new RegExp(
      `(?:maximum\\s+series\\s+fuse(?:\\s+rating)?|fusível\\s+máximo(?:\\s+em\\s+série)?)[^\\d\\n]{0,25}${NUM}\\s*a\\b`,
      'gi',
    ),
    range: [5, 50],
  },
  {
    field: 'efficiencyPct',
    pattern: new RegExp(
      `(?:module\\s+efficiency|eficiência\\s+do\\s+módulo)[^\\d\\n]{0,25}${NUM}\\s*%`,
      'gi',
    ),
    range: [10, 30],
    columnUnit: '%',
  },
  {
    field: 'weightKg',
    pattern: new RegExp(`(?:weight|peso)[^\\d\\n]{0,25}${NUM}\\s*kg`, 'gi'),
    range: [5, 60],
  },
];

const DIMENSIONS = /(\d{3,4})\s*[x×*]\s*(\d{3,4})\s*(?:[x×*]\s*(\d{2,3}))?\s*mm/gi;

const normalize = (text: string): string => text.replace(MINUS, '-').replace(/\u00a0/g, ' ');

export function extractModuleDatasheet(rawText: string): ParsedEquipment {
  const text = normalize(rawText);
  const spec: Record<string, unknown> = {};
  const fieldConfidence: Record<string, FieldConfidence> = {};
  const notes: string[] = [];

  for (const rule of rules) {
    const values: number[] = [];
    let unsigned = false;
    for (const match of text.matchAll(rule.pattern)) {
      const raw = (match[1] ?? '').replace(/\s/g, '');
      let value = toNumber(raw);
      if (value === undefined) continue;
      if (rule.assumeNegative && !/^[+-]/.test(raw)) {
        value = -value;
        unsigned = true;
      }
      if (value < rule.range[0] || value > rule.range[1]) continue;
      values.push(value);
      if (rule.columnUnit) {
        // Tabelas de vários modelos repetem a unidade na mesma linha: os demais valores entram na contagem.
        const end = (match.index ?? 0) + match[0].length;
        const tail = text.slice(
          end,
          text.indexOf('\n', end) === -1 ? undefined : text.indexOf('\n', end),
        );
        for (const extra of tail.matchAll(
          new RegExp(`${NUM}\\s*${rule.columnUnit}(?![a-z])`, 'gi'),
        )) {
          const v = toNumber(extra[1]);
          if (v !== undefined && v >= rule.range[0] && v <= rule.range[1]) values.push(v);
        }
      }
    }
    if (values.length === 0) continue;
    const distinct = new Set(values);
    spec[rule.field] = values[0];
    fieldConfidence[rule.field] = distinct.size > 1 || unsigned ? 'MEDIUM' : 'HIGH';
    if (distinct.size > 1)
      notes.push(
        `"${rule.field}" aparece com ${distinct.size} valores diferentes (provavelmente uma coluna por modelo): foi usado o primeiro (${values[0]}). Confira no PDF.`,
      );
    if (unsigned) {
      fieldConfidence[rule.field] = 'LOW';
      notes.push(`"${rule.field}" veio sem sinal na ficha: assumido negativo. Confira no PDF.`);
    }
  }

  const dim = [...text.matchAll(DIMENSIONS)].find((m) => {
    const a = Number(m[1]);
    const b = Number(m[2]);
    return Math.max(a, b) >= 900 && Math.min(a, b) >= 500;
  });
  if (dim) {
    const a = Number(dim[1]);
    const b = Number(dim[2]);
    spec.lengthMm = Math.max(a, b);
    spec.widthMm = Math.min(a, b);
    fieldConfidence.lengthMm = 'MEDIUM';
    fieldConfidence.widthMm = 'MEDIUM';
    if (dim[3]) {
      spec.thicknessMm = Number(dim[3]);
      fieldConfidence.thicknessMm = 'MEDIUM';
    }
  }

  if (
    /monocrystalline|monocristalin|mono[\s-]?perc|n[\s-]?type|topcon|\bhjt\b|\bmono\b/i.test(text)
  ) {
    spec.technology = 'MONO_SI';
    fieldConfidence.technology = 'LOW';
  } else if (/polycrystalline|policristalin|multicrystalline|\bpoly\b/i.test(text)) {
    spec.technology = 'POLY_SI';
    fieldConfidence.technology = 'LOW';
  }
  if (/bifacial/i.test(text)) {
    spec.bifacial = true;
    fieldConfidence.bifacial = 'LOW';
  }
  if (spec.pmaxWp !== undefined && /\b\d{3}\s*[-–/]\s*\d{3}\s*w/i.test(text))
    notes.push(
      'A ficha parece cobrir uma faixa de potências: confira qual modelo você está cadastrando.',
    );
  notes.push('Fabricante e modelo não são lidos da ficha: informe à mão.');
  notes.push('Coeficientes em mV/°C ou mA/°C não são lidos: informe em %/°C.');

  return {
    kind: 'MODULE',
    manufacturer: '',
    model: '',
    spec,
    fieldConfidence,
    missing: missingFields('MODULE', spec),
    notes,
  };
}
