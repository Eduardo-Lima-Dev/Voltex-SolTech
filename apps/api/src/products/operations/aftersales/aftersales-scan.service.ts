import { Injectable, Logger } from '@nestjs/common';
import { DomainEvent, type OperationsSettingsDto } from '@voltex/shared';
import { RequestContext } from '../../../common/context/request-context';
import { EventBus } from '../../../platform/events/event-bus.service';
import { PrismaService } from '../../../platform/prisma/prisma.service';
import { OpportunitiesService } from '../../crm/opportunities.service';
import { WorkOrdersService } from '../work-orders.service';
import { addMonths, dateOnly, daysLeft, isoDay } from './dates';
import { OperationsSettingsService } from './settings.service';
import { TicketsService } from './tickets.service';

const DAY = 86_400_000;

export interface AftersalesScanResult {
  maintenanceTickets: number;
  warrantyAlerts: number;
  contractsExpired: number;
  contractsRenewed: number;
  renewalNotices: number;
  upsells: number;
}

const average = (values: number[]): number => values.reduce((a, b) => a + b, 0) / values.length;

/**
 * Rotina do pós-venda (modelagem §45). Cada regra só age com o prazo ou o gatilho **que a empresa configurou**
 * (`tenant.settings.operations`): sem configuração, o aviso correspondente fica desligado. Todas são idempotentes
 * (chave de automação em chamados e tarefas, marca de aviso nas garantias e nos contratos).
 */
@Injectable()
export class AftersalesScanService {
  private readonly logger = new Logger(AftersalesScanService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly events: EventBus,
    private readonly settings: OperationsSettingsService,
    private readonly tickets: TicketsService,
    private readonly workOrders: WorkOrdersService,
    private readonly opportunities: OpportunitiesService,
  ) {}

  private async ownerOf(opportunityId: string): Promise<string | null> {
    const opportunity = await this.prisma.db.opportunity.findFirst({
      where: { id: opportunityId },
      select: { ownerId: true },
    });
    if (!opportunity?.ownerId) return null;
    const user = await this.prisma.db.user.findFirst({
      where: { id: opportunity.ownerId, isActive: true, deletedAt: null },
      select: { id: true },
    });
    return user?.id ?? null;
  }

  private async upsertTask(
    plant: { opportunityId: string; accountId: string },
    task: { key: string; title: string; dueAt: Date; description?: string },
  ): Promise<boolean> {
    const tenantId = this.context.requireTenantId();
    const existing = await this.prisma.db.task.findFirst({
      where: { automationKey: task.key },
      select: { id: true },
    });
    if (existing) return false;
    await this.prisma.db.task.create({
      data: {
        tenantId,
        title: task.title,
        description: task.description ?? null,
        dueAt: task.dueAt,
        assigneeId: await this.ownerOf(plant.opportunityId),
        opportunityId: plant.opportunityId,
        accountId: plant.accountId,
        origin: 'automation:aftersales',
        automationKey: task.key,
      },
    });
    return true;
  }

  /** Roda todas as regras para a empresa do contexto. */
  async scanTenant(now: Date = new Date()): Promise<AftersalesScanResult> {
    const settings = await this.settings.get();
    const result: AftersalesScanResult = {
      maintenanceTickets: await this.maintenance(now, settings),
      warrantyAlerts: await this.warranties(now, settings),
      contractsExpired: 0,
      contractsRenewed: 0,
      renewalNotices: 0,
      upsells: await this.upsell(now, settings),
    };
    const contracts = await this.contracts(now, settings);
    result.contractsExpired = contracts.expired;
    result.contractsRenewed = contracts.renewed;
    result.renewalNotices = contracts.notices;
    return result;
  }

  // --- manutenção preventiva --------------------------------------------------------------------------------

