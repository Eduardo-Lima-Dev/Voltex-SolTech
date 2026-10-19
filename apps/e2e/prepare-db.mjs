// Recria o banco `voltex_e2e` do zero (migrations + usuários de demonstração).
// Roda ANTES de a API subir (o Playwright inicia os servidores antes do globalSetup, por isso é um script à parte).
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../.env'), quiet: true });

const base = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL;
if (!base)
  throw new Error('DATABASE_URL (ou E2E_DATABASE_URL) não definida. Rode `pnpm setup` antes.');
const url = new URL(base);
if (!process.env.E2E_DATABASE_URL) url.pathname = '/voltex_e2e';
const name = url.pathname.slice(1);
if (!name.endsWith('_e2e')) throw new Error(`Recusado: "${name}" não é um banco de testes e2e`);

const admin = new pg.Client({
  connectionString: Object.assign(new URL(url), { pathname: '/postgres' }).toString(),
});
await admin.connect();
if ((await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name])).rowCount === 0)
  await admin.query(`CREATE DATABASE "${name}"`);
await admin.end();

const db = new pg.Client({ connectionString: url.toString() });
await db.connect();
await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
await db.end();

const cwd = path.resolve(here, '../../packages/database');
for (const args of [
  ['exec', 'prisma', 'migrate', 'deploy'],
  ['run', 'db:seed'],
]) {
  const result = spawnSync('pnpm', args, {
    cwd,
    env: { ...process.env, DATABASE_URL: url.toString() },
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    console.error(result.stdout, result.stderr);
    process.exit(1);
  }
}
// Chave de captação conhecida: o site de teste é compilado com ela (veja env.ts e playwright.config.ts).
const seeded = new pg.Client({ connectionString: url.toString() });
await seeded.connect();
await seeded.query(
  `UPDATE tenants SET lead_capture_key = 'lk_e2e_jornada' WHERE slug = (SELECT slug FROM tenants ORDER BY created_at LIMIT 1)`,
);
await seeded.end();
console.log(`Banco ${name} pronto.`);
