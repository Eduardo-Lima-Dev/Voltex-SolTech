import type { FieldConfidence } from '@voltex/shared';
import type { LayoutLine } from './layout.js';
import { missingFields, toNumber, type ParsedEquipment } from './import-types.js';

/**
 * Leitura assistida da ficha técnica (PDF com camada de texto) de um **inversor**. Fichas trazem uma coluna por modelo
 * (e células que valem para vários modelos); a posição horizontal de cada célula decide de qual modelo é o valor.
 * Devolve **um registro por modelo**, com a confiança de cada campo. **É sugestão: a pessoa confere na prévia.**
 */
export const DATASHEET_INVERTER_IO_VERSION = 'datasheet-inverter-io-1.0.0';

const strip = (text: string): string =>
  text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[−–—]/g, '-').toLowerCase();

interface Cell {
  text: string;
  center: number;
  width?: number;
}
interface Row {
  label: string;
  values: Cell[];
}

/** `3.000` (milhar à brasileira: um ponto e exatamente três dígitos) vira 3000; `17.3` continua 17,3. */
const num = (raw: string): number | undefined =>
  toNumber(/^\d{1,3}(?:\.\d{3})+$/.test(raw) ? raw.replace(/\./g, '') : raw);

const numbers = (text: string): number[] =>
  [...text.matchAll(/\d{1,3}(?:\.\d{3})+(?!\d)|\d+(?:[.,]\d+)?/g)].flatMap((m) => {
    const v = num(m[0]);
    return v === undefined ? [] : [v];
  });

/** Potência de um texto (`15 kW`, `13200VA`, `352kVA @35°C`): o primeiro valor, em watts. */
function watts(text: string): number | undefined {
  const m = /(\d{1,3}(?:\.\d{3})+(?!\d)|\d+(?:[.,]\d+)?)\s*(k?)\s*(?:wp|w|va)\b/i.exec(text);
  const v = m?.[1] === undefined ? undefined : num(m[1]);
  return v === undefined ? undefined : Math.round(v * (m?.[2] ? 1000 : 1) * 100) / 100;
}

/** Primeiro número seguido da unidade (ex.: `1500V`, `40A`, `98.6%`). */
const first = (text: string): number | undefined => numbers(text)[0];

/** Faixa `a-b` (`500-1500V`, `140V-1000V`). */
function range(text: string): [number, number] | undefined {
  const m = /(\d+(?:[.,]\d+)?)\s*v?\s*(?:-|~|a)\s*(\d+(?:[.,]\d+)?)/i.exec(strip(text));
  const a = toNumber(m?.[1]);
  const b = toNumber(m?.[2]);
  return a !== undefined && b !== undefined && a < b ? [a, b] : undefined;
}

/** Corrente por MPPT: `40A`, `2×32 A`, `40A+20A` (MPPTs diferentes: vale o menor, conservador). */
function perMpptCurrent(
  text: string,
): { value: number; note?: string; channels?: number } | undefined {
  const t = strip(text).replace(/,/g, '.');
  const times = /(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)/.exec(t);
  if (times && !/\d\s*a\s*[x×]/.test(t)) return { value: Number(times[2]) };
  // `20A x 2`: valor por canal × quantidade de canais.
  const perChannel = /(\d+(?:\.\d+)?)\s*a\s*[x×]\s*(\d+)/.exec(t);
  if (perChannel) return { value: Number(perChannel[1]), channels: Number(perChannel[2]) };
  const plus = [...t.matchAll(/(\d+(?:\.\d+)?)\s*a\b/g)].map((m) => Number(m[1]));
  if (plus.length > 1 && (t.includes('+') || t.includes('/')))
    return {
      value: Math.min(...plus),
      note: `Correntes diferentes por MPPT (${plus.join(' + ')} A): usado o menor, por segurança.`,
    };
  const v = first(t);
  return v === undefined ? undefined : { value: v };
}

type Setter = (
  spec: Record<string, unknown>,
  conf: Record<string, FieldConfidence>,
  notes: string[],
  text: string,
) => void;

const put =
  (
    field: string,
    parse: (text: string) => number | undefined,
    confidence: FieldConfidence = 'HIGH',
  ): Setter =>
  (spec, conf, _notes, text) => {
    const v = parse(text);
    if (v !== undefined) {
      spec[field] = v;
      conf[field] = confidence;
    }
  };

