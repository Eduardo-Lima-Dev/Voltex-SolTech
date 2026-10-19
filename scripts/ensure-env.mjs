#!/usr/bin/env node
// Cria o .env a partir do .env.example quando ele ainda não existe. Nunca sobrescreve.
import { copyFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const target = `${root}.env`;
const source = `${root}.env.example`;

if (existsSync(target)) {
  process.exit(0);
}
copyFileSync(source, target);
console.log('[env] .env criado a partir de .env.example');
