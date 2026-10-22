import { randomUUID } from 'node:crypto';
import type {
  ChecklistItemDto,
  CrewDto,
  FieldIssueDto,
  FieldIssueType,
  InstallationHistoryDto,
  MaterialItemDto,
  WorkOrderDto,
} from '@voltex/shared';
import type {
  Crew,
  CrewMember,
  FieldIssue,
  InstallationHistory,
  MaterialItem,
  WorkOrder,
} from '@voltex/database';

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export const toMaterialDto = (m: MaterialItem): MaterialItemDto => ({
  id: m.id,
  category: m.category,
  equipmentId: m.equipmentId,
  description: m.description,
  quantity: m.quantity,
  unit: m.unit,
  unitCostCents: m.unitCostCents,
  status: m.status,
  supplier: m.supplier,
  purchaseOrder: m.purchaseOrder,
  orderedCents: m.orderedCents,
  expectedAt: iso(m.expectedAt),
  receivedAt: iso(m.receivedAt),
  separatedAt: iso(m.separatedAt),
  note: m.note,
});

/** Lê o checklist guardado em JSON, descartando o que não tem o formato esperado. */
export function parseChecklist(value: unknown): ChecklistItemDto[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (i): i is ChecklistItemDto =>
        typeof i === 'object' &&
        i !== null &&
        typeof (i as ChecklistItemDto).id === 'string' &&
        typeof (i as ChecklistItemDto).label === 'string',
    )
    .map((i) => ({
      id: i.id,
      label: i.label,
      done: i.done === true,
      note: typeof i.note === 'string' ? i.note : null,
      doneAt: typeof i.doneAt === 'string' ? i.doneAt : null,
      doneById: typeof i.doneById === 'string' ? i.doneById : null,
    }));
}

/**
 * Monta o checklist a partir dos rótulos enviados: item que já existe (mesmo texto) mantém o estado; os novos entram
 * pendentes; o que saiu da lista sai do checklist.
 */
export function checklistFromLabels(
  labels: readonly string[],
  existing: unknown,
): ChecklistItemDto[] {
  const current = parseChecklist(existing);
  const seen = new Set<string>();
  const items: ChecklistItemDto[] = [];
  for (const raw of labels) {
    const label = raw.trim();
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(
      current.find((c) => c.label.toLowerCase() === key) ?? {
        id: randomUUID(),
        label,
        done: false,
        note: null,
        doneAt: null,
        doneById: null,
      },
    );
  }
  return items;
}

export interface WorkOrderContext {
  photoCount: number;
  crewName: string | null;
  accountName: string | null;
  siteLabel: string | null;
  conflictsWith: string[];
}

export const toWorkOrderDto = (w: WorkOrder, ctx: WorkOrderContext): WorkOrderDto => ({
  id: w.id,
  installationId: w.installationId,
  projectCode: w.projectCode,
  accountId: w.accountId,
  accountName: ctx.accountName,
  siteLabel: ctx.siteLabel,
  type: w.type,
  status: w.status,
  title: w.title,
  notes: w.notes,
  crewId: w.crewId,
  crewName: ctx.crewName,
  assigneeId: w.assigneeId,
  scheduledStart: iso(w.scheduledStart),
  scheduledEnd: iso(w.scheduledEnd),
  startedAt: iso(w.startedAt),
  completedAt: iso(w.completedAt),
  cancelReason: w.cancelReason,
  checklist: parseChecklist(w.checklist),
  signedByName: w.signedByName,
  signedAt: iso(w.signedAt),
  photoCount: ctx.photoCount,
  conflictsWith: ctx.conflictsWith,
});

export const toFieldIssueDto = (i: FieldIssue): FieldIssueDto => ({
  id: i.id,
  installationId: i.installationId,
  workOrderId: i.workOrderId,
  type: i.type as FieldIssueType,
  description: i.description,
  blocking: i.blocking,
  status: i.status,
  resolution: i.resolution,
  reportedById: i.reportedById,
  resolvedById: i.resolvedById,
  resolvedAt: iso(i.resolvedAt),
  createdAt: i.createdAt.toISOString(),
});

export const toHistoryDto = (h: InstallationHistory): InstallationHistoryDto => ({
  id: h.id,
  fromStatus: h.fromStatus,
  toStatus: h.toStatus,
  reason: h.reason,
  actorId: h.actorId,
  createdAt: h.createdAt.toISOString(),
});

export const toCrewDto = (
  c: Crew & { members: (CrewMember & { user: { name: string } })[] },
): CrewDto => ({
  id: c.id,
  name: c.name,
  active: c.active,
  members: c.members.map((m) => ({ userId: m.userId, name: m.user.name })),
});

/** Rótulo curto do local: "Nome do local – Cidade/UF". */
export const siteLabelOf = (
  site: { name: string; city: string; state: string } | null | undefined,
): string | null => (site ? `${site.name} – ${site.city}/${site.state}` : null);
