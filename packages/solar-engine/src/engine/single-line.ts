import type { EngineeringDesign, EngineeringResults } from '@voltex/shared';

/** Unifilar preliminar (9I): deliberadamente marcado como rascunho, não substitui projeto assinado. */
export const SINGLE_LINE_ALGORITHM_VERSION = 'single-line-1.0.0';

const esc = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] as string,
  );

export function singleLineSvg(design: EngineeringDesign, results: EngineeringResults): string {
  const inverters =
    design.inverters.map((entry, index) => `INV ${index + 1}`).join(' · ') || 'INVERSOR A DEFINIR';
  const strings = design.inverters.reduce(
    (sum, entry) =>
      sum +
      entry.mppts.reduce(
        (acc, mppt) => acc + mppt.strings.reduce((n, group) => n + group.parallel, 0),
        0,
      ),
    0,
  );
  const protections =
    results.protection.items
      .filter((item) => item.outcome === 'OK')
      .map((item) => item.role)
      .join(', ') || 'PENDENTE';
  const title = `Sistema FV — ${results.totals.powerKwp ?? '—'} kWp`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="480" viewBox="0 0 1200 480" role="img" aria-label="Diagrama unifilar preliminar"><style>text{font:16px Arial;fill:#16232f}.box{fill:#f8fafc;stroke:#16232f;stroke-width:2}.wire{stroke:#16232f;stroke-width:3}.note{font-size:13px;fill:#7f1d1d}</style><text x="40" y="45" font-weight="bold">${esc(title)}</text><text class="note" x="40" y="75">RASCUNHO PARA REVISÃO — não substitui projeto elétrico assinado.</text><rect class="box" x="40" y="180" width="190" height="100" rx="8"/><text x="60" y="220">ARRANJO FV</text><text x="60" y="248">${strings} string(s)</text><line class="wire" x1="230" y1="230" x2="330" y2="230"/><rect class="box" x="330" y="180" width="220" height="100" rx="8"/><text x="350" y="220">STRING BOX / CC</text><text x="350" y="248">${esc(protections)}</text><line class="wire" x1="550" y1="230" x2="650" y2="230"/><rect class="box" x="650" y="180" width="190" height="100" rx="8"/><text x="670" y="220">${esc(inverters)}</text><text x="670" y="248">CONVERSÃO CC/CA</text><line class="wire" x1="840" y1="230" x2="940" y2="230"/><rect class="box" x="940" y="180" width="210" height="100" rx="8"/><text x="960" y="220">QUADRO / REDE</text><text x="960" y="248">CONEXÃO A REVISAR</text></svg>`;
}

/** DXF ASCII mínimo: caixas e textos, pronto para o RT complementar no CAD. */
export function singleLineDxf(design: EngineeringDesign, results: EngineeringResults): string {
  const label = `RASCUNHO FV ${results.totals.powerKwp ?? '?'} kWp — NÃO ASSINAR`;
  const text = (x: number, y: number, value: string) =>
    `0\nTEXT\n8\nVOLTEXT\n10\n${x}\n20\n${y}\n40\n5\n1\n${value}\n`;
  const line = (x1: number, y1: number, x2: number, y2: number) =>
    `0\nLINE\n8\nVOLTEXT\n10\n${x1}\n20\n${y1}\n11\n${x2}\n21\n${y2}\n`;
  void design;
  return `0\nSECTION\n2\nENTITIES\n${text(0, 40, label)}${text(0, 20, 'ARRANJO FV')}${line(60, 20, 110, 20)}${text(115, 20, 'STRING BOX')}${line(190, 20, 240, 20)}${text(245, 20, 'INVERSOR')}${line(320, 20, 370, 20)}${text(375, 20, 'QUADRO / REDE')}0\nENDSEC\n0\nEOF\n`;
}
