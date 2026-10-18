import { spawnSync } from 'node:child_process';
import path from 'node:path';
import dotenv from 'dotenv';
import { Client } from 'pg';

/** Recria o banco de teste do zero (schema vazio + migrations) antes de toda a suíte e2e. */
export default async function globalSetup(): Promise<void> {
  dotenv.config({ path: path.resolve(__dirname, '../../../.env'), quiet: true });
  const { testDatabaseUrl, TEST_DB_NAME } = await import('./env-setup');
  const testUrl = testDatabaseUrl();
  const dbName = new URL(testUrl).pathname.slice(1);
  if (!dbName.endsWith('_test')) throw new Error(`Recusado: "${dbName}" não é um banco de teste`);

  const adminUrl = new URL(testUrl);
  adminUrl.pathname = '/postgres';
  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (exists.rowCount === 0) await admin.query(`CREATE DATABASE "${dbName.replace(/"/g, '')}"`);
  await admin.end();

  const db = new Client({ connectionString: testUrl });
  await db.connect();
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await db.end();

  const result = spawnSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: path.resolve(__dirname, '../../../packages/database'),
    env: { ...process.env, DATABASE_URL: testUrl },
    encoding: 'utf8',
  });
  if (result.status !== 0)
    throw new Error(
      `prisma migrate deploy falhou no banco ${TEST_DB_NAME}:\n${result.stdout}\n${result.stderr}`,
    );
}
