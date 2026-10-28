import { apiErrorSchema, ROUTES, type SessionResponse } from '@voltex/shared';
import { ApiError } from './errors';

export type QueryParams = Record<string, string | number | boolean | null | undefined>;

export interface RequestOptions {
  query?: QueryParams;
  body?: unknown;
  formData?: FormData;
  signal?: AbortSignal;
  /** Envia o access token (padrão). `false` para rotas públicas. */
  auth?: boolean;
}

export interface ApiClientConfig {
  baseUrl: string;
  getToken: () => string | null;
  /** Chamado quando o refresh devolve uma nova sessão. */
  onSession: (session: SessionResponse) => void;
  /** Chamado quando a sessão não pode mais ser renovada. */
  onUnauthenticated: () => void;
  fetch?: typeof fetch;
}

const AUTH_PATHS: string[] = [
  ROUTES.auth.login,
  ROUTES.auth.refresh,
  ROUTES.auth.logout,
  ROUTES.invitations.accept,
];

function buildUrl(baseUrl: string, path: string, query?: QueryParams): string {
  const url = `${baseUrl.replace(/\/$/, '')}${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

async function toApiError(response: Response): Promise<ApiError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    // Resposta sem JSON (ex.: 502 do proxy): mantém só o status.
  }
  const parsed = apiErrorSchema.safeParse(body);
  if (parsed.success) {
    const { code, message, details, requestId, data } = parsed.data;
    return new ApiError(
      response.status,
      code,
      message,
      details,
      requestId ?? response.headers.get('x-request-id') ?? undefined,
      data,
    );
  }
  return new ApiError(response.status, 'HTTP_ERROR', response.statusText || 'Erro na requisição');
}

/**
 * Cliente HTTP da API. Envia o access token, e quando recebe 401 renova a sessão pelo cookie de refresh
 * (UMA renovação por vez, mesmo com várias requisições falhando juntas) e repete a requisição uma vez.
 */
export class ApiClient {
  private refreshing: Promise<SessionResponse | null> | null = null;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: ApiClientConfig) {
    this.fetchImpl = config.fetch ?? ((...args) => fetch(...args));
  }

  get<T>(path: string, options?: Omit<RequestOptions, 'body' | 'formData'>) {
    return this.request<T>('GET', path, options);
  }
  post<T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'body'>) {
    return this.request<T>('POST', path, { ...options, body });
  }
  put<T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'body'>) {
    return this.request<T>('PUT', path, { ...options, body });
  }
  patch<T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'body'>) {
    return this.request<T>('PATCH', path, { ...options, body });
  }
  delete<T>(path: string, options?: Omit<RequestOptions, 'body'>) {
    return this.request<T>('DELETE', path, options);
  }
  upload<T>(path: string, formData: FormData, options?: Omit<RequestOptions, 'body' | 'formData'>) {
    return this.request<T>('POST', path, { ...options, formData });
  }

  /**
   * POST que responde em fluxo (SSE, linhas `data: {json}`). Chama `onEvent` a cada evento e devolve quando o
   * servidor encerra. Erros HTTP antes do fluxo viram `ApiError`. Renova a sessão em 401 como `request`.
   */
  async postStream<E>(
    path: string,
    body: unknown,
    onEvent: (event: E) => void,
    options: Pick<RequestOptions, 'signal'> = {},
  ): Promise<void> {
    const open = () => this.send('POST', path, { ...options, body }, 'text/event-stream');
    let response = await open();
    if (response.status === 401) {
      const session = await this.refreshSession();
      if (session) response = await open();
      else this.config.onUnauthenticated();
    }
    if (!response.ok) throw await toApiError(response);
    if (!response.body) {
      throw new ApiError(0, 'NETWORK_ERROR', 'Não foi possível conectar ao sistema');
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const flush = (frame: string) => {
      const data = frame
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('');
      if (data) onEvent(JSON.parse(data) as E);
    };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let cut = buffer.indexOf('\n\n');
      while (cut >= 0) {
        flush(buffer.slice(0, cut));
        buffer = buffer.slice(cut + 2);
        cut = buffer.indexOf('\n\n');
      }
    }
    if (buffer.trim()) flush(buffer);
  }

  /** Baixa um arquivo (PDF, SVG, DXF) de rota autenticada. */
  async getBlob(
    path: string,
    options: Omit<RequestOptions, 'body' | 'formData'> = {},
  ): Promise<Blob> {
    let response = await this.send('GET', path, options);
    if (response.status === 401 && options.auth !== false) {
      const session = await this.refreshSession();
      if (session) response = await this.send('GET', path, options);
      else this.config.onUnauthenticated();
    }
    if (!response.ok) throw await toApiError(response);
    return response.blob();
  }

  async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const response = await this.send(method, path, options);
    if (response.status === 401 && options.auth !== false && !AUTH_PATHS.includes(path)) {
      const session = await this.refreshSession();
      if (session) return this.parse<T>(await this.send(method, path, options));
      this.config.onUnauthenticated();
    }
    return this.parse<T>(response);
  }

  /**
   * Renova a sessão pelo cookie de refresh. Uma única chamada por vez (chamadas simultâneas compartilham
   * a mesma promessa). Devolve `null` se não houver sessão válida; nunca lança.
   */
  refreshSession(): Promise<SessionResponse | null> {
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async doRefresh(): Promise<SessionResponse | null> {
    try {
      const response = await this.send('POST', ROUTES.auth.refresh, { auth: false });
      if (!response.ok) return null;
      const session = (await response.json()) as SessionResponse;
      this.config.onSession(session);
      return session;
    } catch {
      return null;
    }
  }

  private async send(
    method: string,
    path: string,
    options: RequestOptions,
    accept = 'application/json',
  ): Promise<Response> {
    const headers: Record<string, string> = { Accept: accept };
    const token = options.auth === false ? null : this.config.getToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    let body: BodyInit | undefined;
    if (options.formData) {
      body = options.formData; // o navegador define o Content-Type com o boundary
    } else if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }

    try {
      return await this.fetchImpl(buildUrl(this.config.baseUrl, path, options.query), {
        method,
        headers,
        body,
        signal: options.signal,
        credentials: 'include',
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      throw new ApiError(0, 'NETWORK_ERROR', 'Não foi possível conectar ao sistema');
    }
  }

  private async parse<T>(response: Response): Promise<T> {
    if (!response.ok) throw await toApiError(response);
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }
}
