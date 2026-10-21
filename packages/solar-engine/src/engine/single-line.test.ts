import { describe, expect, it } from 'vitest';
import { engineeringDesignSchema, type EngineeringResults } from '@voltex/shared';
import { singleLineDxf, singleLineSvg } from './single-line.js';

const design = engineeringDesignSchema.parse({
  site: { latitude: -3, longitude: -38 },
  surfaces: [],
  inverters: [],
});
const results = {
  totals: { powerKwp: 5.5 },
  protection: { items: [] },
} as unknown as EngineeringResults;

describe('unifilar preliminar', () => {
  it('gera SVG marcado como rascunho e DXF ASCII para complementar no CAD', () => {
    expect(singleLineSvg(design, results)).toContain('RASCUNHO PARA REVISÃO');
    expect(singleLineSvg(design, results)).toContain('5.5 kWp');
    expect(singleLineDxf(design, results)).toContain('SECTION');
    expect(singleLineDxf(design, results)).toContain('NÃO ASSINAR');
  });
});
