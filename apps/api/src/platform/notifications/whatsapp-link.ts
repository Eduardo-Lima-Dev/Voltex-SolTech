/** Número nacional (DDD + telefone) válido: fixo = 10 dígitos começando em 2–5; celular = 11 dígitos começando em 9. */
function isNationalNumber(digits: string): boolean {
  const ddd = Number(digits.slice(0, 2));
  if (!(ddd >= 11 && ddd <= 99)) return false;
  if (digits.length === 10) return /^[2-5]$/.test(digits[2] ?? '');
  if (digits.length === 11) return digits[2] === '9';
  return false;
}

/**
 * Telefone brasileiro em formato internacional (só dígitos, com 55) ou `null` se não parecer um telefone do Brasil.
 * Aceita máscara, zero à esquerda do DDD e o prefixo +55.
 */
export function normalizeBrazilianPhone(raw: string): string | null {
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('55') && isNationalNumber(digits.slice(2))) return digits;
  for (const candidate of [digits, digits.replace(/^0+/, '')])
    if (isNationalNumber(candidate)) return `55${candidate}`;
  return null;
}

/** Link de clique para conversar (`wa.me`): abre o WhatsApp do usuário com a mensagem pronta. Nada é enviado daqui. */
export const buildWhatsAppLink = (phone: string, text: string): string =>
  `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
