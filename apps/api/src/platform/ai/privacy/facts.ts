import { formatBrlFromCents, formatKwh, formatKwp, formatPercent } from '@voltex/shared';

/**
 * Tabela de fatos (ADR-0030). Todo número, valor, data e código que a IA pode citar vem de uma ferramenta e ganha um
 * id (`F3`). O modelo escreve só `{{F3}}`; o servidor troca pelo valor formatado. Assim a IA não digita número.
 */

export type FactType =
  | 'MONEY'
  | 'PERCENT'
  | 'PERCENT_POINTS'
  | 'COUNT'
  | 'DATE'
  | 'KWH'
  | 'KWP'
  | 'NUMBER'
  | 'CODE'
  | 'TEXT';

export interface Fact {
  id: string;
  type: FactType;
  /** Valor bruto como veio da ferramenta (centavos, fração, texto). */
  value: number | string;
  /** De onde veio: ferramenta e parâmetros, para o "ver os dados" da tela. */
  source: { tool: string; params: Record<string, unknown>; at: string };
  /** Caminho no resultado (`receivables[0].amountCents`), para descrever o fato. */
  path: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const CODE = /^[A-Z]{2,6}-[A-Z0-9]{4,}$/;
/** Pseudônimos (`[CLIENTE_1]`) carregam algarismo, mas não são dado: não viram fato. */
const ALIAS = /\[(?:CLIENTE|CONTATO|USUARIO|EQUIPE)_\d+\]/g;

/** Tipo do fato pelo nome do campo e pelo valor. As ferramentas seguem a convenção do resto da API. */
export function inferFactType(key: string, value: unknown): FactType | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (/cents$/i.test(key)) return 'MONEY';
    // `...Pct` já vem em pontos percentuais (24,5); `...Rate`/`...Ratio`/`conversion` vêm como fração (0,245).
    if (/(pct|percent)$/i.test(key)) return 'PERCENT_POINTS';
    if (/(rate|ratio|conversion)/i.test(key)) return 'PERCENT';
    if (/kwh/i.test(key)) return 'KWH';
    if (/kwp/i.test(key)) return 'KWP';
    if (/(count|total|qty|quantity|quantidade|days|dias|open|overdue)$/i.test(key)) return 'COUNT';
    return 'NUMBER';
  }
  if (typeof value === 'string') {
    if (ISO_DATE.test(value)) return 'DATE';
    if (CODE.test(value)) return 'CODE';
    // Qualquer outro texto com algarismo (número de nota, "2º trimestre") também vira fato: o modelo não digita dígitos.
    if (/\d/.test(value.replace(ALIAS, ''))) return 'TEXT';
  }
  return null;
}

const dateFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' });
const intFmt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const numFmt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

/** Texto final de um fato, em pt-BR. */
export function formatFact(fact: Pick<Fact, 'type' | 'value'>): string {
  const v = fact.value;
  switch (fact.type) {
    case 'MONEY':
      return formatBrlFromCents(Number(v));
    case 'PERCENT':
      return formatPercent(Number(v), 1);
    case 'PERCENT_POINTS':
      return `${numFmt.format(Number(v))}%`;
    case 'COUNT':
      return intFmt.format(Number(v));
    case 'KWH':
      return formatKwh(Number(v), 0);
    case 'KWP':
      return formatKwp(Number(v));
    case 'DATE': {
      const d = new Date(String(v));
      return Number.isNaN(d.getTime()) ? String(v) : dateFmt.format(d);
    }
    case 'NUMBER':
      return numFmt.format(Number(v));
    case 'CODE':
    case 'TEXT':
    default:
      return String(v);
  }
}

export class FactTable {
  private readonly facts = new Map<string, Fact>();
  private counter = 0;

  constructor(initial: readonly Fact[] = []) {
    for (const f of initial) {
      this.facts.set(f.id, f);
      this.counter = Math.max(this.counter, Number(f.id.slice(1)) || 0);
    }
  }

  add(input: Omit<Fact, 'id'>): Fact {
    const fact: Fact = { ...input, id: `F${++this.counter}` };
    this.facts.set(fact.id, fact);
    return fact;
  }

  get(id: string): Fact | undefined {
    return this.facts.get(id);
  }

  all(): Fact[] {
    return [...this.facts.values()];
  }

  /**
   * Percorre o resultado de uma ferramenta: cada número, data, código e texto com algarismo vira um fato, e no
   * lugar dele o modelo recebe `{ ref, valor }` (valor já formatado: ele pode usá-lo para raciocinar, mas escreve só
   * a referência).
   * Devolve o resultado transformado, pronto para ir ao modelo.
   */
  ingest(tool: string, params: Record<string, unknown>, result: unknown, at = new Date()): unknown {
    const source = { tool, params, at: at.toISOString() };
    const walk = (node: unknown, key: string, path: string): unknown => {
      if (Array.isArray(node)) return node.map((item, i) => walk(item, key, `${path}[${i}]`));
      if (node && typeof node === 'object')
        return Object.fromEntries(
          Object.entries(node as Record<string, unknown>).map(([k, v]) => [
            k,
            walk(v, k, path ? `${path}.${k}` : k),
          ]),
        );
      const type = inferFactType(key, node);
      if (!type) return node;
      const fact = this.add({ type, value: node as number | string, source, path });
      // O modelo vê o valor JÁ formatado ("R$ 5.940,00"): serve para raciocinar e evita números crus longos, que o
      // detector de dado pessoal tomaria por documento.
      return { ref: `{{${fact.id}}}`, valor: formatFact(fact) };
    };
    return walk(result, '', '');
  }
}