/** Último número do texto (`18/17.3` → 17.3: em "Entrada/Saída" vale a saída). */
const last = (text: string): number | undefined => numbers(text).at(-1);

interface FieldRule {
  /** Rótulo (sem acento, minúsculo; português e inglês). */
  label: RegExp;
  /** Rótulos que parecem o mesmo mas são outra coisa. */
  not?: RegExp;
  set: Setter;
}

const THREE_PHASE = /3\s*[φΦf]|3\s*\/\s*n|3\s*l\b|3\s*l\s*\+|trif|three/i;
const ONE_PHASE = /1\s*[φΦf]|\bl\s*[/+]\s*n|mono|single/i;

const currentRule =
  (field: 'iMaxPerMpptA' | 'iscMaxPerMpptA'): Setter =>
  (spec, conf, notes, text) => {
    const c = perMpptCurrent(text);
    if (c) {
      spec[field] = c.value;
      conf[field] = c.note ? 'MEDIUM' : 'HIGH';
      if (c.note) notes.push(c.note);
      if (c.channels && field === 'iMaxPerMpptA') spec.__channels = c.channels;
    }
  };

const fieldRules: FieldRule[] = [
  {
    // Microinversores trazem só a potência contínua máxima (em VA): vale como nominal e máxima, com aviso.
    label: /^max(?:\.|ima|imo)?\s*potencia continua de saida|continuous output power/,
    set: (spec, conf, notes, text) => {
      const w = watts(text);
      if (w === undefined) return;
      spec.pAcMaxW = w;
      conf.pAcMaxW = 'HIGH';
      if (spec.pAcNomW === undefined) {
        spec.pAcNomW = w;
        conf.pAcNomW = 'MEDIUM';
        notes.push(
          'A ficha traz só a potência contínua máxima de saída: usada como potência nominal. Confira.',
        );
      }
    },
  },
  {
    label: /^corrente nominal de saida|rated output current/,
    set: (spec, _c, _n, text) => void (spec.__iacNominal = first(text)),
  },
  {
    label:
      /potencia (ca )?nominal( de saida)?|potencia de saida nominal|nominal ac output power|rated output power|rated ac (input\/output )?(active )?(output )?power|rated (output )?power/,
    not: /reativ|reactive|cc|dc|pv|load|backup/,
    set: put('pAcNomW', watts),
  },
  {
    label:
      /^max(?:\.|ima|imo)?\s*potencia (continua )?(de saida )?(ca|continua)?( \(aparente\))?$|max(?:\.|ima|imo)?\s*(potencia|poder) aparente|max(?:\.|ima|imo)?\s*ac (input\/output )?(apparent )?power|max(?:\.|ima|imo)?\s*potencia de saida ca/,
    set: put('pAcMaxW', watts),
  },
  {
    label:
      /max(?:\.|ima|imo)?\s*potencia (de entrada )?cc|potencia de entrada cc max|max(?:\.|ima|imo)?\s*pv access power|potencia fotovoltaica maxima|recommended max\.? pv input power/,
    set: put('pDcMaxW', watts),
  },
  {
    label:
      /max(?:\.|ima|imo)?\s*(pv input voltage|input voltage|tensao (de entrada )?cc|tensao de entrada)|tensao (maxima de entrada|de entrada maxima)|tensao de entrada fotovoltaica/,
    not: /faixa|range/,
    // `(125~500)`: numa faixa vale o limite superior.
    set: put('vDcMaxV', (text) => range(text)?.[1] ?? first(text)),
  },
  {
    label: /tensao (cc |de entrada cc )?de partida|start-?up voltage|starting voltage/,
    set: put('vStartV', first),
  },
  {
    label: /(faixa|intervalo|range)[^()]*mppt|mppt[^()]*(voltage )?range/,
    not: /carga total|full[- ]load|\(carga|nominal|rated|plena/,
    set: (spec, conf, _notes, text) => {
      const r = range(text);
      if (r) {
        spec.mpptMinV = r[0];
        spec.mpptMaxV = r[1];
        conf.mpptMinV = 'HIGH';
        conf.mpptMaxV = 'HIGH';
      }
    },
  },
  {
    label:
      /max(?:\.|ima|imo)?\s*(operating pv input current|corrente de entrada( cc)?( por mppt)?|input (mppt )?current)|corrente maxima de entrada/,
    not: /curto|short/,
    set: currentRule('iMaxPerMpptA'),
  },
  {
    label: /curto[- ]?circuito|short[- ]circuit current|^isc( pv| cc)?$/,
    not: /saida|output|ca\b/,
    set: currentRule('iscMaxPerMpptA'),
  },
  {
    label:
      /^(numero|n°|nº|no\.?|quantidade)\s*de (mppts?|rastreadores mpp)|^mppts? \/ numero de entradas|number of mppt|no\. of mpp trackers/,
    set: (spec, conf, _notes, text) => {
      const v = first(text);
      if (v !== undefined && Number.isInteger(v)) {
        spec.mpptCount = v;
        conf.mpptCount = 'HIGH';
        // `2 / 2+1`: depois da barra vêm as strings por MPPT.
        const strings = /\/\s*([\d+\s]+)/.exec(text)?.[1];
        const inputs = strings ? Math.max(...numbers(strings)) : undefined;
        if (inputs) {
          spec.inputsPerMppt = inputs;
          conf.inputsPerMppt = 'MEDIUM';
        }
      }
    },
  },
  {
    label:
      /^strings? (por|per) mppt|max(?:\.|ima|imo)?\s*entradas por (rastreador mpp|mppt)|quantidade de entradas por mppt/,
    set: (spec, conf, _notes, text) => {
      const n = numbers(text);
      if (n.length) {
        spec.inputsPerMppt = Math.max(...n);
        conf.inputsPerMppt = 'MEDIUM';
      }
    },
  },
  {
    label: /numero de entradas cc/,
    set: (spec, _c, _n, text) => void (spec.__inputs = first(text)),
  },
  {
    label: /max(?:\.|ima|imo)?\s*numero de entradas de string/,
    set: (spec, _c, _n, text) => void (spec.__inputs = first(text)),
  },
  {
    label:
      /max(?:\.|ima|imo)?\s*(ac\s*(input\/output\s*)?current|output current|corrente (ca|de saida)|corrente de saida)/,
    not: /nominal|rated|passthrough|continuous/,
    set: put('iAcMaxA', last),
  },
  {
    label: /eficiencia (max|maxima)|max(?:\.|ima|imo)?\s*(eficiencia|efficiency)/,
    not: /mppt/,
    set: put('efficiencyMaxPct', first),
  },
  {
    label: /eficiencia (da |ponderada )?(ue|europeia?|european|euro)|euro(pean)? efficiency/,
    set: put('efficiencyEuroPct', first),
  },
  {
    label: /sem exportacao|zero export|limitacao de exportacao|export limit/,
    set: (spec, conf, _notes, text) => {
      spec.exportLimitation = /suportad|sim|integrad|yes|support/i.test(strip(text));
      conf.exportLimitation = 'HIGH';
    },
  },
  {
    label:
      /tensao (nominal )?(de (saida|rede)|ca)|tensao nominal de rede|tensao ca nominal|(rated|nominal) (input\/output )?(grid |ac |output )*voltage/,
    not: /^faixa|\bdc\b|\bcc\b|\bpv\b/,
    set: (spec, conf, notes, text) => {
      const volts = [...text.matchAll(/(\d+(?:[.,]\d+)?)\s*v?/gi)].flatMap((m) => {
        const v = toNumber(m[1]);
        return v !== undefined && v >= 100 && v <= 1500 ? [v] : [];
      });
      // `0.85Un-1.1Un` e faixas viram números pequenos: só valem tensões plausíveis.
      const unique = [...new Set(volts)];
      if (!unique.length) return;
      const three = THREE_PHASE.test(text);
      spec.__acVolts = unique;
      if (three) spec.__acThree = true;
      const line = three ? (unique.find((v) => v >= 300) ?? unique[0]) : unique[0];
      spec.vAcV = line;
      conf.vAcV = unique.length > 1 ? 'MEDIUM' : 'HIGH';
      if (unique.length > 1)
        notes.push(
          `Tensão CA com mais de um valor (${unique.join(' / ')} V): usado ${line} V. Confira.`,
        );
    },
  },
  {
    label:
      /tipo de conexao de rede|conexao a rede|tipo de rede|grid connection form|tipo de ligacao/,
    set: (spec, _c, _n, text) => {
      if (THREE_PHASE.test(text)) spec.__acThree = true;
      else if (ONE_PHASE.test(text)) spec.__acThree = false;
    },
  },
];

const NAME_ROW = /^((nome do )?modelo|model)$/;
/** Cabeçalho que também traz os nomes dos modelos nas colunas (só vale com dois ou mais modelos). */
const TITLE_ROW = /^(especificacao tecnica|technical (data|specifications?))$/;

/** Rótulo impresso em dobro (texto sobreposto no PDF): `Start-up Voltage (V)Start-up Voltage (V)`. */
function dedupeLabel(label: string): string {
  const half = label.length / 2;
  return Number.isInteger(half) && label.slice(0, half) === label.slice(half)
    ? label.slice(0, half)
    : label;
}

/**
 * Nomes de modelo lado a lado podem vir juntos numa só célula (colunas muito próximas): separa pelas palavras e
 * distribui pela largura da célula. Células já separadas ficam como estão.
 */
function expandTokens(cells: Cell[]): Cell[] {
  if (cells.length !== 1) return cells;
  const cell = cells[0] as Cell;
  const tokens = cell.text.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return cells;
  // `cell.center` é o meio de x0..x1; sem a largura, distribui em partes iguais em torno do centro.
  const width = (cell.width ?? 0) || tokens.length * 60;
  const start = cell.center - width / 2;
  return tokens.map((text, k) => ({ text, center: start + ((k + 0.5) * width) / tokens.length }));
}

function rowsOf(lines: LayoutLine[]): { models: Cell[] | undefined; rows: Row[] } {
  const left = Math.min(...lines.flatMap((l) => l.cells.slice(0, 1).map((c) => c.x0)));
  const hasLabel = (line: LayoutLine) => (line.cells[0]?.x0 ?? Infinity) <= left + 40;
  const rows: Row[] = [];
  let models: Cell[] | undefined;
  const toCells = (cells: LayoutLine['cells']): Cell[] =>
    cells.map((c) => ({ text: c.text, center: (c.x0 + c.x1) / 2, width: c.x1 - c.x0 }));
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as LayoutLine;
    const [labelCell, ...rest] = line.cells;
    if (!labelCell) continue;
    if (!hasLabel(line)) continue; // linha só de valores: já foi consumida por um rótulo quebrado
    const label = dedupeLabel(strip(labelCell.text).trim().replace(/:$/, ''))
      .replace(/\s*\(\d\)/g, '')
      .replace(/\s+\d$/, '');
    let cells = toCells(rest);
    // `Model` sozinho numa linha: o início do nome vem na linha de cima e o fim na de baixo, sem rótulo.
    if (NAME_ROW.test(label) && cells.length === 0 && !models) {
      const above = lines[i - 1];
      const below = lines[i + 1];
      if (below && !hasLabel(below)) {
        const end = expandTokens(toCells(below.cells));
        const start = above && !hasLabel(above) ? expandTokens(toCells(above.cells)) : [];
        models = end.map((c, k) => ({
          ...c,
          text: start.length === end.length ? `${(start[k] as Cell).text}${c.text}` : c.text,
        }));
        i += 1;
        continue;
      }
    }
    if (
      (NAME_ROW.test(label) || (TITLE_ROW.test(label) && rest.length >= 2)) &&
      cells.length > 0 &&
      !models
    ) {
      cells = expandTokens(cells);
      // Nome do modelo quebrado em duas linhas: a de cima tem o início e a de baixo (com o rótulo) o fim.
      const above = lines[i - 1];
      const aboveCells = above && !hasLabel(above) ? expandTokens(toCells(above.cells)) : [];
      const below = lines[i + 1];
      const belowCells = below && !hasLabel(below) ? expandTokens(toCells(below.cells)) : [];
      if (aboveCells.length === cells.length)
        cells = cells.map((c, k) => ({ ...c, text: `${(aboveCells[k] as Cell).text}${c.text}` }));
      // `SUN2000` com o fim do nome (`-5KTL-L1`) na linha de baixo, sem rótulo.
      else if (belowCells.length === cells.length) {
        cells = cells.map((c, k) => ({ ...c, text: `${c.text}${(belowCells[k] as Cell).text}` }));
        i += 1;
      }
      models = cells;
      continue;
    }
    // Rótulo quebrado em duas linhas (`No. of MPP Trackers/` + valores + `No. of Strings MPP Tracker`).
    if (rest.length === 0 && /[/,-]$/.test(labelCell.text.trim())) {
      const mid = lines[i + 1];
      const tail = lines[i + 2];
      if (mid && !hasLabel(mid) && tail && hasLabel(tail) && tail.cells.length === 1) {
        rows.push({
          label: `${label} ${strip(tail.cells[0]!.text).trim()}`,
          values: toCells(mid.cells),
        });
        i += 2;
        continue;
      }
    }
    rows.push({ label, values: cells });
  }
  return { models, rows };
}

