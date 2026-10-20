import { describe, expect, it } from 'vitest';
import { simulateHourly, simulateProjectHourly } from './simulation.js';

describe('simulateHourly', () => {
  it('aplica temperatura, perdas e clipping hora a hora', () => {
    const result = simulateHourly({
      hours: [
        { planeIrradianceWm2: 1000, ambientC: 25 },
        { planeIrradianceWm2: 800, ambientC: 25, shadingFraction: 0.5 },
      ],
      dcPowerWp: 10_000,
      acLimitW: 7_000,
      gammaPmaxPctPerC: -0.4,
      lossFraction: 0,
      inverterEfficiencyPct: 100,
    });
    expect(result.energyKwh).toBe(10.808);
    expect(result.clippingKwh).toBe(1.8);
    expect(result.performanceRatio).toBeCloseTo(0.6004, 4);
  });

  it('degrada a produção a partir do segundo ano e explica série ausente', () => {
    const base = {
      hours: [{ planeIrradianceWm2: 1000, ambientC: 20 }],
      dcPowerWp: 1000,
      acLimitW: 2000,
      gammaPmaxPctPerC: 0,
    };
    expect(simulateHourly({ ...base, degradationPctPerYear: 1, year: 2 }).energyKwh).toBe(0.95);
    expect(simulateHourly({ ...base, hours: [] }).warnings).toHaveLength(1);
  });

  it('transpõe a série horizontal, aplica sombra e ignora horas sem dado', () => {
    const base = {
      series: {
        startAt: '2025-01-01T12:00:00Z',
        timeStandard: 'UTC' as const,
        ghiWhM2: [1000, null],
        dhiWhM2: [100, null],
        tempC: [25, null],
        missingHours: 1,
      },
      site: { latitude: 0, longitude: 0, horizon: null },
      surfaces: [
        {
          dcPowerWp: 1000,
          surface: { azimuthDegrees: 0, tiltDegrees: 0, obstacles: [] },
        },
      ],
      acLimitW: 2000,
      gammaPmaxPctPerC: 0,
      inverterEfficiencyPct: 100,
    };
    const open = simulateProjectHourly(base);
    const shaded = simulateProjectHourly({
      ...base,
      surfaces: [
        {
          ...base.surfaces[0]!,
          surface: {
            ...base.surfaces[0]!.surface,
            obstacles: [
              { id: 'o', name: 'Muro', azimuthDegrees: 180, distanceM: 1, heightM: 10, widthM: 30 },
            ],
          },
        },
      ],
    });
    expect(open.energyKwh).toBeGreaterThan(0);
    expect(shaded.energyKwh).toBeLessThan(open.energyKwh);
    expect(open.warnings.join(' ')).toMatch(/1 hora/);
  });
});

describe('agregações e cascata de perdas', () => {
  const hours = Array.from({ length: 48 }, (_, i) => ({
    planeIrradianceWm2: i % 24 >= 6 && i % 24 <= 17 ? 800 : 0,
    unshadedIrradianceWm2: i % 24 >= 6 && i % 24 <= 17 ? 900 : 0,
    ambientC: 25,
    monthIndex: i < 24 ? 0 : 1,
    hourOfDay: i % 24,
  }));
  const r = simulateHourly({
    hours,
    dcPowerWp: 5000,
    acLimitW: 3000,
    gammaPmaxPctPerC: -0.4,
    lossFraction: 0.1,
    inverterEfficiencyPct: 96,
  });

  it('energia mensal e perfil de dia típico somam a energia CA', () => {
    expect(r.monthlyKwh![0]! + r.monthlyKwh![1]!).toBeCloseTo(r.energyKwh, 1);
    expect(r.monthlyKwh!.slice(2).every((v) => v === 0)).toBe(true);
    expect(r.typicalDayKw![12]).toBeGreaterThan(0);
    expect(r.typicalDayKw![2]).toBe(0);
    expect(r.typicalDayKw!.reduce((a, b) => a + b, 0) * 2).toBeCloseTo(r.energyKwh, 1);
  });

  it('a cascata parte da energia ideal e chega à energia CA (somando as perdas)', () => {
    const losses = r.losses!;
    expect(losses.map((l) => l.id)).toEqual([
      'IDEAL',
      'SHADING',
      'TEMPERATURE',
      'SYSTEM',
      'INVERTER',
      'CLIPPING',
      'AC',
    ]);
    const sum = losses.slice(0, -1).reduce((a, l) => a + l.kwh, 0);
    expect(sum).toBeCloseTo(losses.at(-1)!.kwh, 0);
    expect(losses[1]!.kwh).toBeLessThan(0); // sombra: 800 contra 900 W/m²
    expect(losses[5]!.kwh).toBeLessThan(0); // 5 kWp a 800 W/m² passa dos 3 kW CA
  });
});
