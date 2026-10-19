/**
 * Cores base da marca Voltex SolTech, extraídas do logo oficial.
 * São a fonte de verdade: `styles.css` deriva delas todos os tokens (e `theme.test.ts` confere a igualdade).
 */
export const BRAND_COLORS = {
  /** Azul-marinho: fundo e cor principal. */
  navy: '#002362',
  /** Ciano: destaque. Só tem 1,5:1 de contraste sobre branco; em fundo claro use `cyanStrong`. */
  cyan: '#8CDDF4',
  /** Gelo: texto e superfícies claras sobre o marinho. */
  ice: '#E3EBF0',
  /** Ciano derivado (mesma matiz) com contraste de 5:1 sobre branco. */
  cyanStrong: '#007A96',
} as const;

export type BrandColor = keyof typeof BRAND_COLORS;
