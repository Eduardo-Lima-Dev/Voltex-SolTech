/**
 * Reconstrução de linhas e colunas a partir dos itens de texto de um PDF (posição de cada pedaço de texto).
 * Fichas técnicas trazem uma coluna por modelo: sem a posição horizontal não dá para saber de qual modelo é cada valor.
 * Função pura (não lê o PDF): o chamador entrega os itens da camada de texto.
 */
export interface PdfTextItem {
  text: string;
  /** Posição do canto esquerdo e da linha de base, em pontos do PDF. */
  x: number;
  y: number;
  width: number;
}

export interface LayoutCell {
  text: string;
  x0: number;
  x1: number;
}

export interface LayoutLine {
  cells: LayoutCell[];
}

/** Itens da mesma linha têm a base a menos de 3 pt de distância; lacunas maiores que 9 pt separam colunas. */
const LINE_TOLERANCE = 3;
const COLUMN_GAP = 9;

export function buildLayoutLines(items: readonly PdfTextItem[]): LayoutLine[] {
  const usable = items.filter((item) => item.text.trim() !== '');
  // Do topo para baixo (y maior = mais acima no PDF).
  const sorted = [...usable].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: PdfTextItem[][] = [];
  for (const item of sorted) {
    const row = rows.find((r) => Math.abs((r[0] as PdfTextItem).y - item.y) <= LINE_TOLERANCE);
    if (row) row.push(item);
    else rows.push([item]);
  }
  return rows.map((row) => {
    const cells: LayoutCell[] = [];
    for (const item of [...row].sort((a, b) => a.x - b.x)) {
      const last = cells[cells.length - 1];
      if (last && item.x - last.x1 <= COLUMN_GAP) {
        last.text = `${last.text}${item.x - last.x1 > 1 ? ' ' : ''}${item.text.trim()}`;
        last.x1 = item.x + item.width;
      } else cells.push({ text: item.text.trim(), x0: item.x, x1: item.x + item.width });
    }
    return { cells };
  });
}