  private async maintenance(now: Date, settings: OperationsSettingsDto): Promise<number> {
    const lead = settings.maintenanceLeadDays ?? 0;
    const limit = new Date(dateOnly(now).getTime() + lead * DAY);
    const plans = await this.prisma.db.maintenancePlan.findMany({
      where: { active: true, nextDueAt: { lte: limit }, plant: { status: 'ACTIVE' } },
      include: { plant: true },
    });
    let created = 0;
    for (const plan of plans) {
      const key = `maint:${plan.id}:${isoDay(plan.nextDueAt)}`;
      const { ticket, created: isNew } = await this.tickets.createInternal(
        {
          plantId: plan.plantId,
          type: 'PREVENTIVE',
          priority: 'NORMAL',
          title: `${plan.title} (vence em ${isoDay(plan.nextDueAt)})`,
        },
        { origin: 'SYSTEM', automationKey: key, openedById: null },
      );
      if (!isNew) continue;
      const order = await this.workOrders.createForPlant({
        plantId: plan.plantId,
        ticketId: ticket.id,
        maintenancePlanId: plan.id,
        type: plan.kind === 'CLEANING' ? 'CLEANING' : 'MAINTENANCE',
        title: `${plan.title} — ${plan.plant.name}`,
        notes: plan.notes,
      });
      await this.prisma.db.ticket.update({
        where: { id: ticket.id },
        data: { workOrderId: order.id },
      });
      created += 1;
    }
    return created;
  }

  // --- garantias --------------------------------------------------------------------------------------------

  private async warranties(now: Date, settings: OperationsSettingsDto): Promise<number> {
    if (settings.warrantyAlertDays === null) return 0;
    const today = dateOnly(now);
    const limit = new Date(today.getTime() + settings.warrantyAlertDays * DAY);
    const rows = await this.prisma.db.assetWarranty.findMany({
      where: {
        endsOn: { gte: today, lte: limit },
        expiringNotifiedAt: null,
        asset: { status: 'ACTIVE' },
      },
      include: { asset: true },
    });
    let alerts = 0;
    for (const w of rows) {
      const plant = await this.prisma.db.plant.findFirst({ where: { id: w.asset.plantId } });
      if (!plant) continue;
      const days = daysLeft(w.endsOn, now);
      const label = `${w.asset.manufacturer} ${w.asset.model}`;
      await this.upsertTask(plant, {
        key: `warranty-expiring:${w.id}`,
        title: `Garantia de ${label} vence em ${days} dia(s): avisar o cliente (${plant.name})`,
        dueAt: new Date(Math.max(now.getTime() + DAY, w.endsOn.getTime() - 7 * DAY)),
      });
      await this.prisma.db.$transaction(async (tx) => {
        await tx.assetWarranty.update({ where: { id: w.id }, data: { expiringNotifiedAt: now } });
        await tx.plantEvent.create({
          data: {
            tenantId: plant.tenantId,
            plantId: plant.id,
            type: 'WARRANTY_EXPIRING',
            text: `Garantia ${w.kind === 'PRODUCT' ? 'do produto' : 'de desempenho'} de ${label} vence em ${isoDay(w.endsOn)}.`,
            data: { warrantyId: w.id },
          },
        });
        await this.events.publish(
          {
            type: DomainEvent.WARRANTY_EXPIRING,
            projectCode: plant.projectCode,
            payload: {
              warrantyId: w.id,
              plantId: plant.id,
              assetId: w.assetId,
              endsOn: isoDay(w.endsOn),
              daysLeft: days,
            },
          },
          tx,
        );
      });
      alerts += 1;
    }
    return alerts;
  }

  // --- contratos de O&M -------------------------------------------------------------------------------------

