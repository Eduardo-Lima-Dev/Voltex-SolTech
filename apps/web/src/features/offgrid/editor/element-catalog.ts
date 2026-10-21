import type { LayoutElementKind } from '@voltex/shared';

/** Catálogo de objetos do terreno: nome, tamanho típico, cor do desenho simplificado e palavras que o descrevem. */
export interface ElementTypeInfo {
  label: string;
  widthM: number;
  depthM: number;
  heightM: number;
  /** Classes do desenho simplificado (cena SVG sem WebGL). */
  fill: string;
  /** Palavras (sem acento, minúsculas) que identificam o tipo numa descrição. */
  keywords: string[];
}

export const ELEMENT_TYPES: Record<LayoutElementKind, ElementTypeInfo> = {
  HOUSE: {
    label: 'Casa (cargas)',
    widthM: 8,
    depthM: 6,
    heightM: 3.5,
    fill: 'fill-amber-200 stroke-amber-700',
    keywords: ['casa', 'residencia', 'chale', 'moradia', 'sede', 'cabana'],
  },
  POWER_ROOM: {
    label: 'Casa de máquinas',
    widthM: 3,
    depthM: 3,
    heightM: 2.5,
    fill: 'fill-blue-300 stroke-blue-800',
    keywords: ['casa de maquinas', 'sala de baterias', 'abrigo', 'casinha', 'cabine'],
  },
  GENERATOR: {
    label: 'Gerador',
    widthM: 1.5,
    depthM: 1,
    heightM: 1.2,
    fill: 'fill-orange-300 stroke-orange-800',
    keywords: ['gerador', 'grupo gerador', 'motor gerador'],
  },
  GRID_POLE: {
    label: 'Poste da rede',
    widthM: 0.3,
    depthM: 0.3,
    heightM: 7,
    fill: 'fill-zinc-400 stroke-zinc-700',
    keywords: ['poste', 'rede eletrica', 'padrao de entrada', 'transformador'],
  },
  TANK: {
    label: 'Caixa d’água',
    widthM: 2,
    depthM: 2,
    heightM: 3,
    fill: 'fill-cyan-200 stroke-cyan-700',
    keywords: ['caixa d agua', 'caixa dagua', 'reservatorio', 'cisterna', 'tanque'],
  },
  TREE: {
    label: 'Árvore',
    widthM: 3,
    depthM: 3,
    heightM: 6,
    fill: 'fill-green-300 stroke-green-800',
    keywords: ['arvore', 'mangueira', 'palmeira', 'eucalipto', 'pe de', 'bosque', 'mata'],
  },
  CONTAINER: {
    label: 'Contêiner',
    widthM: 6,
    depthM: 2.4,
    heightM: 2.6,
    fill: 'fill-sky-300 stroke-sky-800',
    keywords: ['container', 'conteiner', 'contentor'],
  },
  SHED: {
    label: 'Galpão',
    widthM: 12,
    depthM: 8,
    heightM: 5,
    fill: 'fill-stone-300 stroke-stone-700',
    keywords: [
      'galpao',
      'barracao',
      'deposito',
      'armazem',
      'oficina',
      'estabulo',
      'curral coberto',
      'garagem',
    ],
  },
  GREENHOUSE: {
    label: 'Estufa',
    widthM: 10,
    depthM: 5,
    heightM: 3,
    fill: 'fill-lime-200 stroke-lime-700',
    keywords: ['estufa', 'horta coberta', 'viveiro'],
  },
  SILO: {
    label: 'Silo',
    widthM: 4,
    depthM: 4,
    heightM: 9,
    fill: 'fill-slate-300 stroke-slate-700',
    keywords: ['silo', 'graneleiro'],
  },
  WIND_TURBINE: {
    label: 'Aerogerador',
    widthM: 2,
    depthM: 2,
    heightM: 12,
    fill: 'fill-sky-100 stroke-sky-600',
    keywords: ['aerogerador', 'turbina eolica', 'cata vento', 'cata-vento', 'eolica', 'moinho'],
  },
  TOWER: {
    label: 'Torre / antena',
    widthM: 1,
    depthM: 1,
    heightM: 15,
    fill: 'fill-red-200 stroke-red-700',
    keywords: ['torre', 'antena', 'mastro', 'repetidor'],
  },
  WELL: {
    label: 'Poço',
    widthM: 1.2,
    depthM: 1.2,
    heightM: 1.2,
    fill: 'fill-stone-400 stroke-stone-700',
    keywords: ['poco', 'cacimba', 'bomba'],
  },
  POOL: {
    label: 'Piscina / lago',
    widthM: 8,
    depthM: 4,
    heightM: 0,
    fill: 'fill-cyan-300 stroke-cyan-700',
    keywords: ['piscina', 'lago', 'tanque de peixe', 'acude', 'lagoa', 'represa'],
  },
  VEHICLE: {
    label: 'Veículo',
    widthM: 4.5,
    depthM: 1.9,
    heightM: 1.6,
    fill: 'fill-rose-300 stroke-rose-800',
    keywords: ['carro', 'veiculo', 'caminhonete', 'caminhao', 'trator', 'moto', 'picape'],
  },
  WALL: {
    label: 'Muro / cerca',
    widthM: 10,
    depthM: 0.3,
    heightM: 2,
    fill: 'fill-stone-400 stroke-stone-800',
    keywords: ['muro', 'cerca', 'cercado', 'parede', 'alambrado'],
  },
  OTHER: {
    label: 'Outro objeto',
    widthM: 2,
    depthM: 2,
    heightM: 2,
    fill: 'fill-stone-300 stroke-stone-700',
    keywords: [],
  },
};

