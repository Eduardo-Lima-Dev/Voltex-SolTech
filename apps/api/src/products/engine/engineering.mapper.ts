import type {
  EngineeringDesign,
  EngineeringProjectDto,
  EngineeringRequestListItemDto,
  EngineeringResults,
  EngineeringVersionDto,
} from '@voltex/shared';
import type { ScopedPrismaClient } from '../../platform/prisma/prisma.service';

type ProjectRow = Awaited<ReturnType<ScopedPrismaClient['engineeringProject']['findFirstOrThrow']>>;
type VersionRow = Awaited<ReturnType<ScopedPrismaClient['engineeringVersion']['findFirstOrThrow']>>;
type RequestRow = Awaited<ReturnType<ScopedPrismaClient['engineeringRequest']['findFirstOrThrow']>>;

export const toVersionDto = (row: VersionRow): EngineeringVersionDto => ({
  id: row.id,
  projectId: row.projectId,
  number: row.number,
  status: row.status,
  design: row.design as unknown as EngineeringDesign,
  results: row.results as unknown as EngineeringResults | null,
  fingerprint: row.fingerprint,
  stale: row.stale,
  staleReasons: row.staleReasons as string[],
  ruleRefs: row.ruleRefs as string[],
  submittedAt: row.submittedAt?.toISOString() ?? null,
  decidedAt: row.decidedAt?.toISOString() ?? null,
  decisionNote: row.decisionNote,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

export interface ProjectExtras {
  requestId: string | null;
  responsibleName: string | null;
  latest: Pick<VersionRow, 'id' | 'number' | 'status'> | null;
  approvedVersionId: string | null;
}

export const toProjectDto = (row: ProjectRow, extras: ProjectExtras): EngineeringProjectDto => ({
  id: row.id,
  code: row.code,
  name: row.name,
  status: row.status,
  opportunityId: row.opportunityId,
  requestId: extras.requestId,
  responsibleId: row.responsibleId,
  responsibleName: extras.responsibleName,
  latestVersionId: extras.latest?.id ?? null,
  latestVersionNumber: extras.latest?.number ?? null,
  latestVersionStatus: extras.latest?.status ?? null,
  approvedVersionId: extras.approvedVersionId,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

export const toRequestDto = (
  row: RequestRow & {
    opportunity: { title: string; projectCode: string; account: { name: string } | null };
  },
  assigneeName: string | null,
): EngineeringRequestListItemDto => ({
  id: row.id,
  opportunityId: row.opportunityId,
  opportunityTitle: row.opportunity.title,
  projectCode: row.opportunity.projectCode,
  customerName: row.opportunity.account?.name ?? null,
  calculationSessionId: row.calculationSessionId,
  reason: row.reason,
  status: row.status,
  assigneeId: row.assigneeId,
  assigneeName,
  projectId: row.projectId,
  resolution: row.resolution,
  resolvedAt: row.resolvedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
});
