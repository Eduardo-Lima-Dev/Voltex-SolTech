import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { API_PORT, E2E_DATABASE_URL, WEB_PORT } from './env';

const root = path.resolve(__dirname, '../..');
const apiEnv = {
  NODE_ENV: 'test',
  API_PORT: String(API_PORT),
  DATABASE_URL: E2E_DATABASE_URL(),
  WEB_URL: `http://localhost:${WEB_PORT}`,
  CORS_ORIGIN: `http://localhost:${WEB_PORT}`,
  THROTTLE_DISABLED: 'true',
  OUTBOX_POLL_INTERVAL_MS: '300',
  AUTOMATION_SCAN_INTERVAL_MS: '0',
  AUTOMATION_QUEUE_PREFIX: 'voltex-e2e',
  S3_BUCKET: 'voltex-documents-e2e',
  JWT_SECRET: 'e2e-browser-jwt-secret-with-at-least-32-characters',
  JWT_REFRESH_SECRET: 'e2e-browser-refresh-secret-with-at-least-32-chars',
};

export default defineConfig({
  testDir: './tests',
  // Os testes compartilham um banco real: um por vez.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    locale: 'pt-BR',
    timezoneId: 'America/Fortaleza',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { args: ['--no-sandbox'] },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1360, height: 900 } },
    },
  ],
  // Sobe a API já compilada e o front compilado (`pnpm build` antes) apontando para ela.
  webServer: [
    {
      // Recria o banco e só então sobe a API (o Playwright inicia os servidores antes do globalSetup).
      command: `node "${path.join(__dirname, 'prepare-db.mjs')}" && node dist/main.js`,
      cwd: path.join(root, 'apps/api'),
      url: `http://localhost:${API_PORT}/api/v1/health`,
      env: apiEnv,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `pnpm exec vite preview --port ${WEB_PORT} --strictPort`,
      cwd: path.join(root, 'apps/web'),
      url: `http://localhost:${WEB_PORT}/login`,
      env: { API_PORT: String(API_PORT) },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
