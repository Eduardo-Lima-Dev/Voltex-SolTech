import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@voltex/database';
import {
  DomainEvent,
  OpportunityStage,
  TimelineEventType,
  type DomainEventEnvelope,
} from '@voltex/shared';
import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { RequestContext } from '../../../common/context/request-context';
import type { Env } from '../../../config/env';
import { AuditService } from '../../../platform/audit/audit.service';
import { EventBus } from '../../../platform/events/event-bus.service';
import { PrismaService } from '../../../platform/prisma/prisma.service';
import { TimelineService } from '../support/timeline.service';

const QUEUE = 'crm-automations';
const HOUR = 3_600_000;
const DEFAULT_BILL_FOLLOW_UP_HOURS = 24;
const PROPOSAL_FOLLOW_UP_HOURS = 4;

export interface ScanResult {
  leadAlerts: number;
  billTasks: number;
}

/**
 * Automações essenciais do CRM (seção 42): regras simples e **idempotentes** que viram alertas e tarefas.
 *
 *  - lead sem primeiro contato dentro do prazo → evento `LeadSlaBreached` + tarefa para o responsável;
 *  - fatura pedida e não recebida (etapa "Fatura pendente" há mais de `billFollowUpHours`, padrão 24 h) → tarefa de cobrança;
 *  - proposta visualizada pelo cliente → tarefa de follow-up para o responsável.
 *
 * "Contrato assinado → projeto" não passa pela fila: acontece na própria transação da assinatura (tudo ou nada).
 * Cada tarefa leva uma chave de automação única: repetir a varredura ou reentregar o evento não duplica nada.
 */
