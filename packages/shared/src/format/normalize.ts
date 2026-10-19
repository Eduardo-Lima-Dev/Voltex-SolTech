/**
 * Normalização de contatos para deduplicação (RF-CRM-003). Devolve `null` quando o valor não serve como chave
 * (vazio ou curto demais), para que dois leads sem telefone não sejam considerados duplicados.
 */

export const normalizeEmail = (raw: string | null | undefined): string | null => {
  const value = (raw ?? '').trim().toLowerCase();
  return value.includes('@') ? value : null;
};

/** Só dígitos, sem o DDI 55: "+55 (85) 98888-7777" → "85988887777". */
export const normalizePhone = (raw: string | null | undefined): string | null => {
  let digits = (raw ?? '').replace(/\D/g, '');
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13))
    digits = digits.slice(2);
  return digits.length === 10 || digits.length === 11 ? digits : null;
};

/** CPF (11) ou CNPJ (14), só dígitos. */
export const normalizeDocument = (raw: string | null | undefined): string | null => {
  const digits = (raw ?? '').replace(/\D/g, '');
  return digits.length === 11 || digits.length === 14 ? digits : null;
};

const allEqual = (digits: string) => /^(\d)\1+$/.test(digits);

const checkDigit = (digits: string, weights: number[]): number => {
  const sum = weights.reduce((acc, weight, i) => acc + Number(digits[i]) * weight, 0);
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
};

export const isValidCpf = (raw: string): boolean => {
  const d = raw.replace(/\D/g, '');
  if (d.length !== 11 || allEqual(d)) return false;
  return (
    checkDigit(d, [10, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(d[9]) &&
    checkDigit(d, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(d[10])
  );
};

export const isValidCnpj = (raw: string): boolean => {
  const d = raw.replace(/\D/g, '');
  if (d.length !== 14 || allEqual(d)) return false;
  return (
    checkDigit(d, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(d[12]) &&
    checkDigit(d, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(d[13])
  );
};

export const isValidDocument = (raw: string): boolean => isValidCpf(raw) || isValidCnpj(raw);
