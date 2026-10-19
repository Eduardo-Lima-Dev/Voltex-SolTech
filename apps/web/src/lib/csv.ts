/** Leitura de CSV no navegador (arquivos pequenos escolhidos pela pessoa). */

export const normalizeHeader = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase();

/** Divide uma linha respeitando aspas ("Foz do Iguaçu, PR") e aspas duplas escapadas. */
export function splitCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]!;
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      cells.push(current);
      current = '';
    } else current += char;
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

export interface CsvTable {
  delimiter: string;
  /** Cabeçalhos sem acento e em minúsculas. */
  header: string[];
  /** Linhas de dados, com o número da linha no arquivo (cabeçalho = 1). */
  rows: { line: number; cells: string[] }[];
}

/** Lê o texto (com BOM, `;` ou `,`, linhas em branco) em cabeçalho + linhas. */
export function readCsv(text: string): CsvTable {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((raw, index) => ({ raw, line: index + 1 }))
    .filter(({ raw }) => raw.trim() !== '');
  const first = lines[0];
  if (!first) return { delimiter: ';', header: [], rows: [] };
  const delimiter = first.raw.includes(';') ? ';' : ',';
  return {
    delimiter,
    header: splitCsvLine(first.raw, delimiter).map(normalizeHeader),
    rows: lines.slice(1).map(({ raw, line }) => ({ line, cells: splitCsvLine(raw, delimiter) })),
  };
}
