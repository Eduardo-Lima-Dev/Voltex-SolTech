import { describe, expect, it } from 'vitest';
import {
  clearSkyDirectNormal,
  computeShading,
  horizonHeightAt,
  incidenceCosine,
  isSunBlocked,
  obstacleSilhouette,
} from './shading.js';

const SITE = { latitude: -15.78, longitude: -47.93, horizon: null };
const SURFACE = { azimuthDegrees: 0, tiltDegrees: 15, obstacles: [] };

describe('irradiância direta com céu claro', () => {
  it('zero abaixo do horizonte e crescente com a altura do sol', () => {
    expect(clearSkyDirectNormal(0)).toBe(0);
    expect(clearSkyDirectNormal(-5)).toBe(0);
    expect(clearSkyDirectNormal(10)).toBeLessThan(clearSkyDirectNormal(30));
    expect(clearSkyDirectNormal(30)).toBeLessThan(clearSkyDirectNormal(90));
  });
  it('ao zênite fica perto do valor de Meinel (≈ 0,7 · 1353 = 947 W/m²)', () => {
    expect(clearSkyDirectNormal(90)).toBeGreaterThan(900);
    expect(clearSkyDirectNormal(90)).toBeLessThan(1000);
  });
});

describe('incidência no plano', () => {
  it('sol de frente para o plano inclinado incide com cosseno 1', () => {
    // Plano inclinado 30° voltado ao norte; sol ao norte a 60° de altura (normal do plano).
    expect(incidenceCosine(60, 0, 0, 30)).toBeCloseTo(1, 6);
  });
  it('sol atrás do plano dá cosseno negativo', () => {
    expect(incidenceCosine(10, 180, 0, 60)).toBeLessThan(0);
  });
});

describe('horizonte', () => {
  const points = [
    { azimuthDegrees: 0, heightDegrees: 2 },
    { azimuthDegrees: 90, heightDegrees: 10 },
    { azimuthDegrees: 180, heightDegrees: 2 },
    { azimuthDegrees: 270, heightDegrees: 20 },
  ];
  it('interpola entre os pontos, inclusive na volta de 270° a 360°', () => {
    expect(horizonHeightAt(points, 45)).toBeCloseTo(6, 6);
    expect(horizonHeightAt(points, 90)).toBe(10);
    expect(horizonHeightAt(points, 315)).toBeCloseTo(11, 6); // entre 20 (270°) e 2 (0°/360°)
    expect(horizonHeightAt(points, -45)).toBeCloseTo(11, 6);
    expect(horizonHeightAt(points, 400)).toBeCloseTo(horizonHeightAt(points, 40), 6);
    expect(horizonHeightAt([], 10)).toBe(0);
  });
});

describe('obstáculos e bloqueio do sol', () => {
  const tree = {
    id: 't',
    name: 'Árvore',
    azimuthDegrees: 90,
    distanceM: 10,
    heightM: 10,
    widthM: 10,
  };
  it('a silhueta tem meia-largura e altura angulares', () => {
    const s = obstacleSilhouette(tree);
    expect(s.topElevationDegrees).toBeCloseTo(45, 1);
    expect(s.halfWidthDegrees).toBeCloseTo(26.57, 1);
    expect(obstacleSilhouette({ ...tree, heightM: 0 }).topElevationDegrees).toBe(0);
  });
  it('só bloqueia o sol dentro da faixa angular e abaixo do topo', () => {
    const sil = [obstacleSilhouette(tree)];
    expect(isSunBlocked(30, 90, null, sil)).toBe(true);
    expect(isSunBlocked(50, 90, null, sil)).toBe(false);
    expect(isSunBlocked(30, 150, null, sil)).toBe(false);
    expect(isSunBlocked(30, 90, null, [obstacleSilhouette({ ...tree, heightM: -2 })])).toBe(false);
  });
  it('horizonte alto bloqueia o sol baixo', () => {
    const horizon = {
      source: 'pvgis' as const,
      fetchedAt: '',
      points: Array.from({ length: 8 }, (_, i) => ({ azimuthDegrees: i * 45, heightDegrees: 15 })),
    };
    expect(isSunBlocked(10, 100, horizon, [])).toBe(true);
    expect(isSunBlocked(20, 100, horizon, [])).toBe(false);
  });
});

describe('perda por sombra', () => {
  it('sem obstáculos e sem horizonte a perda é zero', () => {
    const r = computeShading({ site: SITE, surface: SURFACE });
    expect(r.annualLossPct).toBe(0);
    expect(r.monthlyLossPct).toEqual(Array(12).fill(0));
    expect(r.sunPaths).toHaveLength(12);
    expect(r.sunPaths[5]?.points.length).toBeGreaterThan(10);
  });

  it('um obstáculo alto ao norte (onde o sol passa no inverno) causa perda maior no inverno que no verão', () => {
    const wall = {
      id: 'w',
      name: 'Prédio',
      azimuthDegrees: 0,
      distanceM: 8,
      heightM: 8,
      widthM: 40,
    };
    const r = computeShading({ site: SITE, surface: { ...SURFACE, obstacles: [wall] } });
    const june = r.monthlyLossPct[5] as number;
    const december = r.monthlyLossPct[11] as number;
    expect(june).toBeGreaterThan(20);
    expect(june).toBeGreaterThan(december);
    expect(r.annualLossPct).toBeGreaterThan(0);
    expect(r.annualLossPct).toBeLessThan(100);
    expect(r.obstacles).toHaveLength(1);
    expect(r.sunPaths[5]?.points.some((p) => p.shaded)).toBe(true);
  });

  it('obstáculo atrás da superfície (ao sul) quase não afeta uma face voltada ao norte', () => {
    const south = {
      id: 's',
      name: 'Muro',
      azimuthDegrees: 180,
      distanceM: 5,
      heightM: 3,
      widthM: 10,
    };
    const r = computeShading({ site: SITE, surface: { ...SURFACE, obstacles: [south] } });
    expect(r.annualLossPct).toBeLessThan(2);
  });

  it('o resultado é determinístico', () => {
    const wall = { id: 'w', name: 'P', azimuthDegrees: 20, distanceM: 10, heightM: 5, widthM: 15 };
    const a = computeShading({ site: SITE, surface: { ...SURFACE, obstacles: [wall] } });
    const b = computeShading({ site: SITE, surface: { ...SURFACE, obstacles: [wall] } });
    expect(a).toEqual(b);
  });

  it('horizonte alto reduz a geração no nascer e no pôr do sol', () => {
    const horizon = {
      source: 'pvgis' as const,
      fetchedAt: '',
      points: Array.from({ length: 36 }, (_, i) => ({ azimuthDegrees: i * 10, heightDegrees: 25 })),
    };
    const r = computeShading({ site: { ...SITE, horizon }, surface: SURFACE });
    expect(r.annualLossPct).toBeGreaterThan(1);
  });
});
