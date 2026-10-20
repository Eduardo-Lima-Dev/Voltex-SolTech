import type { Surface } from '@voltex/shared';
import { degToRad, radToDeg, roundTo } from '../units/index.js';

/**
 * Layout básico dos módulos numa superfície (ENG-F15): quantos cabem na área útil, em quantas fileiras e colunas, e onde
 * ficam (para a prévia 2D). Geometria pura; o módulo entra só com as dimensões e a potência. Memorial:
 * `docs/06-calculos/engine-layout.md`.
 */
export const LAYOUT_ALGORITHM_VERSION = 'layout-1.0.0';

export interface LayoutModule {
  lengthMm: number;
  widthMm: number;
  pmaxWp: number;
}

export interface LayoutResult {
  fitCount: number;
  moduleCount: number;
  rows: number;
  columns: number;
  usableWidthM: number;
  usableDepthM: number;
  rowSpacingM: number | null;
  minRowSpacingM: number | null;
  powerKwp: number;
  moduleAreaM2: number;
  rects: { x: number; y: number; w: number; h: number }[];
  warnings: string[];
}

/** Posição do sol a partir da declinação e do ângulo horário (sem equação do tempo): suficiente para o espaçamento. */
export function sunFromHourAngle(
  latitudeDegrees: number,
  declinationDegrees: number,
  hourAngleDegrees: number,
): { elevationDegrees: number; azimuthDegrees: number } {
  const lat = degToRad(latitudeDegrees);
  const dec = degToRad(declinationDegrees);
  const h = degToRad(hourAngleDegrees);
  const sinEl = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(h);
  const el = Math.asin(Math.min(1, Math.max(-1, sinEl)));
  const cosEl = Math.cos(el);
  if (cosEl < 1e-9) return { elevationDegrees: 90, azimuthDegrees: 180 };
  const cosAz = Math.min(
    1,
    Math.max(-1, (Math.sin(dec) - Math.sin(el) * Math.sin(lat)) / (cosEl * Math.cos(lat))),
  );
  let az = radToDeg(Math.acos(cosAz));
  if (hourAngleDegrees > 0) az = 360 - az;
  return { elevationDegrees: radToDeg(el), azimuthDegrees: az };
}

/**
 * Espaçamento mínimo entre fileiras (m, entre a borda de trás de uma fileira e a frente da seguinte) para que uma
 * fileira não sombreie a outra no solstício de inverno do hemisfério do local, entre 9h e 15h (hora solar).
 * `moduleSlopeM` é o lado do módulo ao longo da inclinação.
 */
export function minRowSpacingM(input: {
  latitudeDegrees: number;
  tiltDegrees: number;
  azimuthDegrees: number;
  moduleSlopeM: number;
}): number {
  const { latitudeDegrees, tiltDegrees, azimuthDegrees, moduleSlopeM } = input;
  if (tiltDegrees <= 0) return 0;
  const tilt = degToRad(tiltDegrees);
  const height = moduleSlopeM * Math.sin(tilt);
  // Inverno: sol mais baixo. No hemisfério sul é o solstício de junho (declinação +23,44°).
  const declination = latitudeDegrees < 0 ? 23.44 : -23.44;
  let spacing = 0;
  for (const hourAngle of [-45, 45]) {
    const sun = sunFromHourAngle(latitudeDegrees, declination, hourAngle);
    if (sun.elevationDegrees <= 1) continue;
    // A sombra cai no sentido oposto ao do sol; as fileiras de trás ficam a `azimute + 180°` da face.
    const delta = degToRad(sun.azimuthDegrees - azimuthDegrees);
    const projected = (height / Math.tan(degToRad(sun.elevationDegrees))) * Math.cos(delta);
    if (projected > spacing) spacing = projected;
  }
  // A sombra da borda de cima de uma fileira (altura H) cai `projected` metros atrás dela: é o vão necessário.
  return roundTo(Math.max(0, spacing), 2);
}

