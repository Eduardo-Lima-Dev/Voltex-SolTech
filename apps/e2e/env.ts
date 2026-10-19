import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

export const API_PORT = 3100;
export const WEB_PORT = 4173;
export const SITE_PORT = 4174;
/** Chave de captação fixa do banco de testes: o site é compilado com ela, e o formulário cai como lead no CRM. */
export const LEAD_KEY = 'lk_e2e_jornada';
export const PASSWORD = process.env.SEED_PASSWORD ?? 'Voltex@2026';

/** Banco próprio dos testes e2e: nunca o de desenvolvimento. */
export function E2E_DATABASE_URL(): string {
  if (process.env.E2E_DATABASE_URL) return process.env.E2E_DATABASE_URL;
  const base = process.env.DATABASE_URL;
  if (!base)
    throw new Error('DATABASE_URL (ou E2E_DATABASE_URL) não definida. Rode `pnpm setup` antes.');
  return Object.assign(new URL(base), { pathname: '/voltex_e2e' }).toString();
}
