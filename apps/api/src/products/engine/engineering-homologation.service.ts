import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DomainEvent, type DomainEventEnvelope } from '@voltex/shared';
import { RequestContext } from '../../common/context/request-context';
import { AuditService } from '../../platform/audit/audit.service';
import { DocumentsService } from '../../platform/documents/documents.service';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { EngineeringVersionsService } from './engineering-versions.service';

export interface HomologationAttachResult {
  projectId: string;
  attached: { code: string; documentId: string }[];
  skipped: { code: string; reason: string }[];
}

const NOTE =
  'Anexado automaticamente do projeto técnico aprovado. Confira e assine (ART/TRT) antes de enviar à distribuidora.';

/**
 * Anexa o memorial e o unifilar do projeto técnico **aprovado** ao checklist de homologação do projeto do CRM (7C).
 * Só anexa: marcar o item como entregue continua sendo decisão de quem assina o projeto.
 */
@Injectable()
export class EngineeringHomologationService {
  private readonly logger = new Logger(EngineeringHomologationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
    private readonly documents: DocumentsService,
    private readonly versions: EngineeringVersionsService,
  ) {}

  async attach(versionId: string): Promise<HomologationAttachResult> {
    const version = await this.versions.require(versionId);
    if (version.status !== 'APPROVED')
      throw new UnprocessableEntityException({
        message: 'Só a versão aprovada pode ser anexada à homologação',
        code: 'VERSION_NOT_APPROVED',
      });
    const engineering = await this.prisma.db.engineeringProject.findFirst({
      where: { id: version.projectId },
    });
    if (!engineering?.opportunityId)
      throw new UnprocessableEntityException({
        message: 'O projeto técnico não está ligado a uma oportunidade do CRM',
        code: 'NO_OPPORTUNITY',
      });
    const project = await this.prisma.db.project.findFirst({
      where: { opportunityId: engineering.opportunityId },
      include: { checklist: true },
    });
    if (!project)
      throw new NotFoundException({
        message: 'A oportunidade ainda não tem projeto de homologação (assine o contrato antes)',
        code: 'NO_CRM_PROJECT',
      });

    const plan = [
      { code: 'MEMORIAL', build: () => this.versions.reportPdf(versionId) },
      { code: 'SINGLE_LINE', build: () => this.versions.singleLinePdf(versionId) },
    ] as const;
    const attached: HomologationAttachResult['attached'] = [];
    const skipped: HomologationAttachResult['skipped'] = [];
    for (const step of plan) {
      const item = project.checklist.find((i) => i.code === step.code);
      if (!item) {
        skipped.push({ code: step.code, reason: 'O checklist deste projeto não tem este item.' });
        continue;
      }
      if (item.documentId) {
        skipped.push({ code: step.code, reason: 'O item já tem documento anexado.' });
        continue;
      }
      const { buffer, filename } = await step.build();
      const document = await this.documents.upload(
        { originalname: filename, mimetype: 'application/pdf', buffer, size: buffer.length },
        { entityType: 'Project', entityId: project.id },
      );
      await this.prisma.db.projectChecklistItem.update({
        where: { id: item.id },
        data: { documentId: document.id, note: item.note ? `${item.note}\n${NOTE}` : NOTE },
      });
      attached.push({ code: step.code, documentId: document.id });
    }
    if (attached.length)
      await this.audit.record({
        action: 'engineering.homologation_attached',
        entity: 'Project',
        entityId: project.id,
        after: { versionId, items: attached.map((a) => a.code) },
      });
    return { projectId: project.id, attached, skipped };
  }

  /** Aprovação posterior ao contrato: se já existe projeto de homologação, anexa na hora (sem falhar a aprovação). */
  @OnEvent(DomainEvent.ENGINEERING_VERSION_APPROVED)
  async onApproved(event: DomainEventEnvelope): Promise<void> {
    const versionId = String(event.payload.versionId ?? '');
    if (!versionId) return;
    await this.context.run({ tenantId: event.tenantId }, async () => {
      try {
        await this.attach(versionId);
      } catch (error) {
        // Sem projeto de homologação ainda é o caso normal (o contrato vem depois): a pessoa anexa pelo botão.
        this.logger.debug(`Anexo à homologação adiado: ${(error as Error).message}`);
      }
    });
  }
}