export const ELEMENT_KINDS_ORDER = Object.keys(ELEMENT_TYPES) as LayoutElementKind[];

export const COLOR_WORDS: Record<string, string> = {
  azul: '#1976d2',
  'azul claro': '#4fc3f7',
  vermelho: '#d32f2f',
  vermelha: '#d32f2f',
  verde: '#388e3c',
  amarelo: '#fbc02d',
  amarela: '#fbc02d',
  laranja: '#f57c00',
  branco: '#f5f5f5',
  branca: '#f5f5f5',
  cinza: '#90a4ae',
  preto: '#263238',
  preta: '#263238',
  marrom: '#795548',
  madeira: '#a1887f',
  rosa: '#ec407a',
  roxo: '#7b1fa2',
  bege: '#d7c4a0',
  prata: '#cfd8dc',
};

const strip = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’'`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const num = (raw: string): number => Number(raw.replace(',', '.'));

export interface DescribedElement {
  kind: LayoutElementKind;
  name: string;
  widthM: number;
  depthM: number;
  heightM: number;
  color?: string;
  /** O que foi entendido e o que foi assumido, para mostrar à pessoa. */
  notes: string[];
  /** `true` quando o tipo foi reconhecido pelas palavras. */
  recognized: boolean;
}

/**
 * Interpreta uma descrição em português ("container azul de 6 x 2,5 x 2,6 m", "poço de 1,5 m de altura", "galpão
 * verde grande") e devolve o tipo, as medidas e a cor. Funciona sem internet e sem serviço de IA: reconhece o tipo por
 * palavras, as medidas por padrões numéricos e a cor por nome. O que não reconhecer vira um bloco genérico com as
 * medidas e a cor que conseguiu entender.
 */
