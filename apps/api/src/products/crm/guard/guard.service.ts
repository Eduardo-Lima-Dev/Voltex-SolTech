import { createHash } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  UnprocessableEntityException,
  type OnModuleInit,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { Opportunity, TriageOverride, TriageSnapshot } from '@voltex/database';
import {
  DomainEvent,
  OpportunityStage,
  TimelineEventType,
  type DomainEventEnvelope,
  type GuardCheckDto,
  type GuardEvaluationDto,
  type GuardOverviewDto,
  type OverrideGuardInput,
  type SiteIntake,
} from '@voltex/shared';
import {
  GUARD_ALGORITHM_VERSION,
  evaluateProjectGuard,
  type GuardCalculationInput,
  type GuardInputs,
  type QuickCalculationResult,
  type ParsedQuickCalculationInput,
  type CalculationReferencesSummary,
} from '@voltex/solar-engine';
import { RequestContext } from '../../../common/context/request-context';
import { AuditService } from '../../../platform/audit/audit.service';
import { EventBus } from '../../../platform/events/event-bus.service';
import { PrismaService } from '../../../platform/prisma/prisma.service';
import { RulesService } from '../../../platform/rules/rules.service';
import { OpportunitiesService } from '../opportunities.service';
import { TimelineService } from '../support/timeline.service';
import { UserDirectory } from '../support/user-directory.service';

type Row = TriageSnapshot & { overrides: TriageOverride[] };

const LIGHT_LABEL = { GREEN: 'verde', YELLOW: 'amarela', RED: 'vermelha' } as const;

interface Gathered {
  inputs: GuardInputs;
  fingerprint: string;
  billSnapshotId: string | null;
  calculationSessionId: string | null;
}

const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

