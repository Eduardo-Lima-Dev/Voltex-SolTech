import { describe, expect, it } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env';
import { AiProviderError } from '../ai-provider';
import {
  CloudflareAiProvider,
  classifyCloudflareFailure,
  parseCloudflareResult,
  type FetchLike,
} from './cloudflare-ai.provider';

const config = (values: Partial<Record<keyof Env, string>>) =>
  ({ get: (key: keyof Env) => values[key] ?? '' }) as unknown as ConfigService<Env, true>;

const reply = (status: number, body: unknown): ReturnType<FetchLike> =>
  Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
  });

const request = {
  model: '@cf/meta/llama-4-scout-17b-16e-instruct',
  messages: [{ role: 'user' as const, content: 'oi' }],
  maxTokens: 50,
  timeoutMs: 1_000,
};

const make = (fetchImpl: FetchLike, creds = true) => {
  const provider = new CloudflareAiProvider(
    config(creds ? { CLOUDFLARE_ACCOUNT_ID: 'acc', CLOUDFLARE_API_TOKEN: 'tok' } : {}),
  );
  provider.fetchImpl = fetchImpl;
  return provider;
};

describe('Cloudflare Workers AI', () => {
  it('sem credencial não está configurado e não chama a rede', async () => {
    let called = false;
    const provider = make(() => {
      called = true;
      return reply(200, {});
    }, false);
    expect(provider.isConfigured()).toBe(false);
    await expect(provider.chat(request)).rejects.toMatchObject({ code: 'ENV_DISABLED' });
    expect(called).toBe(false);
  });

  it('lê o formato { response } com o custo em neurons', async () => {
    const provider = make(() =>
      reply(200, {
        success: true,
        result: {
          response: ' olá ',
          usage: { neurons: 9.5, prompt_tokens: 4, completion_tokens: 2 },
        },
      }),
    );
    const out = await provider.chat(request);
    expect(out).toMatchObject({ text: 'olá', neurons: 9.5, promptTokens: 4, completionTokens: 2 });
  });

  it('lê o formato OpenAI (choices) e as chamadas de ferramenta', () => {
    const out = parseCloudflareResult(
      {
        choices: [
          {
            finish_reason: 'tool_calls',
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'c1',
                  type: 'function',
                  function: { name: 'resumo', arguments: '{"projeto":"VLX-1"}' },
                },
                { id: 'c2', type: 'function', function: { name: 'outra', arguments: { a: 1 } } },
                {
                  id: 'c3',
                  type: 'function',
                  function: { name: 'quebrada', arguments: '{nao-json' },
                },
              ],
            },
          },
        ],
        usage: { neurons: 5 },
      },
      'm',
    );
    expect(out.text).toBe('');
    expect(out.finishReason).toBe('tool_calls');
    expect(out.toolCalls).toEqual([
      { id: 'c1', name: 'resumo', arguments: { projeto: 'VLX-1' } },
      { id: 'c2', name: 'outra', arguments: { a: 1 } },
      { id: 'c3', name: 'quebrada', arguments: {} },
    ]);
  });

  it('envia a chave e o modelo no endereço certo, e as ferramentas no formato do provedor', async () => {
    let seen: {
      url: string;
      headers: Record<string, string>;
      body: Record<string, unknown>;
    } | null = null;
    const provider = make((url, init) => {
      seen = { url, headers: init.headers, body: JSON.parse(init.body) };
      return reply(200, { success: true, result: { response: 'ok' } });
    });
    await provider.chat({
      ...request,
      tools: [{ name: 'resumo', description: 'd', parameters: { type: 'object', properties: {} } }],
      messages: [
        { role: 'user', content: 'q' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'c1', name: 'resumo', arguments: { a: 1 } }],
        },
        { role: 'tool', content: '{"x":1}', toolCallId: 'c1' },
      ],
    });
    expect(seen!.url).toBe(
      'https://api.cloudflare.com/client/v4/accounts/acc/ai/run/@cf/meta/llama-4-scout-17b-16e-instruct',
    );
    expect(seen!.headers.authorization).toBe('Bearer tok');
    const body = seen!.body as { messages: Record<string, unknown>[]; tools: unknown[] };
    expect(body.tools).toHaveLength(1);
    expect(body.messages[1]).toMatchObject({
      tool_calls: [{ id: 'c1', function: { name: 'resumo', arguments: '{"a":1}' } }],
    });
    expect(body.messages[2]).toMatchObject({ role: 'tool', tool_call_id: 'c1' });
  });

  it('resposta vazia vira EMPTY_RESPONSE (tentável no modelo reserva)', async () => {
    const provider = make(() => reply(200, { success: true, result: { response: '' } }));
    await expect(provider.chat(request)).rejects.toMatchObject({
      code: 'EMPTY_RESPONSE',
      retryable: true,
    });
  });

  it('traduz os erros do provedor para os códigos do sistema', () => {
    const cases: [number, unknown, string, boolean][] = [
      [401, { errors: [{ code: 10000, message: 'Authentication error' }] }, 'PROVIDER_AUTH', false],
      [403, {}, 'PROVIDER_AUTH', false],
      [429, {}, 'PROVIDER_QUOTA', false],
      [
        400,
        {
          errors: [
            {
              code: 4006,
              message: 'you have used up your daily free allocation of 10,000 neurons',
            },
          ],
        },
        'PROVIDER_QUOTA',
        false,
      ],
      [504, {}, 'TIMEOUT', true],
      [500, {}, 'PROVIDER_DOWN', true],
      [404, { errors: [{ code: 5007, message: 'No such model' }] }, 'PROVIDER_DOWN', true],
    ];
    for (const [status, body, code, retryable] of cases) {
      const err = classifyCloudflareFailure(status, body);
      expect(err).toBeInstanceOf(AiProviderError);
      expect(err.code, `${status}`).toBe(code);
      expect(err.retryable, `${status}`).toBe(retryable);
    }
  });

  it('erro de rede vira PROVIDER_DOWN e prazo estourado vira TIMEOUT', async () => {
    await expect(
      make(() => Promise.reject(new Error('ECONNRESET'))).chat(request),
    ).rejects.toMatchObject({ code: 'PROVIDER_DOWN' });
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    await expect(make(() => Promise.reject(abort)).chat(request)).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
  });

  it('o prazo corta uma chamada pendurada', async () => {
    const provider = make(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          );
        }),
    );
    const started = Date.now();
    await expect(provider.chat({ ...request, timeoutMs: 80 })).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('corpo success:false com HTTP 200 também é tratado como falha', async () => {
    const provider = make(() =>
      reply(200, { success: false, errors: [{ code: 10000, message: 'Authentication error' }] }),
    );
    await expect(provider.chat(request)).rejects.toMatchObject({ code: 'PROVIDER_AUTH' });
  });
});
