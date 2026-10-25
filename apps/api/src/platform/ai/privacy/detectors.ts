import { isValidCnpj, isValidCpf } from '@voltex/shared';

/**
 * Detectores de dado pessoal (ADR-0030). Rodam em tudo o que vai ao provedor de IA e em tudo o que volta dele.
 * Preferem errar para o lado de mascarar: um falso positivo esconde um número; um falso negativo vaza um dado.
 */

export type PersonalDataType =
  'CPF' | 'CNPJ' | 'EMAIL' | 'PHONE' | 'CEP' | 'COORDINATES' | 'LONG_NUMBER';

export interface PersonalDataMatch {
  type: PersonalDataType;
  /** Trecho encontrado (não vai para log nem para o usuário: só para substituir). */
  value: string;
  index: number;
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
// CPF com ou sem pontuação, não colado em outros dígitos.
const CPF = /(?<!\d)\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?!\d)/g;
const CNPJ = /(?<!\d)\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}(?!\d)/g;
// Telefone brasileiro: (DD) 9XXXX-XXXX, +55 DD..., 85 99999-9999 e fixos (DD) XXXX-XXXX.
const PHONE =
  /(?<![\d.])(?:\+?55[\s.-]?)?(?:\(?\d{2}\)?[\s.-]?)(?:9[\s.-]?\d{4}|\d{4})[\s.-]?\d{4}(?![\d-])/g;
const CEP = /(?<!\d)\d{5}-\d{3}(?!\d)/g;
// Par de coordenadas decimais (latitude, longitude) com pelo menos 3 casas.
const COORDINATES = /-?\d{1,2}[.,]\d{3,}\s*[,;]\s*-?\d{1,3}[.,]\d{3,}/g;
// Sequência longa de dígitos: número de unidade consumidora, de contrato, de documento sem máscara.
const LONG_NUMBER = /(?<![\d.,])\d{9,}(?![\d.,])/g;

const scan = (
  text: string,
  re: RegExp,
  type: PersonalDataType,
  accept?: (v: string) => boolean,
) => {
  const out: PersonalDataMatch[] = [];
  for (const m of text.matchAll(re)) {
    const value = m[0];
    if (!accept || accept(value)) out.push({ type, value, index: m.index ?? 0 });
  }
  return out;
};

/** Encontra todo dado pessoal reconhecível no texto, sem sobreposição (o mais específico vence). */
export function findPersonalData(text: string): PersonalDataMatch[] {
  const found = [
    ...scan(text, EMAIL, 'EMAIL'),
    ...scan(text, CNPJ, 'CNPJ', isValidCnpj),
    ...scan(text, CPF, 'CPF', isValidCpf),
    ...scan(text, COORDINATES, 'COORDINATES'),
    ...scan(text, CEP, 'CEP'),
    ...scan(text, PHONE, 'PHONE', (v) => v.replace(/\D/g, '').length >= 10),
    ...scan(text, LONG_NUMBER, 'LONG_NUMBER'),
  ].sort((a, b) => a.index - b.index || b.value.length - a.value.length);
  const kept: PersonalDataMatch[] = [];
  let end = -1;
  for (const m of found) {
    if (m.index < end) continue; // sobreposto a outro já aceito
    kept.push(m);
    end = m.index + m.value.length;
  }
  return kept;
}

export const containsPersonalData = (text: string): boolean => findPersonalData(text).length > 0;

export const REDACTION_LABEL: Record<PersonalDataType, string> = {
  CPF: '[CPF REMOVIDO]',
  CNPJ: '[CNPJ REMOVIDO]',
  EMAIL: '[E-MAIL REMOVIDO]',
  PHONE: '[TELEFONE REMOVIDO]',
  CEP: '[CEP REMOVIDO]',
  COORDINATES: '[LOCALIZAÇÃO REMOVIDA]',
  LONG_NUMBER: '[NÚMERO REMOVIDO]',
};

/** Troca cada dado pessoal por um aviso neutro. Devolve também quantos de cada tipo foram removidos. */
export function redactPersonalData(text: string): {
  text: string;
  removed: Partial<Record<PersonalDataType, number>>;
} {
  const matches = findPersonalData(text);
  if (matches.length === 0) return { text, removed: {} };
  const removed: Partial<Record<PersonalDataType, number>> = {};
  let out = '';
  let cursor = 0;
  for (const m of matches) {
    out += text.slice(cursor, m.index) + REDACTION_LABEL[m.type];
    cursor = m.index + m.value.length;
    removed[m.type] = (removed[m.type] ?? 0) + 1;
  }
  return { text: out + text.slice(cursor), removed };
}
