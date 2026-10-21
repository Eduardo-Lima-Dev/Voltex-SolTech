#!/usr/bin/env node
/**
 * Auditoria de arquivos .PAN/.OND com o leitor do Engine.
 *
 *   pnpm --filter @voltex/solar-engine build
 *   node tools/pan-ond-audit/audit.mjs <pasta-com-copia-dos-arquivos> > relatorio.md
 *
 * A pasta deve ser uma CÓPIA em diretório próprio, fora do repositório: os arquivos são de terceiros e tratados como
 * texto não confiável (nada é executado). O relatório não reproduz os arquivos; só campos lidos, faltantes e avisos.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(import.meta.url), '../../..');
const { decodePvsystBytes, parsePvsystFile } = await import(
  join(root, 'packages/solar-engine/dist/index.js')
);

const dir = process.argv[2];
if (!dir) {
  console.error('Uso: node tools/pan-ond-audit/audit.mjs <pasta>');
  process.exit(2);
}

const files = readdirSync(dir)
  .filter((f) => ['.pan', '.ond'].includes(extname(f).toLowerCase()))
  .sort();
let ok = 0;
const lines = [];
for (const file of files) {
  try {
    const r = parsePvsystFile(decodePvsystBytes(readFileSync(join(dir, file))));
    const complete = r.missing.length === 0;
    if (complete) ok += 1;
    lines.push(`### ${file}`, '');
    lines.push(`- ${r.kind === 'MODULE' ? 'Módulo' : 'Inversor'}: ${r.manufacturer} · ${r.model}`);
    lines.push(`- Campos lidos: ${Object.keys(r.spec).length}`);
    lines.push(`- Faltando: ${r.missing.length ? r.missing.join(', ') : 'nenhum'}`);
    const low = Object.entries(r.fieldConfidence)
      .filter(([, level]) => level === 'LOW')
      .map(([field]) => field);
    lines.push(`- Confiança baixa: ${low.length ? low.join(', ') : 'nenhum'}`);
    for (const note of r.notes) lines.push(`- Aviso: ${note}`);
    lines.push('');
  } catch (error) {
    lines.push(`### ${file}`, '', `- ERRO: ${error instanceof Error ? error.message : error}`, '');
  }
}
const pct = files.length ? Math.round((ok / files.length) * 100) : 0;
console.log(`# Auditoria .PAN/.OND\n`);
console.log(
  `Arquivos: ${files.length} · lidos com todos os campos obrigatórios: ${ok} (${pct}%)\n`,
);
console.log(lines.join('\n'));
