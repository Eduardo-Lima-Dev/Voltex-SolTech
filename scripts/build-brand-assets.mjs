#!/usr/bin/env node
/**
 * Gera os ativos de marca a partir do logo original (docs/assets/brand/voltex-soltech-logo-original.svg):
 *  - packages/ui/src/assets/logo-paths.ts   (paths usados pelo componente <Logo />)
 *  - docs/assets/brand/*.svg e *.png        (variantes para fundo escuro/claro, favicon, ícones)
 *  - apps/web/public/                       (favicon e ícones copiados)
 * Rode `node scripts/build-brand-assets.mjs` sempre que o logo original mudar. Os PNGs exigem `rsvg-convert`.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const brandDir = `${root}docs/assets/brand`;
const SOURCE = `${brandDir}/voltex-soltech-logo-original.svg`;

const COLORS = {
  navy: '#002362',
  cyan: '#8CDDF4',
  ice: '#E3EBF0',
  /** Ciano com contraste >= 4,5:1 sobre branco (o ciano da marca só tem 1,5:1). Mesma matiz do ciano. */
  cyanStrong: '#007A96',
};

// ---------- leitura do SVG original ----------
const svg = readFileSync(SOURCE, 'utf8').replace(/<metadata>[\s\S]*?<\/metadata>/, '');
const raw = [...svg.matchAll(/<path fill="(#[0-9A-Fa-f]{6})" d="([^"]+)"/g)].map(([, fill, d]) => ({
  fill: fill.toUpperCase(),
  d,
  box: bbox(d),
}));

function bbox(d) {
  const n = [...d.matchAll(/-?\d+\.?\d*/g)].map((m) => Number(m[0]));
  const xs = n.filter((_, i) => i % 2 === 0);
  const ys = n.filter((_, i) => i % 2 === 1);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}
const area = (b) => (b.x1 - b.x0) * (b.y1 - b.y0);
const inside = (inner, outer) =>
  inner.x0 >= outer.x0 && inner.x1 <= outer.x1 && inner.y0 >= outer.y0 && inner.y1 <= outer.y1;

// ---------- classificação ----------
const shapes = raw.filter(
  (p) => !(p.fill === COLORS.navy.toUpperCase() && p.box.x0 === 0 && p.box.y0 === 0),
);
const holes = shapes.filter((p) => p.fill === COLORS.navy.toUpperCase());
const solids = shapes.filter((p) => p.fill !== COLORS.navy.toUpperCase());

// Os "furos" (miolo de O, o, e) estão desenhados em azul-marinho por cima da letra. Fundimos cada um
// ao seu path com `evenodd`, para o logo ter um corte de verdade e funcionar sobre qualquer fundo.
for (const hole of holes) {
  const parent = solids
    .filter((s) => inside(hole.box, s.box))
    .sort((a, b) => area(a.box) - area(b.box))[0];
  if (!parent) throw new Error('furo sem path pai: ' + JSON.stringify(hole.box));
  parent.d = `${parent.d} ${hole.d}`;
}

const MARK_MAX_X = 535; // o símbolo termina antes do texto
const role = (fill) => (fill === COLORS.ice.toUpperCase() ? 'primary' : 'accent');
const group = (list) => ({
  primary: list.filter((p) => role(p.fill) === 'primary').map((p) => p.d),
  accent: list.filter((p) => role(p.fill) === 'accent').map((p) => p.d),
});
const markShapes = solids.filter((p) => p.box.x1 <= MARK_MAX_X);
const wordShapes = solids.filter((p) => p.box.x1 > MARK_MAX_X);
const mark = group(markShapes);
const word = group(wordShapes);

const union = (list) => ({
  x0: Math.min(...list.map((p) => p.box.x0)),
  x1: Math.max(...list.map((p) => p.box.x1)),
  y0: Math.min(...list.map((p) => p.box.y0)),
  y1: Math.max(...list.map((p) => p.box.y1)),
});
const PAD = 2;
const vb = (b) => ({
  x: Math.floor(b.x0) - PAD,
  y: Math.floor(b.y0) - PAD,
  w: Math.ceil(b.x1 - b.x0) + 2 * PAD,
  h: Math.ceil(b.y1 - b.y0) + 2 * PAD,
});
const fullBox = vb(union(solids));
const markBox = vb(union(markShapes));

