import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BRAND_COLORS } from './brand';

const css = readFileSync(path.resolve(__dirname, 'styles.css'), 'utf8');

type Rgb = [number, number, number];

/** OKLCH → sRGB (0–1), conforme a especificação CSS Color 4. */
function oklchToRgb(L: number, C: number, H: number): Rgb {
  const a = C * Math.cos((H * Math.PI) / 180);
  const b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return linear.map((v) => {
    const c = Math.min(1, Math.max(0, v));
    return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  }) as Rgb;
}

const hexToRgb = (hex: string): Rgb => {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as Rgb;
};

const luminance = ([r, g, b]: Rgb): number => {
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

const contrast = (a: Rgb, b: Rgb): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

/** Distância máxima entre canais (0–255) entre duas cores. */
const maxChannelDiff = (a: Rgb, b: Rgb): number =>
  Math.max(...a.map((v, i) => Math.abs(v - (b[i] as number)) * 255));

function readBlock(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  expect(start, `bloco ${selector}`).toBeGreaterThan(-1);
  const body = css.slice(start, css.indexOf('\n}', start));
  const vars: Record<string, string> = {};
  for (const [, name, value] of body.matchAll(/--([\w-]+):\s*([^;]+);/g))
    vars[name as string] = (value as string).trim();
  return vars;
}

function toRgb(value: string): Rgb {
  const oklch = /^oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)$/.exec(value);
  if (oklch) return oklchToRgb(Number(oklch[1]), Number(oklch[2]), Number(oklch[3]));
  if (/^#[0-9a-f]{6}$/i.test(value)) return hexToRgb(value);
  throw new Error(`Valor de cor não suportado no teste: ${value}`);
}

const light = readBlock(':root');
const dark = { ...light, ...readBlock('.dark') };

/** [texto, fundo, contraste mínimo]. 4,5 = WCAG AA para texto; 3 = elementos de interface. */
const PAIRS: [string, string, number][] = [
  ['foreground', 'background', 4.5],
  ['card-foreground', 'card', 4.5],
  ['popover-foreground', 'popover', 4.5],
  ['primary-foreground', 'primary', 4.5],
  ['secondary-foreground', 'secondary', 4.5],
  ['muted-foreground', 'muted', 4.5],
  ['muted-foreground', 'background', 4.5],
  ['muted-foreground', 'card', 4.5],
  ['accent-foreground', 'accent', 4.5],
  ['destructive-foreground', 'destructive', 4.5],
  ['success-foreground', 'success', 4.5],
  ['warning-foreground', 'warning', 4.5],
  ['sidebar-foreground', 'sidebar', 4.5],
  ['sidebar-muted', 'sidebar', 4.5],
  ['sidebar-primary', 'sidebar', 4.5],
  ['sidebar-foreground', 'sidebar-accent', 4.5],
  ['sidebar-primary', 'sidebar-accent', 4.5],
  ['ring', 'background', 3],
  ['logo-primary', 'background', 4.5],
  ['logo-accent', 'background', 4.5],
];

describe('cores base da marca', () => {
  it('as constantes são as cores do logo oficial', () => {
    expect(BRAND_COLORS).toMatchObject({ navy: '#002362', cyan: '#8CDDF4', ice: '#E3EBF0' });
  });

  it('o CSS declara as cores da marca com os mesmos valores', () => {
    expect(light['brand-navy']?.toUpperCase()).toBe(BRAND_COLORS.navy);
    expect(light['brand-cyan']?.toUpperCase()).toBe(BRAND_COLORS.cyan);
    expect(light['brand-ice']?.toUpperCase()).toBe(BRAND_COLORS.ice);
  });

  it('o ciano forte derivado bate com a constante (tolerância de arredondamento)', () => {
    expect(
      maxChannelDiff(
        toRgb(light['brand-cyan-strong'] as string),
        hexToRgb(BRAND_COLORS.cyanStrong),
      ),
    ).toBeLessThanOrEqual(2);
  });

  it('os tokens semânticos são derivados das cores do logo', () => {
    const navy = hexToRgb(BRAND_COLORS.navy);
    const cyan = hexToRgb(BRAND_COLORS.cyan);
    const ice = hexToRgb(BRAND_COLORS.ice);
    expect(maxChannelDiff(toRgb(light['primary'] as string), navy)).toBeLessThanOrEqual(2);
    expect(maxChannelDiff(toRgb(light['foreground'] as string), navy)).toBeLessThanOrEqual(2);
    expect(maxChannelDiff(toRgb(light['sidebar'] as string), navy)).toBeLessThanOrEqual(2);
    expect(maxChannelDiff(toRgb(light['secondary'] as string), ice)).toBeLessThanOrEqual(2);
    expect(maxChannelDiff(toRgb(light['sidebar-primary'] as string), cyan)).toBeLessThanOrEqual(2);
    expect(maxChannelDiff(toRgb(dark['primary'] as string), cyan)).toBeLessThanOrEqual(2);
    expect(maxChannelDiff(toRgb(dark['popover'] as string), navy)).toBeLessThanOrEqual(2);
  });
});

describe.each([
  ['claro', light],
  ['escuro', dark],
])('acessibilidade do tema %s (WCAG AA)', (_name, theme) => {
  it.each(PAIRS)('%s sobre %s tem contraste >= %s', (fg, bg, minimum) => {
    const resolve = (key: string) =>
      toRgb(
        theme[key] ??
          (() => {
            throw new Error(`token ausente: ${key}`);
          })(),
      );
    // logo-* referenciam variáveis da marca: resolve o alias
    const alias = (key: string) => {
      const raw = theme[key];
      return raw?.startsWith('var(') ? (theme[raw.slice(6, -1)] as string) : raw;
    };
    const value = (key: string): Rgb =>
      key.startsWith('logo-') ? toRgb(alias(key) as string) : resolve(key);
    expect(contrast(value(fg), value(bg))).toBeGreaterThanOrEqual(minimum);
  });

  it('define todos os tokens usados pelo Tailwind', () => {
    for (const token of [
      'background',
      'foreground',
      'primary',
      'secondary',
      'muted',
      'accent',
      'destructive',
      'border',
      'input',
      'ring',
      'sidebar',
    ]) {
      expect(theme[token], token).toBeTruthy();
    }
  });
});
