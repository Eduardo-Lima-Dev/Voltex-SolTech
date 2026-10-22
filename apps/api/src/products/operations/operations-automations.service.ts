import { Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DomainEvent, type DomainEventEnvelope } from '@voltex/shared';
import { RequestContext } from '../../common/context/request-context';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { InstallationsService } from './installations.service';
import { MaterialsService } from './materials.service';

const DAY = 86_400_000;

/**
 * Automações de execução (modelagem §44): reagem aos eventos do CRM. São idempotentes: reentregar um evento não
 * duplica instalação, itens nem tarefas.
 */
@Injectable()
export class OperationsAutomationsService {
  private readonly logger = new Logger(OperationsAutomationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly installations: InstallationsService,
    private readonly materials: MaterialsService,
  ) {}

  /** Contrato assinado → projeto criado → nasce a instalação, aguardando a engenharia. */
  @OnEvent(DomainEvent.PROJECT_CREATED, { suppressErrors: false })
  async onProjectCreated(event: DomainEventEnvelope): Promise<void> {
    const projectId = String(event.payload.projectId ?? '');
    if (!projectId) return;
    await this.context.run({ tenantId: event.tenantId }, () =>
      this.installations.ensureForProject(projectId),
    );
  }

  /** Homologação aprovada → libera compra e agendamento: material aguardado, lista gerada e tarefa de compra. */
  @OnEvent(DomainEvent.HOMOLOGATION_APPROVED, { suppressErrors: false })
  async onHomologationApproved(event: DomainEventEnvelope): Promise<void> {
    const projectId = String(event.payload.projectId ?? '');
    if (!projectId) return;
    await this.context.run({ tenantId: event.tenantId }, async () => {
      let inst = await this.installations.ensureForProject(projectId);
      if (inst.status === 'AWAITING_ENGINEERING')
        inst = await this.installations.transition(inst, 'AWAITING_MATERIAL', {
          automatic: true,
          reason: 'Homologação aprovada',
        });
      if (inst.status !== 'AWAITING_MATERIAL') return;
      try {
        await this.materials.generateFromSnapshot(inst.id);
      } catch (error) {
        // Sem projeto técnico (cotação direta) a lista é montada à mão: não é falha.
        if (!(error instanceof UnprocessableEntityException)) throw error;
        this.logger.log(`Lista de materiais não gerada para ${inst.projectCode}: ${error.message}`);
      }
      await this.prisma.db.$transaction(async (tx) => {
        await this.installations.upsertTask(tx, inst, {
          key: `install-purchase:${inst.id}`,
          title: 'Comprar o material: a homologação foi aprovada',
          dueAt: new Date(Date.now() + 3 * DAY),
          assigneeId: inst.responsibleId,
        });
      });
    });
  }
}
