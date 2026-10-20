import { describe, expect, it } from 'vitest';
import {
  brlToCents,
  centsToBrl,
  kwpToWp,
  mean,
  roundTo,
  sum,
  wpToKwp,
  degToRad,
  radToDeg,
  DAYS_IN_MONTH,
  DAYS_IN_YEAR,
} from './index.js';

describe('unidades', () => {
  it('converte potência e dinheiro', () => {
    expect(wpToKwp(550)).toBe(0.55);
    expect(kwpToWp(4.4)).toBe(4400);
    expect(brlToCents(19.9)).toBe(1990);
    expect(centsToBrl(44650)).toBe(446.5);
  });

  it('arredonda e agrega', () => {
    expect(roundTo(1.005, 2)).toBe(1.01);
    expect(sum([1, 2, 3])).toBe(6);
    expect(mean([2, 4])).toBe(3);
    expect(() => mean([])).toThrow(RangeError);
  });

  it('os dias do ano batem com os meses', () => {
    expect(sum(DAYS_IN_MONTH)).toBe(DAYS_IN_YEAR);
  });

  it('converte graus e radianos', () => {
    expect(degToRad(180)).toBeCloseTo(Math.PI, 12);
    expect(radToDeg(Math.PI / 2)).toBeCloseTo(90, 12);
  });
});
