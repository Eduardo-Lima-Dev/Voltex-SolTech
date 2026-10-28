import { describe, expect, it } from 'vitest';
import { findMentions, type NamedEntity } from './mentions';

const E = (kind: NamedEntity['kind'], id: string, name: string): NamedEntity => ({
  kind,
  id,
  name,
});
const people = [
  E('CLIENTE', 'a1', 'Helena Duarte Campos'),
  E('CLIENTE', 'a2', 'Maria Aparecida Souza'),
  E('CLIENTE', 'a3', 'Maria Eduarda Lima'),
  E('CLIENTE', 'a4', 'João Batista Lima'),
  E('CLIENTE', 'a5', 'Padaria Pão Quente Ltda'),
  E('USUARIO', 'u1', 'Victor Vendedor'),
];
const alias = (e: NamedEntity) => `[${e.kind}_${e.id}]`;

describe('nomes citados na pergunta', () => {
  it('troca o nome completo, sem diferenciar maiúsculas nem acento', () => {
    const out = findMentions(
      'Quanto helena duarte campos deve? E joao batista lima?',
      people,
      alias,
    );
    expect(out.text).toBe('Quanto [CLIENTE_a1] deve? E [CLIENTE_a4]?');
    expect(out.matches.map((m) => m.id).sort()).toEqual(['a1', 'a4']);
    expect(out.ambiguous).toEqual([]);
  });

  it('nome solto que identifica uma só pessoa é trocado', () => {
    const out = findMentions('Como está a Helena?', people, alias);
    expect(out.text).toBe('Como está a [CLIENTE_a1]?');
    expect(out.matches).toHaveLength(1);
  });

  it('nome solto ambíguo some do texto e é sinalizado', () => {
    const out = findMentions('Quanto a Maria deve?', people, alias);
    expect(out.text).toBe('Quanto a [NOME] deve?');
    expect(out.ambiguous).toEqual(['Maria']);
    expect(out.matches).toEqual([]);
  });

  it('sobrenome comum a duas pessoas também é ambíguo; o completo desfaz a ambiguidade', () => {
    expect(findMentions('Fale do Lima', people, alias).ambiguous).toEqual(['Lima']);
    const out = findMentions('Fale da Maria Aparecida Souza', people, alias);
    expect(out.text).toBe('Fale da [CLIENTE_a2]');
    expect(out.ambiguous).toEqual([]);
  });

  it('palavra comum de nome de empresa não identifica ninguém', () => {
    const out = findMentions(
      'Como vai a Padaria? E o Financeiro? Mostre os Clientes.',
      people,
      alias,
    );
    expect(out.matches).toEqual([]);
    expect(out.text).toBe('Como vai a Padaria? E o Financeiro? Mostre os Clientes.');
  });

  it('o nome da empresa inteira é reconhecido; usuário interno vira pseudônimo de usuário', () => {
    const out = findMentions('A padaria pão quente ltda e o Victor', people, alias);
    expect(out.text).toBe('A [CLIENTE_a5] e o [USUARIO_u1]');
  });

  it('palavras que não são nome (início de frase, verbos) ficam como estão', () => {
    const out = findMentions('Quanto está vencido hoje? Preciso do resumo.', people, alias);
    expect(out.text).toBe('Quanto está vencido hoje? Preciso do resumo.');
  });

  it('o mesmo nome citado duas vezes é trocado nas duas', () => {
    const out = findMentions('Helena e a Helena de novo', people, alias);
    expect(out.text).toBe('[CLIENTE_a1] e a [CLIENTE_a1] de novo');
  });

  it('sem entidades na empresa, nada muda', () => {
    expect(findMentions('Quanto Helena deve?', [], alias).text).toBe('Quanto Helena deve?');
  });
});
