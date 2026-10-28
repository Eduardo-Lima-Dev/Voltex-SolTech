import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { API_PORT, E2E_DATABASE_URL, LEAD_KEY, SITE_PORT, WEB_PORT } from './env';

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
  // IA com o provedor de demonstração (determinístico, sem custo e sem rede).
  AI_ENABLED: 'true',
  AI_PROVIDER: 'demo',
  JWT_SECRET: 'e2e-browser-jwt-secret-with-at-least-32-characters',
  JWT_REFRESH_SECRET: 'e2e-browser-refresh-secret-with-at-least-32-chars',
};

const apiImage = process.env.E2E_API_IMAGE;
const dockerEnv = { ...process.env, ...apiEnv } as Record<string, string | undefined>;
const apiCommand = apiImage
  ? `docker rm -f voltex-e2e-api >/dev/null 2>&1; docker run --rm --name voltex-e2e-api --network host ${[
      'NODE_ENV',
      'API_PORT',
      'DATABASE_URL',
      'WEB_URL',
      'CORS_ORIGIN',
      'THROTTLE_DISABLED',
      'AI_ENABLED',
      'AI_PROVIDER',
      'OUTBOX_POLL_INTERVAL_MS',
      'AUTOMATION_SCAN_INTERVAL_MS',
      'AUTOMATION_QUEUE_PREFIX',
      'JWT_SECRET',
      'JWT_REFRESH_SECRET',
      'S3_ENDPOINT',
      'S3_REGION',
      'S3_BUCKET',
      'S3_ACCESS_KEY',
      'S3_SECRET_KEY',
      'REDIS_URL',
    ]
      .filter((k) => dockerEnv[k])
      .map((k) => `-e ${k}='${dockerEnv[k]}'`)
      .join(' ')} ${apiImage}`
  : 'node dist/main.js';

export default defineConfig({
  testDir: './tests',
  // Os testes compartilham um banco real: um por vez.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }]]
    : process.env.JORNADA
      ? [['list'], ['html', { open: 'never', outputFolder: 'relatorio-jornada' }]]
      : 'list',
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
      testIgnore: /jornada-.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1360, height: 900 } },
    },
    {
      // Jornadas completas, para conferência: gravam vídeo e capturas de cada passo (`pnpm jornada`).
      name: 'jornada',
      testMatch: /jornada-.*\.spec\.ts/,
      timeout: 240_000,
      expect: { timeout: 8_000 },
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1360, height: 900 },
        video: { mode: 'on', size: { width: 1360, height: 900 } },
        screenshot: 'on',
        trace: 'retain-on-failure',
        // `SLOWMO=400 pnpm jornada --headed` deixa o navegador mais lento para acompanhar a olho.
        launchOptions: { args: ['--no-sandbox'], slowMo: Number(process.env.SLOWMO ?? 0) },
      },
    },
  ],
  // Sobe a API já compilada e o front compilado (`pnpm build` antes) apontando para ela.
  webServer: [
    {
      // Recria o banco e só então sobe a API (o Playwright inicia os servidores antes do globalSetup).
      // Com `E2E_API_IMAGE=voltex/api:slim` a API roda a partir da IMAGEM Docker (para provar que a imagem funciona).
      command: `node "${path.join(__dirname, 'prepare-db.mjs')}" && ${apiCommand}`,
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
    {
      // O site é compilado aqui com a chave de captação do banco de teste e o endereço da aplicação de teste.
      command: `pnpm exec vite build && pnpm exec vite preview --port ${SITE_PORT} --strictPort`,
      cwd: path.join(root, 'apps/site'),
      url: `http://localhost:${SITE_PORT}/`,
      env: {
        API_PORT: String(API_PORT),
        VITE_APP_URL: `http://localhost:${WEB_PORT}`,
        VITE_LEAD_KEY: LEAD_KEY,
      },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
