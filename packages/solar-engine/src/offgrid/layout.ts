import type {
  ModuleSpec,
  Obstacle,
  OffgridDesign,
  OffgridInverterSpec,
  OffgridLayoutArrayResult,
  OffgridLayoutElement,
  OffgridLayoutResult,
  OffgridLayoutRun,
} from '@voltex/shared';
import { roundTo } from '../units/index.js';
import { computeShading } from '../engine/shading.js';

/**
 * OFF-F11: projeto visual do terreno. Calcula a pegada de cada arranjo (módulos × dimensões da ficha), a sombra que as
 * construções projetam sobre ele (varredura anual do Engine), a distância dos trajetos de cabo e a **seção mínima pela
 * queda de tensão** (CRESESB Eq. 6.33: `S = ρ·d·I/ΔV`, d = ida e volta). A queda máxima é escolha do projetista; a
 * capacidade de condução e a aprovação do cabo seguem a regra de cabos (não aplicada aqui).
 * Memorial: `docs/06-calculos/offgrid-layout.md`.
 */
export const OFFGRID_LAYOUT_VERSION = 'offgrid-layout-1.0.0';

/** Resistividade do cobre a 20 °C (Ω·mm²/m) e coeficiente de temperatura (CR-10). */
const RHO_20 = 0.01724;
const ALPHA_CU = 0.0039;
/** Temperatura do condutor presumida para a queda (°C). */
const CONDUCTOR_TEMP_C = 70;
export const COMMERCIAL_SECTIONS_MM2 = [
  1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240,
] as const;

const rad = (deg: number) => (deg * Math.PI) / 180;

export interface LayoutArrayInput {
  id: string;
  name: string;
  modulesInSeries: number;
  parallelStrings: number;
  azimuthDegrees: number;
  tiltDegrees: number;
  positionM?: { x: number; y: number };
  moduleId?: string;
}

/** Dimensões usadas quando a ficha do módulo não está disponível (módulo de 550 Wp típico). */
const DEFAULT_MODULE = { lengthM: 2.278, widthM: 1.134 };
const MODULE_GAP_M = 0.02;

/** Pegada horizontal e altura do topo de um arranjo: strings em fileiras, módulos em retrato. */
export function arrayFootprint(
  array: Pick<LayoutArrayInput, 'modulesInSeries' | 'parallelStrings' | 'tiltDegrees'>,
  module: Pick<ModuleSpec, 'lengthMm' | 'widthMm'> | undefined,
): { widthM: number; depthM: number; slopeDepthM: number; topHeightM: number } {
  const lengthM = module ? module.lengthMm / 1000 : DEFAULT_MODULE.lengthM;
  const widthM = module ? module.widthMm / 1000 : DEFAULT_MODULE.widthM;
  const columns = array.modulesInSeries;
  const rows = array.parallelStrings;
  const totalWidth = columns * widthM + (columns - 1) * MODULE_GAP_M;
  const slope = rows * lengthM + (rows - 1) * MODULE_GAP_M;
  const tilt = rad(array.tiltDegrees);
  return {
    widthM: roundTo(totalWidth, 2),
    depthM: roundTo(slope * Math.cos(tilt), 2),
    slopeDepthM: roundTo(slope, 2),
    topHeightM: roundTo(slope * Math.sin(tilt), 2),
  };
}

/** Centros dos arranjos: a posição do projeto ou, sem ela, lado a lado no fundo do terreno. */
export function resolveArrayCenters(
  arrays: readonly LayoutArrayInput[],
  footprints: readonly { widthM: number; depthM: number }[],
  lotDepthM: number,
): { x: number; y: number }[] {
  let cursor = 2;
  return arrays.map((array, i) => {
    const f = footprints[i] as { widthM: number; depthM: number };
    if (array.positionM) return array.positionM;
    const center = {
      x: cursor + f.widthM / 2,
      y: Math.max(f.depthM / 2 + 1, lotDepthM - f.depthM / 2 - 2),
    };
    cursor += f.widthM + 2;
    return center;
  });
}

const corners = (element: OffgridLayoutElement): { x: number; y: number }[] => {
  const a = rad(element.rotationDeg);
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const hw = element.widthM / 2;
  const hd = element.depthM / 2;
  return [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ].map(([u, v]) => ({
    x: element.positionM.x + (u as number) * cos + (v as number) * sin,
    y: element.positionM.y - (u as number) * sin + (v as number) * cos,
  }));
};

