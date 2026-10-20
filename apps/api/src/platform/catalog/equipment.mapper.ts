import type { EquipmentDto, EquipmentSpec, FieldConfidence } from '@voltex/shared';
import type { ScopedPrismaClient } from '../prisma/prisma.service';

export type EquipmentRow = Awaited<
  ReturnType<ScopedPrismaClient['equipmentItem']['findFirstOrThrow']>
>;

export const toEquipmentDto = (row: EquipmentRow): EquipmentDto => ({
  id: row.id,
  kind: row.kind,
  manufacturer: row.manufacturer,
  model: row.model,
  spec: row.spec as unknown as EquipmentSpec,
  origin: row.origin,
  fieldConfidence: row.fieldConfidence as Record<string, FieldConfidence>,
  referenceCostCents: row.referenceCostCents,
  datasheetDocumentId: row.datasheetDocumentId,
  inmetroRegistration: row.inmetroRegistration,
  inmetroStatus: row.inmetroStatus as EquipmentDto['inmetroStatus'],
  inmetroCheckedAt: row.inmetroCheckedAt?.toISOString() ?? null,
  inmetroCheckedBy: row.inmetroCheckedBy,
  status: row.status,
  revision: row.revision,
  supersedesId: row.supersedesId,
  approvedById: row.approvedById,
  approvedAt: row.approvedAt?.toISOString() ?? null,
  retiredAt: row.retiredAt?.toISOString() ?? null,
  notes: row.notes,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});
