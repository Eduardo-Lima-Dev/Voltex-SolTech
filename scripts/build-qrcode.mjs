/**
 * Gera o QR code da página de links (`/links`) para apresentações, cartões e posts.
 *
 *   node scripts/build-qrcode.mjs [endereço]
 *
 * Padrão: https://voltex-site-one.vercel.app/links com `utm_source=qrcode`, para o lead que chegar pelo QR ficar
 * marcado com essa origem no CRM. Saídas em docs/assets/brand/: `qrcode-links.svg` e, se houver `rsvg-convert`,
 * `qrcode-links.png` (1024 px). O símbolo da marca vai no centro; a correção de erro alta (H) garante a leitura.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
// O pacote `qrcode` já é dependência da aplicação web.
const QRCode = createRequire(`${root}apps/web/package.json`)('qrcode');

const url = process.argv[2] ?? 'https://voltex-site-one.vercel.app/links?utm_source=qrcode';
const brandDir = `${root}docs/assets/brand`;
const NAVY = '#002362';

const qr = QRCode.create(url, { errorCorrectionLevel: 'H' });
const size = qr.modules.size;
const margin = 4;
const total = size + margin * 2;

let modules = '';
for (let y = 0; y < size; y++)
  for (let x = 0; x < size; x++)
    if (qr.modules.get(y, x)) modules += `M${x + margin} ${y + margin}h1v1h-1z`;

// Selo central: ~20% do lado (bem abaixo dos 30% que a correção H recupera).
const badge = Math.round(total * 0.2);
const bx = (total - badge) / 2;
const mark = readFileSync(`${brandDir}/logo-mark.svg`, 'utf8');
const viewBox = mark.match(/viewBox="([^"]+)"/)?.[1] ?? '0 0 100 76';
const inner = mark.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const pad = badge * 0.18;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges">
  <title>QR code: ${url.replace(/&/g, '&amp;')}</title>
  <rect width="${total}" height="${total}" fill="#ffffff"/>
  <path fill="${NAVY}" d="${modules}"/>
  <rect x="${bx}" y="${bx}" width="${badge}" height="${badge}" rx="${badge * 0.2}" fill="${NAVY}" stroke="#ffffff" stroke-width="0.8" shape-rendering="geometricPrecision"/>
  <svg x="${bx + pad}" y="${bx + pad}" width="${badge - pad * 2}" height="${badge - pad * 2}" viewBox="${viewBox}" shape-rendering="geometricPrecision">${inner}</svg>
</svg>
`;

writeFileSync(`${brandDir}/qrcode-links.svg`, svg);
try {
  execFileSync('rsvg-convert', [
    '-w',
    '1024',
    `${brandDir}/qrcode-links.svg`,
    '-o',
    `${brandDir}/qrcode-links.png`,
  ]);
  console.log(`[qrcode] ${url} → qrcode-links.svg e qrcode-links.png`);
} catch {
  console.warn(`[qrcode] ${url} → qrcode-links.svg (sem rsvg-convert: PNG não gerado)`);
}