/** Como a construção aparece do arranjo: direção, distância até a face mais próxima e largura vista. */
function obstacleFor(
  center: { x: number; y: number },
  element: OffgridLayoutElement,
): Obstacle | null {
  if (element.heightM <= 0) return null;
  const dx = element.positionM.x - center.x;
  const dy = element.positionM.y - center.y;
  const centerDistance = Math.hypot(dx, dy);
  if (centerDistance < 0.05) return null;
  const azimuth = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
  const dir = { x: dx / centerDistance, y: dy / centerDistance };
  const across = { x: dir.y, y: -dir.x };
  const pts = corners(element);
  const alongs = pts.map((p) => (p.x - center.x) * dir.x + (p.y - center.y) * dir.y);
  const acrosses = pts.map((p) => (p.x - center.x) * across.x + (p.y - center.y) * across.y);
  const nearest = Math.min(...alongs);
  if (nearest <= 0.1) return null;
  return {
    id: element.id,
    name: element.name,
    azimuthDegrees: roundTo(azimuth, 1),
    distanceM: roundTo(nearest, 2),
    heightM: element.heightM,
    widthM: Math.max(0.1, roundTo(Math.max(...acrosses) - Math.min(...acrosses), 2)),
  };
}

const rhoAt = (tempC: number): number => RHO_20 * (1 + ALPHA_CU * (tempC - 20));

/** Seção mínima (mm²) pela queda: `S = ρ·2·d·I / (ΔV%·V)`; `suggested` é a comercial seguinte. */
export function sectionForDrop(input: {
  distanceM: number;
  currentA: number;
  voltageV: number;
  dropPct: number;
}): {
  minSectionMm2: number;
  suggestedSectionMm2: number | null;
  dropPctAtSuggested: number | null;
} {
  const dropV = (input.dropPct / 100) * input.voltageV;
  const min =
    dropV > 0 ? (rhoAt(CONDUCTOR_TEMP_C) * 2 * input.distanceM * input.currentA) / dropV : 0;
  const suggested = COMMERCIAL_SECTIONS_MM2.find((s) => s >= min) ?? null;
  const at =
    suggested !== null && input.voltageV > 0
      ? ((rhoAt(CONDUCTOR_TEMP_C) * 2 * input.distanceM * input.currentA) /
          suggested /
          input.voltageV) *
        100
      : null;
  return {
    minSectionMm2: roundTo(min, 2),
    suggestedSectionMm2: suggested,
    dropPctAtSuggested: at === null ? null : roundTo(at, 2),
  };
}

