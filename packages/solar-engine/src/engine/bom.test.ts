import { describe, expect, it } from 'vitest';
import { engineeringDesignSchema } from '@voltex/shared';
import type { CableResult, ProtectionResult, SurfaceLayoutResult } from '@voltex/shared';
import { buildBom } from './bom.js';

const M1 = '0198a000-0000-7000-8000-000000000001';
const INV = '0198a000-0000-7000-8000-0000000000a1';
const FUSE = '0198a000-0000-7000-8000-000000000101';
const CAB = '0198a000-0000-7000-8000-000000000201';

const design = engineeringDesignSchema.parse({
  site: { latitude: -15.78, longitude: -47.93 },
  surfaces: [{ id: 's1', name: 'A', azimuthDegrees: 0, tiltDegrees: 20, widthM: 10, depthM: 5 }],
  inverters: [{ id: 'e1', inverterId: INV, mppts: [] }],
  cables: [
    {
      id: 'c1',
      label: 'CC',
      kind: 'DC_MAIN',
      inverterEntryId: 'e1',
      mpptIndex: 0,
      lengthM: 30,
      count: 1,
    },
    { id: 'c2', label: 'CA', kind: 'AC', inverterEntryId: 'e1', lengthM: 10 },
  ],
});
const layout = [{ surfaceId: 's1', moduleId: M1, moduleCount: 12 }] as SurfaceLayoutResult[];
const protection = {
  status: 'VALID',
  pending: [],
  algorithmVersion: 'x',
  items: [
    {
      id: 'a',
      role: 'STRING_FUSE',
      quantity: 6,
      justification: '',
      chosen: {
        equipmentId: FUSE,
        label: 'Fusível 20 A',
        ratedCurrentA: 20,
        ratedVoltageV: 1000,
        sensitivityMa: null,
        costCents: 600,
      },
    },
    {
      id: 'b',
      role: 'AC_BREAKER',
      quantity: 1,
      justification: 'Nenhum item aprovado atende.',
      chosen: null,
    },
  ],
} as unknown as ProtectionResult;
const cables = {
  status: 'VALID',
  pending: [],
  algorithmVersion: 'x',
  runs: [
    {
      runId: 'c1',
      label: 'CC',
      kind: 'DC_MAIN',
      lengthM: 30,
      count: 1,
      chosen: { equipmentId: CAB, label: 'Cabo 16 mm²', crossSectionMm2: 16, costCents: 1600 },
    },
    { runId: 'c2', label: 'CA', kind: 'AC', lengthM: 10, count: 1, chosen: null },
  ],
} as unknown as CableResult;
const base = {
  design,
  layout,
  protection,
  cables,
  inverters: { [INV]: { phases: 1 } as never },
  labels: { [M1]: 'Módulo 550 W', [INV]: 'Inversor 5 kW' },
  prices: {
    [M1]: { cents: 60000, source: 'PRICE_LIST' as const },
    [INV]: { cents: 400000, source: 'REFERENCE' as const },
    [FUSE]: { cents: 600, source: 'PRICE_LIST' as const },
    [CAB]: { cents: 1600, source: 'PRICE_LIST' as const },
  },
  cableParameters: {},
};

