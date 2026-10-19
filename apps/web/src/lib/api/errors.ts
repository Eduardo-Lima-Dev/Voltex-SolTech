import type { ApiError as ApiErrorBody } from '@voltex/shared';

/** Erro devolvido pela API (ou falha de rede, com `status` 0). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: ApiErrorBody['details'] = undefined,
    readonly requestId: string | undefined = undefined,
    /** Dados estruturados do erro (ex.: `matchedLeadId` num lead duplicado). */
    readonly data: Record<string, unknown> | undefined = undefined,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get isNetworkError(): boolean {
    return this.status === 0;
  }
  get isUnauthorized(): boolean {
    return this.status === 401;
  }
  get isForbidden(): boolean {
    return this.status === 403;
  }
}

export const isApiError = (error: unknown): error is ApiError => error instanceof ApiError;

/** Mensagem segura para mostrar ao usuário. */
export function errorMessage(
  error: unknown,
  fallback = 'Algo deu errado. Tente novamente.',
): string {
  if (isApiError(error)) {
    if (error.isNetworkError)
      return 'Não foi possível conectar ao sistema. Verifique sua conexão com a internet.';
    if (error.status >= 500)
      return 'O sistema encontrou um problema. Tente novamente em instantes.';
    return error.message || fallback;
  }
  return fallback;
}

/** Erros de validação (422) por campo: `{ email: 'E-mail inválido' }`. */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!isApiError(error) || !error.details) return {};
  const result: Record<string, string> = {};
  for (const detail of error.details) {
    if (detail.path && !(detail.path in result)) result[detail.path] = detail.message;
  }
  return result;
}
