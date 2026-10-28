import { describe, expect, it } from 'vitest';
import { FactTable } from './facts';
import { Pseudonymizer } from './pseudonymizer';
import { looksPortuguese, retryInstruction, validateAnswer } from './validator';

const setup = () => {
  const facts = new FactTable();
  facts.ingest('t', {}, { overdueCents: 231000, mPct: 24.5 });
  const p = new Pseudonymizer();
  p.alias('CLIENTE', 'a1', 'Helena Campos');
  return { facts, p };
};
const codes = (text: string) => {
  const { facts, p } = setup();
  return validateAnswer(text, facts, p).map((i) => i.code);
};

describe('validador da resposta', () => {
  it('aceita texto que cita só referências e pseudônimos conhecidos', () => {
    expect(codes('O cliente [CLIENTE_1] tem {{F1}} vencido e margem de {{F2}}.')).toEqual([]);
  });

  it('reprova número fora de referência', () => {
    expect(codes('O vencido é 2310 reais.')).toEqual(['LOOSE_NUMBER']);
    expect(codes('Margem de 24,5% no projeto')).toContain('LOOSE_NUMBER');
    expect(codes('Em 25/10/2026 venceu')).toContain('LOOSE_NUMBER');
  });

  it('numeração de lista não conta como número solto', () => {
    expect(codes('Passos:\n1. Ligar para o cliente\n2) Conferir {{F1}}')).toEqual([]);
  });

  it('reprova referência e pseudônimo inexistentes', () => {
    expect(codes('Vencido {{F99}}')).toEqual(['UNKNOWN_FACT']);
    expect(codes('Fale com [CLIENTE_9]')).toEqual(['UNKNOWN_PSEUDONYM']);
  });

  it('reprova dado pessoal na resposta', () => {
    expect(codes('Escreva para maria@x.com sobre {{F1}}')).toContain('PERSONAL_DATA');
  });

  it('reprova resposta vazia e resposta em inglês', () => {
    expect(codes('   ')).toEqual(['EMPTY']);
    expect(
      codes('The customer has an overdue balance and this is not good for the project'),
    ).toContain('NOT_PORTUGUESE');
  });

  it('o idioma é julgado pelas palavras comuns, sem confundir siglas e nomes', () => {
    expect(looksPortuguese('A parcela do projeto VLX está vencida e o cliente não pagou')).toBe(
      true,
    );
    expect(looksPortuguese('kWh kWp MPPT')).toBe(true);
  });

  it('o texto de reforço lista os problemas e repete a regra das referências', () => {
    const { facts, p } = setup();
    const issues = validateAnswer('vencido 2310', facts, p);
    const text = retryInstruction(issues);
    expect(text).toMatch(/número fora de referência/);
    expect(text).toMatch(/\{\{F#\}\}/);
  });
});
