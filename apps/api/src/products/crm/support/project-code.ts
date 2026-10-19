import { randomBytes } from 'node:crypto';

/** Alfabeto de Crockford (sem I, L, O, U): legível em voz alta e sem ambiguidade. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Project ID global (Digital Thread): `VLX-` + 8 caracteres. Aleatório de propósito: um contador revelaria o
 * volume de negócios da plataforma. A unicidade é garantida pelo índice único (quem chama repete em caso de colisão).
 */
export function generateProjectCode(): string {
  const bytes = randomBytes(8);
  let code = '';
  for (const byte of bytes) code += ALPHABET[byte % ALPHABET.length];
  return `VLX-${code}`;
}

export const PROJECT_CODE_PATTERN = /^VLX-[0-9A-HJKMNP-TV-Z]{8}$/;
