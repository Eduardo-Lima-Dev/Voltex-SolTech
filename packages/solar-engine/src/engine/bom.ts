import type {
  BillOfMaterials,
  BomLine,
  CableResult,
  EngineeringDesign,
  InverterSpec,
  ProtectionResult,
  SurfaceLayoutResult,
} from '@voltex/shared';

/**
 * Lista de materiais (ENG-F24): módulos, inversores, proteções e cabos do projeto, com **preço vigente** (tabela de
 * preços) ou o custo de referência do catálogo. Item sem preço aparece como tal e bloqueia a cotação **desse item**.
 * Cabos: ida e volta no CC (2 condutores) e fase, neutro conforme a rede no CA; o condutor de proteção (PE) não entra.
 */
export const BOM_ALGORITHM_VERSION = 'bom-1.0.0';

export interface UnitPrice {
  cents: number;
  source: 'PRICE_LIST' | 'REFERENCE';
}

export interface BomInput {
  design: EngineeringDesign;
  layout: SurfaceLayoutResult[];
  protection: ProtectionResult;
  cables: CableResult;
  inverters: Record<string, InverterSpec | undefined>;
  /** Nome legível de cada equipamento do catálogo. */
  labels: Record<string, string | undefined>;
  prices: Record<string, UnitPrice | undefined>;
  /** Parâmetros da regra `engine.cables` (sobra de cabo, opcional). */
  cableParameters: Record<string, number>;
}

const ROLE_LABEL: Record<string, string> = {
  STRING_FUSE: 'Fusível de string',
  DC_DISCONNECTOR: 'Seccionadora CC',
  DC_SURGE: 'DPS CC',
  AC_BREAKER: 'Disjuntor CA',
  RCD: 'DR',
};

export function buildBom(input: BomInput): BillOfMaterials {
  const lines: BomLine[] = [];
  const add = (
    category: BomLine['category'],
    equipmentId: string | null,
    description: string,
    quantity: number,
    unit: BomLine['unit'],
    price: UnitPrice | undefined,
    note: string | null = null,
  ) => {
    if (quantity <= 0) return;
    const existing = lines.find(
      (l) =>
        l.category === category &&
        l.equipmentId === equipmentId &&
        l.description === description &&
        l.unit === unit,
    );
    if (existing) {
      existing.quantity = Math.round((existing.quantity + quantity) * 1000) / 1000;
      existing.totalCents =
        existing.unitCostCents === null
          ? null
          : Math.round(existing.unitCostCents * existing.quantity);
      return;
    }
    lines.push({
      category,
      equipmentId,
      description,
      quantity: Math.round(quantity * 1000) / 1000,
      unit,
      unitCostCents: price?.cents ?? null,
      totalCents: price ? Math.round(price.cents * quantity) : null,
      priceSource: price?.source ?? 'NONE',
      note,
    });
  };
  const label = (id: string) => input.labels[id] ?? id;

  for (const l of input.layout)
    if (l.moduleId)
      add('MODULE', l.moduleId, label(l.moduleId), l.moduleCount, 'un', input.prices[l.moduleId]);
  for (const entry of input.design.inverters)
    add(
      'INVERTER',
      entry.inverterId,
      label(entry.inverterId),
      entry.micro ? entry.micro.units : 1,
      'un',
      input.prices[entry.inverterId],
    );
  for (const item of input.protection.items)
    if (item.chosen)
      add(
        'PROTECTION',
        item.chosen.equipmentId,
        `${ROLE_LABEL[item.role]}: ${item.chosen.label}`,
        item.quantity,
        'un',
        input.prices[item.chosen.equipmentId],
      );
    else
      add(
        'PROTECTION',
        null,
        `${ROLE_LABEL[item.role]} (sem item escolhido)`,
        item.quantity,
        'un',
        undefined,
        item.justification,
      );

  const surplus = 1 + (input.cableParameters.cableSurplusPct ?? 0) / 100;
  for (const run of input.cables.runs) {
    const source = input.design.cables.find((c) => c.id === run.runId);
    const entry = input.design.inverters.find((e) => e.id === source?.inverterEntryId);
    const inverter = entry ? input.inverters[entry.inverterId] : undefined;
    const conductors =
      run.kind === 'AC' ? (inverter?.phases === 3 ? 4 : inverter?.phases === 2 ? 3 : 2) : 2;
    const meters = run.lengthM * conductors * run.count * surplus;
    if (run.chosen)
      add(
        'CABLE',
        run.chosen.equipmentId,
        `Cabo ${run.kind === 'AC' ? 'CA' : 'solar CC'}: ${run.chosen.label}`,
        meters,
        'm',
        input.prices[run.chosen.equipmentId],
        `${conductors} condutor(es) por trecho${surplus > 1 ? `, com sobra de ${input.cableParameters.cableSurplusPct}%` : ''}`,
      );
    else
      add(
        'CABLE',
        null,
        `Cabo ${run.kind === 'AC' ? 'CA' : 'CC'} (sem cabo escolhido)`,
        meters,
        'm',
        undefined,
        run.label,
      );
  }

  const priced = lines.filter((l) => l.totalCents !== null);
  return {
    lines,
    totalCents:
      priced.length === 0 ? null : priced.reduce((s, l) => s + (l.totalCents as number), 0),
    unpricedCount: lines.filter((l) => l.totalCents === null).length,
    algorithmVersion: BOM_ALGORITHM_VERSION,
  };
}
