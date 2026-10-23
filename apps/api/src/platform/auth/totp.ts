import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * TOTP (RFC 6238, HMAC-SHA1, 6 dígitos, passo de 30 s) e HOTP (RFC 4226), compatível com Google Authenticator,
 * Microsoft Authenticator, Authy e 1Password. Implementação própria e pequena, testada com os vetores da RFC.
 */

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Tolerância a relógio desalinhado: aceita o passo anterior e o seguinte. */
export const TOTP_WINDOW = 1;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=-]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) throw new Error('Segredo base32 inválido');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Segredo novo: 20 bytes aleatórios (160 bits, o recomendado pela RFC 4226), em base32. */
export const generateSecret = (): string => base32Encode(randomBytes(20));

export function hotp(secret: Buffer, counter: number, digits = TOTP_DIGITS): string {
  const message = Buffer.alloc(8);
  message.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  message.writeUInt32BE(counter >>> 0, 4);
  const hmac = createHmac('sha1', secret).update(message).digest();
  const offset = (hmac[hmac.length - 1] as number) & 0x0f;
  const binary =
    (((hmac[offset] as number) & 0x7f) << 24) |
    (((hmac[offset + 1] as number) & 0xff) << 16) |
    (((hmac[offset + 2] as number) & 0xff) << 8) |
    ((hmac[offset + 3] as number) & 0xff);
  return String(binary % 10 ** digits).padStart(digits, '0');
}

export const totpStep = (at: Date): number => Math.floor(at.getTime() / 1000 / TOTP_STEP_SECONDS);

export const totp = (secretBase32: string, at: Date = new Date()): string =>
  hotp(base32Decode(secretBase32), totpStep(at));

const safeEqual = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * Confere o código nos passos próximos do atual. Devolve o passo que bateu (para impedir reuso do mesmo código) ou
 * `null`. `afterStep`: passos até esse valor já foram usados e não valem de novo.
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  at: Date = new Date(),
  afterStep = -1,
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const secret = base32Decode(secretBase32);
  const current = totpStep(at);
  let matched: number | null = null;
  // Percorre todos os passos (sem sair no primeiro acerto) para não vazar, pelo tempo, qual passo bateu.
  for (let step = current - TOTP_WINDOW; step <= current + TOTP_WINDOW; step += 1)
    if (safeEqual(hotp(secret, step), code) && step > afterStep) matched = step;
  return matched;
}

export const otpauthUri = (issuer: string, account: string, secretBase32: string): string =>
  `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}`;

// --- códigos de recuperação --------------------------------------------------------------------------------

const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const RECOVERY_CODE_COUNT = 10;

/** Dez códigos `XXXXX-XXXXX` de uso único (sem caracteres ambíguos como 0/O e 1/I). */
export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: count }, () => {
    const bytes = randomBytes(10);
    const chars = Array.from(bytes, (b) => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length]).join(
      '',
    );
    return `${chars.slice(0, 5)}-${chars.slice(5)}`;
  });
}

export const normalizeRecoveryCode = (code: string): string =>
  code.replace(/[\s-]/g, '').toUpperCase();
export const hashRecoveryCode = (code: string): string =>
  createHash('sha256').update(normalizeRecoveryCode(code)).digest('hex');
