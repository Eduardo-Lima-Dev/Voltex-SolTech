import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  // O .env fica na raiz do monorepo.
  const env = loadEnv(mode, path.resolve(here, '../..'), '');
  // O formulário de contato fala com a API na mesma origem (`/api/v1/public/leads/...`): em dev o Vite encaminha.
  const proxy = {
    '/api': { target: `http://localhost:${env.API_PORT ?? '3000'}`, changeOrigin: false },
  };
  return {
    envDir: path.resolve(here, '../..'),
    server: { port: 5174, strictPort: true, proxy },
    preview: { port: 4174, proxy },
    build: { sourcemap: true, target: 'es2022' },
    test: { environment: 'jsdom', include: ['src/**/*.test.ts'] },
  };
});
