import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  blindIndex,
  decryptField,
  deriveTenantKeys,
  encryptField,
  isBlindIndex,
  isEncrypted,
  parseMasterKey,
} from './field-crypto';

const master = randomBytes(32);
const a = deriveTenantKeys(master, 'tenant-a');
const b = deriveTenantKeys(master, 'tenant-b');

describe('criptografia de campos', () => {
  it('cifra e decifra; o texto cifrado não revela o valor e muda a cada vez (IV aleatório)', () => {
    const one = encryptField('123.456.789-09', a);
    const two = encryptField('123.456.789-09', a);
    expect(isEncrypted(one)).toBe(true);
    expect(one).not.toContain('123');
    expect(one).not.toBe(two);
    expect(decryptField(one, a)).toBe('123.456.789-09');
    expect(decryptField(two, a)).toBe('123.456.789-09');
  });

  it('é idempotente: valor já cifrado não é cifrado de novo; texto antigo passa na leitura', () => {
    const once = encryptField('12345678909', a);
    expect(encryptField(once, a)).toBe(once);
    expect(decryptField('12345678909', a)).toBe('12345678909');
  });

  it('cada empresa tem a sua chave: outra empresa não decifra nem correlaciona', () => {
    const secret = encryptField('12345678909', a);
    expect(() => decryptField(secret, b)).toThrow(/chave errada/);
    expect(blindIndex('12345678909', a)).toBe(blindIndex('12345678909', a));
    expect(blindIndex('12345678909', a)).not.toBe(blindIndex('12345678909', b));
    expect(isBlindIndex(blindIndex('12345678909', a))).toBe(true);
    expect(blindIndex(blindIndex('12345678909', a), a)).toBe(blindIndex('12345678909', a));
  });

  it('detecta adulteração e chave-mestra diferente', () => {
    const secret = encryptField('12345678909', a);
    const tampered = secret.slice(0, -3) + (secret.endsWith('AAA') ? 'BBB' : 'AAA');
    expect(() => decryptField(tampered, a)).toThrow();
    const other = deriveTenantKeys(randomBytes(32), 'tenant-a');
    expect(() => decryptField(secret, other)).toThrow();
  });

  it('a chave-mestra precisa ter 32 bytes', () => {
    expect(() => parseMasterKey(Buffer.alloc(16).toString('base64'))).toThrow(/32 bytes/);
    expect(parseMasterKey(Buffer.alloc(32, 1).toString('base64')).length).toBe(32);
  });
});
