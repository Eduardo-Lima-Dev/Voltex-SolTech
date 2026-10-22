import type { EngineeringDesign } from '@voltex/shared';
import type { CommissioningSubject, StringElectrical } from './types.js';

export interface EquipmentLike {
  id: string;
  kind: string;
  spec: unknown;
}

const numberOf = (obj: Record<string, unknown>, key: string): number | null => {
  const v = obj[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};

/** Dados elétricos do módulo (ficha do catálogo), ou `null` se faltar algum. */
export function moduleElectrical(spec: unknown, modulesInSeries: number): StringElectrical | null {
  if (!spec || typeof spec !== 'object') return null;
  const s = spec as Record<string, unknown>;
  const vocStcV = numberOf(s, 'vocV');
  const iscStcA = numberOf(s, 'iscA');
  const betaVocPctPerC = numberOf(s, 'betaVocPctPerC');
  const alphaIscPctPerC = numberOf(s, 'alphaIscPctPerC');
  if (vocStcV === null || iscStcA === null || betaVocPctPerC === null || alphaIscPctPerC === null)
    return null;
  return { modulesInSeries, vocStcV, iscStcA, betaVocPctPerC, alphaIscPctPerC };
}

export interface CommissioningSubjects {
  strings: CommissioningSubject[];
  inverters: CommissioningSubject[];
  /** Avisos de dado faltando (ex.: módulo sem coeficiente). */
  notes: string[];
}

/**
 * Os alvos dos ensaios que vêm do projeto técnico aprovado: cada string (com os dados elétricos, para o valor
 * esperado) e cada inversor. Microinversor não tem string: entra só como inversor.
 */
export function commissioningSubjects(
  design: EngineeringDesign,
  equipment: readonly EquipmentLike[],
): CommissioningSubjects {
  const byId = new Map(equipment.map((e) => [e.id, e]));
  const surfaces = new Map(design.surfaces.map((s) => [s.id, s]));
  const strings: CommissioningSubject[] = [];
  const inverters: CommissioningSubject[] = [];
  const notes: string[] = [];

  for (const [i, inverter] of design.inverters.entries()) {
    const invLabel = `Inversor ${i + 1}${inverter.name ? ` (${inverter.name})` : ''}`;
    inverters.push({
      key: `inv:${inverter.id}`,
      scope: 'INVERTER',
      label: inverter.micro ? `${invLabel}: ${inverter.micro.units} microinversor(es)` : invLabel,
    });
    for (const [m, mppt] of inverter.mppts.entries()) {
      for (const [g, group] of mppt.strings.entries()) {
        const surface = surfaces.get(group.surfaceId);
        const moduleId = surface?.moduleId ?? design.defaultModuleId;
        const module = moduleId ? byId.get(moduleId) : undefined;
        const electrical = module ? moduleElectrical(module.spec, group.modulesInSeries) : null;
        if (!electrical)
          notes.push(
            `${invLabel} · MPPT ${m + 1}: módulo sem os dados elétricos completos (Voc, Isc e coeficientes).`,
          );
        for (let k = 0; k < group.parallel; k += 1) {
          const label = `${invLabel} · MPPT ${m + 1} · string ${g + 1}${group.parallel > 1 ? `.${k + 1}` : ''}`;
          strings.push({
            key: `str:${inverter.id}:${m}:${group.id}:${k}`,
            scope: 'STRING',
            label,
            ...(electrical ? { electrical } : {}),
          });
        }
      }
    }
  }
  return { strings, inverters, notes: [...new Set(notes)] };
}
