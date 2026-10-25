import type { PseudonymKind } from './pseudonymizer';

/**
 * Nomes citados na pergunta (ADR-0030). O usuário escreve "quanto a Helena deve?", e esse nome NÃO pode ir ao
 * provedor. Antes de perguntar ao modelo, procuramos na empresa (dentro da carteira de quem pergunta) os nomes que
 * aparecem no texto e os trocamos por pseudônimos. Nome ambíguo (vários com o mesmo primeiro nome) é apagado do
 * texto e vira um pedido de esclarecimento: nunca vai ao provedor.
 */

export interface NamedEntity {
  kind: PseudonymKind;
  id: string;
  name: string;
}

export interface MentionResult {
  /** Entidades identificadas na pergunta. */
  matches: NamedEntity[];
  /** Pergunta com os nomes já trocados por pseudônimo (ou por `[NOME]`, quando ambíguos). */
  text: string;
  /** Nomes que servem a mais de uma entidade: o assistente deve pedir o nome completo. */
  ambiguous: string[];
}

/** Minúsculas e sem acento, MANTENDO o tamanho do texto (para os índices servirem ao texto original). */
export const foldKeepLength = (s: string): string =>
  s
    .split('')
    .map((ch) => (ch.normalize('NFD').replace(/[̀-ͯ]/g, '')[0] ?? ch).toLowerCase())
    .join('');

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Palavras que aparecem em nomes de empresas e na fala comum: sozinhas, não identificam ninguém. */
const GENERIC = new Set([
  'padaria',
  'loja',
  'empresa',
  'restaurante',
  'clinica',
  'industria',
  'comercio',
  'servicos',
  'ltda',
  'eireli',
  'sitio',
  'fazenda',
  'casa',
  'residencia',
  'projeto',
  'cliente',
  'lead',
  'conta',
  'equipe',
  'solar',
  'energia',
  'sistema',
  'novo',
  'nova',
  'santa',
  'santo',
  'dona',
  'doutor',
  'doutora',
  'quanto',
  'qual',
  'quais',
  'como',
  'onde',
  'quando',
  'porque',
  'resumo',
  'financeiro',
  'ontem',
  'hoje',
  'preciso',
  'quero',
  'mostre',
  'liste',
  'mostrar',
  'listar',
  'ranking',
  'melhores',
  'piores',
  'projetos',
  'clientes',
  'leads',
  'vendas',
  'verificacao',
]);

interface Range {
  start: number;
  end: number;
  entity: NamedEntity | null;
}

const overlaps = (ranges: readonly Range[], start: number, end: number) =>
  ranges.some((r) => start < r.end && end > r.start);

export function findMentions(
  question: string,
  entities: readonly NamedEntity[],
  aliasOf: (entity: NamedEntity) => string,
): MentionResult {
  const folded = foldKeepLength(question);
  const ranges: Range[] = [];

  // 1) Nome completo, do mais longo para o mais curto ("Maria da Silva" antes de "Maria").
  const full = [...entities]
    .filter((e) => foldKeepLength(e.name).trim().length >= 5)
    .sort((a, b) => b.name.length - a.name.length);
  for (const e of full) {
    const parts = foldKeepLength(e.name).trim().split(/\s+/).map(escape);
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${parts.join('\\s+')}(?![\\p{L}\\p{N}])`, 'giu');
    for (const m of folded.matchAll(re)) {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      if (!overlaps(ranges, start, end)) ranges.push({ start, end, entity: e });
    }
  }

  // 2) Nome solto ("Helena"): só vale se identifica UMA entidade; com várias, é ambíguo.
  const byToken = new Map<string, Map<string, NamedEntity>>();
  for (const e of entities)
    for (const part of foldKeepLength(e.name).split(/[^\p{L}\p{N}]+/u))
      if (part.length >= 4 && !GENERIC.has(part)) {
        const owners = byToken.get(part) ?? new Map<string, NamedEntity>();
        owners.set(`${e.kind}:${e.id}`, e);
        byToken.set(part, owners);
      }
  const ambiguous: string[] = [];
  for (const m of question.matchAll(/\p{Lu}[\p{L}'’-]{3,}/gu)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (overlaps(ranges, start, end)) continue;
    const owners = byToken.get(foldKeepLength(m[0]));
    if (!owners) continue;
    if (owners.size === 1) ranges.push({ start, end, entity: [...owners.values()][0]! });
    else {
      ranges.push({ start, end, entity: null });
      ambiguous.push(m[0]);
    }
  }

  // Troca da direita para a esquerda, para os índices não se deslocarem.
  let text = question;
  const found = new Map<string, NamedEntity>();
  for (const r of [...ranges].sort((a, b) => b.start - a.start)) {
    if (r.entity) found.set(`${r.entity.kind}:${r.entity.id}`, r.entity);
    text = text.slice(0, r.start) + (r.entity ? aliasOf(r.entity) : '[NOME]') + text.slice(r.end);
  }
  return { matches: [...found.values()], text, ambiguous: [...new Set(ambiguous)] };
}