  private async contracts(
    now: Date,
    settings: OperationsSettingsDto,
  ): Promise<{ expired: number; renewed: number; notices: number }> {
    const today = dateOnly(now);
    let expired = 0;
    let renewed = 0;
    let notices = 0;

    // Vencidos: renovação automática estende pela mesma duração; os demais passam a "vencido".
    const lapsed = await this.prisma.db.omContract.findMany({
      where: { status: 'ACTIVE', endsOn: { lt: today } },
      include: { plant: true },
    });
    for (const c of lapsed) {
      if (c.autoRenew) {
        const months = Math.max(
          1,
          Math.round((c.endsOn.getTime() - c.startsOn.getTime()) / (30.4375 * DAY)),
        );
        const endsOn = addMonths(c.endsOn, months);
        await this.prisma.db.$transaction(async (tx) => {
          await tx.omContract.update({
            where: { id: c.id },
            data: { endsOn, renewalNotifiedAt: null },
          });
          await tx.plantEvent.create({
            data: {
              tenantId: c.tenantId,
              plantId: c.plantId,
              type: 'OM_CONTRACT',
              text: `Contrato de O&M renovado automaticamente até ${isoDay(endsOn)}.`,
              data: { contractId: c.id },
            },
          });
        });
        renewed += 1;
      } else {
        await this.prisma.db.$transaction(async (tx) => {
          await tx.omContract.update({ where: { id: c.id }, data: { status: 'EXPIRED' } });
          await tx.plantEvent.create({
            data: {
              tenantId: c.tenantId,
              plantId: c.plantId,
              type: 'OM_CONTRACT',
              text: `Contrato de O&M vencido em ${isoDay(c.endsOn)}.`,
              data: { contractId: c.id },
            },
          });
        });
        expired += 1;
      }
    }

    // Aviso de renovação na janela da empresa.
    if (settings.renewalNoticeDays !== null) {
      const limit = new Date(today.getTime() + settings.renewalNoticeDays * DAY);
      const due = await this.prisma.db.omContract.findMany({
        where: { status: 'ACTIVE', endsOn: { gte: today, lte: limit }, renewalNotifiedAt: null },
        include: { plant: true },
      });
      for (const c of due) {
        const owner = await this.ownerOf(c.plant.opportunityId);
        let opportunityId: string | null = null;
        try {
          const opportunity = await this.opportunities.create({
            accountId: c.accountId,
            ...(c.plant.siteId ? { siteId: c.plant.siteId } : {}),
            projectType: 'ON_GRID',
            title: `Renovação de O&M: ${c.plant.name}`,
            ...(owner ? { ownerId: owner } : {}),
          });
          opportunityId = opportunity.id;
        } catch (error) {
          this.logger.warn(
            `Não foi possível abrir a oportunidade de renovação do contrato ${c.id}: ${String(error)}`,
          );
        }
        await this.upsertTask(c.plant, {
          key: `om-renewal:${c.id}:${isoDay(c.endsOn)}`,
          title: `Renovar o contrato de O&M de ${c.plant.name} (termina em ${isoDay(c.endsOn)})`,
          dueAt: new Date(now.getTime() + 3 * DAY),
        });
        await this.prisma.db.$transaction(async (tx) => {
          await tx.omContract.update({
            where: { id: c.id },
            data: { renewalNotifiedAt: now, renewalOpportunityId: opportunityId },
          });
          await tx.plantEvent.create({
            data: {
              tenantId: c.tenantId,
              plantId: c.plantId,
              type: 'OM_RENEWAL',
              text: `Contrato de O&M perto do fim (${isoDay(c.endsOn)}): renovação aberta no CRM.`,
              data: { contractId: c.id, opportunityId },
            },
          });
          await this.events.publish(
            {
              type: DomainEvent.OM_RENEWAL_DUE,
              projectCode: c.plant.projectCode,
              payload: {
                contractId: c.id,
                plantId: c.plantId,
                endsOn: isoDay(c.endsOn),
                opportunityId,
              },
            },
            tx,
          );
        });
        notices += 1;
      }
    }
    return { expired, renewed, notices };
  }

  // --- expansão (gatilho declarado pela empresa) ------------------------------------------------------------

