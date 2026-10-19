import { setupServer } from 'msw/node';

/** Servidor MSW compartilhado pelos testes. Cada teste registra os handlers de que precisa com `server.use(...)`. */
export const server = setupServer();
