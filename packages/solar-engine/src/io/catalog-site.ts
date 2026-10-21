/**
 * Leitura da listagem pública de downloads (fichas técnicas e manuais) de uma distribuidora. Função pura: recebe o
 * HTML de uma página e devolve os documentos. A busca na internet fica no servidor; aqui só se interpreta a página.
 */
export interface CatalogSiteDocument {
  /** `Datasheet`, `Manual`... como a página rotula. */
  docType: string;
  title: string;
  brand: string;
  pdfUrl: string;
  productUrl: string | null;
  /** Palpite pelo título (a pessoa confere na prévia). */
  equipmentHint: 'MODULE' | 'INVERTER' | 'OTHER';
}

const decode = (text: string): string =>
  text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export function equipmentHint(title: string): CatalogSiteDocument['equipmentHint'] {
  const t = title.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (/\b(microinversor|inversor)\b/.test(t)) return 'INVERTER';
  if (/\b(modulo|painel)\b/.test(t)) return 'MODULE';
  return 'OTHER';
}

export function parseCatalogSiteDownloads(html: string, baseUrl: string): CatalogSiteDocument[] {
  const documents: CatalogSiteDocument[] = [];
  for (const row of html.match(/<tr[\s>][\s\S]*?<\/tr>/gi) ?? []) {
    const docType = /<p[^>]*font-weight-bold[^>]*>([\s\S]*?)<\/p>/i.exec(row)?.[1];
    const title = /<p[^>]*text-muted[^>]*>([\s\S]*?)<\/p>/i.exec(row)?.[1];
    const brand = /<\/td>\s*<td>([\s\S]*?)<\/td>/i.exec(row)?.[1];
    const hrefs = [...row.matchAll(/href="([^"]+)"/gi)].map((m) => m[1] as string);
    const pdf = hrefs.find((h) => /\.pdf(\?|$)/i.test(h));
    if (!docType || !title || !pdf) continue;
    const absolute = (href: string) => new URL(decode(href), baseUrl).toString();
    const product = hrefs.find((h) => /\/produto\//i.test(h));
    documents.push({
      docType: decode(docType),
      title: decode(title),
      brand: decode(brand ?? ''),
      pdfUrl: absolute(pdf),
      productUrl: product ? absolute(product) : null,
      equipmentHint: equipmentHint(decode(title)),
    });
  }
  return documents;
}
