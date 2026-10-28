import { containsPersonalData } from './detectors';
import type { FactTable } from './facts';
import type { Pseudonymizer } from './pseudonymizer';
import { refsIn } from './renderer';

export type AnswerIssueCode =
  | 'EMPTY'
  | 'LOOSE_NUMBER'
  | 'UNKNOWN_FACT'
  | 'UNKNOWN_PSEUDONYM'
  | 'PERSONAL_DATA'
  | 'NOT_PORTUGUESE'
  | 'FORMAT';

export interface AnswerIssue {
  code: AnswerIssueCode;
  detail: string;
}

const REF = /\{\{\s*F\d+\s*\}\}/g;
const ALIAS = /\[(?:CLIENTE|CONTATO|USUARIO|EQUIPE)_\d+\]/g;
// Numeração de lista no começo da linha ("1.", "2)") não é número do dado.
const LIST_MARKER = /^[ \t]*\d{1,2}[.)](?=\s)/gm;

const PT = new Set([
  'de',
  'da',
  'do',
  'que',
  'para',
  'com',
  'não',
  'uma',
  'um',
  'em',
  'os',
  'as',
  'por',
  'se',
  'foi',
  'está',
  'são',
  'mas',
  'mais',
  'ao',
  'dos',
  'das',
  'ou',
  'como',
  'tem',
  'há',
  'seu',
  'sua',
  'na',
  'no',
  'nos',
  'nas',
  'e',
  'o',
  'a',
  'é',
]);
const EN = new Set([
  'the',
  'and',
  'is',
  'of',
  'to',
  'with',
  'you',
  'this',
  'that',
  'your',
  'are',
  'for',
  'was',
  'have',
  'has',
  'not',
  'from',
  'will',
  'can',
]);

/** O texto parece português? Reprova o texto cujas palavras comuns são em maioria inglesas. */
export function looksPortuguese(text: string): boolean {
  const words = text.toLowerCase().match(/[a-zà-ú]+/g) ?? [];
  const pt = words.filter((w) => PT.has(w)).length;
  const en = words.filter((w) => EN.has(w)).length;
  return !(en >= 3 && en > pt);
}

/**
 * Confere a redação do modelo ANTES de mostrar ao usuário (ADR-0030). Reprova número fora de `{{F#}}`, referência ou
 * pseudônimo inexistente, dado pessoal e texto fora do português. Nenhum texto reprovado chega à tela.
 */
/** Períodos que a própria pessoa escreveu na pergunta ("30 dias", "6 meses"): repeti-los não é inventar número. */
const PERIOD = /\b\d{1,3}\s*(?:dias?|semanas?|mes(?:es)?|mês|anos?|horas?)\b/gi;
export const periodsIn = (question: string): string[] => [
  ...new Set((question.match(PERIOD) ?? []).map((p) => p.replace(/\s+/g, ' ').toLowerCase())),
];

export function validateAnswer(
  text: string,
  facts: FactTable,
  pseudonyms: Pseudonymizer,
  echo: readonly string[] = [],
): AnswerIssue[] {
  const issues: AnswerIssue[] = [];
  if (!text.trim()) return [{ code: 'EMPTY', detail: 'resposta vazia' }];

  for (const id of refsIn(text))
    if (!facts.get(id))
      issues.push({ code: 'UNKNOWN_FACT', detail: `referência ${id} não existe` });
  for (const alias of pseudonyms.unknownAliases(text))
    issues.push({ code: 'UNKNOWN_PSEUDONYM', detail: `${alias} não existe nesta conversa` });

  let withoutRefs = text.replace(REF, ' ').replace(ALIAS, ' ').replace(LIST_MARKER, ' ');
  // Só vale o período idêntico ao da pergunta, com a mesma unidade (o "30" de "30 dias").
  withoutRefs = withoutRefs.replace(PERIOD, (found) =>
    echo.includes(found.replace(/\s+/g, ' ').toLowerCase()) ? ' ' : found,
  );
  const loose = withoutRefs.match(/\d+(?:[.,]\d+)*/g);
  if (loose)
    issues.push({
      code: 'LOOSE_NUMBER',
      detail: `número fora de referência: ${[...new Set(loose)].slice(0, 5).join(', ')}`,
    });

  if (containsPersonalData(text))
    issues.push({ code: 'PERSONAL_DATA', detail: 'a resposta contém dado pessoal' });
  if (!looksPortuguese(text))
    issues.push({ code: 'NOT_PORTUGUESE', detail: 'a resposta não está em português' });
  return issues;
}

/** Texto de reforço para a segunda tentativa do modelo, com o que foi reprovado. */
export function retryInstruction(issues: readonly AnswerIssue[]): string {
  return [
    'Sua resposta anterior foi reprovada pelas regras do sistema:',
    ...issues.map((i) => `- ${i.detail}`),
    'Reescreva a resposta em português, citando números, valores e datas APENAS pelas referências {{F#}} dos dados',
    'recebidos, sem escrever nenhum algarismo, e usando só os pseudônimos que aparecem nos dados.',
  ].join('\n');
}