@Injectable()
export class GuardService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly rules: RulesService,
    private readonly timeline: TimelineService,
    private readonly users: UserDirectory,
    private readonly opportunities: OpportunitiesService,
  ) {}

  onModuleInit(): void {
    // A cotação só começa depois da triagem liberada (fluxo: fatura → cálculo → triagem → margem → proposta).
    this.opportunities.registerGate({
      assertCanEnter: async (opportunity, to) => {
        if (to !== OpportunityStage.QUOTING) return;
        const overview = await this.overview(opportunity.id);
        if (overview.current?.releasedForQuote) return;
        throw new UnprocessableEntityException({
          message: overview.current
            ? overview.current.stale
              ? 'As premissas mudaram desde a última triagem: avalie de novo na aba Triagem antes da cotação.'
              : `A triagem está ${LIGHT_LABEL[overview.current.status]}: corrija os pontos ou libere-a formalmente na aba Triagem antes da cotação.`
            : 'Avalie a triagem na aba Triagem antes de seguir para a cotação.',
          code: 'GUARD_REQUIRED',
          data: {
            status: overview.current?.status ?? null,
            stale: overview.current?.stale ?? null,
          },
        });
      },
    });
  }

  // ---- Consulta ----

  async overview(opportunityId: string): Promise<GuardOverviewDto> {
    const opportunity = await this.opportunities.findOrThrow(opportunityId);
    const rows = await this.prisma.db.triageSnapshot.findMany({
      where: { opportunityId },
      include: { overrides: true },
      orderBy: { version: 'desc' },
      take: 50,
    });
    if (rows.length === 0) return { current: null, history: [] };
    const live = await this.gather(opportunity);
    const names = await this.users.names(
      rows.flatMap((r) => [r.createdById, ...r.overrides.map((o) => o.decidedById)]),
    );
    const dtos = rows.map((row, index) =>
      this.toDto(row, names, index === 0 ? live.fingerprint : null),
    );
    return { current: dtos[0] ?? null, history: dtos.slice(1) };
  }

  // ---- Avaliação ----

  /** Roda a triagem. Se nada mudou desde a última avaliação válida, devolve a mesma (sem criar versão nova). */
  async evaluate(opportunityId: string, force = false): Promise<GuardEvaluationDto> {
    const opportunity = await this.opportunities.findOrThrow(opportunityId);
    if (opportunity.status !== 'OPEN')
      throw new ConflictException('Oportunidade encerrada não pode ser reavaliada');
    const gathered = await this.gather(opportunity);

    const latest = await this.prisma.db.triageSnapshot.findFirst({
      where: { opportunityId },
      include: { overrides: true },
      orderBy: { version: 'desc' },
    });
    if (
      !force &&
      latest &&
      !latest.invalidatedAt &&
      latest.inputsFingerprint === gathered.fingerprint
    ) {
      const names = await this.users.names([
        latest.createdById,
        ...latest.overrides.map((o) => o.decidedById),
      ]);
      return this.toDto(latest, names, gathered.fingerprint);
    }

    const result = evaluateProjectGuard(gathered.inputs);
    const rules = await this.rules.effective();
    const row = await this.prisma.db.$transaction(async (tx) => {
      const created = await tx.triageSnapshot.create({
        data: {
          tenantId: this.context.requireTenantId(),
          opportunityId,
          version: (latest?.version ?? 0) + 1,
          status: result.status,
          checks: result.checks as object,
          missingFields: result.missingFields as object,
          needsHumanReview: result.needsHumanReview,
          needsEngineeringReview: result.needsEngineeringReview,
          algorithmVersion: result.algorithmVersion,
          ruleSetRef: rules.ref,
          billSnapshotId: gathered.billSnapshotId,
          calculationSessionId: gathered.calculationSessionId,
          inputsFingerprint: gathered.fingerprint,
          createdById: this.context.userId ?? null,
        },
        include: { overrides: true },
      });
      await this.timeline.record(
        {
          opportunityId,
          type: TimelineEventType.GUARD_EVALUATED,
          summary: `Triagem v${created.version}: ${LIGHT_LABEL[result.status]}${result.checks.some((c) => c.severity !== 'INFO') ? ` (${result.checks.filter((c) => c.severity !== 'INFO').length} pontos)` : ''}`,
          data: { evaluationId: created.id, status: result.status, version: created.version },
        },
        tx,
      );
      await this.audit.record(
        {
          action: 'guard.evaluated',
          entity: 'TriageSnapshot',
          entityId: created.id,
          after: {
            opportunityId,
            version: created.version,
            status: result.status,
            checks: result.checks.length,
          },
        },
        tx,
      );
      await this.events.publish(
        {
          type: DomainEvent.PROJECT_GUARD_EVALUATED,
          projectCode: opportunity.projectCode,
          payload: {
            opportunityId,
            evaluationId: created.id,
            version: created.version,
            status: result.status,
            ruleSetRef: rules.ref,
            algorithmVersion: GUARD_ALGORITHM_VERSION,
          },
        },
        tx,
      );
      return created;
    });
    const names = await this.users.names([row.createdById]);
    return this.toDto(row, names, gathered.fingerprint);
  }

  // ---- Liberação formal (RF-GUARD-004) ----

  async override(opportunityId: string, input: OverrideGuardInput): Promise<GuardEvaluationDto> {
    const opportunity = await this.opportunities.findOrThrow(opportunityId);
    const overview = await this.overview(opportunityId);
    const current = overview.current;
    if (!current || current.id !== input.evaluationId)
      throw new ConflictException(
        'Só a avaliação vigente pode ser liberada: atualize a página e avalie de novo.',
      );
    if (current.stale)
      throw new ConflictException(
        'As premissas mudaram desde esta avaliação: avalie de novo antes de liberar.',
      );
    if (current.status === 'GREEN')
      throw new ConflictException('A triagem já está verde: não há o que liberar.');
    if (current.override) throw new ConflictException('Esta avaliação já foi liberada.');

    const row = await this.prisma.db.$transaction(async (tx) => {
      await tx.triageOverride.create({
        data: {
          tenantId: this.context.requireTenantId(),
          evaluationId: current.id,
          justification: input.justification,
          decidedById: this.context.userId ?? null,
        },
      });
      await this.timeline.record(
        {
          opportunityId,
          type: TimelineEventType.GUARD_OVERRIDDEN,
          summary: `Triagem v${current.version} (${LIGHT_LABEL[current.status]}) liberada: ${input.justification}`,
          data: { evaluationId: current.id, status: current.status },
        },
        tx,
      );
      await this.audit.record(
        {
          action: 'guard.overridden',
          entity: 'TriageSnapshot',
          entityId: current.id,
          after: { opportunityId, status: current.status, justification: input.justification },
        },
        tx,
      );
      await this.events.publish(
        {
          type: DomainEvent.PROJECT_GUARD_OVERRIDDEN,
          projectCode: opportunity.projectCode,
          payload: { opportunityId, evaluationId: current.id, status: current.status },
        },
        tx,
      );
      return tx.triageSnapshot.findUniqueOrThrow({
        where: { id: current.id },
        include: { overrides: true },
      });
    });
    const live = await this.gather(opportunity);
    const names = await this.users.names([
      row.createdById,
      ...row.overrides.map((o) => o.decidedById),
    ]);
    return this.toDto(row, names, live.fingerprint);
  }

  // ---- Invalidação (RF-GUARD-006) ----

  /** Marca a avaliação vigente como desatualizada. Idempotente: o evento do outbox pode chegar mais de uma vez. */
  /**
   * Invalida a avaliação vigente. Com `occurredAt`, ignora eventos anteriores à avaliação: o outbox
   * entrega com atraso e uma mudança que já estava refletida na avaliação não a torna obsoleta.
   */
  async invalidate(opportunityId: string, reason: string, occurredAt?: Date): Promise<void> {
    const latest = await this.prisma.db.triageSnapshot.findFirst({
      where: { opportunityId },
      orderBy: { version: 'desc' },
    });
    if (!latest || latest.invalidatedAt) return;
    if (occurredAt && occurredAt < latest.createdAt) return;
    await this.prisma.db.triageSnapshot.update({
      where: { id: latest.id },
      data: { invalidatedAt: new Date(), invalidatedReason: reason },
    });
  }

  @OnEvent(DomainEvent.OPPORTUNITY_PREMISES_CHANGED, { suppressErrors: false })
  async onPremisesChanged(event: DomainEventEnvelope): Promise<void> {
    const opportunityId = event.payload.opportunityId as string | undefined;
    if (!opportunityId) return;
    const reason = String(event.payload.reason ?? 'premissas da oportunidade mudaram');
    await this.context.run({ tenantId: event.tenantId }, () =>
      this.invalidate(opportunityId, reason, event.occurredAt),
    );
  }

  @OnEvent(DomainEvent.ENERGY_BILL_VALIDATED, { suppressErrors: false })
  async onBillValidated(event: DomainEventEnvelope): Promise<void> {
    const opportunityId = event.payload.opportunityId as string | null | undefined;
    if (!opportunityId) return;
    await this.context.run({ tenantId: event.tenantId }, () =>
      this.invalidate(opportunityId, 'fatura de energia confirmada novamente', event.occurredAt),
    );
  }

  // ---- Internos ----

  /** Junta o que a triagem precisa saber e calcula a impressão digital das premissas. */
  private async gather(opportunity: Opportunity): Promise<Gathered> {
    const [site, unit, snapshot, session, requests] = await Promise.all([
      opportunity.siteId
        ? this.prisma.db.site.findFirst({ where: { id: opportunity.siteId, deletedAt: null } })
        : null,
      opportunity.consumerUnitId
        ? this.prisma.db.consumerUnit.findFirst({
            where: { id: opportunity.consumerUnitId, deletedAt: null },
          })
        : null,
      this.prisma.db.energyBillSnapshot.findFirst({
        where: { bill: { opportunityId: opportunity.id } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.db.calculationSession.findFirst({
        where: { opportunityId: opportunity.id, deletedAt: null },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.db.engineeringRequest.findMany({
        where: { opportunityId: opportunity.id },
        select: { status: true },
      }),
    ]);

    const intake = (site?.intake ?? {}) as SiteIntake;
    const history =
      (snapshot?.fields as { consumptionHistory?: { month: string; kwh: number }[] } | undefined)
        ?.consumptionHistory ?? [];
    const recent = [...history].sort((a, b) => a.month.localeCompare(b.month)).slice(-12);
    const bill = snapshot
      ? {
          createdAt: snapshot.createdAt,
          averageMonthlyKwh:
            recent.length > 0 ? recent.reduce((sum, p) => sum + p.kwh, 0) / recent.length : 0,
        }
      : null;

    let calculation: GuardCalculationInput | null = null;
    if (session) {
      const result = session.result as unknown as QuickCalculationResult;
      const input = session.input as unknown as ParsedQuickCalculationInput;
      const references = session.references as unknown as CalculationReferencesSummary;
      calculation = {
        id: session.id,
        createdAt: session.createdAt,
        trafficLight: session.trafficLight,
        requiresEngineering: result.requiresEngineering,
        alerts: result.alerts,
        averageMonthlyConsumptionKwh: result.averageMonthlyConsumptionKwh,
        premises: {
          projectType: input.projectType,
          customerGroup: input.customerGroup,
          latitude: input.latitude ?? null,
          roofAzimuthDegrees: input.roofAzimuthDegrees ?? null,
          tiltDegrees: input.tiltDegrees ?? null,
          availableAreaM2: input.availableAreaM2 ?? null,
          shadingRelevant: input.shadingRelevant,
        },
        tariffSource: references.tariff?.source ?? null,
        overridden: {
          solarResource: references.solarResource?.overridden ?? false,
          tariff: references.tariff?.overridden ?? false,
        },
      };
    }

    const inputs: GuardInputs = {
      opportunity: { projectType: opportunity.projectType },
      site: site ? { latitude: site.latitude, intake } : null,
      unit: unit
        ? {
            distributorId: unit.distributorId,
            customerGroup: unit.customerGroup,
            phaseSystem: unit.phaseSystem,
          }
        : null,
      bill,
      calculation,
      engineeringRequests: requests,
    };
    // As verificações dependem só destes dados: se algum mudar, a avaliação deixa de valer.
    const fingerprint = sha([
      opportunity.projectType,
      site ? [site.id, site.latitude, site.longitude, intake] : null,
      unit ? [unit.id, unit.distributorId, unit.customerGroup, unit.phaseSystem] : null,
      snapshot?.id ?? null,
      session?.id ?? null,
      requests.map((r) => r.status).sort(),
    ]);
    return {
      inputs,
      fingerprint,
      billSnapshotId: snapshot?.id ?? null,
      calculationSessionId: session?.id ?? null,
    };
  }

  private toDto(
    row: Row,
    names: Map<string, string>,
    liveFingerprint: string | null,
  ): GuardEvaluationDto {
    const override = row.overrides[0] ?? null;
    const stale =
      row.invalidatedAt !== null ||
      (liveFingerprint !== null && row.inputsFingerprint !== liveFingerprint);
    return {
      id: row.id,
      opportunityId: row.opportunityId,
      version: row.version,
      status: row.status,
      checks: row.checks as unknown as GuardCheckDto[],
      missingFields: row.missingFields as unknown as string[],
      needsHumanReview: row.needsHumanReview,
      needsEngineeringReview: row.needsEngineeringReview,
      algorithmVersion: row.algorithmVersion,
      ruleSetRef: row.ruleSetRef,
      inputs: {
        billSnapshotId: row.billSnapshotId,
        calculationSessionId: row.calculationSessionId,
      },
      stale,
      invalidatedAt: row.invalidatedAt?.toISOString() ?? null,
      invalidatedReason: row.invalidatedReason,
      override: override
        ? {
            id: override.id,
            justification: override.justification,
            decidedById: override.decidedById,
            decidedByName: override.decidedById ? (names.get(override.decidedById) ?? null) : null,
            decidedAt: override.decidedAt.toISOString(),
          }
        : null,
      releasedForQuote: !stale && (row.status === 'GREEN' || override !== null),
      createdById: row.createdById,
      createdByName: row.createdById ? (names.get(row.createdById) ?? null) : null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** Útil para o gate da proposta: a avaliação vigente está liberada e válida? */
  async isReleased(opportunityId: string): Promise<boolean> {
    return (await this.overview(opportunityId)).current?.releasedForQuote ?? false;
  }
}
