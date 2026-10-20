/**
 * Apoio à vigilância de fontes (páginas de normas, resoluções, leis): extrai o texto, normaliza e resume a
 * diferença entre duas coletas. Puro e sem rede. A decisão sobre o que a mudança significa é sempre humana.
 */
export const WATCH_IO_VERSION = 'watch-io-1.0.0';

const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
};

/** Texto visível de uma página HTML (sem scripts, estilos e comentários). */
export function htmlToText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|br)\s*>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:nbsp|amp|lt|gt|quot|apos|#39);/g, (entity) => ENTITIES[entity] ?? ' ');
}

/** Espaços colapsados, linhas aparadas e sem linhas vazias: duas coletas iguais dão o mesmo texto. */
export function normalizeText(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

export interface TextDiff {
  added: string[];
  removed: string[];
  addedCount: number;
  removedCount: number;
  changed: boolean;
}

const MAX_LINES = 40;

/**
 * Diferença por linhas, ignorando a ordem (multiconjunto): suficiente para avisar "o que entrou e o que saiu" numa
 * norma. Mostra até 40 linhas de cada lado; as contagens são completas.
 */
export function diffLines(before: string, after: string): TextDiff {
  const count = (text: string): Map<string, number> => {
    const map = new Map<string, number>();
    for (const line of text.split('\n').filter(Boolean)) map.set(line, (map.get(line) ?? 0) + 1);
    return map;
  };
  const a = count(before);
  const b = count(after);
  const added: string[] = [];
  const removed: string[] = [];
  for (const [line, n] of b) for (let i = 0; i < n - (a.get(line) ?? 0); i++) added.push(line);
  for (const [line, n] of a) for (let i = 0; i < n - (b.get(line) ?? 0); i++) removed.push(line);
  return {
    added: added.slice(0, MAX_LINES),
    removed: removed.slice(0, MAX_LINES),
    addedCount: added.length,
    removedCount: removed.length,
    changed: added.length > 0 || removed.length > 0,
  };
}