export function describeElement(text: string): DescribedElement {
  const t = strip(text);
  const notes: string[] = [];

  // Tipo: a palavra mais longa que casar (casa de máquinas vence casa).
  let kind: LayoutElementKind = 'OTHER';
  let best = 0;
  for (const k of ELEMENT_KINDS_ORDER)
    for (const word of ELEMENT_TYPES[k].keywords) {
      const re = new RegExp(`(^|[^a-z])${word.replace(/[-\s]/g, '[-\\s]')}([^a-z]|$)`);
      if (re.test(t) && word.length > best) {
        kind = k;
        best = word.length;
      }
    }
  const base = ELEMENT_TYPES[kind];
  const recognized = kind !== 'OTHER';
  notes.push(
    recognized
      ? `Reconheci: ${base.label.toLowerCase()}.`
      : 'Não reconheci o tipo: usei um bloco genérico (você pode trocar o tipo ao selecioná-lo).',
  );

  let widthM = base.widthM;
  let depthM = base.depthM;
  let heightM = base.heightM;

  // Medidas "6 x 2,5 x 2,6 m" (largura x profundidade x altura) ou "6 x 2,5".
  const dims = t.match(
    /(\d+(?:[.,]\d+)?)\s*(?:x|por)\s*(\d+(?:[.,]\d+)?)(?:\s*(?:x|por)\s*(\d+(?:[.,]\d+)?))?\s*(?:m|metros?)?/,
  );
  let sized = false;
  if (dims) {
    widthM = num(dims[1] as string);
    depthM = num(dims[2] as string);
    if (dims[3]) heightM = num(dims[3]);
    sized = true;
    notes.push(`Medidas: ${widthM} × ${depthM}${dims[3] ? ` × ${heightM}` : ''} m.`);
  }
  // Altura explícita: "3 m de altura", "altura de 3 m", "com 3 metros de altura".
  const h =
    t.match(/(\d+(?:[.,]\d+)?)\s*(?:m|metros?)?\s*de altura/) ??
    t.match(/altura(?: de| com)?\s*(\d+(?:[.,]\d+)?)/);
  if (h) {
    heightM = num(h[1] as string);
    notes.push(`Altura: ${heightM} m.`);
  }
  // Comprimento solto: "de 6 metros" (só se não houve medidas em x).
  if (!sized) {
    const one = t.match(/(?:de|com|tem)\s*(\d+(?:[.,]\d+)?)\s*(?:m|metros?)\b(?!\s*de altura)/);
    if (one && !h) {
      const length = num(one[1] as string);
      const ratio = base.depthM / base.widthM;
      if (
        kind === 'TREE' ||
        kind === 'GRID_POLE' ||
        kind === 'TOWER' ||
        kind === 'WIND_TURBINE' ||
        kind === 'SILO'
      )
        heightM = length;
      else {
        widthM = length;
        depthM = Math.max(0.3, Math.round(length * ratio * 10) / 10);
      }
      notes.push(`Tamanho: ${length} m.`);
    }
  }
  // Adjetivos de tamanho.
  if (!sized && !h) {
    if (/\b(grande|enorme|amplo)\b/.test(t)) {
      widthM *= 1.5;
      depthM *= 1.5;
      heightM *= 1.25;
      notes.push('“Grande”: aumentei 50% as medidas.');
    } else if (/\b(pequeno|pequena|mini|compacto|compacta)\b/.test(t)) {
      widthM *= 0.6;
      depthM *= 0.6;
      heightM *= 0.8;
      notes.push('“Pequeno”: reduzi as medidas.');
    }
  }

  // Cor: a palavra de cor mais longa que aparecer.
  let color: string | undefined;
  let colorWord = '';
  for (const [word, hex] of Object.entries(COLOR_WORDS))
    if (new RegExp(`(^|[^a-z])${word}([^a-z]|$)`).test(t) && word.length > colorWord.length) {
      color = hex;
      colorWord = word;
    }
  if (color) notes.push(`Cor: ${colorWord}.`);

  const round = (v: number) => Math.round(v * 10) / 10;
  const raw = text.trim();
  const name = raw.length > 0 ? raw.charAt(0).toUpperCase() + raw.slice(1) : base.label;
  return {
    kind,
    name: name.length > 40 ? base.label : name,
    widthM: Math.min(200, Math.max(0.1, round(widthM))),
    depthM: Math.min(200, Math.max(0.1, round(depthM))),
    heightM: Math.min(60, Math.max(0, round(heightM))),
    ...(color ? { color } : {}),
    notes,
    recognized,
  };
}
