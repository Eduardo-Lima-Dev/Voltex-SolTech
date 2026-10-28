import { describe, expect, it } from 'vitest';
import { Pseudonymizer } from './pseudonymizer';

describe('pseudônimos', () => {
  it('mesma entidade, mesmo pseudônimo; entidades diferentes, números diferentes', () => {
    const p = new Pseudonymizer();
    expect(p.alias('CLIENTE', 'a1', 'Helena Duarte Campos')).toBe('[CLIENTE_1]');
    expect(p.alias('CLIENTE', 'a1', 'Helena Duarte Campos')).toBe('[CLIENTE_1]');
    expect(p.alias('CLIENTE', 'a2', 'Maria Aparecida Souza')).toBe('[CLIENTE_2]');
    expect(p.alias('USUARIO', 'u1', 'Victor Vendedor')).toBe('[USUARIO_1]');
  });

  it('troca o nome no texto sem diferenciar maiúsculas, acento nem espaços, só palavra inteira', () => {
    const p = new Pseudonymizer();
    p.alias('CLIENTE', 'a1', 'Helena Duarte Campos');
    p.alias('CLIENTE', 'a2', 'Maria Souza');
    const out = p.scrub('A HELENA  duarte campos pagou; maria souza não. Mariana Souza fica.');
    expect(out).toBe('A [CLIENTE_1] pagou; [CLIENTE_2] não. Mariana Souza fica.');
    expect(p.scrub('padaria pão quente')).toBe('padaria pão quente');
  });

  it('pega o nome sem acento quando o cadastro tem acento', () => {
    const p = new Pseudonymizer();
    p.alias('CLIENTE', 'a1', 'João Batista Lima');
    expect(p.scrub('joao batista lima ligou')).toBe('[CLIENTE_1] ligou');
  });

  it('nome mais longo vence o mais curto que o contém', () => {
    const p = new Pseudonymizer();
    p.alias('CLIENTE', 'a1', 'Maria');
    p.alias('CLIENTE', 'a2', 'Maria da Silva');
    expect(p.scrub('Maria da Silva e Maria')).toBe('[CLIENTE_2] e [CLIENTE_1]');
  });

  it('nome muito curto não é trocado (evita estragar o texto)', () => {
    const p = new Pseudonymizer();
    p.alias('CLIENTE', 'a1', 'Jo');
    expect(p.scrub('Jo foi')).toBe('Jo foi');
  });

  it('nomes com caracteres especiais de expressão regular não quebram', () => {
    const p = new Pseudonymizer();
    p.alias('CLIENTE', 'a1', 'Padaria (Centro) + Filhos Ltda.');
    expect(p.scrub('visitar padaria (centro) + filhos ltda. amanhã')).toBe(
      'visitar [CLIENTE_1] amanhã',
    );
  });

  it('detecta pseudônimo que a IA inventou', () => {
    const p = new Pseudonymizer();
    p.alias('CLIENTE', 'a1', 'Helena Campos');
    expect(p.unknownAliases('[CLIENTE_1] e [CLIENTE_7] e [USUARIO_1]')).toEqual([
      '[CLIENTE_7]',
      '[USUARIO_1]',
    ]);
  });

  it('volta ao nome real só para quem pode ver; sem permissão fica neutro', () => {
    const p = new Pseudonymizer();
    p.alias('CLIENTE', 'a1', 'Helena Campos');
    p.alias('USUARIO', 'u1', 'Victor Vendedor');
    const text = '[CLIENTE_1] é atendida por [USUARIO_1].';
    expect(p.reveal(text, () => true)).toBe('Helena Campos é atendida por Victor Vendedor.');
    expect(p.reveal(text, (e) => e.kind === 'USUARIO')).toBe(
      'um cliente é atendida por Victor Vendedor.',
    );
    expect(p.reveal(text, () => false)).toBe('um cliente é atendida por uma pessoa da equipe.');
  });

  it('o mapa pode ser guardado e restaurado (conversa continuada)', () => {
    const p = new Pseudonymizer();
    p.alias('CLIENTE', 'a1', 'Helena Campos');
    const restored = new Pseudonymizer(p.entries());
    expect(restored.alias('CLIENTE', 'a1', 'Helena Campos')).toBe('[CLIENTE_1]');
    expect(restored.alias('CLIENTE', 'a2', 'Outra Pessoa')).toBe('[CLIENTE_2]');
  });
});
