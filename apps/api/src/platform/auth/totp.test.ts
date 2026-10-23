import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  generateRecoveryCodes,
  generateSecret,
  hashRecoveryCode,
  hotp,
  normalizeRecoveryCode,
  otpauthUri,
  totp,
  verifyTotp,
} from './totp';

// Segredo ASCII "12345678901234567890" dos vetores da RFC 4226/6238.
const SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('TOTP', () => {
  it('base32 vai e volta e aceita minúsculas, espaços e hífens', () => {
    const bytes = Buffer.from('Voltex SolTech ♥');
    expect(base32Decode(base32Encode(bytes)).equals(bytes)).toBe(true);
    expect(base32Decode(`${SECRET.slice(0, 8)} ${SECRET.slice(8).toLowerCase()}`).toString()).toBe(
      '12345678901234567890',
    );
    expect(() => base32Decode('0189')).toThrow();
  });

  it('HOTP bate com os vetores da RFC 4226 (apêndice D)', () => {
    const secret = Buffer.from('12345678901234567890');
    const expected = [
      '755224',
      '287082',
      '359152',
      '969429',
      '338314',
      '254676',
      '287922',
      '162583',
      '399871',
      '520489',
    ];
    expected.forEach((code, counter) => expect(hotp(secret, counter)).toBe(code));
  });

  it('TOTP bate com os vetores da RFC 6238 (SHA-1, 6 últimos dígitos)', () => {
    const at = (s: number) => new Date(s * 1000);
    expect(totp(SECRET, at(59))).toBe('287082');
    expect(totp(SECRET, at(1111111109))).toBe('081804');
    expect(totp(SECRET, at(1111111111))).toBe('050471');
    expect(totp(SECRET, at(1234567890))).toBe('005924');
    expect(totp(SECRET, at(2000000000))).toBe('279037');
    expect(totp(SECRET, at(20000000000))).toBe('353130');
  });

  it('verifica com tolerância de um passo e devolve o passo que bateu', () => {
    const now = new Date(1_700_000_010_000);
    const code = totp(SECRET, now);
    const step = Math.floor(now.getTime() / 30_000);
    expect(verifyTotp(SECRET, code, now)).toBe(step);
    expect(verifyTotp(SECRET, code, new Date(now.getTime() + 30_000))).toBe(step);
    expect(verifyTotp(SECRET, code, new Date(now.getTime() + 90_000))).toBeNull();
    expect(verifyTotp(SECRET, '000000', now)).toBeNull();
  });

  it('o mesmo código não vale duas vezes (passo já usado)', () => {
    const now = new Date(1_700_000_010_000);
    const code = totp(SECRET, now);
    const step = verifyTotp(SECRET, code, now)!;
    expect(verifyTotp(SECRET, code, now, step)).toBeNull();
    expect(
      verifyTotp(
        SECRET,
        totp(SECRET, new Date(now.getTime() + 30_000)),
        new Date(now.getTime() + 30_000),
        step,
      ),
    ).toBe(step + 1);
  });

  it('recusa código fora do formato', () => {
    expect(verifyTotp(SECRET, '12345', new Date())).toBeNull();
    expect(verifyTotp(SECRET, 'abcdef', new Date())).toBeNull();
    expect(verifyTotp(SECRET, '1234567', new Date())).toBeNull();
  });

  it('segredo novo tem 160 bits e a URI usa o formato otpauth', () => {
    const secret = generateSecret();
    expect(base32Decode(secret)).toHaveLength(20);
    expect(generateSecret()).not.toBe(secret);
    const uri = otpauthUri('Voltex SolTech', 'maria@empresa.test', secret);
    expect(uri).toMatch(/^otpauth:\/\/totp\/Voltex%20SolTech%3Amaria%40empresa\.test\?secret=/);
    expect(uri).toContain('issuer=Voltex%20SolTech');
    expect(uri).toContain('digits=6&period=30');
  });
});

describe('códigos de recuperação', () => {
  it('geram dez códigos distintos, no formato esperado, e o hash ignora hífen e caixa', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
    const code = codes[0]!;
    expect(hashRecoveryCode(code.toLowerCase())).toBe(hashRecoveryCode(code.replace('-', '')));
    expect(normalizeRecoveryCode(' ab-cd ')).toBe('ABCD');
    expect(hashRecoveryCode(code)).toMatch(/^[0-9a-f]{64}$/);
  });
});