/** Valor de uma linha para o modelo `index`: 1 valor vale para todos; mesma quantidade, um por modelo; senão, o mais próximo. */
function valueFor(
  row: Row,
  models: Cell[],
  index: number,
): { text: string; approx: boolean } | undefined {
  if (row.values.length === 0) return undefined;
  // Lista de valores de uma célula só (`352kVA @35°C / 320kVA @45°C`): vale para todos os modelos.
  const merged = row.values.some((v) => v.text.includes('@'));
  if (merged) return { text: row.values.map((v) => v.text).join(' '), approx: false };
  if (row.values.length === 1) return { text: (row.values[0] as Cell).text, approx: false };
  if (row.values.length === models.length)
    return { text: (row.values[index] as Cell).text, approx: false };
  const center = (models[index] as Cell).center;
  let best = row.values[0] as Cell;
  for (const v of row.values)
    if (Math.abs(v.center - center) < Math.abs(best.center - center)) best = v;
  return { text: best.text, approx: true };
}

const BRANDS =
  /\b(csi solar|growatt|sungrow|huawei|fronius|solis|ginlong|deye|goodwe|canadian solar|intelbras|weg|sma|hoymiles|sofar|solax|livoltek|renovigi|byd|refusol|abb|fimer|kstar|saj|chint|apsystems|elgin|solplanet|enphase|tsun|nep|fox ?ess)\b/i;