@Injectable()
export class AutomationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AutomationsService.name);
  private connection?: IORedis;
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly timeline: TimelineService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async onModuleInit(): Promise<void> {
    const url = this.config.get('REDIS_URL', { infer: true });
    const prefix = this.config.get('AUTOMATION_QUEUE_PREFIX', { infer: true });
    const interval = this.config.get('AUTOMATION_SCAN_INTERVAL_MS', { infer: true });
    this.connection = new IORedis(url, { maxRetriesPerRequest: null, lazyConnect: false });
    this.connection.on('error', (error) =>
      this.logger.warn(`Redis das automações: ${error.message}`),
    );
    this.queue = new Queue(QUEUE, { connection: this.connection, prefix });
    this.queue.on('error', (error) => this.logger.warn(`Fila das automações: ${error.message}`));
    this.worker = new Worker(QUEUE, (job) => this.process(job), {
      connection: this.connection,
      prefix,
      concurrency: 2,
    });
    this.worker.on('failed', (job, error) =>
      this.logger.error({ err: error, job: job?.name }, 'Falha numa automação'),
    );
    this.worker.on('error', (error) => this.logger.warn(`Worker das automações: ${error.message}`));
    if (interval > 0)
      await this.queue
        .upsertJobScheduler('scan', { every: interval }, { name: 'scan' })
        .catch((error: unknown) =>
          this.logger.error({ err: error }, 'Não foi possível agendar a varredura'),
        );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
    this.connection?.disconnect();
  }

  /** Enfileira a varredura (também usada pelo agendamento e pelos testes). */
  async enqueueScan(): Promise<void> {
    await this.queue?.add('scan', {}, { removeOnComplete: true, removeOnFail: 50 });
  }

  /** Estado da fila (diagnóstico e testes). */
  async counts() {
    return this.queue?.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
  }

  private async process(job: Job): Promise<unknown> {
    if (job.name === 'scan') return this.runScan();
    if (job.name === 'proposal-viewed') return this.proposalViewedTask(job.data as ViewedPayload);
    return undefined;
  }

  @OnEvent(DomainEvent.PROPOSAL_VIEWED, { suppressErrors: false })
  async onProposalViewed(event: DomainEventEnvelope): Promise<void> {
    const payload: ViewedPayload = {
      tenantId: event.tenantId,
      opportunityId: String(event.payload.opportunityId),
      proposalId: String(event.payload.proposalId),
      version: Number(event.payload.version),
    };
    if (!this.queue) {
      await this.proposalViewedTask(payload);
      return;
    }
    // O jobId evita duplicar o job; a chave de automação evita duplicar a tarefa.
    await this.queue.add('proposal-viewed', payload, {
      jobId: `proposal-viewed-${payload.proposalId}`,
      removeOnComplete: true,
      removeOnFail: 50,
    });
  }

  // ---- Regras ----

  async runScan(): Promise<ScanResult> {
    const [leadAlerts, billTasks] = await Promise.all([
      this.scanLeadSla(),
      this.scanBillFollowUp(),
    ]);
    return { leadAlerts, billTasks };
  }

  private async scanLeadSla(): Promise<number> {
    const leads = await this.prisma.system.lead.findMany({
      where: {
        status: 'NEW',
        firstContactAt: null,
        firstContactDueAt: { lt: new Date() },
        slaAlertedAt: null,
        deletedAt: null,
      },
      orderBy: { firstContactDueAt: 'asc' },
      take: 200,
    });
    let alerted = 0;
    for (const lead of leads)
      alerted += await this.context.run({ tenantId: lead.tenantId }, () =>
        this.prisma.db.$transaction(async (tx) => {
          // Reserva o alerta: se outra instância já fez, não faz de novo.
          const claimed = await tx.lead.updateMany({
            where: { id: lead.id, slaAlertedAt: null },
            data: { slaAlertedAt: new Date() },
          });
          if (claimed.count === 0) return 0;
          await tx.task.create({
            data: {
              tenantId: lead.tenantId,
              title: `Contatar o lead ${lead.name}: prazo do primeiro contato estourado`,
              dueAt: new Date(),
              assigneeId: lead.ownerId,
              leadId: lead.id,
              origin: 'automation:lead-sla',
              automationKey: `lead-sla:${lead.id}`,
            },
          });
          await this.events.publish(
            {
              type: DomainEvent.LEAD_SLA_BREACHED,
              actorId: null,
              payload: {
                leadId: lead.id,
                ownerId: lead.ownerId,
                dueAt: lead.firstContactDueAt?.toISOString() ?? null,
              },
            },
            tx,
          );
          await this.audit.record(
            {
              action: 'automation.lead_sla_breached',
              entity: 'Lead',
              entityId: lead.id,
              actorId: null,
            },
            tx,
          );
          return 1;
        }),
      );
    return alerted;
  }

  private async scanBillFollowUp(): Promise<number> {
    const candidates = await this.prisma.system.opportunity.findMany({
      where: {
        status: 'OPEN',
        stage: OpportunityStage.BILL_PENDING,
        deletedAt: null,
        stageChangedAt: { lt: new Date(Date.now() - HOUR) },
      },
      include: { account: { select: { name: true } } },
      take: 500,
    });
    if (candidates.length === 0) return 0;
    const [bills, tenants] = await Promise.all([
      this.prisma.system.energyBill.findMany({
        where: { opportunityId: { in: candidates.map((c) => c.id) }, status: { not: 'REJECTED' } },
        select: { opportunityId: true },
      }),
      this.prisma.system.tenant.findMany({
        where: { id: { in: [...new Set(candidates.map((c) => c.tenantId))] } },
        select: { id: true, settings: true },
      }),
    ]);
    const received = new Set(bills.map((b) => b.opportunityId));
    const hours = new Map(
      tenants.map((t) => [
        t.id,
        Number(
          (t.settings as { billFollowUpHours?: number } | null)?.billFollowUpHours ??
            DEFAULT_BILL_FOLLOW_UP_HOURS,
        ),
      ]),
    );
    let created = 0;
    for (const opp of candidates) {
      if (received.has(opp.id)) continue;
      const waited = (Date.now() - opp.stageChangedAt.getTime()) / HOUR;
      if (waited < (hours.get(opp.tenantId) ?? DEFAULT_BILL_FOLLOW_UP_HOURS)) continue;
      created += await this.createTask(opp.tenantId, {
        opportunityId: opp.id,
        assigneeId: opp.ownerId,
        title: `Cobrar a fatura de energia de ${opp.account.name}: pedida e ainda não recebida`,
        dueAt: new Date(),
        origin: 'automation:bill-followup',
        // A etapa é parte da chave: se a oportunidade voltar a "Fatura pendente" depois, nasce outra tarefa.
        key: `bill-followup:${opp.id}:${opp.stageChangedAt.getTime()}`,
      });
    }
    return created;
  }

  async proposalViewedTask(payload: ViewedPayload): Promise<number> {
    const opportunity = await this.context.run({ tenantId: payload.tenantId }, () =>
      this.prisma.db.opportunity.findFirst({
        where: { id: payload.opportunityId },
        include: { account: { select: { name: true } } },
      }),
    );
    if (!opportunity || opportunity.status !== 'OPEN') return 0;
    return this.createTask(payload.tenantId, {
      opportunityId: opportunity.id,
      assigneeId: opportunity.ownerId,
      title: `Fazer o follow-up com ${opportunity.account.name}: o cliente abriu a proposta v${payload.version}`,
      dueAt: new Date(Date.now() + PROPOSAL_FOLLOW_UP_HOURS * HOUR),
      origin: 'automation:proposal-viewed',
      key: `proposal-viewed:${payload.proposalId}`,
    });
  }

  /** Cria a tarefa uma única vez por chave. Devolve 1 se criou, 0 se já existia. */
  private async createTask(
    tenantId: string,
    task: {
      opportunityId: string;
      assigneeId: string | null;
      title: string;
      dueAt: Date;
      origin: string;
      key: string;
    },
  ): Promise<number> {
    try {
      await this.context.run({ tenantId }, () =>
        this.prisma.db.$transaction(async (tx) => {
          await tx.task.create({
            data: {
              tenantId,
              title: task.title,
              dueAt: task.dueAt,
              assigneeId: task.assigneeId,
              opportunityId: task.opportunityId,
              origin: task.origin,
              automationKey: task.key,
            },
          });
          await this.timeline.record(
            {
              opportunityId: task.opportunityId,
              type: TimelineEventType.TASK_CREATED,
              summary: `Tarefa automática: ${task.title}`,
              data: { origin: task.origin },
              actorId: null,
            },
            tx,
          );
        }),
      );
      return 1;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return 0;
      throw error;
    }
  }
}

interface ViewedPayload {
  tenantId: string;
  opportunityId: string;
  proposalId: string;
  version: number;
}
