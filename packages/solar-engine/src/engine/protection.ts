import type {
  CompatibilityStatus,
  EngineeringDesign,
  InverterEntry,
  InverterSpec,
  ModuleSpec,
  ProtectionItem,
  ProtectionResult,
  ProtectionRole,
  ProtectionSpec,
  Surface,
} from '@voltex/shared';
import { roundTo } from '../units/index.js';
import { moduleThermal } from './compatibility.js';
import type { Candidate } from './configurator.js';

/**
 * Proteções CC e CA (ENG-F10 a F12): para cada inversor do projeto, calcula o que é exigido (fusível de string,
 * seccionadora CC, DPS CC, disjuntor CA, DR) e **sugere o menor item do catálogo aprovado que atende**, com a justificativa.
 * A pessoa pode trocar por outro item, que é conferido contra a mesma exigência. Os fatores (ex.: 1,25 sobre a Isc) são
 * **parâmetros da regra `engine.design`**: sem a regra, o item fica **pendente** e impede a aprovação (ADR-0016).
 * Memorial: `docs/06-calculos/engine-protecoes-cabos.md`.
 */
export const PROTECTION_ALGORITHM_VERSION = 'protection-1.0.0';

export interface ProtectionInput {
  design: EngineeringDesign;
  modules: Record<string, ModuleSpec | undefined>;
  inverters: Record<string, InverterSpec | undefined>;
  /** Proteções **aprovadas** do catálogo, com preço vigente ou custo de referência. */
  catalog: Candidate<ProtectionSpec>[];
  parameters: Record<string, number>;
}

const SRC = {
  fuse: 'EnergIF 2023, p. 169 (EF-R12: exigência do fabricante do módulo); ficha do módulo',
  disc: 'EnergIF 2023, p. 45–46 (EF-M13); regra engine.design',
  surge: 'EnergIF 2023, p. 45–46 (EF-M13)',
  breaker: 'EnergIF 2023, p. 46 (EF-M14); regra engine.design',
  rcd: 'EnergIF 2023, p. 46 (EF-M14: DR de 30 mA); regra engine.design',
};

const KIND_OF_ROLE: Record<ProtectionRole, ProtectionSpec['protectionKind']> = {
  STRING_FUSE: 'FUSE_DC',
  DC_DISCONNECTOR: 'DISCONNECTOR_DC',
  DC_SURGE: 'SURGE_DC',
  AC_BREAKER: 'BREAKER_AC',
  RCD: 'RCD',
};

interface Requirement {
  currentMinA?: number;
  currentMaxA?: number;
  voltageMinV?: number;
  sensitivityMaxMa?: number;
  /** Polos mínimos (disjuntor trifásico). */
  polesMin?: number;
}

const fmt = (n: number) => String(roundTo(n, 2)).replace('.', ',');

function describe(r: Requirement): string {
  const parts: string[] = [];
  if (r.currentMinA !== undefined)
    parts.push(
      r.currentMaxA !== undefined
        ? `corrente de ${fmt(r.currentMinA)} A a ${fmt(r.currentMaxA)} A`
        : `corrente ≥ ${fmt(r.currentMinA)} A`,
    );
  if (r.voltageMinV !== undefined) parts.push(`tensão ≥ ${fmt(r.voltageMinV)} V`);
  if (r.sensitivityMaxMa !== undefined) parts.push(`sensibilidade ≤ ${fmt(r.sensitivityMaxMa)} mA`);
  if (r.polesMin !== undefined) parts.push(`≥ ${r.polesMin} polos`);
  return parts.join('; ');
}

/** `true` se o item atende a exigência. */
function meets(spec: ProtectionSpec, r: Requirement): boolean {
  if (
    r.currentMinA !== undefined &&
    (spec.ratedCurrentA === undefined || spec.ratedCurrentA < r.currentMinA - 1e-9)
  )
    return false;
  if (
    r.currentMaxA !== undefined &&
    spec.ratedCurrentA !== undefined &&
    spec.ratedCurrentA > r.currentMaxA + 1e-9
  )
    return false;
  if (
    r.voltageMinV !== undefined &&
    (spec.ratedVoltageV === undefined || spec.ratedVoltageV < r.voltageMinV - 1e-9)
  )
    return false;
  if (
    r.sensitivityMaxMa !== undefined &&
    (spec.sensitivityMa === undefined || spec.sensitivityMa > r.sensitivityMaxMa + 1e-9)
  )
    return false;
  if (r.polesMin !== undefined && spec.poles !== undefined && spec.poles < r.polesMin) return false;
  return true;
}

