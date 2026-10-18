import { QueryClient } from '@tanstack/react-query';
import { isApiError } from './api/errors';

/** Não repete erros do cliente (4xx): só falhas de rede e de servidor. */
export const shouldRetry = (failureCount: number, error: unknown): boolean => {
  if (failureCount >= 2) return false;
  if (isApiError(error)) return error.isNetworkError || error.status >= 500;
  return false;
};

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: shouldRetry },
      mutations: { retry: false },
    },
  });
}
