import { describe, expect, it } from 'vitest';
import { assertAllowedFile, sanitizeFilename, toStorageName } from './file-validation';

const pdf = Buffer.from('%PDF-1.7 conteudo');
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);

describe('assertAllowedFile', () => {
  it('aceita PDF e PNG com assinatura correta', () => {
    expect(() => assertAllowedFile('application/pdf', pdf)).not.toThrow();
    expect(() => assertAllowedFile('image/png', png)).not.toThrow();
  });

  it('recusa tipo fora da lista', () => {
    expect(() => assertAllowedFile('application/x-msdownload', pdf)).toThrow(/não permitido/);
    expect(() => assertAllowedFile('text/html', Buffer.from('<script>'))).toThrow(/não permitido/);
  });

  it('recusa conteúdo que não bate com o tipo declarado', () => {
    expect(() => assertAllowedFile('application/pdf', Buffer.from('MZ executavel'))).toThrow(
      /não corresponde/,
    );
    expect(() => assertAllowedFile('image/png', pdf)).toThrow(/não corresponde/);
  });

  it('não confere assinatura de tipos sem assinatura conhecida', () => {
    expect(() => assertAllowedFile('text/csv', Buffer.from('a,b'))).not.toThrow();
  });
});

describe('nomes de arquivo', () => {
  it('remove caminhos e caracteres de controle', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('C:\\Users\\x\\fatura.pdf')).toBe('fatura.pdf');
    expect(sanitizeFilename('a\u0000b\nc.pdf')).toBe('abc.pdf');
    expect(sanitizeFilename('   ')).toBe('arquivo');
    expect(sanitizeFilename('x'.repeat(500)).length).toBe(200);
  });

  it('gera nome ASCII seguro para a chave do objeto', () => {
    expect(toStorageName('Conta de Luz — Março.pdf')).toBe('Conta_de_Luz_Marco.pdf');
    expect(toStorageName('../../x y')).not.toContain('/');
  });
});
