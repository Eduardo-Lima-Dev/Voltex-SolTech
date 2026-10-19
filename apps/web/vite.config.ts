import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  // O .env fica na raiz do monorepo; só precisamos da porta da API para o proxy de desenvolvimento.
  const env = loadEnv(mode, path.resolve(here, '../..'), '');
  const apiTarget = `http://localhost:${env.API_PORT ?? '3000'}`;
  const proxy = { '/api': { target: apiTarget, changeOrigin: false } };

  return {
    plugins: [react(), tailwindcss()],
    resolve: { alias: { '@': path.resolve(here, 'src') } },
    // O front chama `/api/v1` na mesma origem; em dev o Vite encaminha para a API (sem CORS e com o cookie de sessão).
    server: { port: 5173, strictPort: true, proxy },
    preview: { port: 4173, proxy },
    build: { sourcemap: true },
    test: {
      environment: 'jsdom',
      globals: true,
      include: ['src/**/*.test.{ts,tsx}'],
      setupFiles: ['./src/test/setup.ts'],
      css: false,
      // Com o monorepo todo rodando em paralelo a máquina fica lenta: 5 s (padrão) estoura em testes de tela inteira.
      testTimeout: 15_000,
      // O fetch do Node exige URL absoluta; o MSW intercepta este host nos testes.
      env: { VITE_API_URL: 'http://api.test/api/v1' },
    },
  };
});
