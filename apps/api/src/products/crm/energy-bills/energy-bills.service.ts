import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { EnergyBill, EnergyBillSnapshot } from '@voltex/database';
import {
  DomainEvent,
  EnergyBillStatus,
  OpportunityStage,
  TimelineEventType,
  type EnergyBillDto,
  type EnergyBillFields,
  type EnergyBillSnapshotDto,
  type ExtractedBillFields,
  type ValidateEnergyBillData,
} from '@voltex/shared';
import { RequestContext } from '../../../common/context/request-context';
import { AuditService } from '../../../platform/audit/audit.service';
import { DocumentsService, type UploadedFile } from '../../../platform/documents/documents.service';
import { EventBus } from '../../../platform/events/event-bus.service';
import { PrismaService } from '../../../platform/prisma/prisma.service';
import { OpportunitiesService } from '../opportunities.service';
import { TimelineService } from '../support/timeline.service';
import { BILL_PARSER, overallConfidence, type BillParserProvider } from './bill-parser';

@Injectable()
export class EnergyBillsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly documents: DocumentsService,
    private readonly timeline: TimelineService,
    private readonly opportunities: OpportunitiesService,
    @Inject(BILL_PARSER) private readonly parser: BillParserProvider,
  ) {}

  /** Recebe a fatura, guarda o arquivo, tenta ler os campos e deixa tudo aguardando revisão humana. */
  async upload(
    file: UploadedFile | undefined,
    target: { opportunityId?: string; consumerUnitId?: string },
  ): Promise<EnergyBillDto> {
    if (!file) throw new BadRequestException('Envie o arquivo no campo "file"');
    if (!target.opportunityId && !target.consumerUnitId)
      throw new UnprocessableEntityException('Informe a oportunidade ou a unidade consumidora');

    const opportunity = target.opportunityId
      ? await this.opportunities.findOrThrow(target.opportunityId)
      : null;
    const consumerUnitId = target.consumerUnitId ?? opportunity?.consumerUnitId ?? null;
    if (consumerUnitId) {
      const unit = await this.prisma.db.consumerUnit.findFirst({
        where: { id: consumerUnitId, deletedAt: null },
      });
      if (!unit) throw new UnprocessableEntityException('Unidade consumidora não encontrada');
    }

    const billId = randomUUID();
    const document = await this.documents.upload(file, {
      entityType: 'EnergyBill',
      entityId: billId,
    });

    const distributors = await this.prisma.db.distributor.findMany({
      where: { deletedAt: null },
      select: { name: true },
    });
    const parsed = await this.parser.parse({
      buffer: file.buffer,
      mimeType: file.mimetype,
      distributorNames: distributors.map((d) => d.name),
    });
    const found = Object.keys(parsed.fields).length;
    const confidence = overallConfidence(parsed.fields);

    const row = await this.prisma.db.$transaction(async (tx) => {
      const created = await tx.energyBill.create({
        data: {
          id: billId,
          tenantId: this.context.requireTenantId(),
          opportunityId: opportunity?.id ?? null,
          consumerUnitId,
          documentId: document.id,
          filename: document.filename,
          status: found > 0 ? EnergyBillStatus.PARSED : EnergyBillStatus.UPLOADED,
          extracted: parsed.fields as object,
          overallConfidence: confidence,
          parserName: parsed.parserName,
          parserVersion: parsed.parserVersion,
          createdById: this.context.userId ?? null,
        },
      });
      await this.audit.record(
        {
          action: 'energy_bill.uploaded',
          entity: 'EnergyBill',
          entityId: created.id,
          after: {
            filename: created.filename,
            fieldsRead: found,
            opportunityId: created.opportunityId,
          },
        },
        tx,
      );
      if (opportunity) {
        await this.timeline.record(
          {
            opportunityId: opportunity.id,
            type: TimelineEventType.BILL_UPLOADED,
            summary:
              found > 0
                ? `Fatura enviada (${found} campos lidos, aguardando revisão)`
                : 'Fatura enviada (sem leitura automática: preencher na revisão)',
            data: { billId: created.id, fieldsRead: found },
          },
          tx,
        );
      }
      await this.events.publish(
        {
          type: DomainEvent.ENERGY_BILL_PARSED,
          projectCode: opportunity?.projectCode ?? null,
          payload: {
            billId: created.id,
            opportunityId: created.opportunityId,
            fieldsRead: found,
            overallConfidence: confidence,
            parser: `${parsed.parserName}@${parsed.parserVersion}`,
          },
        },
        tx,
      );
      return created;
    });
    return this.toDto(row, null);
  }

  async list(query: { opportunityId?: string; consumerUnitId?: string }): Promise<EnergyBillDto[]> {
    const rows = await this.prisma.db.energyBill.findMany({
      where: {
        deletedAt: null,
        ...(query.opportunityId ? { opportunityId: query.opportunityId } : {}),
        ...(query.consumerUnitId ? { consumerUnitId: query.consumerUnitId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const snapshots = await this.latestSnapshotIds(rows.map((r) => r.id));
    return rows.map((r) => this.toDto(r, snapshots.get(r.id) ?? null));
  }

  async get(id: string): Promise<EnergyBillDto> {
    const row = await this.findOrThrow(id);
    const snapshots = await this.latestSnapshotIds([id]);
    return this.toDto(row, snapshots.get(id) ?? null);
  }

  async snapshots(id: string): Promise<EnergyBillSnapshotDto[]> {
    await this.findOrThrow(id);
    const rows = await this.prisma.db.energyBillSnapshot.findMany({
      where: { billId: id },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toSnapshotDto(r));
  }

  async downloadUrl(id: string) {
    const row = await this.findOrThrow(id);
    return this.documents.downloadUrl(row.documentId);
  }

  /**
   * Confirma os campos (já revisados por uma pessoa) e grava o snapshot IMUTÁVEL que alimenta o cálculo.
   * Cada confirmação gera um snapshot novo; o mais recente vale e invalida avaliações anteriores (Fase 7B).
   */
  async validate(id: string, input: ValidateEnergyBillData): Promise<EnergyBillDto> {
    const bill = await this.findOrThrow(id);
    const fields = input.fields as EnergyBillFields;
    const opportunity = bill.opportunityId
      ? await this.opportunities.findOrThrow(bill.opportunityId)
      : null;

    const snapshot = await this.prisma.db.$transaction(async (tx) => {
      const created = await tx.energyBillSnapshot.create({
        data: {
          tenantId: this.context.requireTenantId(),
          billId: id,
          fields: fields as object,
          note: input.note ?? null,
          validatedById: this.context.userId ?? null,
        },
      });
      await tx.energyBill.update({
        where: { id },
        data: {
          status: EnergyBillStatus.VALIDATED,
          validatedById: this.context.userId ?? null,
          validatedAt: new Date(),
          rejectedReason: null,
        },
      });
      // A UC ganha o que a fatura confirmou (grupo e ligação), sem sobrescrever o que já foi definido à mão.
      if (bill.consumerUnitId) {
        const unit = await tx.consumerUnit.findFirst({ where: { id: bill.consumerUnitId } });
        if (unit) {
          await tx.consumerUnit.update({
            where: { id: unit.id },
            data: {
              ...(fields.phaseSystem && !unit.phaseSystem
                ? { phaseSystem: fields.phaseSystem }
                : {}),
              ...(fields.customerGroup ? { customerGroup: fields.customerGroup } : {}),
            },
          });
        }
      }
      await this.audit.record(
        {
          action: 'energy_bill.validated',
          entity: 'EnergyBill',
          entityId: id,
          after: { snapshotId: created.id, months: fields.consumptionHistory?.length ?? 0 },
        },
        tx,
      );
      if (opportunity) {
        await this.timeline.record(
          {
            opportunityId: opportunity.id,
            type: TimelineEventType.BILL_VALIDATED,
            summary: `Fatura validada (${fields.consumptionHistory?.length ?? 0} meses de consumo)`,
            data: { billId: id, snapshotId: created.id },
          },
          tx,
        );
        // Fatura validada tira a oportunidade de "Fatura pendente".
        if (opportunity.stage === OpportunityStage.BILL_PENDING) {
          await this.opportunities.moveStageWithin(
            tx,
            opportunity,
            OpportunityStage.PRE_SIZING,
            null,
            'fatura validada',
          );
        }
      }
      await this.events.publish(
        {
          type: DomainEvent.ENERGY_BILL_VALIDATED,
          projectCode: opportunity?.projectCode ?? null,
          payload: { billId: id, snapshotId: created.id, opportunityId: bill.opportunityId },
        },
        tx,
      );
      return created;
    });
    const row = await this.findOrThrow(id);
    return this.toDto(row, snapshot.id);
  }

  async reject(id: string, reason: string): Promise<EnergyBillDto> {
    const bill = await this.findOrThrow(id);
    const row = await this.prisma.db.$transaction(async (tx) => {
      const updated = await tx.energyBill.update({
        where: { id },
        data: { status: EnergyBillStatus.REJECTED, rejectedReason: reason },
      });
      await this.audit.record(
        { action: 'energy_bill.rejected', entity: 'EnergyBill', entityId: id, after: { reason } },
        tx,
      );
      if (bill.opportunityId)
        await this.timeline.record(
          {
            opportunityId: bill.opportunityId,
            type: TimelineEventType.NOTE,
            summary: `Fatura recusada: ${reason}`,
            data: { billId: id },
          },
          tx,
        );
      return updated;
    });
    return this.toDto(row, null);
  }

  // ---- Internos ----

  private async findOrThrow(id: string): Promise<EnergyBill> {
    const row = await this.prisma.db.energyBill.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundException('Fatura não encontrada');
    return row;
  }

  private async latestSnapshotIds(billIds: string[]): Promise<Map<string, string>> {
    if (billIds.length === 0) return new Map();
    const rows = await this.prisma.db.energyBillSnapshot.findMany({
      where: { billId: { in: billIds } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, billId: true },
    });
    const map = new Map<string, string>();
    for (const row of rows) if (!map.has(row.billId)) map.set(row.billId, row.id);
    return map;
  }

  private toDto(row: EnergyBill, snapshotId: string | null): EnergyBillDto {
    return {
      id: row.id,
      opportunityId: row.opportunityId,
      consumerUnitId: row.consumerUnitId,
      documentId: row.documentId,
      filename: row.filename,
      status: row.status,
      extracted: (row.extracted ?? {}) as ExtractedBillFields,
      overallConfidence: row.overallConfidence,
      parserName: row.parserName,
      parserVersion: row.parserVersion,
      rejectedReason: row.rejectedReason,
      validatedAt: row.validatedAt?.toISOString() ?? null,
      snapshotId,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toSnapshotDto(row: EnergyBillSnapshot): EnergyBillSnapshotDto {
    return {
      id: row.id,
      billId: row.billId,
      fields: row.fields as EnergyBillFields,
      note: row.note,
      validatedById: row.validatedById,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