  /**
   * Gatilho de expansão: a média do consumo da rede nas últimas N faturas validadas, depois da ativação da planta,
   * acima do valor definido pela empresa (kWh/mês). Sem as duas configurações, fica desligado. Gera uma oportunidade
   * de expansão no CRM, uma tarefa e o evento; uma vez por planta e por última fatura.
   */
  private async upsell(now: Date, settings: OperationsSettingsDto): Promise<number> {
    if (settings.upsellGridKwh === null || settings.upsellMinBills === null) return 0;
    const plants = await this.prisma.db.plant.findMany({ where: { status: 'ACTIVE' } });
    let detected = 0;
    for (const plant of plants) {
      const project = await this.prisma.db.project.findFirst({
        where: { id: plant.projectId },
        select: { consumerUnitId: true },
      });
      if (!project?.consumerUnitId) continue;
      const bills = await this.prisma.db.energyBill.findMany({
        where: {
          consumerUnitId: project.consumerUnitId,
          status: 'VALIDATED',
          deletedAt: null,
          createdAt: { gt: plant.activatedAt },
        },
        orderBy: { validatedAt: 'desc' },
        take: settings.upsellMinBills,
      });
      if (bills.length < settings.upsellMinBills) continue;
      const consumptions: number[] = [];
      for (const bill of bills) {
        const snapshot = await this.prisma.db.energyBillSnapshot.findFirst({
          where: { billId: bill.id },
          orderBy: { createdAt: 'desc' },
        });
        const history = (
          snapshot?.fields as { consumptionHistory?: { month: string; kwh: number }[] } | null
        )?.consumptionHistory;
        const latest =
          history && history.length > 0
            ? [...history].sort((a, b) => a.month.localeCompare(b.month)).at(-1)
            : undefined;
        if (latest && Number.isFinite(latest.kwh)) consumptions.push(latest.kwh);
      }
      if (consumptions.length < settings.upsellMinBills) continue;
      const avg = average(consumptions);
      if (avg <= settings.upsellGridKwh) continue;
      const key = `upsell:${plant.id}:${bills[0]!.id}`;
      const taskCreated = await this.upsertTask(plant, {
        key,
        title: `Oportunidade de expansão em ${plant.name}: consumo médio da rede de ${Math.round(avg)} kWh/mês (limite ${settings.upsellGridKwh})`,
        dueAt: new Date(now.getTime() + 5 * DAY),
      });
      if (!taskCreated) continue;
      const owner = await this.ownerOf(plant.opportunityId);
      let opportunityId: string | null = null;
      try {
        const opportunity = await this.opportunities.create({
          accountId: plant.accountId,
          ...(plant.siteId ? { siteId: plant.siteId } : {}),
          ...(project.consumerUnitId ? { consumerUnitId: project.consumerUnitId } : {}),
          projectType: 'ON_GRID',
          title: `Expansão: ${plant.name}`,
          ...(owner ? { ownerId: owner } : {}),
        });
        opportunityId = opportunity.id;
      } catch (error) {
        this.logger.warn(
          `Não foi possível abrir a oportunidade de expansão da planta ${plant.id}: ${String(error)}`,
        );
      }
      await this.prisma.db.$transaction(async (tx) => {
        await tx.plantEvent.create({
          data: {
            tenantId: plant.tenantId,
            plantId: plant.id,
            type: 'UPSELL',
            text: `Consumo médio da rede de ${Math.round(avg)} kWh/mês acima do limite da empresa: oportunidade de expansão.`,
            data: { opportunityId, average: avg },
          },
        });
        await this.events.publish(
          {
            type: DomainEvent.UPSELL_OPPORTUNITY_DETECTED,
            projectCode: plant.projectCode,
            payload: {
              plantId: plant.id,
              opportunityId,
              averageGridKwh: avg,
              thresholdKwh: settings.upsellGridKwh,
            },
          },
          tx,
        );
      });
      detected += 1;
    }
    return detected;
  }
}
