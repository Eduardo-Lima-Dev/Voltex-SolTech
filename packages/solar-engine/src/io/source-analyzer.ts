/**
 * Analisador de páginas de fontes de equipamentos: dado o HTML de uma página (ou só o endereço de um arquivo), acha os
 * arquivos que o sistema sabe ler (PDF, CSV, PAN, OND), entende o que cada um parece ser (tipo de documento, tipo de
 * equipamento, marca) e aponta as páginas seguintes da listagem. Função pura: a busca na internet é do servidor.
 * É heurística, sempre com a confiança e os motivos: a pessoa decide o que importar.
 */
export const SOURCE_ANALYZER_VERSION = 'source-analyzer-1.0.0';

export const SOURCE_FILE_TYPES = ['pdf', 'csv', 'pan', 'ond'] as const;
export type SourceFileType = (typeof SOURCE_FILE_TYPES)[number];
export type SourceDocType = 'DATASHEET' | 'MANUAL' | 'CERTIFICATE' | 'SPREADSHEET' | 'FILE';
export type SourceEquipmentHint =
  | 'MODULE'
  | 'INVERTER'
  | 'PROTECTION'
  | 'CABLE'
  | 'BATTERY'
  | 'CHARGE_CONTROLLER'
  | 'GENERATOR'
  | 'OTHER';

export interface AnalyzedDocument {
  url: string;
  fileType: SourceFileType;
  title: string;
  brand: string;
  docType: SourceDocType;
  equipmentHint: SourceEquipmentHint;
  /** Onde foi encontrado (página da listagem) e a página do produto, se houver. */
  pageUrl: string;
  productUrl: string | null;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  /** Por que o algoritmo chegou a essa classificação (mostrado na tela). */
  reasons: string[];
}

export interface AnalyzedPage {
  documents: AnalyzedDocument[];
  /** Endereços de paginação da mesma listagem (a coleta decide quantos seguir). */
  nextPages: string[];
}

const NAMED_ENTITIES: Record<string, string> = {
  aacute: 'á',
  eacute: 'é',
  iacute: 'í',
  oacute: 'ó',
  uacute: 'ú',
  Aacute: 'Á',
  Eacute: 'É',
  Iacute: 'Í',
  Oacute: 'Ó',
  Uacute: 'Ú',
  atilde: 'ã',
  otilde: 'õ',
  Atilde: 'Ã',
  Otilde: 'Õ',
  acirc: 'â',
  ecirc: 'ê',
  ocirc: 'ô',
  Acirc: 'Â',
  Ecirc: 'Ê',
  Ocirc: 'Ô',
  agrave: 'à',
  ccedil: 'ç',
  Ccedil: 'Ç',
  uuml: 'ü',
  ordm: 'º',
  ordf: 'ª',
  deg: '°',
  ndash: '–',
  mdash: '—',
  bull: '•',
  copy: '©',
  reg: '®',
};

