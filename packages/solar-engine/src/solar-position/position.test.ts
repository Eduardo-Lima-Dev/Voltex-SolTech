import { describe, expect, it } from 'vitest';
import { julianDay, refractionDegrees, solarPosition } from './position.js';

const BRASILIA = { latitudeDegrees: -15.78, longitudeDegrees: -47.93 };

describe('dia juliano', () => {
  it('J2000: 2000-01-01 12:00 UTC = 2451545,0', () => {
    expect(julianDay(new Date('2000-01-01T12:00:00Z'))).toBe(2_451_545);
  });
});

describe('posição solar (ENG-F16)', () => {
  it('declinação no solstício de junho ≈ +23,44° e de dezembro ≈ −23,44°', () => {
    const jun = solarPosition({ at: new Date('2020-06-20T21:44:00Z'), ...BRASILIA });
    const dec = solarPosition({ at: new Date('2020-12-21T10:02:00Z'), ...BRASILIA });
    expect(jun.declinationDegrees).toBeCloseTo(23.44, 1);
    expect(dec.declinationDegrees).toBeCloseTo(-23.44, 1);
  });

  it('declinação ≈ 0° no equinócio de março', () => {
    const r = solarPosition({ at: new Date('2020-03-20T03:50:00Z'), ...BRASILIA });
    expect(Math.abs(r.declinationDegrees)).toBeLessThan(0.05);
  });

  it('equação do tempo: +16,4 min em 3/nov e −14,2 min em 11/fev', () => {
    const nov = solarPosition({ at: new Date('2020-11-03T12:00:00Z'), ...BRASILIA });
    const feb = solarPosition({ at: new Date('2020-02-11T12:00:00Z'), ...BRASILIA });
    expect(nov.equationOfTimeMinutes).toBeCloseTo(16.4, 0);
    expect(feb.equationOfTimeMinutes).toBeCloseTo(-14.2, 0);
  });

  it('meio-dia solar em Brasília no solstício de dezembro: altura ≈ 90 − |lat − dec| e sol ao sul', () => {
    const r = solarPosition({ at: new Date('2020-12-21T15:10:00Z'), ...BRASILIA });
    expect(r.elevationDegrees).toBeCloseTo(90 - Math.abs(-15.78 - -23.44), 0);
    expect(r.azimuthDegrees).toBeGreaterThan(150);
    expect(r.azimuthDegrees).toBeLessThan(210);
    expect(Math.abs(r.hourAngleDegrees)).toBeLessThan(1);
  });

  it('de manhã o sol está a leste e à tarde a oeste, com alturas parecidas', () => {
    const morning = solarPosition({ at: new Date('2020-09-22T12:04:00Z'), ...BRASILIA });
    const afternoon = solarPosition({ at: new Date('2020-09-22T18:04:00Z'), ...BRASILIA });
    expect(morning.azimuthDegrees).toBeGreaterThan(60);
    expect(morning.azimuthDegrees).toBeLessThan(120);
    expect(afternoon.azimuthDegrees).toBeGreaterThan(240);
    expect(afternoon.azimuthDegrees).toBeLessThan(300);
    expect(morning.elevationDegrees).toBeCloseTo(afternoon.elevationDegrees, 0);
  });

  it('à meia-noite local o sol está abaixo do horizonte', () => {
    const r = solarPosition({ at: new Date('2020-06-21T03:00:00Z'), ...BRASILIA });
    expect(r.elevationDegrees).toBeLessThan(-40);
  });

  it('no equador, meio-dia solar de equinócio, o sol está quase no zênite (azimute indefinido tratado)', () => {
    const r = solarPosition({
      at: new Date('2020-03-20T12:07:00Z'),
      latitudeDegrees: 0,
      longitudeDegrees: 0,
    });
    expect(r.elevationDegrees).toBeGreaterThan(88);
    expect(r.azimuthDegrees).toBeGreaterThanOrEqual(0);
    expect(r.azimuthDegrees).toBeLessThanOrEqual(360);
  });

  it('recusa data e coordenadas inválidas', () => {
    expect(() =>
      solarPosition({ at: new Date('x'), latitudeDegrees: 0, longitudeDegrees: 0 }),
    ).toThrow(RangeError);
    expect(() =>
      solarPosition({ at: new Date(), latitudeDegrees: 91, longitudeDegrees: 0 }),
    ).toThrow(RangeError);
    expect(() =>
      solarPosition({ at: new Date(), latitudeDegrees: 0, longitudeDegrees: 181 }),
    ).toThrow(RangeError);
  });
});

describe('refração', () => {
  it('é nula perto do zênite e cresce perto do horizonte', () => {
    expect(refractionDegrees(90)).toBe(0);
    expect(refractionDegrees(10)).toBeCloseTo(0.088, 2);
    expect(refractionDegrees(0)).toBeCloseTo(0.48, 1);
    expect(refractionDegrees(-5)).toBeGreaterThan(0);
  });
});
