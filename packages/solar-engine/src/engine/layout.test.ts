import { describe, expect, it } from 'vitest';
import { layoutSurface, minRowSpacingM, sunFromHourAngle } from './layout.js';

const MODULE = { lengthMm: 2278, widthMm: 1134, pmaxWp: 550 };
const base = {
  kind: 'PITCHED' as const,
  azimuthDegrees: 0,
  tiltDegrees: 20,
  widthM: 10,
  depthM: 5,
  setbackM: { left: 0.3, right: 0.3, top: 0.3, bottom: 0.3 },
  moduleOrientation: 'PORTRAIT' as const,
  moduleGapM: 0.02,
};

describe('layout em telhado inclinado', () => {
  it('conta fileiras e colunas na área útil (caso feito à mão)', () => {
    // Útil: 9,4 m × 4,4 m. Retrato: 1,134 × 2,278. Colunas: floor((9,4+0,02)/(1,154)) = 8. Fileiras: floor((4,4+0,02)/2,298) = 1.
    const r = layoutSurface({ surface: base, module: MODULE, latitudeDegrees: -15.78 });
    expect(r).toMatchObject({
      rows: 1,
      columns: 8,
      fitCount: 8,
      moduleCount: 8,
      usableWidthM: 9.4,
      usableDepthM: 4.4,
    });
    expect(r.powerKwp).toBe(4.4);
    expect(r.moduleAreaM2).toBeCloseTo(8 * 2.278 * 1.134, 1);
    expect(r.rects).toHaveLength(8);
    expect(r.rects[1]).toEqual({ x: 1.154, y: 0, w: 1.134, h: 2.278 });
  });

  it('paisagem encaixa mais fileiras quando a água é profunda', () => {
    const r = layoutSurface({
      surface: { ...base, depthM: 6, moduleOrientation: 'LANDSCAPE' },
      module: MODULE,
      latitudeDegrees: -15.78,
    });
    // Útil 9,4 × 5,4. Paisagem: 2,278 × 1,134. Colunas: floor(9,42/2,298)=4. Fileiras: floor((5,4+0,02)/1,154)=4.
    expect(r).toMatchObject({ columns: 4, rows: 4, fitCount: 16 });
  });

  it('o limite de módulos reduz a contagem e o excesso gera aviso', () => {
    const r = layoutSurface({
      surface: { ...base, moduleCount: 5 },
      module: MODULE,
      latitudeDegrees: -15.78,
    });
    expect(r.moduleCount).toBe(5);
    expect(r.rects).toHaveLength(5);
    const over = layoutSurface({
      surface: { ...base, moduleCount: 50 },
      module: MODULE,
      latitudeDegrees: -15.78,
    });
    expect(over.moduleCount).toBe(8);
    expect(over.warnings.join(' ')).toMatch(/Só cabem 8/);
  });

  it('área pequena demais: nada cabe e avisa', () => {
    const r = layoutSurface({
      surface: { ...base, widthM: 1, depthM: 1 },
      module: MODULE,
      latitudeDegrees: -15.78,
    });
    expect(r.fitCount).toBe(0);
    expect(r.rects).toEqual([]);
    expect(r.warnings.join(' ')).toMatch(/Nenhum módulo cabe/);
  });

  it('avisa quando o telhado inclinado tem inclinação zero', () => {
    const r = layoutSurface({
      surface: { ...base, tiltDegrees: 0 },
      module: MODULE,
      latitudeDegrees: -15.78,
    });
    expect(r.warnings.join(' ')).toMatch(/inclinação zero/);
  });
});