export function computeLayout(input: {
  design: Pick<OffgridDesign, 'arrays' | 'layout' | 'site' | 'systemVoltageV' | 'systemType'>;
  modules: Record<string, ModuleSpec | undefined>;
  inverter?: OffgridInverterSpec | undefined;
  peakW: number;
  generatorW?: number | undefined;
}): OffgridLayoutResult {
  const { design } = input;
  const layout = design.layout;
  const warnings: string[] = [];
  const footprints = design.arrays.map((a) =>
    arrayFootprint(a, a.moduleId ? input.modules[a.moduleId] : undefined),
  );
  const centers = resolveArrayCenters(design.arrays, footprints, layout.lotDepthM);
  const room = layout.elements.find((e) => e.kind === 'POWER_ROOM');

  const arrays: OffgridLayoutArrayResult[] = design.arrays.map((array, i) => {
    const center = centers[i] as { x: number; y: number };
    const f = footprints[i] as ReturnType<typeof arrayFootprint>;
    const obstacles = layout.elements
      .map((e) => obstacleFor(center, e))
      .filter((o): o is Obstacle => o !== null);
    const shading = computeShading({
      site: design.site,
      surface: { azimuthDegrees: array.azimuthDegrees, tiltDegrees: array.tiltDegrees, obstacles },
    });
    if (
      center.x - f.widthM / 2 < 0 ||
      center.x + f.widthM / 2 > layout.lotWidthM ||
      center.y - f.depthM / 2 < 0 ||
      center.y + f.depthM / 2 > layout.lotDepthM
    )
      warnings.push(`O arranjo "${array.name}" sai dos limites do terreno.`);
    return {
      id: array.id,
      name: array.name,
      centerM: { x: roundTo(center.x, 2), y: roundTo(center.y, 2) },
      widthM: f.widthM,
      depthM: f.depthM,
      topHeightM: f.topHeightM,
      annualShadingLossPct: shading.annualLossPct,
      shadingObstacles: obstacles.length,
    };
  });

  for (const element of layout.elements) {
    const pts = corners(element);
    if (pts.some((p) => p.x < 0 || p.x > layout.lotWidthM || p.y < 0 || p.y > layout.lotDepthM))
      warnings.push(`"${element.name}" sai dos limites do terreno.`);
  }
  arrays.forEach((a, i) => {
    layout.elements.forEach((e) => {
      const c = a.centerM;
      const rot = rad(-e.rotationDeg);
      const lx = (c.x - e.positionM.x) * Math.cos(rot) - (c.y - e.positionM.y) * Math.sin(rot);
      const ly = (c.x - e.positionM.x) * Math.sin(rot) + (c.y - e.positionM.y) * Math.cos(rot);
      if (
        Math.abs(lx) < e.widthM / 2 + a.widthM / 2 &&
        Math.abs(ly) < e.depthM / 2 + a.depthM / 2 &&
        e.heightM > 0.3
      )
        warnings.push(`O arranjo "${design.arrays[i]?.name}" se sobrepõe a "${e.name}".`);
    });
  });

  const runs: OffgridLayoutRun[] = [];
  const slack = 1 + layout.cableSlackPct / 100;
  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    roundTo(Math.hypot(a.x - b.x, a.y - b.y) * slack, 2);
  const vac = input.inverter?.vAcV ?? 220;

  if (!room) {
    if (design.arrays.length > 0)
      warnings.push('Adicione a casa de máquinas na planta para calcular os trajetos de cabo.');
  } else {
    design.arrays.forEach((array, i) => {
      const module = array.moduleId ? input.modules[array.moduleId] : undefined;
      const voltage = array.modulesInSeries * (module?.vmppV ?? 30);
      const current = array.parallelStrings * (module?.imppA ?? 10);
      const distanceM = dist(centers[i] as { x: number; y: number }, room.positionM);
      runs.push({
        id: `pv-${array.id}`,
        kind: 'DC_PV',
        from: array.name,
        to: room.name,
        distanceM,
        currentA: roundTo(current, 2),
        voltageV: roundTo(voltage, 1),
        dropLimitPct: layout.maxDropPctDc,
        ...sectionForDrop({
          distanceM,
          currentA: current,
          voltageV: voltage,
          dropPct: layout.maxDropPctDc,
        }),
      });
    });
    const house = layout.elements.find((e) => e.kind === 'HOUSE');
    if (house) {
      const distanceM = dist(room.positionM, house.positionM);
      const current = input.peakW / vac;
      runs.push({
        id: 'ac-load',
        kind: 'AC_LOAD',
        from: room.name,
        to: house.name,
        distanceM,
        currentA: roundTo(current, 2),
        voltageV: vac,
        dropLimitPct: layout.maxDropPctAc,
        ...sectionForDrop({
          distanceM,
          currentA: current,
          voltageV: vac,
          dropPct: layout.maxDropPctAc,
        }),
      });
    } else warnings.push('Adicione a casa (cargas) na planta para calcular o cabo CA.');
    const generator = layout.elements.find((e) => e.kind === 'GENERATOR');
    if (generator && input.generatorW) {
      const distanceM = dist(generator.positionM, room.positionM);
      const current = input.generatorW / vac;
      runs.push({
        id: 'ac-gen',
        kind: 'AC_GENERATOR',
        from: generator.name,
        to: room.name,
        distanceM,
        currentA: roundTo(current, 2),
        voltageV: vac,
        dropLimitPct: layout.maxDropPctAc,
        ...sectionForDrop({
          distanceM,
          currentA: current,
          voltageV: vac,
          dropPct: layout.maxDropPctAc,
        }),
      });
    }
    const pole = layout.elements.find((e) => e.kind === 'GRID_POLE');
    if (pole && design.systemType === 'HYBRID') {
      const distanceM = dist(pole.positionM, room.positionM);
      const current = (input.inverter?.pContinuousW ?? input.peakW) / vac;
      runs.push({
        id: 'ac-grid',
        kind: 'AC_GRID',
        from: pole.name,
        to: room.name,
        distanceM,
        currentA: roundTo(current, 2),
        voltageV: vac,
        dropLimitPct: layout.maxDropPctAc,
        ...sectionForDrop({
          distanceM,
          currentA: current,
          voltageV: vac,
          dropPct: layout.maxDropPctAc,
        }),
      });
    }
    const inverterW = input.inverter?.pContinuousW ?? input.peakW;
    const bankCurrent = inverterW / design.systemVoltageV;
    runs.push({
      id: 'dc-bank',
      kind: 'DC_BANK',
      from: 'Banco de baterias',
      to: 'Inversor',
      distanceM: layout.bankToInverterM,
      currentA: roundTo(bankCurrent, 1),
      voltageV: design.systemVoltageV,
      dropLimitPct: layout.maxDropPctBank,
      ...sectionForDrop({
        distanceM: layout.bankToInverterM,
        currentA: bankCurrent,
        voltageV: design.systemVoltageV,
        dropPct: layout.maxDropPctBank,
      }),
    });
  }
  for (const run of runs)
    if (run.suggestedSectionMm2 === null)
      warnings.push(
        `O trajeto ${run.from} → ${run.to} pede mais de 240 mm²: aproxime os equipamentos ou eleve a tensão.`,
      );

  return {
    arrays,
    runs,
    totalCableM: roundTo(
      runs.filter((r) => r.kind !== 'DC_BANK').reduce((a, r) => a + r.distanceM, 0),
      1,
    ),
    warnings,
  };
}