// ---------- componente React ----------
const tsLiteral = (value) => JSON.stringify(value, null, 2);
writeFileSync(
  `${root}packages/ui/src/assets/logo-paths.ts`,
  `// GERADO por scripts/build-brand-assets.mjs a partir do logo original. Não edite à mão.
export const LOGO_VIEWBOX = {
  full: '${fullBox.x} ${fullBox.y} ${fullBox.w} ${fullBox.h}',
  mark: '${markBox.x} ${markBox.y} ${markBox.w} ${markBox.h}',
} as const;

/** \`primary\`: cor principal (gelo no fundo escuro). \`accent\`: destaque (ciano). Todos os paths usam fill-rule evenodd. */
export const LOGO_PATHS = ${tsLiteral({ mark, word })} as const;
`,
);

// ---------- arquivos SVG ----------
const paths = (g, primary, accent) =>
  [
    ...g.primary.map((d) => `<path fill="${primary}" fill-rule="evenodd" d="${d}"/>`),
    ...g.accent.map((d) => `<path fill="${accent}" fill-rule="evenodd" d="${d}"/>`),
  ].join('');
const both = {
  primary: [...mark.primary, ...word.primary],
  accent: [...mark.accent, ...word.accent],
};
const doc = (box, body, bg = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box.x} ${box.y} ${box.w} ${box.h}" role="img" aria-label="Voltex SolTech">${bg}${body}</svg>\n`;

mkdirSync(brandDir, { recursive: true });
const files = {
  'logo-horizontal.svg': doc(fullBox, paths(both, COLORS.ice, COLORS.cyan)),
  'logo-horizontal-on-light.svg': doc(fullBox, paths(both, COLORS.navy, COLORS.cyanStrong)),
  'logo-mark.svg': doc(markBox, paths(mark, COLORS.ice, COLORS.cyan)),
  'logo-mark-on-light.svg': doc(markBox, paths(mark, COLORS.navy, COLORS.cyanStrong)),
};
// Banner (marca sobre azul-marinho) para README e pré-visualizações.
const BANNER_PAD = 90;
const banner = {
  x: fullBox.x - BANNER_PAD,
  y: fullBox.y - BANNER_PAD,
  w: fullBox.w + 2 * BANNER_PAD,
  h: fullBox.h + 2 * BANNER_PAD,
};
files['logo-banner.svg'] = doc(
  banner,
  paths(both, COLORS.ice, COLORS.cyan),
  `<rect x="${banner.x}" y="${banner.y}" width="${banner.w}" height="${banner.h}" fill="${COLORS.navy}"/>`,
);

// Ícone: símbolo centralizado num quadrado arredondado azul-marinho (grade 64x64).
const scale = 44 / markBox.w;
const cx = markBox.x + markBox.w / 2;
const cy = markBox.y + markBox.h / 2;
files['favicon.svg'] =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Voltex SolTech"><rect width="64" height="64" rx="14" fill="${COLORS.navy}"/>` +
  `<g transform="translate(${(32 - cx * scale).toFixed(3)} ${(32 - cy * scale).toFixed(3)}) scale(${scale.toFixed(5)})">${paths(mark, COLORS.ice, COLORS.cyan)}</g></svg>\n`;

// Uma cor só (impressos, carimbos, documentos em preto e branco, e-mails): o símbolo e o nome na mesma cor.
files['logo-horizontal-mono-navy.svg'] = doc(fullBox, paths(both, COLORS.navy, COLORS.navy));
files['logo-horizontal-mono-white.svg'] = doc(fullBox, paths(both, '#FFFFFF', '#FFFFFF'));
files['logo-mark-mono-navy.svg'] = doc(markBox, paths(mark, COLORS.navy, COLORS.navy));

// Ícone "mascarável" (Android/PWA): quadrado de borda a borda, sem cantos arredondados, e o símbolo dentro da
// zona segura (círculo de 80% do lado), porque o sistema recorta o ícone no formato que quiser.
const halfDiagonal = Math.hypot(markBox.w / 2, markBox.h / 2);
const safeScale = (64 * 0.4) / halfDiagonal;
files['icon-maskable.svg'] =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Voltex SolTech"><rect width="64" height="64" fill="${COLORS.navy}"/>` +
  `<g transform="translate(${(32 - cx * safeScale).toFixed(3)} ${(32 - cy * safeScale).toFixed(3)}) scale(${safeScale.toFixed(5)})">${paths(mark, COLORS.ice, COLORS.cyan)}</g></svg>\n`;

