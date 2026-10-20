import type {
  CableSpec,
  EngineeringDesign,
  ProtectionSpec,
  InverterSpec,
  ModuleSpec,
  EngineeringResults,
  SurfaceLayoutResult,
  SurfaceShadingResult,
} from '@voltex/shared';
import { roundTo } from '../units/index.js';
import { BOM_ALGORITHM_VERSION, buildBom, type UnitPrice } from './bom.js';
import { CABLES_ALGORITHM_VERSION, evaluateCables, type AmpacityRow } from './cables.js';
import type { Candidate } from './configurator.js';
import { PROTECTION_ALGORITHM_VERSION, evaluateProtections } from './protection.js';
import {
  COMPATIBILITY_ALGORITHM_VERSION,
  evaluateCompatibility,
  type EquipmentStatusLite,
} from './compatibility.js';
import { LAYOUT_ALGORITHM_VERSION, layoutSurface, type LayoutModule } from './layout.js';
import { SHADING_ALGORITHM_VERSION, computeShading } from './shading.js';

/**
 * Orquestra os cálculos do projeto de engenharia a partir do desenho e das fichas dos equipamentos. Puro e
 * determinístico: roda no navegador (prévia ao vivo) e no servidor (fonte oficial ao salvar). Cada fase do Engine
 * acrescenta aqui o seu cálculo.
 */
export const ENGINEERING_RESULTS_VERSION = 'engine-results-1.0.0';

export interface ComputeContext {
  /** Fichas dos módulos usados no desenho, por id do catálogo (para o layout bastam dimensões e potência). */
  modules: Record<string, (LayoutModule & Partial<ModuleSpec>) | undefined>;
  inverters?: Record<string, InverterSpec | undefined>;
  /** Situação no catálogo dos equipamentos citados. Ausente = não encontrado. */
  status?: Record<string, EquipmentStatusLite | undefined>;
  /** Parâmetros da regra `engine.design` em vigor (vazio = sem regra). */
  parameters?: Record<string, number>;
  /** Proteções e cabos **aprovados** do catálogo (candidatos à seleção automática). */
  protections?: Candidate<ProtectionSpec>[];
  cableCatalog?: Candidate<CableSpec>[];
  /** Regra `engine.cables` em vigor: parâmetros e tabelas (ex.: `ampacity`). */
  cableRules?: {
    parameters: Record<string, number>;
    tables: Record<string, Record<string, number | string | null>[]>;
  };
  /** Nomes e preços unitários dos equipamentos, para a lista de materiais. */
  labels?: Record<string, string | undefined>;
  prices?: Record<string, UnitPrice | undefined>;
}

/** Linhas válidas da tabela `ampacity` (ignora linhas incompletas). */
export function ampacityRows(
  table: Record<string, number | string | null>[] | undefined,
): AmpacityRow[] {
  return (table ?? []).flatMap((row) =>
    typeof row.crossSectionMm2 === 'number' &&
    typeof row.method === 'string' &&
    typeof row.ampacityA === 'number'
      ? [{ crossSectionMm2: row.crossSectionMm2, method: row.method, ampacityA: row.ampacityA }]
      : [],
  );
}

