import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
} from 'node:crypto';

/**
 * Criptografia de campos pessoais — AES-256-GCM, com chaves **derivadas por empresa** e **rodízio de chaves**.
 *
 *  - `DATA_ENCRYPTION_KEY` é a chave-mestra ATUAL (32 bytes, base64). `DATA_ENCRYPTION_KEY_PREVIOUS` lista as
 *    anteriores (separadas por vírgula): servem só para LER e para a busca; tudo o que se grava usa a atual.
 *  - Cada valor cifrado leva o identificador da chave que o cifrou (`enc:v2:<id>:<dados>`), então várias chaves
 *    convivem sem tentativa e erro. O comando `rotate-encryption-key` recifra o que ficou com chave antiga.
 *  - Para cada empresa derivam-se (HKDF-SHA256, `salt = tenantId`) uma chave de cifra e uma de **índice cego**. A busca
 *    por documento igual compara HMACs (um por chave conhecida), então funciona durante o rodízio. O mesmo CPF em
 *    duas empresas gera índices diferentes.
 *  - O prefixo torna as funções idempotentes e permite ler dados antigos (`enc:v1:`, sem identificador).
 */
export const ENCRYPTED_PREFIX = 'enc:v2:';
const LEGACY_PREFIX = 'enc:v1:';
export const BLIND_PREFIX = 'bi1:';

export interface MasterKey {
  /** Primeiros 8 hex do SHA-256 da chave: identifica sem revelar. */
  id: string;
  key: Buffer;
}

export interface Keyring {
  current: MasterKey;
  /** Todas as chaves conhecidas (atual primeiro), por identificador. */
  all: Map<string, MasterKey>;
}

export interface TenantKeys {
  encryption: Buffer;
  index: Buffer;
}

export function parseMasterKey(encoded: string): Buffer {
  const key = Buffer.from(encoded.trim(), 'base64');
  if (key.length !== 32)
    throw new Error('A chave de criptografia deve ter exatamente 32 bytes em base64.');
  return key;
}

export const keyId = (key: Buffer): string =>
  createHash('sha256').update(key).digest('hex').slice(0, 8);

export function createKeyring(currentBase64: string, previousCsv = ''): Keyring {
  const toMaster = (b64: string): MasterKey => {
    const key = parseMasterKey(b64);
    return { id: keyId(key), key };
  };
  const current = toMaster(currentBase64);
  const all = new Map<string, MasterKey>([[current.id, current]]);
  for (const part of previousCsv
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)) {
    const old = toMaster(part);
    if (!all.has(old.id)) all.set(old.id, old);
  }
  return { current, all };
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

export const isEncrypted = (value: string): boolean =>
  value.startsWith(ENCRYPTED_PREFIX) || value.startsWith(LEGACY_PREFIX);
export const isBlindIndex = (value: string): boolean => value.startsWith(BLIND_PREFIX);

/** Já está cifrado com a chave atual? (o que o rodízio não precisa refazer) */
export const isEncryptedWithCurrent = (value: string, ring: Keyring): boolean =>
  value.startsWith(`${ENCRYPTED_PREFIX}${ring.current.id}:`);

export function encryptField(plain: string, ring: Keyring, tenantId: string): string {
  if (isEncrypted(plain)) return plain;
  const keys = deriveTenantKeys(ring.current.key, tenantId);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keys.encryption, iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `${ENCRYPTED_PREFIX}${ring.current.id}:${Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url')}`;
}

function open(payload: string, master: MasterKey, tenantId: string): string {
  const raw = Buffer.from(payload, 'base64url');
  const keys = deriveTenantKeys(master.key, tenantId);
  const decipher = createDecipheriv('aes-256-gcm', keys.encryption, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}

/** Valor sem prefixo é dado antigo em texto: devolve como está (a migração o protege). */
export function decryptField(value: string, ring: Keyring, tenantId: string): string {
  if (!isEncrypted(value)) return value;
  try {
    if (value.startsWith(ENCRYPTED_PREFIX)) {
      const rest = value.slice(ENCRYPTED_PREFIX.length);
      const sep = rest.indexOf(':');
      const master = ring.all.get(rest.slice(0, sep));
      if (!master)
        throw new Error(
          'O dado foi cifrado com uma chave que não está configurada (DATA_ENCRYPTION_KEY_PREVIOUS).',
        );
      return open(rest.slice(sep + 1), master, tenantId);
    }
    // Formato antigo, sem identificador: tenta as chaves conhecidas.
    for (const master of ring.all.values()) {
      try {
        return open(value.slice(LEGACY_PREFIX.length), master, tenantId);
      } catch {
        // próxima chave
      }
    }
    throw new Error('nenhuma chave conhecida decifra este dado');
  } catch (error) {
    const reason = error instanceof Error ? error.message : '';
    throw new Error(
      `Não foi possível decifrar o campo: ${reason.startsWith('O dado') ? reason : 'chave errada ou dado corrompido.'}`,
    );
  }
}

/** Índice cego de UMA chave (a atual, por padrão). */
export function blindIndex(
  normalized: string,
  ring: Keyring,
  tenantId: string,
  master: MasterKey = ring.current,
): string {
  if (isBlindIndex(normalized)) return normalized;
  const keys = deriveTenantKeys(master.key, tenantId);
  return BLIND_PREFIX + createHmac('sha256', keys.index).update(normalized).digest('hex');
}

/** Índices de TODAS as chaves conhecidas: a busca acha o dado seja qual for a chave com que foi gravado. */
export function blindIndexes(normalized: string, ring: Keyring, tenantId: string): string[] {
  if (isBlindIndex(normalized)) return [normalized];
  return [...ring.all.values()].map((master) => blindIndex(normalized, ring, tenantId, master));
}