describe('estrutura em laje (FLAT_RACK)', () => {
  const rack = { ...base, kind: 'FLAT_RACK' as const, tiltDegrees: 15, widthM: 10, depthM: 12 };

  it('calcula o espaçamento mínimo e deixa menos fileiras que no plano', () => {
    const r = layoutSurface({ surface: rack, module: MODULE, latitudeDegrees: -15.78 });
    expect(r.minRowSpacingM).toBeGreaterThan(0.3);
    expect(r.minRowSpacingM).toBeLessThan(2);
    expect(r.rowSpacingM).toBe(r.minRowSpacingM);
    // Cada fileira ocupa 2,278·cos15° ≈ 2,2 m e o passo soma o espaçamento.
    const pitch = 2.278 * Math.cos((15 * Math.PI) / 180) + (r.minRowSpacingM as number);
    expect(r.rows).toBe(
      Math.floor((r.usableDepthM - 2.278 * Math.cos((15 * Math.PI) / 180)) / pitch) + 1,
    );
    const flat = layoutSurface({
      surface: { ...rack, kind: 'PITCHED' },
      module: MODULE,
      latitudeDegrees: -15.78,
    });
    expect(r.rows).toBeLessThanOrEqual(flat.rows);
  });

  it('espaçamento informado menor que o mínimo avisa; maior que o mínimo reduz fileiras', () => {
    const tight = layoutSurface({
      surface: { ...rack, rowSpacingM: 0.1 },
      module: MODULE,
      latitudeDegrees: -15.78,
    });
    expect(tight.warnings.join(' ')).toMatch(/menor que o mínimo/);
    const wide = layoutSurface({
      surface: { ...rack, rowSpacingM: 3 },
      module: MODULE,
      latitudeDegrees: -15.78,
    });
    expect(wide.rows).toBeLessThanOrEqual(tight.rows);
  });
});

describe('espaçamento mínimo entre fileiras', () => {
  it('sem inclinação não há sombra entre fileiras', () => {
    expect(
      minRowSpacingM({ latitudeDegrees: -15, tiltDegrees: 0, azimuthDegrees: 0, moduleSlopeM: 2 }),
    ).toBe(0);
  });

  it('cresce com a inclinação e com a latitude', () => {
    const at = (lat: number, tilt: number) =>
      minRowSpacingM({
        latitudeDegrees: lat,
        tiltDegrees: tilt,
        azimuthDegrees: lat < 0 ? 0 : 180,
        moduleSlopeM: 2,
      });
    expect(at(-15, 25)).toBeGreaterThan(at(-15, 10));
    expect(at(-30, 20)).toBeGreaterThan(at(-5, 20));
    // Espelhado no hemisfério norte (face ao sul).
    expect(at(15, 20)).toBeCloseTo(at(-15, 20), 1);
  });

  it('caso de referência calculado à mão: lat −15°, 15°, módulo de 2 m, solstício de inverno', () => {
    // H = 2·sin15° = 0,5176 m. Às 9h/15h (ângulo horário ±45°) o sol tem altura 31,58° e azimute 49,6°.
    // Sombra = H / tan(31,58°) = 0,842 m; componente no eixo das fileiras = 0,842 · cos(49,6°) = 0,546 m → 0,55 m.
    const d = minRowSpacingM({
      latitudeDegrees: -15,
      tiltDegrees: 15,
      azimuthDegrees: 0,
      moduleSlopeM: 2,
    });
    expect(d).toBeCloseTo(0.55, 2);
  });
});

describe('posição do sol por ângulo horário', () => {
  it('ao meio-dia no equinócio, no equador, o sol está a pino', () => {
    const s = sunFromHourAngle(0, 0, 0);
    expect(s.elevationDegrees).toBeCloseTo(90, 5);
  });
  it('manhã a leste, tarde a oeste', () => {
    const am = sunFromHourAngle(-15, 0, -45);
    const pm = sunFromHourAngle(-15, 0, 45);
    expect(am.azimuthDegrees).toBeLessThan(180);
    expect(pm.azimuthDegrees).toBeGreaterThan(180);
    expect(am.elevationDegrees).toBeCloseTo(pm.elevationDegrees, 5);
  });
});
