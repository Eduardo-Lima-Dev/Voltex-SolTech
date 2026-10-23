import { describe, expect, it } from 'vitest';
import { buildWhatsAppLink, normalizeBrazilianPhone } from './whatsapp-link';

describe('normalizeBrazilianPhone', () => {
  it('aceita celular com máscara e acrescenta o 55', () => {
    expect(normalizeBrazilianPhone('(61) 99999-8888')).toBe('5561999998888');
  });
  it('aceita fixo, zero antes do DDD e prefixo +55', () => {
    expect(normalizeBrazilianPhone('061 3333-4444')).toBe('556133334444');
    expect(normalizeBrazilianPhone('+55 61 99999-8888')).toBe('5561999998888');
  });
  it('recusa número curto, longo demais e DDD inexistente', () => {
    expect(normalizeBrazilianPhone('9999-8888')).toBeNull();
    expect(normalizeBrazilianPhone('1234567890123456')).toBeNull();
    expect(normalizeBrazilianPhone('(05) 99999-8888')).toBeNull();
  });
});

describe('buildWhatsAppLink', () => {
  it('codifica o texto', () => {
    expect(buildWhatsAppLink('5561999998888', 'Olá, tudo bem? a&b')).toBe(
      'https://wa.me/5561999998888?text=Ol%C3%A1%2C%20tudo%20bem%3F%20a%26b',
    );
  });
});
