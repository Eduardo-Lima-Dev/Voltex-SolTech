import type { AiFactDto, AiMessagePart } from '@voltex/shared';
import { formatFact, type Fact } from '../privacy/facts';
import type { PseudonymEntry, Pseudonymizer } from '../privacy/pseudonymizer';

const REF = /\{\{\s*(F\d+)\s*\}\}/g;

/** Rótulos curtos, em português, do que cada consulta fez (para o "de onde veio" da tela). */
export function toolLabel(tool: string, area: string | undefined): string {
  return area ? `Consulta de ${area}` : tool;
}

/** Divide o texto do modelo em texto e valores (chips), já com os nomes reais para quem pode vê-los. */
export function splitParts(
  maskedText: string,
  facts: ReadonlyMap<string, Fact>,
  pseudonyms: Pseudonymizer,
  canSee: (entry: PseudonymEntry) => boolean,
): AiMessagePart[] {
  const parts: AiMessagePart[] = [];
  let cursor = 0;
  const pushText = (text: string) => {
    if (text) parts.push({ type: 'text', text: pseudonyms.reveal(text, canSee) });
  };
  for (const m of maskedText.matchAll(REF)) {
    const fact = facts.get(m[1] as string);
    pushText(maskedText.slice(cursor, m.index));
    if (fact) parts.push({ type: 'fact', factId: fact.id, text: formatFact(fact) });
    else pushText(m[0]);
    cursor = (m.index ?? 0) + m[0].length;
  }
  pushText(maskedText.slice(cursor));
  return parts;
}

export const plainText = (parts: readonly AiMessagePart[]): string =>
  parts.map((p) => p.text).join('');

export function toFactDto(fact: Fact, labelOf: (tool: string) => string): AiFactDto {
  return {
    id: fact.id,
    text: formatFact(fact),
    type: fact.type,
    tool: fact.source.tool,
    toolLabel: labelOf(fact.source.tool),
    field: fact.path,
    queriedAt: fact.source.at,
  };
}