const chosenOf = (c: Candidate<ProtectionSpec>): NonNullable<ProtectionItem['chosen']> => ({
  equipmentId: c.id,
  label: c.label,
  ratedCurrentA: c.spec.ratedCurrentA ?? null,
  ratedVoltageV: c.spec.ratedVoltageV ?? null,
  sensitivityMa: c.spec.sensitivityMa ?? null,
  costCents: c.costCents,
});

export function evaluateProtections(input: ProtectionInput): ProtectionResult {
  const { design, parameters } = input;
  const items: ProtectionItem[] = [];
  const pending: ProtectionResult['pending'] = [];
  const addPending = (p: ProtectionResult['pending'][number]) => {
    if (!pending.some((x) => x.code === p.code)) pending.push(p);
  };
  const tminMissing = design.site.designTminC === null || design.site.designTminC === undefined;
  if (design.inverters.length > 0 && tminMissing)
    addPending({
      code: 'TMIN_MISSING',
      kind: 'DATA',
      message:
        'Falta a temperatura mínima de projeto do local: sem ela a tensão exigida das proteções CC não é calculada.',
    });

  const make = (
    base: Pick<
      ProtectionItem,
      'id' | 'role' | 'inverterEntryId' | 'mpptIndex' | 'quantity' | 'source'
    >,
    req: Requirement | null,
    missing: string | null,
  ): void => {
    const override = design.protectionOverrides.find(
      (o) =>
        o.role === base.role &&
        o.inverterEntryId === base.inverterEntryId &&
        (o.mpptIndex ?? null) === base.mpptIndex,
    );
    const empty: ProtectionItem = {
      ...base,
      requirement: req ? describe(req) : '',
      currentMinA: req?.currentMinA ?? null,
      currentMaxA: req?.currentMaxA ?? null,
      voltageMinV: req?.voltageMinV ?? null,
      sensitivityMaxMa: req?.sensitivityMaxMa ?? null,
      chosen: null,
      manual: false,
      outcome: 'PENDING',
      justification: missing ?? '',
    };
    if (!req) {
      items.push({
        ...empty,
        justification: missing ?? 'Falta dado ou regra para calcular a exigência.',
      });
      return;
    }
    const kind = KIND_OF_ROLE[base.role];
    if (override) {
      const found = input.catalog.find((c) => c.id === override.equipmentId);
      if (!found || found.spec.protectionKind !== kind) {
        items.push({
          ...empty,
          manual: true,
          outcome: 'OVERRIDE_FAILS',
          justification: 'O item escolhido não é uma proteção aprovada deste tipo.',
        });
        return;
      }
      const ok = meets(found.spec, req);
      items.push({
        ...empty,
        chosen: chosenOf(found),
        manual: true,
        outcome: ok ? 'OK' : 'OVERRIDE_FAILS',
        justification: ok
          ? `Escolhido à mão: ${found.label} atende a exigência (${describe(req)}).`
          : `Escolhido à mão: ${found.label} NÃO atende a exigência (${describe(req)}).`,
      });
      return;
    }
    const candidates = input.catalog
      .filter((c) => c.spec.protectionKind === kind && meets(c.spec, req))
      .sort(
        (a, b) =>
          (a.spec.ratedCurrentA ?? 0) - (b.spec.ratedCurrentA ?? 0) ||
          (a.spec.ratedVoltageV ?? 0) - (b.spec.ratedVoltageV ?? 0) ||
          (a.costCents ?? Number.POSITIVE_INFINITY) - (b.costCents ?? Number.POSITIVE_INFINITY) ||
          a.id.localeCompare(b.id),
      );
    const best = candidates[0];
    items.push(
      best
        ? {
            ...empty,
            chosen: chosenOf(best),
            outcome: 'OK',
            justification: `Menor item aprovado que atende (${describe(req)}): ${best.label}.`,
          }
        : {
            ...empty,
            outcome: 'NONE_AVAILABLE',
            justification: `Nenhum item aprovado no catálogo atende (${describe(req)}). Cadastre e aprove um.`,
          },
    );
  };

  for (const entry of design.inverters) {
    const inverter = input.inverters[entry.inverterId];
    if (!inverter) continue;

    if (inverter.topology !== 'MICRO') {
      entry.mppts.forEach((mppt, index) => {
        if (mppt.strings.length === 0) return;
        const first = mppt.strings[0];
        const surface = design.surfaces.find((s) => s.id === first?.surfaceId) as
          Surface | undefined;
        const moduleId = surface ? (surface.moduleId ?? design.defaultModuleId) : undefined;
        const module = moduleId ? input.modules[moduleId] : undefined;
        if (!module) return;
        const t = moduleThermal(module, design, parameters);
        const parallel = mppt.strings.reduce((n, s) => n + s.parallel, 0);
        const vocString =
          t.vocColdV === null
            ? null
            : Math.max(...mppt.strings.map((s) => s.modulesInSeries)) * t.vocColdV;
        const scope = `${entry.id}/MPPT${index + 1}`;

        // Fusível de string: exigido quando há mais strings em paralelo do que a regra permite sem fusível.
        const maxNoFuse = parameters.maxParallelStringsWithoutFuse;
        if (maxNoFuse === undefined) {
          addPending({
            code: 'RULE_MAX_PARALLEL_STRINGS',
            kind: 'RULE',
            message:
              'A regra engine.design não define quantas strings em paralelo dispensam fusível (maxParallelStringsWithoutFuse).',
          });
          make(
            {
              id: `${scope}/fuse`,
              role: 'STRING_FUSE',
              inverterEntryId: entry.id,
              mpptIndex: index,
              quantity: parallel,
              source: SRC.fuse,
            },
            null,
            'Pendente da regra: quantas strings em paralelo dispensam fusível.',
          );
        } else if (parallel > maxNoFuse) {
          const factor = parameters.fuseMinFactor;
          if (factor === undefined) {
            addPending({
              code: 'RULE_FUSE_MIN_FACTOR',
              kind: 'RULE',
              message:
                'A regra engine.design não define o fator mínimo do fusível sobre a Isc (fuseMinFactor).',
            });
            make(
              {
                id: `${scope}/fuse`,
                role: 'STRING_FUSE',
                inverterEntryId: entry.id,
                mpptIndex: index,
                quantity: parallel,
                source: SRC.fuse,
              },
              null,
              'Pendente da regra: fator mínimo do fusível.',
            );
          } else if (module.maxSeriesFuseA === undefined) {
            addPending({
              code: 'MODULE_MAX_FUSE_MISSING',
              kind: 'DATA',
              message:
                'A ficha do módulo não traz o fusível máximo em série: sem ele o fusível de string não é dimensionado.',
            });
            make(
              {
                id: `${scope}/fuse`,
                role: 'STRING_FUSE',
                inverterEntryId: entry.id,
                mpptIndex: index,
                quantity: parallel,
                source: SRC.fuse,
              },
              null,
              'Falta o fusível máximo na ficha do módulo.',
            );
          } else if (vocString === null) {
            make(
              {
                id: `${scope}/fuse`,
                role: 'STRING_FUSE',
                inverterEntryId: entry.id,
                mpptIndex: index,
                quantity: parallel,
                source: SRC.fuse,
              },
              null,
              'Falta a temperatura mínima de projeto.',
            );
          } else {
            make(
              {
                id: `${scope}/fuse`,
                role: 'STRING_FUSE',
                inverterEntryId: entry.id,
                mpptIndex: index,
                quantity: parallel,
                source: SRC.fuse,
              },
              {
                currentMinA: factor * module.iscA,
                currentMaxA:
                  parameters.fuseMaxFactor === undefined
                    ? module.maxSeriesFuseA
                    : Math.min(module.maxSeriesFuseA, parameters.fuseMaxFactor * module.iscA),
                voltageMinV: vocString,
              },
              null,
            );
          }
        }

        // Seccionadora CC e DPS CC: uma por MPPT.
        const factor = parameters.dcSwitchCurrentFactor;
        if (factor === undefined)
          addPending({
            code: 'RULE_DC_SWITCH_FACTOR',
            kind: 'RULE',
            message:
              'A regra engine.design não define o fator da seccionadora CC sobre a Isc (dcSwitchCurrentFactor).',
          });
        make(
          {
            id: `${scope}/disconnector`,
            role: 'DC_DISCONNECTOR',
            inverterEntryId: entry.id,
            mpptIndex: index,
            quantity: 1,
            source: SRC.disc,
          },
          factor === undefined || vocString === null
            ? null
            : { currentMinA: factor * module.iscA * parallel, voltageMinV: vocString },
          factor === undefined
            ? 'Pendente da regra: fator da seccionadora CC.'
            : 'Falta a temperatura mínima de projeto.',
        );
        make(
          {
            id: `${scope}/surge`,
            role: 'DC_SURGE',
            inverterEntryId: entry.id,
            mpptIndex: index,
            quantity: 1,
            source: SRC.surge,
          },
          vocString === null ? null : { voltageMinV: vocString },
          'Falta a temperatura mínima de projeto.',
        );
      });
    }

    // Lado CA: disjuntor e DR, um por inversor (micro: um por entrada, com a potência de todas as unidades).
    const units = inverter.topology === 'MICRO' ? (entry.micro?.units ?? 1) : 1;
    const phases = inverter.phases;
    const acPowerW = inverter.pAcNomW * units;
    const iAc =
      inverter.iAcMaxA !== undefined && units === 1
        ? inverter.iAcMaxA
        : phases === 3
          ? acPowerW / (Math.sqrt(3) * inverter.vAcV)
          : acPowerW / inverter.vAcV;
    const factor = parameters.acBreakerFactor;
    if (factor === undefined)
      addPending({
        code: 'RULE_AC_BREAKER_FACTOR',
        kind: 'RULE',
        message:
          'A regra engine.design não define o fator do disjuntor CA sobre a corrente do inversor (acBreakerFactor).',
      });
    const breakerReq: Requirement | null =
      factor === undefined
        ? null
        : {
            currentMinA: factor * iAc,
            voltageMinV: inverter.vAcV,
            polesMin: phases === 3 ? 3 : phases,
          };
    make(
      {
        id: `${entry.id}/breaker`,
        role: 'AC_BREAKER',
        inverterEntryId: entry.id,
        mpptIndex: null,
        quantity: 1,
        source: SRC.breaker,
      },
      breakerReq,
      'Pendente da regra: fator do disjuntor CA.',
    );
    const sensitivity = parameters.rcdSensitivityMa;
    if (sensitivity === undefined)
      addPending({
        code: 'RULE_RCD_SENSITIVITY',
        kind: 'RULE',
        message: 'A regra engine.design não define a sensibilidade do DR (rcdSensitivityMa).',
      });
    const breakerItem = items.find((i) => i.id === `${entry.id}/breaker`);
    const breakerCurrent = breakerItem?.chosen?.ratedCurrentA ?? breakerReq?.currentMinA;
    make(
      {
        id: `${entry.id}/rcd`,
        role: 'RCD',
        inverterEntryId: entry.id,
        mpptIndex: null,
        quantity: 1,
        source: SRC.rcd,
      },
      sensitivity === undefined || breakerCurrent === undefined
        ? null
        : { currentMinA: breakerCurrent, sensitivityMaxMa: sensitivity },
      sensitivity === undefined
        ? 'Pendente da regra: sensibilidade do DR.'
        : 'Depende do disjuntor CA.',
    );
  }

  const hasFail = items.some(
    (i) => i.outcome === 'NONE_AVAILABLE' || i.outcome === 'OVERRIDE_FAILS',
  );
  const hasPending = items.some((i) => i.outcome === 'PENDING') || pending.length > 0;
  const status: CompatibilityStatus =
    design.inverters.length === 0
      ? 'INCOMPLETE'
      : hasFail
        ? 'INVALID'
        : hasPending
          ? 'INCOMPLETE'
          : 'VALID';
  if (design.inverters.length === 0)
    addPending({
      code: 'NO_INVERTERS',
      kind: 'DATA',
      message: 'Nenhum inversor no projeto: não há proteções a dimensionar.',
    });
  return { status, items, pending, algorithmVersion: PROTECTION_ALGORITHM_VERSION };
}

/** Entradas do inversor, para a lista de materiais. */
export const entriesOf = (design: EngineeringDesign): InverterEntry[] => design.inverters;
