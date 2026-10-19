import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';

/**
 * Criptografia de campos pessoais (CPF/CNPJ) — AES-256-GCM, com chaves **derivadas por empresa**.
 *
 *  - `DATA_ENCRYPTION_KEY` (32 bytes, base64) é a chave-mestra, só do servidor. Perdê-la torna os documentos ilegíveis.
 *  - Para cada empresa derivam-se (HKDF-SHA256, `salt = tenantId`) duas subchaves independentes: uma de cifra e uma
 *    de **índice cego**. A busca por documento igual (deduplicação) compara o HMAC do documento normalizado, que
 *    inclui a empresa: o mesmo CPF em duas empresas gera índices diferentes e nada se correlaciona entre elas.
 *  - Formato: `enc:v1:<base64url(iv ‖ tag ‖ cifra)>` e `bi1:<hex>`. O prefixo torna as funções idempotentes
 *    (valor já protegido não é protegido de novo) e permite migrar dados antigos em texto.
 */
export const ENCRYPTED_PREFIX = 'enc:v1:';
export const BLIND_PREFIX = 'bi1:';

export interface TenantKeys {
  encryption: Buffer;
  index: Buffer;
}

export function parseMasterKey(encoded: string): Buffer {
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32)
    throw new Error('DATA_ENCRYPTION_KEY deve ter exatamente 32 bytes em base64.');
  return key;
}

export function deriveTenantKeys(master: Buffer, tenantId: string): TenantKeys {
  const derive = (info: string) =>
    Buffer.from(
      hkdfSync('sha256', master, Buffer.from(tenantId, 'utf8'), Buffer.from(info, 'utf8'), 32),
    );
  return {
    encryption: derive('voltex:field-encryption:v1'),
    index: derive('voltex:blind-index:v1'),
  };
}

export const isEncrypted = (value: string): boolean => value.startsWith(ENCRYPTED_PREFIX);
export const isBlindIndex = (value: string): boolean => value.startsWith(BLIND_PREFIX);

export function encryptField(plain: string, keys: TenantKeys): string {
  if (isEncrypted(plain)) return plain;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keys.encryption, iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ENCRYPTED_PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}

/** Valor sem o prefixo é dado antigo em texto: devolve como está (a migração o protege). */
export function decryptField(value: string, keys: TenantKeys): string {
  if (!isEncrypted(value)) return value;
  const raw = Buffer.from(value.slice(ENCRYPTED_PREFIX.length), 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', keys.encryption, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  try {
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('Não foi possível decifrar o campo: chave errada ou dado corrompido.');
  }
}

export function blindIndex(normalized: string, keys: TenantKeys): string {
  if (isBlindIndex(normalized)) return normalized;
  return BLIND_PREFIX + createHmac('sha256', keys.index).update(normalized).digest('hex');
}
