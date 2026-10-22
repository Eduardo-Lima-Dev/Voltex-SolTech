import { Injectable } from '@nestjs/common';
import type {
  OperationsSettingsDto,
  OperationsSettingsInput,
  TicketPriority,
} from '@voltex/shared';
import { RequestContext } from '../../../common/context/request-context';
import { AuditService } from '../../../platform/audit/audit.service';
import { PrismaService } from '../../../platform/prisma/prisma.service';

const KEYS = [
  'warrantyAlertDays',
  'renewalNoticeDays',
  'maintenanceLeadDays',
  'upsellGridKwh',
  'upsellMinBills',
] as const;
const PRIORITIES: TicketPriority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

const numberOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/**
 * Prazos e gatilhos do pós-venda, definidos pela empresa e guardados em `tenant.settings.operations`. **Sem valor
 * padrão**: aviso de garantia, aviso de renovação, antecedência da manutenção, prazo de atendimento e gatilho de
 * expansão ficam desligados até a empresa configurá-los.
 */
@Injectable()
export class OperationsSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
  ) {}

  private async raw(): Promise<Record<string, unknown>> {
    const tenant = await this.prisma.db.tenant.findUniqueOrThrow({
      where: { id: this.context.requireTenantId() },
      select: { settings: true },
    });
    const operations = (tenant.settings as Record<string, unknown> | null)?.operations;
    return operations && typeof operations === 'object'
      ? (operations as Record<string, unknown>)
      : {};
  }

  async get(): Promise<OperationsSettingsDto> {
    const raw = await this.raw();
    const sla = (raw.slaHours && typeof raw.slaHours === 'object' ? raw.slaHours : {}) as Record<
      string,
      unknown
    >;
    const slaHours: Partial<Record<TicketPriority, number>> = {};
    for (const p of PRIORITIES) {
      const v = numberOrNull(sla[p]);
      if (v !== null) slaHours[p] = v;
    }
    return {
      warrantyAlertDays: numberOrNull(raw.warrantyAlertDays),
      renewalNoticeDays: numberOrNull(raw.renewalNoticeDays),
      maintenanceLeadDays: numberOrNull(raw.maintenanceLeadDays),
      slaHours,
      upsellGridKwh: numberOrNull(raw.upsellGridKwh),
      upsellMinBills: numberOrNull(raw.upsellMinBills),
    };
  }

  async update(input: OperationsSettingsInput): Promise<OperationsSettingsDto> {
    const current = await this.get();
    const next: Record<string, unknown> = { ...current, slaHours: { ...current.slaHours } };
    for (const key of KEYS)
      if (input[key] !== undefined) {
        if (input[key] === null) delete next[key];
        else next[key] = input[key];
      }
    if (input.slaHours) {
      const sla = next.slaHours as Record<string, number>;
      for (const p of PRIORITIES) {
        const v = input.slaHours[p];
        if (v === null) delete sla[p];
        else if (v !== undefined) sla[p] = v;
      }
    }
    // `null` nas chaves simples vira ausência: nada guardado = desligado.
    for (const key of KEYS) if (next[key] === null) delete next[key];
    const tenantId = this.context.requireTenantId();
    const tenant = await this.prisma.db.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { settings: true },
    });
    const settings = {
      ...((tenant.settings as Record<string, unknown> | null) ?? {}),
      operations: next,
    };
    await this.prisma.db.$transaction(async (tx) => {
      await tx.tenant.update({ where: { id: tenantId }, data: { settings: settings as object } });
      await this.audit.record(
        {
          action: 'operations.settings_updated',
          entity: 'Tenant',
          entityId: tenantId,
          before: current,
          after: next,
        },
        tx,
      );
    });
    return this.get();
  }
}