describe('lista de materiais', () => {
  const bom = buildBom(base);
  const line = (d: string) => bom.lines.find((l) => l.description.includes(d));

  it('módulos e inversores com preço da tabela ou de referência', () => {
    expect(line('Módulo 550 W')).toMatchObject({
      category: 'MODULE',
      quantity: 12,
      unitCostCents: 60000,
      totalCents: 720000,
      priceSource: 'PRICE_LIST',
    });
    expect(line('Inversor 5 kW')).toMatchObject({
      quantity: 1,
      totalCents: 400000,
      priceSource: 'REFERENCE',
    });
  });

  it('proteções escolhidas e item sem escolha (sem preço, com a justificativa)', () => {
    expect(line('Fusível 20 A')).toMatchObject({ quantity: 6, totalCents: 3600 });
    expect(line('Disjuntor CA (sem item escolhido)')).toMatchObject({
      unitCostCents: null,
      totalCents: null,
      priceSource: 'NONE',
      note: 'Nenhum item aprovado atende.',
    });
  });

  it('cabo CC em ida e volta: 30 m × 2 condutores = 60 m; trecho sem cabo escolhido também aparece', () => {
    expect(line('Cabo solar CC: Cabo 16 mm²')).toMatchObject({
      quantity: 60,
      unit: 'm',
      totalCents: 96000,
    });
    expect(line('Cabo CA (sem cabo escolhido)')).toMatchObject({
      quantity: 20,
      unit: 'm',
      totalCents: null,
    });
  });

  it('o total soma só as linhas com preço e conta as que não têm', () => {
    expect(bom.totalCents).toBe(720000 + 400000 + 3600 + 96000);
    expect(bom.unpricedCount).toBe(2);
    expect(bom.algorithmVersion).toBe('bom-1.0.0');
  });

  it('sobra de cabo da regra aumenta o comprimento (10%: 66 m)', () => {
    const withSurplus = buildBom({ ...base, cableParameters: { cableSurplusPct: 10 } });
    expect(withSurplus.lines.find((l) => l.description.includes('Cabo 16 mm²'))?.quantity).toBe(66);
    expect(withSurplus.lines.find((l) => l.description.includes('Cabo 16 mm²'))?.note).toMatch(
      /sobra de 10%/,
    );
  });

  it('trechos idênticos do mesmo cabo e itens iguais se agrupam; trifásico leva 4 condutores no CA', () => {
    const d = engineeringDesignSchema.parse({
      ...design,
      cables: [
        {
          id: 'c1',
          label: 'CC',
          kind: 'DC_STRING',
          inverterEntryId: 'e1',
          mpptIndex: 0,
          lengthM: 10,
          count: 2,
        },
        {
          id: 'c3',
          label: 'CC2',
          kind: 'DC_STRING',
          inverterEntryId: 'e1',
          mpptIndex: 0,
          lengthM: 10,
          count: 1,
        },
        { id: 'c2', label: 'CA', kind: 'AC', inverterEntryId: 'e1', lengthM: 10 },
      ],
    });
    const c = {
      ...cables,
      runs: [
        {
          runId: 'c1',
          label: 'CC',
          kind: 'DC_STRING',
          lengthM: 10,
          count: 2,
          chosen: { equipmentId: CAB, label: 'Cabo 16 mm²', crossSectionMm2: 16, costCents: 1600 },
        },
        {
          runId: 'c3',
          label: 'CC2',
          kind: 'DC_STRING',
          lengthM: 10,
          count: 1,
          chosen: { equipmentId: CAB, label: 'Cabo 16 mm²', crossSectionMm2: 16, costCents: 1600 },
        },
        {
          runId: 'c2',
          label: 'CA',
          kind: 'AC',
          lengthM: 10,
          count: 1,
          chosen: { equipmentId: CAB, label: 'Cabo 16 mm²', crossSectionMm2: 16, costCents: 1600 },
        },
      ],
    } as unknown as CableResult;
    const r = buildBom({
      ...base,
      design: d,
      cables: c,
      inverters: { [INV]: { phases: 3 } as never },
    });
    const dc = r.lines.find((l) => l.description.startsWith('Cabo solar CC'));
    expect(dc?.quantity).toBe(10 * 2 * 2 + 10 * 2 * 1);
    expect(r.lines.find((l) => l.description.startsWith('Cabo CA:'))?.quantity).toBe(40);
  });

  it('sem nenhuma linha com preço, o total é nulo; microinversor conta as unidades', () => {
    const d = engineeringDesignSchema.parse({
      ...design,
      inverters: [
        {
          id: 'e1',
          inverterId: INV,
          mppts: [],
          micro: { surfaceId: 's1', units: 6, modulesPerUnit: 2 },
        },
      ],
    });
    const r = buildBom({ ...base, design: d, prices: {} });
    expect(r.totalCents).toBeNull();
    expect(r.lines.find((l) => l.category === 'INVERTER')?.quantity).toBe(6);
  });
});
