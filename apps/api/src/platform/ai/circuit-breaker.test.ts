import { describe, expect, it } from 'vitest';
import { CircuitBreaker } from './circuit-breaker';

describe('disjuntor', () => {
  const make = () => {
    let t = 0;
    const breaker = new CircuitBreaker(3, 60_000, 60_000, () => t);
    return { breaker, at: (ms: number) => (t = ms) };
  };

  it('fechado deixa passar; abre na terceira falha dentro da janela', () => {
    const { breaker } = make();
    expect(breaker.canAttempt()).toBe(true);
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.isOpen).toBe(false);
    breaker.recordFailure();
    expect(breaker.isOpen).toBe(true);
    expect(breaker.canAttempt()).toBe(false);
  });

  it('falhas fora da janela de 60 s não somam', () => {
    const { breaker, at } = make();
    breaker.recordFailure();
    at(30_000);
    breaker.recordFailure();
    at(70_000);
    breaker.recordFailure();
    expect(breaker.isOpen).toBe(false);
  });

  it('depois do tempo aberto deixa passar uma tentativa; sucesso fecha, falha reabre', () => {
    const { breaker, at } = make();
    for (let i = 0; i < 3; i++) breaker.recordFailure();
    at(61_000);
    expect(breaker.canAttempt()).toBe(true);
    expect(breaker.canAttempt()).toBe(false); // só uma tentativa de cada vez
    breaker.recordFailure();
    expect(breaker.isOpen).toBe(true);
    at(125_000);
    expect(breaker.canAttempt()).toBe(true);
    breaker.recordSuccess();
    expect(breaker.isOpen).toBe(false);
    expect(breaker.canAttempt()).toBe(true);
  });
});
