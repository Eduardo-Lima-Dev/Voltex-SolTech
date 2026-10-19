import { describe, expect, it } from 'vitest';
import { redact } from './redact';

describe('redact', () => {
  it('mascara campos sensíveis em qualquer nível, inclusive em listas', () => {
    const input = {
      name: 'Ana',
      passwordHash: '$argon2id$...',
      nested: { accessToken: 'abc', refresh_token: 'def', ok: 1 },
      list: [{ secret: 's', keep: true }],
      when: new Date('2026-01-01'),
    };
    expect(redact(input)).toEqual({
      name: 'Ana',
      passwordHash: '[REDACTED]',
      nested: { accessToken: '[REDACTED]', refresh_token: '[REDACTED]', ok: 1 },
      list: [{ secret: '[REDACTED]', keep: true }],
      when: input.when,
    });
  });

  it('não altera o objeto original e tolera null/primitivos', () => {
    const input = { password: 'x' };
    redact(input);
    expect(input.password).toBe('x');
    expect(redact(null)).toBeNull();
    expect(redact('texto')).toBe('texto');
  });
});
