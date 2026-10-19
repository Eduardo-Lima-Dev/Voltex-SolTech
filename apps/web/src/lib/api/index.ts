import { sessionStore } from '@/features/auth/session-store';
import { ApiClient } from './client';

export const API_BASE_URL = import.meta.env.VITE_API_URL || '/api/v1';

/** Cliente único da aplicação, ligado ao store de sessão. */
export const api = new ApiClient({
  baseUrl: API_BASE_URL,
  getToken: () => sessionStore.getState().accessToken,
  onSession: sessionStore.setSession,
  onUnauthenticated: sessionStore.clear,
});

export * from './errors';
export { ApiClient } from './client';