/**
 * @param lines linhas da página da tabela de especificações (uma tabela por chamada)
 * @param documentText texto corrido do PDF inteiro (título e marca)
 */
export function extractInverterDatasheet(
  lines: LayoutLine[],
  documentText = '',
  modelHint = '',
): ParsedEquipment[] {
  const parsedTable = rowsOf(lines);
  const unnamed = !parsedTable.models;
  // Sem cabeçalho de modelos reconhecido: ficha de um modelo só (nome vindo de quem enviou). Linhas com vários
  // valores (uma coluna por modelo) não dá para atribuir sem o cabeçalho e ficam de fora.
  const table = {
    models: parsedTable.models ?? [{ text: modelHint, center: 0 }],
    rows: unnamed ? parsedTable.rows.filter((r) => r.values.length <= 1) : parsedTable.rows,
  };
  if (unnamed && table.rows.length < 8) return [];
  const brandRaw = BRANDS.exec(documentText)?.[1];
  const SPECIAL: Record<string, string> = {
    apsystems: 'APsystems',
    'fox ess': 'Fox ESS',
    foxess: 'Fox ESS',
  };
  const brand = brandRaw
    ? (SPECIAL[brandRaw.toLowerCase()] ??
      brandRaw
        .toLowerCase()
        .split(' ')
        .map((w) =>
          ['csi', 'weg', 'sma', 'abb', 'byd', 'saj', 'nep'].includes(w)
            ? w.toUpperCase()
            : w[0]!.toUpperCase() + w.slice(1),
        )
        .join(' '))
    : undefined;
  const titleThree = /trif[aá]sic|three[- ]phase/i.test(documentText);
  const titleMono = /monof[aá]sic|single[- ]phase/i.test(documentText);
  const micro = /microinversor/i.test(documentText);
  const hybrid = /h[ií]brido|hybrid/i.test(documentText);

  return table.models.map((model, index) => {
    const spec: Record<string, unknown> = {};
    const confidence: Record<string, FieldConfidence> = {};
    const notes: string[] = [];
    for (const row of table.rows) {
      const rule = fieldRules.find(
        (r) => r.label.test(row.label) && !(r.not && r.not.test(row.label)),
      );
      if (!rule) continue;
      const found = valueFor(row, table.models, index);
      if (!found) continue;
      // Valor sem unidade (`7200`) com a unidade no rótulo (`Max. PV Access Power (W)`).
      const labelUnit = /\((k?w|kva|va|wp)\)/i.exec(row.label)?.[1];
      if (labelUnit && /^\d+(?:[.,]\d+)?$/.test(found.text.trim()))
        found.text = `${found.text} ${labelUnit}`;
      const before = new Set(Object.keys(spec));
      const previous = { ...spec };
      rule.set(spec, confidence, notes, found.text);
      if (found.approx)
        for (const key of Object.keys(spec))
          if (!before.has(key) || spec[key] !== previous[key]) {
            confidence[key] = 'LOW';
            notes.push(
              `"${key}": a célula da ficha cobre mais de um modelo; valor atribuído pela posição da coluna. Confira no PDF.`,
            );
          }
    }

    if (typeof spec.__channels === 'number' && spec.mpptCount === undefined) {
      spec.mpptCount = spec.__channels;
      confidence.mpptCount = 'MEDIUM';
      notes.push(
        `${spec.__channels} canais de entrada (corrente "valor × canais"): contados como MPPTs.`,
      );
    }
    if (typeof spec.__iacNominal === 'number' && spec.iAcMaxA === undefined) {
      spec.iAcMaxA = spec.__iacNominal;
      confidence.iAcMaxA = 'LOW';
      notes.push('A ficha não traz a corrente máxima de saída: usada a corrente nominal. Confira.');
    }
    const inputs = typeof spec.__inputs === 'number' ? spec.__inputs : undefined;
    if (inputs && typeof spec.mpptCount === 'number' && spec.inputsPerMppt === undefined) {
      spec.inputsPerMppt = Math.max(1, Math.round(inputs / spec.mpptCount));
      confidence.inputsPerMppt = 'MEDIUM';
      notes.push(`Entradas por MPPT = ${inputs} entradas ÷ ${spec.mpptCount} MPPTs.`);
    }
    // Fases e tensão de linha.
    const three = spec.__acThree === true || (spec.__acThree === undefined && titleThree);
    if (spec.vAcV !== undefined || spec.__acThree !== undefined || titleThree || titleMono) {
      spec.phases = three ? 3 : titleMono || spec.__acThree === false ? 1 : undefined;
      if (spec.phases !== undefined)
        confidence.phases = spec.__acThree !== undefined ? 'HIGH' : 'MEDIUM';
      else delete spec.phases;
      if (three && Array.isArray(spec.__acVolts)) {
        const volts = spec.__acVolts as number[];
        const line = volts.find((v) => v >= 300) ?? volts[0];
        spec.vAcV = line;
      }
    }
    // Potência nominal ausente: a ficha só traz a aparente; o nome do modelo costuma trazer `350K`.
    if (spec.pAcNomW === undefined) {
      const fromName = /(\d+(?:[.,]\d+)?)\s*k(?:w)?(?![a-z])/i.exec(model.text);
      const kw = toNumber(fromName?.[1]);
      if (kw !== undefined) {
        spec.pAcNomW = kw * 1000;
        confidence.pAcNomW = 'LOW';
        notes.push(`A ficha não traz a potência nominal: ${kw} kW vem do nome do modelo. Confira.`);
      }
    }
    // Sem indicação de fases e com tensão de rede residencial (até 277 V): monofásico, com confiança baixa.
    if (spec.phases === undefined && typeof spec.vAcV === 'number' && spec.vAcV <= 277) {
      spec.phases = 1;
      confidence.phases = 'LOW';
      notes.push(`Fases não informadas na ficha: assumido monofásico (${spec.vAcV} V). Confira.`);
    }
    if (
      typeof spec.pAcMaxW === 'number' &&
      typeof spec.pAcNomW === 'number' &&
      spec.pAcMaxW < spec.pAcNomW
    ) {
      notes.push(
        `Potência aparente máxima (${spec.pAcMaxW} VA) menor que a nominal (${spec.pAcNomW} W): valor descartado. Confira no PDF.`,
      );
      delete spec.pAcMaxW;
      delete confidence.pAcMaxW;
    }
    spec.topology = micro ? 'MICRO' : hybrid ? 'HYBRID' : 'STRING';
    confidence.topology = micro || hybrid || /string/i.test(documentText) ? 'MEDIUM' : 'LOW';
    if (unnamed)
      notes.push(
        'A tabela não tem o cabeçalho dos modelos: foi lido um modelo só (nome da listagem) e as linhas com um valor por coluna foram ignoradas. Confira no PDF.',
      );
    if (spec.exportLimitation === undefined) spec.exportLimitation = false;
    delete spec.__channels;
    delete spec.__iacNominal;
    delete spec.__inputs;
    delete spec.__acVolts;
    delete spec.__acThree;
    return {
      kind: 'INVERTER' as const,
      manufacturer: brand ?? '',
      model: model.text.trim(),
      spec,
      fieldConfidence: confidence,
      missing: missingFields('INVERTER', spec),
      notes,
    };
  });
}