// Grade de construção do símbolo: linhas nas coordenadas reais das pontas e dos vértices das asas, eixo de simetria
// e o contorno do símbolo. Serve de fundo técnico (engenharia), em `currentColor` para pegar a cor do contexto.
const allMark = [...mark.primary, ...mark.accent];
const nums = (d) => [...d.matchAll(/-?\d+\.?\d*/g)].map((m) => Number(m[0]));
const keyValues = (axis) => {
  const values = allMark.flatMap((d) => {
    const n = nums(d).filter((_, i) => i % 2 === axis);
    return [Math.min(...n), Math.max(...n)];
  });
  const picked = [];
  for (const v of [...values].sort((a, b) => a - b))
    if (!picked.length || v - picked[picked.length - 1] > 14) picked.push(v);
  return picked;
};
const gx = keyValues(0);
const gy = keyValues(1);
const GP = 46; // quanto a grade passa do símbolo
const gbox = {
  x: markBox.x - GP,
  y: markBox.y - GP,
  w: markBox.w + 2 * GP,
  h: markBox.h + 2 * GP,
};
const gridLines = [
  ...gx.map((x) => `<path d="M${x.toFixed(1)} ${gbox.y}V${gbox.y + gbox.h}"/>`),
  ...gy.map((y) => `<path d="M${gbox.x} ${y.toFixed(1)}H${gbox.x + gbox.w}"/>`),
].join('');
files['brand-grid.svg'] =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${gbox.x} ${gbox.y} ${gbox.w} ${gbox.h}" role="img" aria-label="Símbolo Voltex SolTech sobre grade de construção">` +
  `<g fill="none" stroke="currentColor" stroke-width="1" opacity="0.55">${gridLines}</g>` +
  `<path d="M${(markBox.x + markBox.w / 2).toFixed(1)} ${gbox.y}V${gbox.y + gbox.h}" fill="none" stroke="currentColor" stroke-width="1" stroke-dasharray="5 6" opacity="0.8"/>` +
  `<g fill="currentColor" fill-opacity="0.14" stroke="currentColor" stroke-width="1.5" fill-rule="evenodd">${allMark.map((d) => `<path d="${d}"/>`).join('')}</g></svg>\n`;

// Para usar em <img> ou CSS, onde `currentColor` não vale: a mesma grade já em ciano.
files['brand-grid-cyan.svg'] = files['brand-grid.svg'].replaceAll('currentColor', COLORS.cyan);

for (const [name, content] of Object.entries(files)) writeFileSync(`${brandDir}/${name}`, content);

// ---------- PNGs (opcional: exige rsvg-convert) ----------
const png = (src, out, width) =>
  execFileSync('rsvg-convert', [
    '-w',
    String(width),
    `${brandDir}/${src}`,
    '-o',
    `${brandDir}/${out}`,
  ]);
try {
  png('favicon.svg', 'favicon-32.png', 32);
  png('favicon.svg', 'apple-touch-icon.png', 180);
  png('favicon.svg', 'icon-192.png', 192);
  png('favicon.svg', 'icon-512.png', 512);
  png('logo-horizontal.svg', 'logo-horizontal.png', 960);
  png('logo-banner.svg', 'logo-banner.png', 1280);
  png('icon-maskable.svg', 'icon-maskable-512.png', 512);
  png('logo-horizontal-on-light.svg', 'logo-horizontal-on-light.png', 720);
  png('logo-horizontal-mono-navy.svg', 'logo-horizontal-mono-navy.png', 720);
} catch {
  console.warn('[brand] rsvg-convert não encontrado: PNGs não foram gerados (os SVGs sim).');
}

// ---------- cópia para os apps ----------
for (const app of ['web', 'site']) {
  const dest = `${root}apps/${app}/public`;
  mkdirSync(dest, { recursive: true });
  for (const f of [
    'brand-grid-cyan.svg',
    'favicon.svg',
    'favicon-32.png',
    'apple-touch-icon.png',
    'icon-192.png',
    'icon-512.png',
  ]) {
    if (existsSync(`${brandDir}/${f}`)) copyFileSync(`${brandDir}/${f}`, `${dest}/${f}`);
  }
  if (existsSync(`${brandDir}/icon-maskable-512.png`))
    copyFileSync(`${brandDir}/icon-maskable-512.png`, `${dest}/icon-maskable-512.png`);
}

console.log(
  `[brand] ${Object.keys(files).length} SVGs + logo-paths.ts gerados (símbolo: ${markShapes.length} paths, texto: ${wordShapes.length} paths, furos fundidos: ${holes.length}).`,
);