export function layoutSurface(input: {
  surface: Pick<
    Surface,
    | 'kind'
    | 'azimuthDegrees'
    | 'tiltDegrees'
    | 'widthM'
    | 'depthM'
    | 'setbackM'
    | 'moduleOrientation'
    | 'moduleGapM'
    | 'rowSpacingM'
    | 'moduleCount'
  >;
  module: LayoutModule;
  latitudeDegrees: number;
}): LayoutResult {
  const { surface, module } = input;
  const warnings: string[] = [];
  const usableWidthM = roundTo(
    Math.max(0, surface.widthM - surface.setbackM.left - surface.setbackM.right),
    3,
  );
  const usableDepthM = roundTo(
    Math.max(0, surface.depthM - surface.setbackM.top - surface.setbackM.bottom),
    3,
  );
  const lengthM = module.lengthMm / 1000;
  const widthM = module.widthMm / 1000;
  const portrait = surface.moduleOrientation === 'PORTRAIT';
  // w: lado ao longo do beiral; h: lado ao longo da inclinação.
  const w = portrait ? widthM : lengthM;
  const h = portrait ? lengthM : widthM;
  const gap = surface.moduleGapM;
  const moduleAreaOne = lengthM * widthM;

  let rows = 0;
  let minSpacing: number | null = null;
  let spacing: number | null = null;
  const columns = usableWidthM >= w ? Math.floor((usableWidthM + gap) / (w + gap)) : 0;

  // Quanto cada fileira ocupa na vista da superfície (m) e o passo entre fileiras.
  let footprint = h;
  let pitch = h + gap;
  if (surface.kind === 'FLAT_RACK') {
    const tilt = degToRad(surface.tiltDegrees);
    footprint = h * Math.cos(tilt);
    minSpacing = minRowSpacingM({
      latitudeDegrees: input.latitudeDegrees,
      tiltDegrees: surface.tiltDegrees,
      azimuthDegrees: surface.azimuthDegrees,
      moduleSlopeM: h,
    });
    spacing = surface.rowSpacingM ?? minSpacing;
    if (surface.rowSpacingM !== undefined && surface.rowSpacingM < minSpacing)
      warnings.push(
        `O espaçamento informado (${surface.rowSpacingM} m) é menor que o mínimo calculado (${minSpacing} m): as fileiras se sombreiam no inverno.`,
      );
    pitch = footprint + spacing;
  }
  if (usableDepthM >= footprint) rows = Math.floor((usableDepthM - footprint) / pitch) + 1;

  const fitCount = rows * columns;
  const moduleCount =
    surface.moduleCount !== undefined ? Math.min(surface.moduleCount, fitCount) : fitCount;
  if (surface.moduleCount !== undefined && surface.moduleCount > fitCount)
    warnings.push(
      `Só cabem ${fitCount} módulos; o limite informado (${surface.moduleCount}) foi reduzido.`,
    );
  if (fitCount === 0)
    warnings.push(
      'Nenhum módulo cabe na área útil: confira as dimensões, os recuos e a orientação dos módulos.',
    );
  if (surface.kind === 'PITCHED' && surface.tiltDegrees === 0)
    warnings.push(
      'Telhado inclinado com inclinação zero: confira se a superfície não é uma laje (estrutura inclinada).',
    );

  // Retângulos: preenche fileira a fileira, da primeira (topo) para baixo, até `moduleCount`.
  const rects: LayoutResult['rects'] = [];
  const offsetY = footprint;
  for (let r = 0; r < rows && rects.length < moduleCount; r++)
    for (let c = 0; c < columns && rects.length < moduleCount; c++)
      rects.push({
        x: roundTo(c * (w + gap), 3),
        y: roundTo(r * pitch, 3),
        w: roundTo(w, 3),
        h: roundTo(offsetY, 3),
      });

  return {
    fitCount,
    moduleCount,
    rows,
    columns,
    usableWidthM,
    usableDepthM,
    rowSpacingM: spacing,
    minRowSpacingM: minSpacing,
    powerKwp: roundTo((moduleCount * module.pmaxWp) / 1000, 3),
    moduleAreaM2: roundTo(moduleCount * moduleAreaOne, 2),
    rects,
    warnings,
  };
}
