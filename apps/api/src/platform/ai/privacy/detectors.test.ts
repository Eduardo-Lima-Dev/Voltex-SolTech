import { describe, expect, it } from 'vitest';
import { containsPersonalData, findPersonalData, redactPersonalData } from './detectors';

const types = (text: string) => findPersonalData(text).map((m) => m.type);

describe('detectores de dado pessoal', () => {
  it('CPF válido, com e sem máscara; CPF com dígito errado não conta como CPF', () => {
    expect(types('CPF 529.982.247-25 do cliente')).toEqual(['CPF']);
    expect(types('documento 52998224725')).toEqual(['CPF']);
    expect(types('529.982.247-26')).not.toContain('CPF');
  });

  it('CNPJ válido', () => {
    expect(types('empresa 11.222.333/0001-81')).toEqual(['CNPJ']);
    expect(types('11222333000181')).toEqual(['CNPJ']);
  });

  it('e-mail', () => {
    expect(types('fale com maria.souza+x@example.com.br hoje')).toEqual(['EMAIL']);
  });

  it('telefones brasileiros em vários formatos', () => {
    for (const phone of [
      '(85) 98877-1001',
      '85 98877-1001',
      '+55 85 98877-1001',
      '(85) 3222-3003',
      '85988771001',
    ])
      expect(types(`ligar ${phone}`), phone).toEqual(['PHONE']);
  });

  it('CEP e coordenadas', () => {
    expect(types('CEP 60150-160')).toEqual(['CEP']);
    expect(types('local -3.7319, -38.5267')).toEqual(['COORDINATES']);
    expect(types('local -3,7319; -38,5267')).toEqual(['COORDINATES']);
  });

  it('número longo sem máscara (UC, contrato)', () => {
    expect(types('unidade 3124567810')).toHaveLength(1);
    expect(types('contrato 20261025000123')).toEqual(['LONG_NUMBER']);
  });

  it('não confunde valores, datas, percentuais e códigos de projeto com dado pessoal', () => {
    for (const text of [
      'Recebido: R$ 5.940,00 de R$ 19.800,00',
      'margem de 24,5% e 3 parcelas vencidas',
      'vence em 2026-10-25 ou 25/10/2026',
      'projeto VLX-6WB4CMRT na etapa Qualificação',
      '528 kWh por mês e 4,4 kWp',
      'R$ 1.980.000,00',
    ])
      expect(containsPersonalData(text), text).toBe(false);
  });

  it('um trecho não é contado duas vezes (CNPJ não vira também número longo)', () => {
    expect(types('11.222.333/0001-81')).toEqual(['CNPJ']);
    expect(findPersonalData('52998224725')).toHaveLength(1);
  });

  it('substitui por avisos neutros e conta o que removeu', () => {
    const out = redactPersonalData(
      'Maria, CPF 529.982.247-25, e-mail maria@x.com, tel (85) 98877-1001.',
    );
    expect(out.text).toBe(
      'Maria, CPF [CPF REMOVIDO], e-mail [E-MAIL REMOVIDO], tel [TELEFONE REMOVIDO].',
    );
    expect(out.removed).toEqual({ CPF: 1, EMAIL: 1, PHONE: 1 });
    expect(redactPersonalData('nada aqui').removed).toEqual({});
  });

  it('o texto redigido não contém mais dado pessoal', () => {
    const dirty =
      'a 529.982.247-25 b 11.222.333/0001-81 c x@y.com d (85) 98877-1001 e 60150-160 f -3.73,-38.52 g 3124567810';
    expect(containsPersonalData(redactPersonalData(dirty).text)).toBe(false);
  });
});
