import path from 'node:path';
import dotenv from 'dotenv';

// Carrega o .env da raiz (credenciais de S3/Redis) sem sobrescrever o que já veio do ambiente...
dotenv.config({ path: path.resolve(__dirname, '../../../.env'), quiet: true });

// ...e então aponta TUDO que for destrutivo para recursos de teste.
export const TEST_DB_NAME = 'voltex_test';

export function testDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const base = process.env.DATABASE_URL;
  if (!base)
    throw new Error(
      'DATABASE_URL (ou TEST_DATABASE_URL) não definida. Rode `pnpm setup` antes dos testes e2e.',
    );
  const url = new URL(base);
  url.pathname = `/${TEST_DB_NAME}`;
  return url.toString();
}

const url = testDatabaseUrl();
if (!new URL(url).pathname.slice(1).endsWith('_test')) {
  throw new Error('Os testes e2e só rodam em bancos cujo nome termina com "_test".');
}

Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: url,
  S3_BUCKET: 'voltex-documents-test',
  THROTTLE_DISABLED: 'true',
  OUTBOX_POLL_INTERVAL_MS: '0',
  AUTOMATION_SCAN_INTERVAL_MS: '0',
  // A rotina de insights é chamada direto pelos testes; agendada, ela disparia sozinha e consumiria respostas do provedor simulado.
  AI_INSIGHTS_INTERVAL_MS: '0',
  AUTOMATION_RETENTION_INTERVAL_MS: '0',
  DATA_HUB_WATCH_INTERVAL_MS: '0',
  DATA_HUB_TARIFF_INTERVAL_MS: '0',
  INTEGRATIONS_SYNC_INTERVAL_MS: '0',
  AFTERSALES_SCAN_INTERVAL_MS: '0',
  // Ligado nos testes: os adaptadores usados são falsos, registrados pelo próprio teste.
  INTEGRATIONS_ENABLED_PROVIDERS: 'fake-monitor,fake-unofficial',
  DATA_HUB_ENABLED_SOURCES: 'nasa-power,pvgis,aneel-tariffs',
  METRICS_TOKEN: 'e2e-metrics-token-0123456789',
  AUTOMATION_QUEUE_PREFIX: `voltex-test-${process.pid}`,
  REFRESH_REUSE_GRACE_MS: '0',
  JWT_SECRET: 'e2e-jwt-secret-with-at-least-32-characters-0123456789',
});
