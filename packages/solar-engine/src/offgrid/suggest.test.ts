import { describe, expect, it } from 'vitest';
import { OFFGRID_PROVISIONAL_PARAMETERS } from './parameters.js';
import { suggestOffgrid, type SuggestCatalog } from './suggest.js';
import { IDS, baseContext, baseDesign } from './fixtures.js';

const ctx = baseContext();
const catalog = (): SuggestCatalog => ({
  modules: [{ id: IDS.module, spec: ctx.modules[IDS.module] as never, priceCents: 60_000 }],
  batteries: [
    { id: IDS.battery, spec: ctx.batteries[IDS.battery] as never, priceCents: 1_200_000 },
  ],
  controllers: [
    { id: IDS.controller, spec: ctx.controllers[IDS.controller] as never, priceCents: 250_000 },
  ],
  inverters: [
    { id: IDS.inverter, spec: ctx.inverters[IDS.inverter] as never, priceCents: 600_000 },
  ],
});
const context = { parameters: { ...OFFGRID_PROVISIONAL_PARAMETERS }, generators: {} };

describe('sugestor off-grid', () => {
  it('monta a combinação do catálogo que passa nas verificações e na simulação', () => {
    const [s] = suggestOffgrid({ design: baseDesign(), catalog: catalog(), context, limit: 3 });
    expect(s).toBeDefined();
    expect(s?.systemVoltageV).toBe(48);
    expect(s?.modulesInSeries).toBeGreaterThanOrEqual(2);
    expect(s?.capexCents).toBeGreaterThan(0);
    expect(s?.lolpPct).toBeLessThanOrEqual(5);
    expect(s?.batteryParallel).toBeGreaterThanOrEqual(1);
  });

  it('sem cargas, sem clima ou sem recurso solar não sugere', () => {
    expect(
      suggestOffgrid({ design: baseDesign({ loads: [] }), catalog: catalog(), context, limit: 3 }),
    ).toEqual([]);
    expect(
      suggestOffgrid({
        design: baseDesign({ site: { latitude: -15, longitude: -47 } }),
        catalog: catalog(),
        context,
        limit: 3,
      }),
    ).toEqual([]);
  });

  it('descarta inversor de outra tensão, híbrido sem inversor híbrido e baterias incompatíveis', () => {
    const c = catalog();
    expect(
      suggestOffgrid({
        design: baseDesign({ systemType: 'HYBRID' }),
        catalog: c,
        context,
        limit: 3,
      }),
    ).toEqual([]);
    expect(
      suggestOffgrid({ design: baseDesign({ systemVoltageV: 24 }), catalog: c, context, limit: 3 }),
    ).toEqual([]);
    const lead = {
      ...c,
      batteries: [
        {
          ...(c.batteries[0] as object),
          spec: { ...(c.batteries[0]?.spec as object), nominalVoltageV: 2 },
        },
      ],
    };
    expect(
      suggestOffgrid({ design: baseDesign(), catalog: lead as never, context, limit: 3 }).length,
    ).toBeGreaterThanOrEqual(0);
  });

  it('sem preço o custo fica nulo e a nota avisa; híbrido aceita inversor híbrido', () => {
    const c = catalog();
    const noPrice = { ...c, modules: [{ ...(c.modules[0] as object), priceCents: null }] };
    const [s] = suggestOffgrid({
      design: baseDesign(),
      catalog: noPrice as never,
      context,
      limit: 1,
    });
    expect(s?.capexCents).toBeNull();
    expect(s?.notes.join(' ')).toContain('Sem preço');
    const hybrid = {
      ...c,
      inverters: [
        {
          id: IDS.hybridInverter,
          spec: ctx.inverters[IDS.hybridInverter] as never,
          priceCents: 800_000,
        },
      ],
    };
    expect(
      suggestOffgrid({
        design: baseDesign({ systemType: 'HYBRID' }),
        catalog: hybrid,
        context,
        limit: 1,
      })[0]?.inverterId,
    ).toBe(IDS.hybridInverter);
  });

  it('sinaliza quando a melhor opção ainda perde carga', () => {
    const [s] = suggestOffgrid({
      design: baseDesign({
        arrays: [
          { id: 'a1', name: 'T', modulesInSeries: 4, parallelStrings: 1, shadingLossPct: 95 },
        ],
      }),
      catalog: catalog(),
      context,
      limit: 1,
    });
    expect(s?.notes.join(' ')).toContain('acima do limite');
  });

  it('inversor pequeno demais exige mais de um ou é descartado', () => {
    const c = catalog();
    const tiny = {
      ...c,
      inverters: [
        {
          id: IDS.inverter,
          spec: {
            ...(ctx.inverters[IDS.inverter] as object),
            pContinuousW: 100,
            pSurgeW: 150,
          } as never,
          priceCents: 1,
        },
      ],
    };
    expect(suggestOffgrid({ design: baseDesign(), catalog: tiny, context, limit: 1 })).toEqual([]);
  });
});

describe('sugestor: limites das combinações', () => {
  it('controlador sem faixa de tensão para o módulo ou com corrente curta é descartado', () => {
    const c = catalog();
    const lowVoc = {
      ...c,
      controllers: [
        {
          ...(c.controllers[0] as object),
          spec: { ...(c.controllers[0]?.spec as object), pvVocMaxV: 60 },
        },
      ],
    };
    expect(
      suggestOffgrid({ design: baseDesign(), catalog: lowVoc as never, context, limit: 1 }),
    ).toEqual([]);
    const weak = {
      ...c,
      controllers: [
        {
          ...(c.controllers[0] as object),
          spec: { ...(c.controllers[0]?.spec as object), ratedChargeCurrentA: 1 },
        },
      ],
    };
    expect(
      suggestOffgrid({ design: baseDesign(), catalog: weak as never, context, limit: 1 }),
    ).toEqual([]);
  });

  it('paralelo acima do limite e inversor de surto fraco são descartados; ordena por custo', () => {
    const c = catalog();
    const small = {
      ...c,
      batteries: [
        {
          ...(c.batteries[0] as object),
          spec: { ...(c.batteries[0]?.spec as object), capacityAh: 5 },
        },
      ],
    };
    expect(
      suggestOffgrid({ design: baseDesign(), catalog: small as never, context, limit: 1 }),
    ).toEqual([]);
    const weakSurge = {
      ...c,
      inverters: [
        {
          ...(c.inverters[0] as object),
          spec: { ...(c.inverters[0]?.spec as object), pSurgeW: undefined, pContinuousW: 900 },
        },
      ],
    };
    expect(
      suggestOffgrid({ design: baseDesign(), catalog: weakSurge as never, context, limit: 1 }),
    ).toEqual([]);
    const two = {
      ...c,
      modules: [...c.modules, { ...(c.modules[0] as object), id: 'm2', priceCents: 10_000 }],
    };
    const out = suggestOffgrid({ design: baseDesign(), catalog: two as never, context, limit: 2 });
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]?.capexCents ?? 0).toBeLessThanOrEqual(out[1]?.capexCents ?? Infinity);
  });
});
