import { formatFact, type FactTable } from './facts';

const REF = /\{\{\s*(F\d+)\s*\}\}/g;

/** Referências a fatos citadas no texto (sem repetir). */
export const refsIn = (text: string): string[] => [
  ...new Set([...text.matchAll(REF)].map((m) => m[1] as string)),
];

/** Troca `{{F3}}` pelo valor formatado em pt-BR. Referência desconhecida é mantida (o validador a reprova antes). */
export function renderFacts(text: string, facts: FactTable): string {
  return text.replace(REF, (whole, id: string) => {
    const fact = facts.get(id);
    return fact ? formatFact(fact) : whole;
  });
}
