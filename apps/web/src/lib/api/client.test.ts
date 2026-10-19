import { describe, expect, it, vi } from 'vitest';
import type { SessionResponse } from '@voltex/shared';
import { ApiClient } from './client';
import { ApiError, errorMessage, fieldErrors, isApiError } from './errors';
import { shouldRetry } from '../query-client';
import { makeSession } from '@/test/fixtures';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

interface Harness {
  client: ApiClient;
  fetch: ReturnType<typeof vi.fn>;
  state: { token: string | null };
  onSession: ReturnType<typeof vi.fn>;
  onUnauthenticated: ReturnType<typeof vi.fn>;
}

function setup(
  handler: (url: string, init: RequestInit) => Response | Promise<Response>,
  token: string | null = 'old-token',
): Harness {
  const state = { token };
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => handler(url, init));
  const onSession = vi.fn((session: SessionResponse) => {
    state.token = session.accessToken;
  });
  const onUnauthenticated = vi.fn(() => {
    state.token = null;
  });
  const client = new ApiClient({
    baseUrl: 'http://api.test/api/v1/',
    getToken: () => state.token,
    onSession,
    onUnauthenticated,
    fetch: fetchMock as unknown as typeof fetch,
  });
  return { client, fetch: fetchMock, state, onSession, onUnauthenticated };
}

const headersOf = (init: RequestInit) => init.headers as Record<string, string>;

describe('ApiClient — requisições', () => {
  it('monta a URL sem barra dupla, ignora filtros vazios e envia o token e os cookies', async () => {
    const h = setup(() => json({ ok: true }));
    await h.client.get('/users', {
      query: { page: 2, search: '', role: undefined, isActive: false, x: null },
    });
    const [url, init] = h.fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://api.test/api/v1/users?page=2&isActive=false');
    expect(headersOf(init).Authorization).toBe('Bearer old-token');
    expect(init.credentials).toBe('include');
  });

  it('envia JSON com Content-Type e não envia Authorization sem token ou com auth:false', async () => {
    const h = setup(() => json({}), null);
    await h.client.post('/auth/login', { a: 1 }, { auth: false });
    const [, init] = h.fetch.mock.calls[0] as [string, RequestInit];
    expect(headersOf(init)['Content-Type']).toBe('application/json');
    expect(init.body).toBe('{"a":1}');
    expect(headersOf(init).Authorization).toBeUndefined();

    h.state.token = 'tok';
    await h.client.post('/x', {}, { auth: false });
    expect(headersOf(h.fetch.mock.calls[1]![1] as RequestInit).Authorization).toBeUndefined();
  });

  it('upload deixa o navegador definir o Content-Type (boundary)', async () => {
    const h = setup(() => json({ id: 1 }, 201));
    const form = new FormData();
    form.append('file', new Blob(['x']), 'a.pdf');
    await h.client.upload('/documents', form);
    const init = h.fetch.mock.calls[0]![1] as RequestInit;
    expect(headersOf(init)['Content-Type']).toBeUndefined();
    expect(init.body).toBe(form);
  });

  it('204 devolve undefined e corpo vazio não quebra', async () => {
    const h = setup(() => new Response(null, { status: 204 }));
    await expect(h.client.delete('/x')).resolves.toBeUndefined();
  });
});