const decode = (text: string): string =>
  text
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-zA-Z]+);/g, (m, name: string) => NAMED_ENTITIES[name] ?? m)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const strip = (text: string): string => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function fileTypeOf(url: string): SourceFileType | null {
  const path = url.split(/[?#]/)[0] ?? '';
  const ext = /\.([a-z0-9]{2,4})$/i.exec(path)?.[1]?.toLowerCase();
  return (SOURCE_FILE_TYPES as readonly string[]).includes(ext ?? '')
    ? (ext as SourceFileType)
    : null;
}

const GENERIC_LINK_TEXT =
  /^(baixar|download|pdf|ver|abrir|clique aqui|saiba mais|mais|arquivo|link|datasheet|manual|ficha|ficha tecnica|\.pdf|csv)$/i;

const BRANDS = [
  'Canadian Solar',
  'Jinko',
  'JA Solar',
  'Trina',
  'Longi',
  'Risen',
  'Astronergy',
  'Hanersun',
  'DAH Solar',
  'Resun',
  'Sunova',
  'Znshine',
  'Seraphim',
  'Q CELLS',
  'Hanwha',
  'BYD',
  'Huawei',
  'Sungrow',
  'Growatt',
  'Fronius',
  'Solis',
  'Deye',
  'Goodwe',
  'SMA',
  'Sofar',
  'Livoltek',
  'Chint',
  'CSI Solar',
  'Hopewind',
  'Hoymiles',
  'APsystems',
  'SAJ',
  'Intelbras',
  'WEG',
  'Refusol',
  'Fimer',
  'Kstar',
  'Solax',
  'Hyxipower',
  'Prysmian',
  'Nexans',
  'Corfio',
  'Cobrecom',
  'Sil',
  'Siemens',
  'Schneider',
  'Steck',
  'Clamper',
  'Mersen',
  'Phoenix Contact',
  'ABB',
  'Eaton',
  'Legrand',
  'Mente',
];

const brandIn = (text: string): string | null => {
  const t = strip(text);
  for (const brand of BRANDS) {
    const b = strip(brand);
    if (new RegExp(`(^|[^a-z0-9])${b.replace(/\s+/g, '\\s+')}([^a-z0-9]|$)`).test(t)) return brand;
  }
  return null;
};

export function classifyDocument(input: { title: string; url: string; context?: string }): {
  docType: SourceDocType;
  equipmentHint: SourceEquipmentHint;
  brand: string;
  reasons: string[];
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
} {
  const file = fileTypeOf(input.url);
  const name = decodeURIComponent((input.url.split(/[?#]/)[0] ?? '').split('/').pop() ?? '');
  const text = strip(`${input.title} ${name} ${input.context ?? ''}`);
  const reasons: string[] = [];
  let score = 0;

  let docType: SourceDocType = 'FILE';
  if (file === 'pan' || file === 'ond') {
    docType = 'DATASHEET';
    reasons.push(`Arquivo .${file.toUpperCase()} (ficha do PVsyst)`);
    score += 2;
  } else if (/(certificad|registro inmetro|portaria|inmetro)/.test(text)) {
    docType = 'CERTIFICATE';
    reasons.push('Fala em certificado/registro');
    score += 1;
  } else if (/(manual|guia de instala|guia rapido|installation|user guide|instrucoes)/.test(text)) {
    docType = 'MANUAL';
    reasons.push('Palavras de manual/guia');
    score += 1;
  } else if (
    /(datasheet|data sheet|ficha tecnica|folha de dados|especifica|ficha de dados|ficha tec)/.test(
      text,
    )
  ) {
    docType = 'DATASHEET';
    reasons.push('Palavras de ficha técnica/datasheet');
    score += 2;
  } else if (file === 'csv') {
    docType = 'SPREADSHEET';
    reasons.push('Planilha CSV');
    score += 1;
  }

  let equipmentHint: SourceEquipmentHint = 'OTHER';
  if (file === 'pan') equipmentHint = 'MODULE';
  else if (file === 'ond') equipmentHint = 'INVERTER';
  else if (
    /(controlador de carga|charge controller|regulador de carga|\bmppt\b.*\bcontrol)/.test(text)
  )
    equipmentHint = 'CHARGE_CONTROLLER';
  else if (/(bateria|battery|estacionaria|lifepo4|\bopzs\b|\bopzv\b)/.test(text))
    equipmentHint = 'BATTERY';
  else if (/(gerador|generator|grupo gerador)/.test(text)) equipmentHint = 'GENERATOR';
  else if (/(microinversor|micro-inversor|inversor|inverter)/.test(text))
    equipmentHint = 'INVERTER';
  else if (/(modulo|painel|panel|module|\bpv\b|fotovoltaic[oa] \d)/.test(text))
    equipmentHint = 'MODULE';
  else if (/(\bcabo\b|cable|condutor|\bawg\b|mm2)/.test(text)) equipmentHint = 'CABLE';
  else if (
    /(disjuntor|dps|fusivel|fusible|seccionador|string box|breaker|surge|\bdr\b|protecao|protetor)/.test(
      text,
    )
  )
    equipmentHint = 'PROTECTION';
  if (equipmentHint !== 'OTHER') {
    reasons.push(`Tipo de equipamento "${equipmentHint}" pelo texto`);
    score += 1;
  }

  // A marca do título/arquivo vale mais que a do texto ao redor (que pode ser de outro item da lista).
  const brand = brandIn(`${input.title} ${name}`) ?? brandIn(input.context ?? '') ?? '';
  if (brand) {
    reasons.push(`Marca "${brand}" reconhecida`);
    score += 1;
  }
  return {
    docType,
    equipmentHint,
    brand,
    reasons,
    confidence: score >= 4 ? 'HIGH' : score >= 2 ? 'MEDIUM' : 'LOW',
  };
}

const PAGINATION_TEXT = /^(proxima|próxima|next|seguinte|»|›|>|\d{1,3})$/i;

export function analyzeSourcePage(html: string, pageUrl: string): AnalyzedPage {
  const documents: AnalyzedDocument[] = [];
  const nextPages = new Set<string>();
  const seen = new Set<string>();
  const page = new URL(pageUrl);
  const absolute = (href: string): string | null => {
    try {
      const u = new URL(decode(href).replace(/\s/g, '%20'), pageUrl);
      return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
    } catch {
      return null;
    }
  };

  // Cabeçalhos de tabela: de onde sai a coluna da marca.
  const headers = [...html.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map((m) =>
    strip(decode(m[1] ?? '')),
  );
  const brandColumn = headers.findIndex((h) => /^(marca|fabricante|brand|manufacturer)$/.test(h));

  for (const match of html.matchAll(/<a\b([^>]*?)href\s*=\s*"([^"]+)"([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = `${match[1] ?? ''} ${match[3] ?? ''}`;
    const href = match[2] ?? '';
    const url = absolute(href);
    if (!url) continue;
    const text = decode(match[4] ?? '');
    const index = match.index ?? 0;

    const file = fileTypeOf(url);
    if (!file) {
      // Paginação da mesma listagem (mesmo servidor).
      const u = new URL(url);
      const looksPaged =
        /rel\s*=\s*"next"/i.test(attrs) ||
        (u.hostname === page.hostname &&
          u.pathname === page.pathname &&
          /(^|&)(page|pagina|p|pg)=\d+/i.test(u.search)) ||
        (u.hostname === page.hostname &&
          PAGINATION_TEXT.test(strip(text)) &&
          /page|pagina|\/p\/\d+/i.test(u.href));
      if (looksPaged && u.toString() !== page.toString()) nextPages.add(u.toString());
      continue;
    }
    if (seen.has(url)) continue;
    seen.add(url);

    // Contexto: a linha da tabela ou, sem tabela, o trecho de texto ao redor do link.
    const before = html.lastIndexOf('<tr', index);
    const rowEnd = html.indexOf('</tr>', index);
    const inRow =
      before !== -1 &&
      rowEnd !== -1 &&
      rowEnd - before < 6000 &&
      !html.slice(before, index).includes('</tr>');
    const rowHtml = inRow ? html.slice(before, rowEnd) : '';
    const cells = inRow
      ? [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => decode(m[1] ?? ''))
      : [];
    const around = inRow ? decode(rowHtml) : decode(html.slice(Math.max(0, index - 250), index));
    const rowLinks = inRow
      ? [...rowHtml.matchAll(/href\s*=\s*"([^"]+)"/gi)].map((m) => absolute(m[1] ?? ''))
      : [];
    const productUrl =
      rowLinks.find((l): l is string => !!l && !fileTypeOf(l) && /produto|product/i.test(l)) ??
      null;

    const titleAttr = /title\s*=\s*"([^"]+)"/i.exec(attrs)?.[1];
    const description = cells.find(
      (c) => c.length > 8 && !GENERIC_LINK_TEXT.test(strip(c)) && c !== text,
    );
    const fromFile = decodeURIComponent(
      (url.split(/[?#]/)[0] ?? '').split('/').pop() ?? '',
    ).replace(/\.[a-z0-9]+$/i, '');
    const title =
      (text && !GENERIC_LINK_TEXT.test(strip(text)) && text.length > 3 ? text : '') ||
      (titleAttr ? decode(titleAttr) : '') ||
      description ||
      fromFile;

    // Descrição da linha (ex.: `Datasheet` + nome do produto) entra no contexto e, se melhor que o texto do link, no título.
    const better = description && title === fromFile ? description : title;
    // Marca: pela coluna "Marca/Fabricante" quando o cabeçalho e a linha têm o mesmo número de colunas; senão, pela
    // célula curta que tem uma marca conhecida.
    const byColumn =
      brandColumn >= 0 && headers.length === cells.length ? cells[brandColumn] : undefined;
    const brandCell =
      byColumn && byColumn.length < 40 && !GENERIC_LINK_TEXT.test(strip(byColumn))
        ? byColumn
        : cells.find(
            (c) =>
              c.length > 1 &&
              c.length < 30 &&
              c !== better &&
              !GENERIC_LINK_TEXT.test(strip(c)) &&
              brandIn(c) !== null,
          );
    const classified = classifyDocument({
      title: better,
      url,
      context: `${around} ${cells.join(' ')}`,
    });
    const reasons = [...classified.reasons];
    let brand = brandCell && brandCell.length < 40 ? brandCell : classified.brand;
    if (brandCell) reasons.push(`Marca "${brandCell}" na coluna da tabela`);
    if (!brand) brand = '';
    documents.push({
      url,
      fileType: file,
      title: better,
      brand,
      docType: classified.docType,
      equipmentHint: classified.equipmentHint,
      pageUrl,
      productUrl,
      confidence: classified.confidence,
      reasons,
    });
  }
  return { documents, nextPages: [...nextPages] };
}