export function computeEngineeringResults(
  design: EngineeringDesign,
  context: ComputeContext,
): EngineeringResults {
  const pending: EngineeringResults['pending'] = [];
  const layout: SurfaceLayoutResult[] = [];
  const shading: SurfaceShadingResult[] = [];

  if (design.surfaces.length === 0)
    pending.push({
      code: 'NO_SURFACES',
      message: 'Nenhuma superfície de instalação foi cadastrada.',
    });

  for (const surface of design.surfaces) {
    const moduleId = surface.moduleId ?? design.defaultModuleId ?? null;
    const module = moduleId ? context.modules[moduleId] : undefined;
    if (!moduleId)
      pending.push({
        code: 'MODULE_NOT_SELECTED',
        message: `A superfície "${surface.name}" não tem módulo: escolha o módulo do projeto.`,
      });
    else if (!module)
      pending.push({
        code: 'MODULE_NOT_FOUND',
        message: `O módulo da superfície "${surface.name}" não está no catálogo.`,
      });

    if (module) {
      const result = layoutSurface({ surface, module, latitudeDegrees: design.site.latitude });
      layout.push({ surfaceId: surface.id, moduleId, ...result });
    } else {
      layout.push({
        surfaceId: surface.id,
        moduleId,
        fitCount: 0,
        moduleCount: 0,
        rows: 0,
        columns: 0,
        usableWidthM: 0,
        usableDepthM: 0,
        rowSpacingM: null,
        minRowSpacingM: null,
        powerKwp: null,
        moduleAreaM2: null,
        rects: [],
        warnings: ['Sem módulo escolhido, não há como calcular o layout.'],
      });
    }

    const warnings: string[] = [];
    if (!design.site.horizon && surface.obstacles.length === 0)
      warnings.push(
        'Sem perfil de horizonte nem obstáculos: a perda por sombra calculada é zero. Busque o horizonte do local ou informe os obstáculos.',
      );
    const calculated = computeShading({ site: design.site, surface });
    if (surface.shadingLossOverride) {
      warnings.push('Perda por sombra informada à mão: o cálculo por posição solar não foi usado.');
      shading.push({
        surfaceId: surface.id,
        monthlyLossPct: Array<number>(12).fill(surface.shadingLossOverride.pct),
        annualLossPct: surface.shadingLossOverride.pct,
        overridden: true,
        overrideSource: surface.shadingLossOverride.source,
        sunPaths: calculated.sunPaths,
        obstacles: calculated.obstacles,
        warnings,
      });
    } else {
      shading.push({
        surfaceId: surface.id,
        monthlyLossPct: calculated.monthlyLossPct,
        annualLossPct: calculated.annualLossPct,
        overridden: false,
        overrideSource: null,
        sunPaths: calculated.sunPaths,
        obstacles: calculated.obstacles,
        warnings,
      });
    }
  }

  const compatibility = evaluateCompatibility({
    design,
    layoutCountBySurface: Object.fromEntries(layout.map((l) => [l.surfaceId, l.moduleCount])),
    modules: context.modules as Record<string, ModuleSpec | undefined>,
    inverters: context.inverters ?? {},
    status: context.status ?? {},
    parameters: context.parameters ?? {},
  });

  const designParameters = context.parameters ?? {};
  const protection = evaluateProtections({
    design,
    modules: context.modules as Record<string, ModuleSpec | undefined>,
    inverters: context.inverters ?? {},
    catalog: context.protections ?? [],
    parameters: designParameters,
  });
  const cableRules = context.cableRules ?? { parameters: {}, tables: {} };
  const cables = evaluateCables({
    design,
    modules: context.modules as Record<string, ModuleSpec | undefined>,
    inverters: context.inverters ?? {},
    catalog: context.cableCatalog ?? [],
    parameters: cableRules.parameters,
    designParameters,
    ampacity: ampacityRows(cableRules.tables.ampacity),
  });
  const bom = buildBom({
    design,
    layout,
    protection,
    cables,
    inverters: context.inverters ?? {},
    labels: context.labels ?? {},
    prices: context.prices ?? {},
    cableParameters: cableRules.parameters,
  });

  const modulesUsed = layout.reduce((sum, l) => sum + l.moduleCount, 0);
  const havePower = layout.length > 0 && layout.every((l) => l.powerKwp !== null);
  return {
    algorithmVersions: {
      results: ENGINEERING_RESULTS_VERSION,
      layout: LAYOUT_ALGORITHM_VERSION,
      shading: SHADING_ALGORITHM_VERSION,
      compatibility: COMPATIBILITY_ALGORITHM_VERSION,
      protection: PROTECTION_ALGORITHM_VERSION,
      cables: CABLES_ALGORITHM_VERSION,
      bom: BOM_ALGORITHM_VERSION,
    },
    layout,
    shading,
    compatibility,
    protection,
    cables,
    bom,
    totals: {
      moduleCount: modulesUsed,
      powerKwp: havePower
        ? roundTo(
            layout.reduce((s, l) => s + (l.powerKwp ?? 0), 0),
            3,
          )
        : null,
      moduleAreaM2: havePower
        ? roundTo(
            layout.reduce((s, l) => s + (l.moduleAreaM2 ?? 0), 0),
            2,
          )
        : null,
    },
    pending,
  };
}
