import { Injectable, NotFoundException } from '@nestjs/common';
import { ZodValidationException } from 'nestjs-zod';
import { ZodError } from 'zod';
import { DomainEvent, type ListCalculationsQuery } from '@voltex/shared';
import {
  calculateQuick,
  quickCalculationInputSchema,
  type CalculationReferencesSummary,
  type CalculatorConfigDto,
  type CreateCalculationInput,
  type QuickCalculationResult,
} from '@voltex/solar-engine';
import { RequestContext } from '../../common/context/request-context';
import { toPaginated, toSkipTake } from '../../common/pagination';
import { AuditService } from '../../platform/audit/audit.service';
import { EventBus } from '../../platform/events/event-bus.service';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { RulesService } from '../../platform/rules/rules.service';

const EPSILON = 1e-9;
const sameNumbers = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && a.every((v, i) => Math.abs(v - (b[i] as number)) < EPSILON);

@Injectable()
export class CalculatorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly rules: RulesService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
  ) {}

  /** Configuração efetiva (regra ativa ou padrão): usada também pelo preview do front. */
  async config(): Promise<CalculatorConfigDto> {
    const rules = await this.rules.effective();
    return {
      ruleSetRef: rules.ref,
      thresholds: rules.thresholds,
      availabilityCostKwh: rules.availabilityCostKwh,
      sources: rules.sources,
    };
  }

  /**
   * Calcula (o servidor é a fonte oficial), registra o que foi usado e grava a sessão. Os `thresholds` enviados pelo
   * cliente são ignorados: valem as regras do tenant.
   */
  async create(dto: CreateCalculationInput) {
    const rules = await this.rules.effective();
    // O corpo já foi validado pelo pipe; revalidar com os limites do tenant garante o formato final do cálculo.
    const parsed = (() => {
      try {
        return quickCalculationInputSchema.parse({ ...dto.input, thresholds: rules.thresholds });
      } catch (error) {
        if (error instanceof ZodError) throw new ZodValidationException(error);
        throw error;
      }
    })();
    const result = calculateQuick(parsed);
    const references = await this.captureReferences(dto, parsed);

    return this.prisma.db.$transaction(async (tx) => {
      const session = await tx.calculationSession.create({
        data: {
          tenantId: this.context.requireTenantId(),
          createdById: this.context.userId ?? null,
          title: dto.title ?? null,
          customerName: dto.customerName ?? null,
          input: parsed as unknown as object,
          result: result as unknown as object,
          trafficLight: result.trafficLight,
          algorithmVersion: result.algorithmVersion,
          ruleSetRef: rules.ref,
          references: references as unknown as object,
        },
      });
      await this.audit.record(
        {
          action: 'calculation.created',
          entity: 'CalculationSession',
          entityId: session.id,
          after: {
            trafficLight: result.trafficLight,
            installedPowerKwp: result.installedPowerKwp,
            ruleSetRef: rules.ref,
          },
        },
        tx,
      );
      await this.events.publish(
        {
          type: DomainEvent.QUICK_CALCULATION_COMPLETED,
          payload: {
            sessionId: session.id,
            trafficLight: result.trafficLight,
            requiresEngineering: result.requiresEngineering,
            installedPowerKwp: result.installedPowerKwp,
            algorithmVersion: result.algorithmVersion,
            ruleSetRef: rules.ref,
          },
        },
        tx,
      );
      return this.toSession(session);
    });
  }

  async list(query: ListCalculationsQuery) {
    const where = {
      deletedAt: null,
      ...(query.trafficLight ? { trafficLight: query.trafficLight } : {}),
      ...(query.search
        ? {
            OR: [
              { customerName: { contains: query.search, mode: 'insensitive' as const } },
              { title: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.db.calculationSession.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...toSkipTake(query),
      }),
      this.prisma.db.calculationSession.count({ where }),
    ]);
    return toPaginated(
      rows.map((r) => this.toSession(r)),
      total,
      query,
    );
  }

  async get(id: string) {
    return this.toSession(await this.getRow(id));
  }

  async createSnapshot(id: string, note?: string) {
    const session = await this.getRow(id);
    return this.prisma.db.$transaction(async (tx) => {
      const snapshot = await tx.quickCalculationSnapshot.create({
        data: {
          tenantId: session.tenantId,
          sessionId: session.id,
          createdById: this.context.userId ?? null,
          customerName: session.customerName,
          input: session.input as object,
          result: session.result as object,
          trafficLight: session.trafficLight,
          algorithmVersion: session.algorithmVersion,
          ruleSetRef: session.ruleSetRef,
          references: session.references as object,
          note: note ?? null,
        },
      });
      await this.audit.record(
        {
          action: 'calculation.snapshot_created',
          entity: 'QuickCalculationSnapshot',
          entityId: snapshot.id,
          after: {
            sessionId: session.id,
            algorithmVersion: session.algorithmVersion,
            ruleSetRef: session.ruleSetRef,
          },
        },
        tx,
      );
      return this.toSnapshot(snapshot);
    });
  }

  async listSnapshots(sessionId: string) {
    await this.getRow(sessionId);
    const rows = await this.prisma.db.quickCalculationSnapshot.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toSnapshot(r));
  }

  async getSnapshot(id: string) {
    const row = await this.prisma.db.quickCalculationSnapshot.findFirst({ where: { id } });
    if (!row) throw new NotFoundException('Snapshot não encontrado');
    return this.toSnapshot(row);
  }

  // ---- internos ----
  private async getRow(id: string) {
    const row = await this.prisma.db.calculationSession.findFirst({
      where: { id, deletedAt: null },
    });
    if (!row) throw new NotFoundException('Cálculo não encontrado');
    return row;
  }

  /** Captura (a partir do banco, não do cliente) o que foi usado e se o usuário alterou os valores do catálogo. */
  private async captureReferences(
    dto: CreateCalculationInput,
    input: { hspMonthly: number[]; tariffCentsPerKwh: number },
  ): Promise<CalculationReferencesSummary> {
    const summary: CalculationReferencesSummary = { solarResource: null, tariff: null };
    const refs = dto.references;
    if (refs?.solarResourceId) {
      const resource = await this.prisma.db.solarResource.findFirst({
        where: { id: refs.solarResourceId, deletedAt: null },
      });
      if (!resource) throw new NotFoundException('Local de irradiação não encontrado');
      summary.solarResource = {
        id: resource.id,
        name: resource.name,
        state: resource.state,
        source: resource.source,
        plane: resource.plane,
        overridden: !sameNumbers(resource.hspMonthly as number[], input.hspMonthly),
      };
    }
    if (refs?.tariffId) {
      const tariff = await this.prisma.db.tariff.findFirst({
        where: { id: refs.tariffId, deletedAt: null },
        include: { distributor: true },
      });
      if (!tariff) throw new NotFoundException('Tarifa não encontrada');
      summary.tariff = {
        id: tariff.id,
        distributorName: tariff.distributor.name,
        customerGroup: tariff.customerGroup,
        energyCentsPerKwh: tariff.energyCentsPerKwh,
        validFrom: tariff.validFrom.toISOString(),
        source: tariff.source,
        overridden: Math.abs(tariff.energyCentsPerKwh - input.tariffCentsPerKwh) > EPSILON,
      };
    }
    return summary;
  }

  private toSession(row: {
    id: string;
    tenantId: string;
    createdById: string | null;
    title: string | null;
    customerName: string | null;
    input: unknown;
    result: unknown;
    trafficLight: 'GREEN' | 'YELLOW' | 'RED';
    algorithmVersion: string;
    ruleSetRef: string;
    references: unknown;
    opportunityId: string | null;
    createdAt: Date;
  }) {
    return {
      ...row,
      input: row.input as object,
      result: row.result as QuickCalculationResult,
      references: row.references as CalculationReferencesSummary,
    };
  }

  private toSnapshot(row: {
    id: string;
    tenantId: string;
    sessionId: string;
    createdById: string | null;
    customerName: string | null;
    input: unknown;
    result: unknown;
    trafficLight: 'GREEN' | 'YELLOW' | 'RED';
    algorithmVersion: string;
    ruleSetRef: string;
    references: unknown;
    note: string | null;
    createdAt: Date;
  }) {
    return {
      ...row,
      input: row.input as object,
      result: row.result as QuickCalculationResult,
      references: row.references as CalculationReferencesSummary,
    };
  }
}
