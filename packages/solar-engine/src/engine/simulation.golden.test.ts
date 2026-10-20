import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { simulateProjectHourly } from './simulation.js';

interface Golden {
  reference: string;
  params: {
    dcPowerWp: number;
    lossFraction: number;
    inverterEfficiencyPct: number;
    gammaPmaxPctPerC: number;
    noctC: number;
    albedo: number;
  };
  toleranceRelative: number;
  cases: {
    id: string;
    input: {
      latitude: number;
      longitude: number;
      startAt: string;
      ghiWhM2: number[];
      dhiWhM2: number[];
      tempC: number[];
      azimuthDegrees: number;
      tiltDegrees: number;
    };
    expected: { acEnergyKwh: number; poaWhM2: number };
  }[];
}

const golden = JSON.parse(
  readFileSync(resolve(__dirname, '../../../../tools/golden/cases/simulation-hourly.json'), 'utf8'),
) as Golden;

/** Casos de ouro (pvlib: Ineichen, SPA e transposição isotrópica): ver `tools/golden/README.md`. */
describe('simulação horária × casos de ouro', () => {
  it('há casos carregados', () => {
    expect(golden.cases.length).toBeGreaterThanOrEqual(24);
  });

  it.each(golden.cases)('$id', ({ input, expected }) => {
    const result = simulateProjectHourly({
      series: {
        startAt: input.startAt,
        timeStandard: 'UTC',
        ghiWhM2: input.ghiWhM2,
        dhiWhM2: input.dhiWhM2,
        tempC: input.tempC,
        missingHours: 0,
      },
      site: { latitude: input.latitude, longitude: input.longitude, horizon: null },
      surfaces: [
        {
          surface: {
            azimuthDegrees: input.azimuthDegrees,
            tiltDegrees: input.tiltDegrees,
            obstacles: [],
          },
          dcPowerWp: golden.params.dcPowerWp,
        },
      ],
      acLimitW: 1e9,
      gammaPmaxPctPerC: golden.params.gammaPmaxPctPerC,
      noctC: golden.params.noctC,
      albedo: golden.params.albedo,
      lossFraction: golden.params.lossFraction,
      inverterEfficiencyPct: golden.params.inverterEfficiencyPct,
    });
    const relative = Math.abs(result.energyKwh - expected.acEnergyKwh) / expected.acEnergyKwh;
    expect(relative).toBeLessThan(golden.toleranceRelative);
  });
});
