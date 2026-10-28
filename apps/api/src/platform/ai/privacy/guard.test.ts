import { describe, expect, it } from 'vitest';
import { PersonalDataLeak, assertNoPersonalData } from './guard';

describe('última barreira antes do provedor', () => {
  it('passa texto limpo e pseudônimos', () => {
    expect(() =>
      assertNoPersonalData([
        { role: 'system', content: 'Responda em português.' },
        { role: 'user', content: 'Quanto [CLIENTE_1] deve no projeto VLX-6WB4CMRT?' },
      ]),
    ).not.toThrow();
  });

  it('bloqueia dado pessoal em qualquer mensagem e guarda só os tipos', () => {
    try {
      assertNoPersonalData([
        { role: 'user', content: 'ok' },
        {
          role: 'tool',
          content: '{"email":"maria@x.com","tel":"(85) 98877-1001"}',
          toolCallId: 'c1',
        },
      ]);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(PersonalDataLeak);
      expect((error as PersonalDataLeak).counts).toEqual({ EMAIL: 1, PHONE: 1 });
      expect((error as Error).message).not.toContain('maria@x.com');
    }
  });

  it('olha também os argumentos das chamadas de ferramenta do modelo', () => {
    expect(() =>
      assertNoPersonalData([
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'c1', name: 'buscar', arguments: { cpf: '529.982.247-25' } }],
        },
      ]),
    ).toThrow(PersonalDataLeak);
  });
});
