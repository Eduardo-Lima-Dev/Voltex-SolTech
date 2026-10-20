import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DomainEvent, TimelineEventType, type DomainEventEnvelope } from '@voltex/shared';
import { RequestContext } from '../../common/context/request-context';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { GuardService } from '../crm/guard/guard.service';
import { TimelineService } from '../crm/support/timeline.service';

/** Consumidor CRM do evento aprovado: encerra o pedido que originou o projeto, sem reescrever o snapshot. */
@Injectable()
export class EngineeringCrmIntegrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly timeline: TimelineService,
    private readonly guard: GuardService,
  ) {}

  @OnEvent(DomainEvent.ENGINEERING_VERSION_APPROVED, { suppressErrors: false })
  async onApproved(event: DomainEventEnvelope): Promise<void> {
    const projectId = String(event.payload.projectId ?? '');
    if (!projectId) return;
    await this.context.run({ tenantId: event.tenantId }, async () => {
      const project = await this.prisma.db.engineeringProject.findFirst({
        where: { id: projectId },
        select: { opportunityId: true, code: true },
      });
      await this.prisma.db.engineeringRequest.updateMany({
        where: { projectId, status: { in: ['PENDING', 'IN_PROGRESS'] } },
        data: {
          status: 'DONE',
          resolution: `Projeto técnico aprovado (versão ${String(event.payload.versionId ?? '')}).`,
          resolvedAt: new Date(),
        },
      });
      if (!project?.opportunityId) return;
      await this.timeline.record({
        opportunityId: project.opportunityId,
        type: TimelineEventType.ENGINEERING_APPROVED,
        summary: `Projeto técnico ${project.code} aprovado; snapshot técnico disponível para cotação.`,
        data: {
          engineeringProjectId: projectId,
          engineeringVersionId: String(event.payload.versionId ?? ''),
          snapshotHash: String(event.payload.snapshotHash ?? ''),
        },
      });
      // A avaliação anterior tinha ENGINEERING_PENDING no fingerprint. Reavaliar agora produz
      // uma versão da triagem ligada ao pedido concluído, sem alterar nenhum snapshot técnico.
      await this.guard.evaluate(project.opportunityId, true);
    });
  }
}
