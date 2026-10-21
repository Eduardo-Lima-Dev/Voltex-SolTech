import { describe, expect, it } from 'vitest';
import {
  designMonth,
  describeResource,
  buildYear,
  monthlyHsp,
  orientationsOf,
  syntheticSeries,
} from './resource.js';
import { baseDesign, siteGoias } from './fixtures.js';
import type { HourlySeries } from '../io/weather.js';

describe('recurso solar off-grid', () => {
  it('sem climatologia não há série sintética nem ano', () => {
    const design = baseDesign({ site: { latitude: -15, longitude: -47 } });
    expect(syntheticSeries(design.site)).toBeNull();
    expect(
      buildYear(
        design,
        orientationsOf(design, () => 1),
      ),
    ).toBeNull();
    const resource = describeResource(null, [], [1000, ...Array(11).fill(500)]);
    expect(resource.source).toBe('NONE');
    expect(resource.designMonthIndex).toBe(0);
  });

  it('o ano sintético tem 8760 horas e a energia mensal bate com a climatologia na horizontal', () => {
    const design = baseDesign();
    const synthetic = syntheticSeries(design.site);
    expect(synthetic?.series.ghiWhM2).toHaveLength(8760);
    const january = (synthetic?.series.ghiWhM2 ?? [])
      .slice(0, 31 * 24)
      .reduce((a: number, b) => a + (b ?? 0), 0);
    expect(january / 31 / 1000).toBeCloseTo(siteGoias.climate.ghiKwhM2Day[0] as number, 1);
  });

  it('transpõe para o plano e acha o mês de projeto', () => {
    const design = baseDesign();
    const orientations = orientationsOf(design, () => 2200);
    const year = buildYear(design, orientations);
    expect(year?.source).toBe('SYNTHETIC');
    expect(year?.monthIndex).toHaveLength(8760);
    expect(year?.warnings.some((w) => w.includes('sintético'))).toBe(true);
    const resource = describeResource(year, orientations, Array(12).fill(3000));
    expect(resource.hspMonthly).toHaveLength(12);
    expect(resource.hspMin).toBeLessThanOrEqual(resource.hspDesign);
    expect(resource.tiltDegrees).toBe(16);
  });

  it('sem arranjos usa a orientação recomendada pela latitude', () => {
    const design = baseDesign({ arrays: [] });
    const [first] = orientationsOf(design, () => 1);
    expect(first?.azimuthDegrees).toBe(0);
    expect(first?.tiltDegrees).toBeGreaterThan(10);
  });

  it('usa a série horária da Central quando existe e avisa do albedo', () => {
    const design = baseDesign({ albedo: 0.2 });
    const series: HourlySeries = {
      startAt: '2021-01-01T00:00:00',
      timeStandard: 'LST',
      ghiWhM2: Array.from({ length: 48 }, (_, i) => (i % 24 >= 8 && i % 24 < 16 ? 600 : 0)),
      dhiWhM2: Array.from({ length: 48 }, (_, i) => (i % 24 >= 8 && i % 24 < 16 ? 150 : 0)),
      tempC: Array(48).fill(25),
      missingHours: 0,
    };
    const year = buildYear(
      design,
      orientationsOf(design, () => 1),
      series,
    );
    expect(year?.source).toBe('SERIES');
    expect(year?.warnings).toHaveLength(0);
    expect(year?.monthIndex).toHaveLength(48);
  });

  it('mês de projeto: maior carga ÷ recurso, e meses sem sol com carga mandam', () => {
    expect(designMonth([100, 100, 100], [5, 2, 4])).toBe(1);
    expect(designMonth([100, 100], [5, 0])).toBe(1);
    expect(designMonth([0, 0], [0, 0])).toBe(0);
  });

  it('média ponderada pelos pesos dos arranjos', () => {
    const design = baseDesign({
      arrays: [
        {
          id: 'a',
          name: 'N',
          modulesInSeries: 1,
          parallelStrings: 1,
          azimuthDegrees: 0,
          tiltDegrees: 15,
        },
        {
          id: 'b',
          name: 'S',
          modulesInSeries: 1,
          parallelStrings: 1,
          azimuthDegrees: 180,
          tiltDegrees: 15,
        },
      ],
    });
    const orientations = orientationsOf(design, (id) => (id === 'a' ? 3 : 1));
    const year = buildYear(design, orientations);
    if (!year) throw new Error('sem ano');
    const weighted = monthlyHsp(year, orientations);
    const northOnly = monthlyHsp(year, [
      { ...(orientations[0] as object), weight: 1 } as never,
      { ...(orientations[1] as object), weight: 0 } as never,
    ]);
    expect(weighted[5]).toBeLessThan(northOnly[5] as number);
  });
});
