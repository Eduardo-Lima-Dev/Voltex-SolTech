import { existsSync } from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { defineConfig } from 'prisma/config';

// Carrega o .env da raiz do monorepo (e o local do pacote, se existir). Em Docker/CI as variáveis já vêm do ambiente.
for (const candidate of [
  path.resolve(process.cwd(), '../../.env'),
  path.resolve(process.cwd(), '.env'),
]) {
  if (existsSync(candidate)) dotenv.config({ path: candidate, quiet: true });
}

// `prisma generate` não acessa o banco, então builds de CI/Docker não precisam de DATABASE_URL.
// Se ela faltar em um comando que conecta (migrate, studio), o host abaixo deixa o erro explícito.
const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://user:pass@DATABASE_URL-nao-definida.invalid:5432/db';

export default defineConfig({
  schema: 'prisma/schema',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: databaseUrl,
  },
});
