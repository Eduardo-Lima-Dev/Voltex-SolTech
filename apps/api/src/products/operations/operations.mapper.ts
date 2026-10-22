import type {
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

export interface WorkOrderContext {
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
