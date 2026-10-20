import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  WeatherParseError,
  parseNasaPowerClimatology,
  parseNasaPowerHourly,
  parsePvgisHorizon,
  parsePvgisSeries,
  summarizeHourly,
} from './weather.js';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(resolve(__dirname, 'fixtures', name), 'utf8'));

describe('NASA POWER: climatologia', () => {
  it('lê os 12 meses de irradiação e temperaturas (resposta real de Brasília)', () => {
    const r = parseNasaPowerClimatology(fixture('nasa-clim.json'));
    expect(r.latitude).toBe(-15.78);
    expect(r.longitude).toBe(-47.93);
    expect(r.ghiKwhM2Day).toHaveLength(12);
    expect(r.ghiKwhM2Day[0]).toBe(5.8658);
    expect(r.tempMinC[4]).toBe(7.63);
    expect(r.tempMaxC[9]).toBe(39.94);
    expect(r.elevationM).toBeCloseTo(984.96, 2);
  });

  it('recusa mês faltando, valor de preenchimento e resposta sem estrutura', () => {
    const broken = JSON.parse(JSON.stringify(fixture('nasa-clim.json')));
    delete broken.properties.parameter.T2M.MAR;
    expect(() => parseNasaPowerClimatology(broken)).toThrow(/T2M: mês MAR/);
    const filled = JSON.parse(JSON.stringify(fixture('nasa-clim.json')));
    filled.properties.parameter.T2M_MIN.JAN = -999;
    expect(() => parseNasaPowerClimatology(filled)).toThrow(WeatherParseError);
    expect(() => parseNasaPowerClimatology({})).toThrow(/geometry/);
    expect(() => parseNasaPowerClimatology({ geometry: { coordinates: [] } })).toThrow(
      /coordenadas/,
    );
    expect(() => parseNasaPowerClimatology(null)).toThrow(WeatherParseError);
  });
});

describe('NASA POWER: série horária', () => {
  it('lê 48 horas (2 dias) em hora solar local', () => {
    const s = parseNasaPowerHourly(fixture('nasa-hourly.json'));
    expect(s.ghiWhM2).toHaveLength(48);
    expect(s.startAt).toBe('2024-06-20T00:00:00');
    expect(s.timeStandard).toBe('LST');
    expect(s.tempC[0]).toBe(17.75);
    expect(s.missingHours).toBe(0);
    expect(Math.max(...(s.ghiWhM2 as number[]))).toBeGreaterThan(500);
  });

  it('conta horas sem dado e recusa série vazia', () => {
    const data = JSON.parse(JSON.stringify(fixture('nasa-hourly.json')));
    data.properties.parameter.ALLSKY_SFC_SW_DWN['2024062010'] = -999;
    expect(parseNasaPowerHourly(data).missingHours).toBe(1);
    expect(() =>
      parseNasaPowerHourly({
        properties: { parameter: { ALLSKY_SFC_SW_DWN: {}, ALLSKY_SFC_SW_DIFF: {}, T2M: {} } },
      }),
    ).toThrow(/vazia/);
  });
});

describe('PVGIS: série horária', () => {
  it('soma direta e difusa no plano horizontal, em UTC', () => {
    const s = parsePvgisSeries(fixture('pvgis-series.json'));
    expect(s.ghiWhM2).toHaveLength(72);
    expect(s.startAt).toBe('2020-01-01T00:00:00Z');
    expect(s.timeStandard).toBe('UTC');
    expect(s.tempC[0]).toBe(21.62);
    const noon = s.ghiWhM2[15] as number;
    expect(noon).toBeGreaterThan(0);
  });

  it('recusa plano inclinado, série vazia e horário estranho', () => {
    const tilted = JSON.parse(JSON.stringify(fixture('pvgis-series.json')));
    tilted.inputs.mounting_system.fixed.slope.value = 30;
    expect(() => parsePvgisSeries(tilted)).toThrow(/horizontal/);
    expect(() => parsePvgisSeries({ outputs: { hourly: [] } })).toThrow(/vazia/);
    const odd = JSON.parse(JSON.stringify(fixture('pvgis-series.json')));
    odd.outputs.hourly[0].time = 'ontem';
    expect(() => parsePvgisSeries(odd)).toThrow(/formato/);
  });

  it('marca como ausente a hora sem componentes', () => {
    const data = JSON.parse(JSON.stringify(fixture('pvgis-series.json')));
    delete data.outputs.hourly[3]['Gb(i)'];
    delete data.outputs.hourly[3]['T2m'];
    const s = parsePvgisSeries(data);
    expect(s.ghiWhM2[3]).toBeNull();
    expect(s.tempC[3]).toBeNull();
    expect(s.missingHours).toBe(1);
  });
});

describe('PVGIS: horizonte', () => {
  it('converte o azimute (sul = 0) para o do norte e ordena', () => {
    const h = parsePvgisHorizon(fixture('pvgis-horizon.json'));
    expect(h.points.length).toBeGreaterThan(40);
    expect(h.points[0]?.azimuthDegrees).toBeLessThan(h.points[1]?.azimuthDegrees ?? 0);
    // A = −180 (norte para o PVGIS) vira 0°; A = 0 (sul) vira 180°.
    expect(h.points[0]).toEqual({ azimuthDegrees: 0, heightDegrees: 0.4 });
    expect(h.points.some((p) => p.azimuthDegrees === 180)).toBe(true);
    expect(h.elevationM).toBe(1137);
  });

  it('recusa perfil vazio ou ponto inválido', () => {
    expect(() =>
      parsePvgisHorizon({ inputs: { location: {} }, outputs: { horizon_profile: [] } }),
    ).toThrow(/vazio/);
    expect(() =>
      parsePvgisHorizon({ inputs: { location: {} }, outputs: { horizon_profile: [{ A: 1 }] } }),
    ).toThrow(/inválido/);
  });
});

describe('resumo de série horária', () => {
  it('médias mensais só dos dias cobertos e extremos de temperatura', () => {
    const s = parsePvgisSeries(fixture('pvgis-series.json'));
    const sum = summarizeHourly(s);
    expect(sum.hours).toBe(72);
    expect(sum.ghiKwhM2Day[0]).toBeGreaterThan(2);
    expect(sum.ghiKwhM2Day[0]).toBeLessThan(9);
    expect(sum.ghiKwhM2Day[5]).toBeNull();
    expect(sum.tempMinC).not.toBeNull();
    expect(sum.tempMaxC as number).toBeGreaterThan(sum.tempMinC as number);
    expect(sum.tempMeanC[0]).toBeGreaterThan(15);
  });

  it('série da NASA (hora local) também resume; hora sem dado não entra na soma', () => {
    const s = parseNasaPowerHourly(fixture('nasa-hourly.json'));
    s.ghiWhM2[12] = null;
    s.tempC[12] = null;
    const sum = summarizeHourly({ ...s, missingHours: 1 });
    expect(sum.ghiKwhM2Day[5]).toBeGreaterThan(2);
    expect(sum.missingHours).toBe(1);
  });
});
