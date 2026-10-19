import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  blindIndex,
  blindIndexes,
  createKeyring,
  decryptField,
  encryptField,
  isBlindIndex,
  isEncrypted,
  isEncryptedWithCurrent,
  parseMasterKey,
} from './field-crypto';

const b64 = () => randomBytes(32).toString('base64');
const k1 = b64();
const k2 = b64();
const ring1 = createKeyring(k1);
const ringRotated = createKeyring(k2, k1);

describe('criptografia de campos', () => {
  it('cifra e decifra; o texto cifrado não revela o valor e muda a cada vez (IV aleatório)', () => {
    const one = encryptField('123.456.789-09', ring1, 'tenant-a');
    const two = encryptField('123.456.789-09', ring1, 'tenant-a');
    expect(isEncrypted(one)).toBe(true);
    expect(one).toMatch(new RegExp(`^enc:v2:${ring1.current.id}:`));
    expect(one).not.toContain('123');
    expect(one).not.toBe(two);
    expect(decryptField(one, ring1, 'tenant-a')).toBe('123.456.789-09');
  });

  it('é idempotente: valor já cifrado não é cifrado de novo; texto antigo passa na leitura', () => {
    const once = encryptField('12345678909', ring1, 'tenant-a');
    expect(encryptField(once, ring1, 'tenant-a')).toBe(once);
    expect(decryptField('12345678909', ring1, 'tenant-a')).toBe('12345678909');
  });

  it('cada empresa tem a sua chave: outra empresa não decifra nem correlaciona', () => {
    const secret = encryptField('12345678909', ring1, 'tenant-a');
    expect(() => decryptField(secret, ring1, 'tenant-b')).toThrow(/chave errada/);
    expect(blindIndex('12345678909', ring1, 'tenant-a')).toBe(
      blindIndex('12345678909', ring1, 'tenant-a'),
    );
    expect(blindIndex('12345678909', ring1, 'tenant-a')).not.toBe(
      blindIndex('12345678909', ring1, 'tenant-b'),
    );
    expect(isBlindIndex(blindIndex('12345678909', ring1, 'tenant-a'))).toBe(true);
    const idx = blindIndex('12345678909', ring1, 'tenant-a');
    expect(blindIndex(idx, ring1, 'tenant-a')).toBe(idx);
  });

  it('detecta adulteração', () => {
    const secret = encryptField('12345678909', ring1, 'tenant-a');
    const tampered = secret.slice(0, -3) + (secret.endsWith('AAA') ? 'BBB' : 'AAA');
    expect(() => decryptField(tampered, ring1, 'tenant-a')).toThrow();
  });

  describe('rodízio de chave', () => {
    it('com a chave nova atual e a antiga como anterior, lê o que foi gravado antes e grava com a nova', () => {
      const old = encryptField('12345678909', ring1, 'tenant-a');
      expect(decryptField(old, ringRotated, 'tenant-a')).toBe('12345678909');
      expect(isEncryptedWithCurrent(old, ringRotated)).toBe(false);
      const fresh = encryptField('12345678909', ringRotated, 'tenant-a');
      expect(isEncryptedWithCurrent(fresh, ringRotated)).toBe(true);
      expect(fresh).toMatch(new RegExp(`^enc:v2:${ringRotated.current.id}:`));
    });

    it('sem a chave antiga configurada, o dado antigo não abre e o erro diz o que fazer', () => {
      const old = encryptField('12345678909', ring1, 'tenant-a');
      expect(() => decryptField(old, createKeyring(k2), 'tenant-a')).toThrow(
        /DATA_ENCRYPTION_KEY_PREVIOUS/,
      );
    });

    it('a busca considera os índices de todas as chaves: acha o dado seja qual for a chave que o gravou', () => {
      const oldIndex = blindIndex('12345678909', ring1, 'tenant-a');
      const searched = blindIndexes('12345678909', ringRotated, 'tenant-a');
      expect(searched).toHaveLength(2);
      expect(searched).toContain(oldIndex);
      expect(searched[0]).toBe(blindIndex('12345678909', ringRotated, 'tenant-a')); // atual primeiro
      expect(searched[0]).not.toBe(oldIndex);
    });

    it('o identificador da chave não revela a chave; chaves repetidas não duplicam', () => {
      expect(ring1.current.id).toMatch(/^[0-9a-f]{8}$/);
      expect(ring1.current.id).not.toContain(k1.slice(0, 6));
      expect(createKeyring(k1, `${k1}, ${k1}`).all.size).toBe(1);
    });

    it('dados no formato antigo (sem identificador) ainda abrem com qualquer chave conhecida', async () => {
      const { createCipheriv, hkdfSync } = await import('node:crypto');
      const master = Buffer.from(k1, 'base64');
      const key = Buffer.from(
        hkdfSync(
          'sha256',
          master,
          Buffer.from('tenant-a'),
          Buffer.from('voltex:field-encryption:v1'),
          32,
        ),
      );
      const iv = randomBytes(12);
      const c = createCipheriv('aes-256-gcm', key, iv);
      const body = Buffer.concat([c.update('12345678909', 'utf8'), c.final()]);
      const legacy = 'enc:v1:' + Buffer.concat([iv, c.getAuthTag(), body]).toString('base64url');
      expect(decryptField(legacy, ringRotated, 'tenant-a')).toBe('12345678909');
    });
  });

  it('a chave precisa ter 32 bytes', () => {
    expect(() => parseMasterKey(Buffer.alloc(16).toString('base64'))).toThrow(/32 bytes/);
    expect(() => createKeyring(k1, Buffer.alloc(16).toString('base64'))).toThrow(/32 bytes/);
    expect(parseMasterKey(Buffer.alloc(32, 1).toString('base64')).length).toBe(32);
  });
});