describe('ApiClient — erros', () => {
  it('converte o corpo ApiError da API (código, detalhes e requestId)', async () => {
    const h = setup(() =>
      json(
        {
          statusCode: 422,
          code: 'VALIDATION_ERROR',
          message: 'Dados inválidos',
          details: [{ path: 'email', message: 'E-mail inválido' }],
          requestId: 'r-1',
        },
        422,
      ),
    );
    const error = await h.client.get('/x').catch((e: unknown) => e);
    expect(isApiError(error)).toBe(true);
    expect(error).toMatchObject({
      status: 422,
      code: 'VALIDATION_ERROR',
      message: 'Dados inválidos',
      requestId: 'r-1',
    });
    expect(fieldErrors(error)).toEqual({ email: 'E-mail inválido' });
  });

  it('resposta de erro sem JSON (proxy 502) vira HTTP_ERROR com o status', async () => {
    const h = setup(
      () => new Response('<html>Bad gateway</html>', { status: 502, statusText: 'Bad Gateway' }),
    );
    const error = (await h.client.get('/x').catch((e: unknown) => e)) as ApiError;
    expect(error).toMatchObject({ status: 502, code: 'HTTP_ERROR' });
    expect(errorMessage(error)).toMatch(/sistema/);
  });

  it('falha de rede vira ApiError status 0 com mensagem amigável', async () => {
    const h = setup(() => {
      throw new TypeError('Failed to fetch');
    });
    const error = (await h.client.get('/x').catch((e: unknown) => e)) as ApiError;
    expect(error.isNetworkError).toBe(true);
    expect(errorMessage(error)).toMatch(/conectar/);
  });

  it('não engole o cancelamento (AbortError)', async () => {
    const h = setup(() => {
      throw new DOMException('aborted', 'AbortError');
    });
    await expect(h.client.get('/x')).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('errorMessage usa a mensagem da API para erros 4xx e um texto padrão para erros desconhecidos', () => {
    expect(errorMessage(new ApiError(409, 'CONFLICT', 'Já existe um registro'))).toBe(
      'Já existe um registro',
    );
    expect(errorMessage(new Error('x'))).toBe('Algo deu errado. Tente novamente.');
    expect(errorMessage('x', 'Padrão')).toBe('Padrão');
  });

  it('shouldRetry repete só falhas de rede e de servidor, no máximo 2 vezes', () => {
    expect(shouldRetry(0, new ApiError(0, 'NETWORK_ERROR', ''))).toBe(true);
    expect(shouldRetry(1, new ApiError(503, 'X', ''))).toBe(true);
    expect(shouldRetry(2, new ApiError(503, 'X', ''))).toBe(false);
    expect(shouldRetry(0, new ApiError(404, 'NOT_FOUND', ''))).toBe(false);
    expect(shouldRetry(0, new ApiError(401, 'UNAUTHORIZED', ''))).toBe(false);
    expect(shouldRetry(0, new Error('x'))).toBe(false);
  });
});

describe('ApiClient — renovação de sessão', () => {
  it('401 → renova pelo cookie → repete a requisição com o token novo', async () => {
    const fresh = makeSession('OWNER');
    let calls = 0;
    const h = setup((url, init) => {
      if (url.endsWith('/auth/refresh')) return json(fresh);
      calls++;
      return headersOf(init).Authorization === 'Bearer old-token'
        ? json({ message: 'x', code: 'UNAUTHORIZED', statusCode: 401 }, 401)
        : json({ data: 'ok' });
    });
    await expect(h.client.get('/users')).resolves.toEqual({ data: 'ok' });
    expect(calls).toBe(2);
    expect(h.onSession).toHaveBeenCalledWith(fresh);
    expect(h.onUnauthenticated).not.toHaveBeenCalled();
  });

  it('várias requisições com 401 ao mesmo tempo disparam UMA única renovação', async () => {
    const fresh = makeSession('OWNER');
    let refreshes = 0;
    const h = setup(async (url, init) => {
      if (url.endsWith('/auth/refresh')) {
        refreshes++;
        await new Promise((r) => setTimeout(r, 20));
        return json(fresh);
      }
      return headersOf(init).Authorization === 'Bearer old-token'
        ? new Response('', { status: 401 })
        : json({ ok: true });
    });
    await Promise.all([h.client.get('/a'), h.client.get('/b'), h.client.get('/c')]);
    expect(refreshes).toBe(1);
  });

  it('se a renovação falha, encerra a sessão local e devolve o 401', async () => {
    const h = setup((url) =>
      url.endsWith('/auth/refresh')
        ? new Response('', { status: 401 })
        : new Response('', { status: 401 }),
    );
    await expect(h.client.get('/users')).rejects.toMatchObject({ status: 401 });
    expect(h.onUnauthenticated).toHaveBeenCalledTimes(1);
  });

  it('só repete UMA vez: se continua 401 depois de renovar, devolve o erro', async () => {
    let attempts = 0;
    const h = setup((url) => {
      if (url.endsWith('/auth/refresh')) return json(makeSession('OWNER'));
      attempts++;
      return new Response('', { status: 401 });
    });
    await expect(h.client.get('/users')).rejects.toMatchObject({ status: 401 });
    expect(attempts).toBe(2);
  });

  it('401 no login (senha errada) NÃO tenta renovar a sessão', async () => {
    const h = setup(
      () => json({ statusCode: 401, code: 'UNAUTHORIZED', message: 'Credenciais inválidas' }, 401),
      null,
    );
    await expect(h.client.post('/auth/login', {}, { auth: false })).rejects.toMatchObject({
      message: 'Credenciais inválidas',
    });
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(h.onUnauthenticated).not.toHaveBeenCalled();
  });

  it('rotas públicas (auth:false) com 401 não renovam', async () => {
    const h = setup(() => new Response('', { status: 401 }));
    await expect(h.client.get('/health', { auth: false })).rejects.toMatchObject({ status: 401 });
    expect(h.fetch).toHaveBeenCalledTimes(1);
  });

  it('refreshSession devolve null (sem lançar) quando não há sessão ou a rede cai', async () => {
    const noSession = setup(() => new Response('', { status: 401 }));
    await expect(noSession.client.refreshSession()).resolves.toBeNull();
    const offline = setup(() => {
      throw new TypeError('Failed to fetch');
    });
    await expect(offline.client.refreshSession()).resolves.toBeNull();
  });

  it('permite nova renovação depois que a anterior termina', async () => {
    let refreshes = 0;
    const h = setup(() => {
      refreshes++;
      return json(makeSession('OWNER'));
    });
    await h.client.refreshSession();
    await h.client.refreshSession();
    expect(refreshes).toBe(2);
  });
});
