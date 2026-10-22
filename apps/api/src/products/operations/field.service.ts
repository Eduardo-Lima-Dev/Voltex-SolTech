import {
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@voltex/database';
import type {
  ChecklistItemDto,
  FieldActionInput,
  FieldWorkOrderDto,
  FieldSyncResultDto,
  SaveFieldSignatureInput,
  UpdateFieldPhotoInput,
  UploadFieldPhotoInput,
  WorkOrderPhotoDto,
} from '@voltex/shared';
import type { RequestUser } from '../../common/context/request-user';
import { RequestContext } from '../../common/context/request-context';
import { AuditService } from '../../platform/audit/audit.service';
import { DocumentsService, type UploadedFile } from '../../platform/documents/documents.service';
import { S3Service } from '../../platform/documents/s3.service';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { FieldIssuesService } from './field-issues.service';
import { parseChecklist, toFieldIssueDto } from './operations.mapper';
import { WorkOrderPresenter } from './work-order-presenter.service';
import { WorkOrdersService } from './work-orders.service';

const PHOTO_LIMIT_PER_ORDER = 60;
const PHOTO_URL_TTL_SECONDS = 300;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];

type GeoPoint = {
  kind: string;
  latitude: number;
  longitude: number;
  accuracy?: number;
  at: string;
  userId: string;
};

/**
 * App de campo (ADR-0021). O aparelho pode ficar horas sem internet e enviar tudo depois: cada ação leva uma chave
 * gerada no aparelho (`clientActionId`), então reenviar um lote não repete nada. As ações só se acrescentam ao registro
 * da ordem; se o servidor recusa uma (a ordem foi cancelada, por exemplo), ela volta como REJECTED com a mensagem, e
 * nada que já estava no servidor é sobrescrito.
 */
@Injectable()
export class FieldService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
    private readonly workOrders: WorkOrdersService,
    private readonly issues: FieldIssuesService,
    private readonly documents: DocumentsService,
    private readonly s3: S3Service,
    private readonly presenter: WorkOrderPresenter,
  ) {}

  /** Só quem executa em campo ou gerencia ordens usa o app de campo. */
  assertFieldAccess(actor: RequestUser): void {
    if (
      !actor.permissions.includes('ops.field.execute') &&
      !actor.permissions.includes('ops.workorder.write')
    )
      throw new ForbiddenException('Seu perfil não usa o app de campo.');
  }

  // --- leitura para o aparelho ------------------------------------------------------------------------------

  /** As ordens do técnico, com tudo o que ele precisa em campo (e para guardar offline). */
  async listMine(actor: RequestUser): Promise<FieldWorkOrderDto[]> {
    const rows = await this.workOrders.mineRows(actor.id);
    if (rows.length === 0) return [];
    const db = this.prisma.db;
    const dtos = await this.presenter.present(rows);
    const siteIds = [...new Set(rows.map((r) => r.siteId).filter((x): x is string => !!x))];
    const accountIds = [...new Set(rows.map((r) => r.accountId).filter((x): x is string => !!x))];
    const installationIds = [
      ...new Set(rows.map((r) => r.installationId).filter((x): x is string => !!x)),
    ];
    const [sites, contacts, accounts, openIssues, photos] = await Promise.all([
      siteIds.length ? db.site.findMany({ where: { id: { in: siteIds } } }) : [],
      accountIds.length
        ? db.contact.findMany({
            where: { accountId: { in: accountIds }, deletedAt: null },
            orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
          })
        : [],
      accountIds.length
        ? db.account.findMany({
            where: { id: { in: accountIds } },
            select: { id: true, phone: true },
          })
        : [],
      installationIds.length
        ? db.fieldIssue.findMany({
            where: { installationId: { in: installationIds }, status: 'OPEN' },
          })
        : [],
      db.workOrderPhoto.findMany({
        where: { workOrderId: { in: rows.map((r) => r.id) } },
        orderBy: { takenAt: 'asc' },
      }),
    ]);
    const documentIds = photos.map((p) => p.documentId);
    const documents = documentIds.length
      ? await db.document.findMany({
          where: { id: { in: documentIds } },
          select: { id: true, storageKey: true, filename: true },
        })
      : [];
    const urls = new Map<string, string>();
    for (const doc of documents)
      urls.set(
        doc.id,
        await this.s3.presignedDownloadUrl(doc.storageKey, doc.filename, PHOTO_URL_TTL_SECONDS),
      );

    return dtos.map((dto, index) => {
      const row = rows[index]!;
      const site = sites.find((s) => s.id === row.siteId);
      const contact =
        contacts.find((c) => c.accountId === row.accountId && c.phone) ??
        contacts.find((c) => c.accountId === row.accountId);
      const account = accounts.find((a) => a.id === row.accountId);
      const address = site
        ? [
            site.street && `${site.street}${site.number ? `, ${site.number}` : ''}`,
            site.district,
            `${site.city}/${site.state}`,
            site.zip,
          ]
            .filter(Boolean)
            .join(' – ')
        : null;
      return {
        ...dto,
        address,
        siteLatitude: site?.latitude ?? null,
        siteLongitude: site?.longitude ?? null,
        contactName: contact?.name ?? null,
        contactPhone: contact?.phone ?? account?.phone ?? null,
        openIssues: openIssues
          .filter((i) => i.installationId === row.installationId)
          .map(toFieldIssueDto),
        photos: photos
          .filter((p) => p.workOrderId === row.id)
          .map((p) => ({
            id: p.id,
            workOrderId: p.workOrderId,
            caption: p.caption,
            takenAt: p.takenAt.toISOString(),
            latitude: p.latitude,
            longitude: p.longitude,
            visibleToCustomer: p.visibleToCustomer,
            url: urls.get(p.documentId) ?? '',
          })),
        fetchedAt: new Date().toISOString(),
      };
    });
  }

  // --- sincronização ----------------------------------------------------------------------------------------

  async sync(actions: FieldActionInput[], actor: RequestUser): Promise<FieldSyncResultDto[]> {
    const results: FieldSyncResultDto[] = [];
    for (const action of actions) {
      const previous = await this.prisma.db.fieldAction.findFirst({
        where: { clientActionId: action.clientActionId },
      });
      if (previous) {
        results.push({
          clientActionId: action.clientActionId,
          status: previous.status === 'APPLIED' ? 'DUPLICATE' : 'REJECTED',
          message: previous.message,
        });
        continue;
      }
      let status: 'APPLIED' | 'REJECTED' = 'APPLIED';
      let message: string | null = null;
      try {
        message = await this.apply(action, actor);
      } catch (error) {
        // Erro do cliente (permissão, estado da ordem): a ação é recusada e fica registrada. Erro do servidor sobe:
        // o lote inteiro falha e o aparelho tenta de novo (o que já foi aplicado não se repete).
        if (!(error instanceof HttpException) || error.getStatus() >= 500) throw error;
        status = 'REJECTED';
        message = this.messageOf(error);
      }
      await this.recordAction(action, actor, status, message);
      results.push({ clientActionId: action.clientActionId, status, message });
    }
    return results;
  }

  private messageOf(error: HttpException): string {
    const response = error.getResponse();
    if (typeof response === 'string') return response;
    const message = (response as { message?: unknown }).message;
    return Array.isArray(message)
      ? message.join('; ')
      : typeof message === 'string'
        ? message
        : error.message;
  }

  private async recordAction(
    action: { clientActionId: string; workOrderId: string; type: string; capturedAt: string },
    actor: RequestUser,
    status: 'APPLIED' | 'REJECTED',
    message: string | null,
  ): Promise<void> {
    try {
      await this.prisma.db.fieldAction.create({
        data: {
          tenantId: this.context.requireTenantId(),
          clientActionId: action.clientActionId,
          userId: actor.id,
          workOrderId: action.workOrderId,
          type: action.type,
          capturedAt: new Date(action.capturedAt),
          status,
          message,
        },
      });
    } catch (error) {
      // Dois envios simultâneos da mesma ação: o segundo só encontra o registro do primeiro.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'))
        throw error;
    }
  }

  /** Aplica uma ação e devolve uma observação (ou nulo). Idempotente por estado: repetir não faz mal. */
  private async apply(action: FieldActionInput, actor: RequestUser): Promise<string | null> {
    const order = await this.workOrders.requireRow(action.workOrderId);
    await this.workOrders.assertCanAct(order, actor);
    switch (action.type) {
      case 'START': {
        if (order.status === 'IN_PROGRESS') return 'A ordem já estava em execução.';
        await this.workOrders.start(order.id, actor);
        if (action.geo)
          await this.addGeo(order.id, 'START', action.geo, action.capturedAt, actor.id);
        return null;
      }
      case 'COMPLETE': {
        if (order.status === 'DONE') return 'A ordem já estava concluída.';
        await this.workOrders.complete(order.id, { notes: action.notes }, actor);
        if (action.geo)
          await this.addGeo(order.id, 'COMPLETE', action.geo, action.capturedAt, actor.id);
        return null;
      }
      case 'CHECK':
        await this.check(order.id, action, actor);
        return null;
      case 'NOTE':
        await this.addNote(order.id, action.text, action.capturedAt, actor);
        return null;
      case 'ISSUE': {
        if (!order.installationId)
          throw new UnprocessableEntityException('Esta ordem não é de uma instalação.');
        await this.issues.create(
          order.installationId,
          {
            type: action.issueType,
            description: action.description,
            blocking: action.blocking,
            workOrderId: order.id,
          },
          actor,
        );
        return null;
      }
    }
  }

  /** Trava a linha da ordem enquanto altera os campos em JSON, para duas pessoas não se atropelarem. */
  private async withLockedOrder<T>(
    id: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM work_orders WHERE id = ${id}::uuid FOR UPDATE`;
      return fn(tx as unknown as Prisma.TransactionClient);
    });
  }

  private async addGeo(
    id: string,
    kind: string,
    geo: { latitude: number; longitude: number; accuracy?: number },
    at: string,
    userId: string,
  ): Promise<void> {
    await this.withLockedOrder(id, async (tx) => {
      const row = await tx.workOrder.findUniqueOrThrow({ where: { id }, select: { geo: true } });
      const points = (Array.isArray(row.geo) ? row.geo : []) as GeoPoint[];
      await tx.workOrder.update({
        where: { id },
        data: { geo: [...points, { kind, ...geo, at, userId }] as object[] },
      });
    });
  }

  private async check(
    id: string,
    action: Extract<FieldActionInput, { type: 'CHECK' }>,
    actor: RequestUser,
  ): Promise<void> {
    await this.withLockedOrder(id, async (tx) => {
      const row = await tx.workOrder.findUniqueOrThrow({
        where: { id },
        select: { checklist: true, status: true },
      });
      if (row.status === 'CANCELLED')
        throw new UnprocessableEntityException('A ordem foi cancelada.');
      const items = parseChecklist(row.checklist);
      const item = items.find((i) => i.id === action.itemId);
      if (!item) throw new UnprocessableEntityException('O item não existe mais no checklist.');
      const next: ChecklistItemDto[] = items.map((i) =>
        i.id === action.itemId
          ? {
              ...i,
              done: action.done,
              note: action.note ?? i.note,
              doneAt: action.done ? action.capturedAt : null,
              doneById: action.done ? actor.id : null,
            }
          : i,
      );
      await tx.workOrder.update({ where: { id }, data: { checklist: next as object[] } });
    });
  }

  private async addNote(id: string, text: string, at: string, actor: RequestUser): Promise<void> {
    await this.withLockedOrder(id, async (tx) => {
      const row = await tx.workOrder.findUniqueOrThrow({
        where: { id },
        select: { notes: true, status: true },
      });
      if (row.status === 'CANCELLED')
        throw new UnprocessableEntityException('A ordem foi cancelada.');
      const stamp = new Date(at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      const line = `[${stamp} · ${actor.name}] ${text}`;
      await tx.workOrder.update({
        where: { id },
        data: { notes: row.notes ? `${row.notes}\n${line}` : line },
      });
    });
  }

  // --- fotos e assinatura -----------------------------------------------------------------------------------

  private toPhotoDto(
    photo: {
      id: string;
      workOrderId: string;
      caption: string | null;
      takenAt: Date;
      latitude: number | null;
      longitude: number | null;
      visibleToCustomer: boolean;
    },
    url: string,
  ): WorkOrderPhotoDto {
    return {
      id: photo.id,
      workOrderId: photo.workOrderId,
      caption: photo.caption,
      takenAt: photo.takenAt.toISOString(),
      latitude: photo.latitude,
      longitude: photo.longitude,
      visibleToCustomer: photo.visibleToCustomer,
      url,
    };
  }

  async uploadPhoto(
    workOrderId: string,
    file: UploadedFile | undefined,
    input: UploadFieldPhotoInput,
    actor: RequestUser,
  ): Promise<WorkOrderPhotoDto> {
    const order = await this.workOrders.requireRow(workOrderId);
    await this.workOrders.assertCanAct(order, actor);
    const existing = await this.prisma.db.workOrderPhoto.findFirst({
      where: { clientActionId: input.clientActionId },
    });
    // Reenvio da mesma foto (o aparelho não soube se a primeira chegou): devolve a que já existe.
    if (existing) {
      const doc = await this.prisma.db.document.findFirstOrThrow({
        where: { id: existing.documentId },
      });
      return this.toPhotoDto(
        existing,
        await this.s3.presignedDownloadUrl(doc.storageKey, doc.filename, PHOTO_URL_TTL_SECONDS),
      );
    }
    if (order.status === 'CANCELLED')
      throw new UnprocessableEntityException('A ordem foi cancelada.');
    if (!file || !IMAGE_TYPES.includes(file.mimetype))
      throw new UnprocessableEntityException('Envie uma imagem (JPEG, PNG, WebP ou HEIC).');
    const count = await this.prisma.db.workOrderPhoto.count({ where: { workOrderId } });
    if (count >= PHOTO_LIMIT_PER_ORDER)
      throw new UnprocessableEntityException(`Limite de ${PHOTO_LIMIT_PER_ORDER} fotos por ordem.`);
    const document = await this.documents.upload(file, {
      entityType: 'WorkOrder',
      entityId: workOrderId,
    });
    const photo = await this.prisma.db.workOrderPhoto.create({
      data: {
        tenantId: order.tenantId,
        workOrderId,
        documentId: document.id,
        clientActionId: input.clientActionId,
        caption: input.caption ?? null,
        takenAt: input.takenAt ? new Date(input.takenAt) : new Date(),
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        accuracy: input.accuracy ?? null,
        uploadedById: actor.id,
      },
    });
    const stored = await this.prisma.db.document.findFirstOrThrow({ where: { id: document.id } });
    return this.toPhotoDto(
      photo,
      await this.s3.presignedDownloadUrl(stored.storageKey, stored.filename, PHOTO_URL_TTL_SECONDS),
    );
  }

  /** Legenda e liberação para o cliente: decisão de quem gerencia a ordem. */
  async updatePhoto(id: string, input: UpdateFieldPhotoInput): Promise<WorkOrderPhotoDto> {
    const photo = await this.prisma.db.workOrderPhoto.findFirst({ where: { id } });
    if (!photo) throw new NotFoundException('Foto não encontrada.');
    const updated = await this.prisma.db.workOrderPhoto.update({
      where: { id },
      data: {
        ...(input.caption !== undefined ? { caption: input.caption } : {}),
        ...(input.visibleToCustomer !== undefined
          ? { visibleToCustomer: input.visibleToCustomer }
          : {}),
      },
    });
    await this.audit.record({
      action: 'work_order.photo_updated',
      entity: 'WorkOrderPhoto',
      entityId: id,
      after: { visibleToCustomer: updated.visibleToCustomer },
    });
    const doc = await this.prisma.db.document.findFirstOrThrow({
      where: { id: updated.documentId },
    });
    return this.toPhotoDto(
      updated,
      await this.s3.presignedDownloadUrl(doc.storageKey, doc.filename, PHOTO_URL_TTL_SECONDS),
    );
  }

  async listPhotos(workOrderId: string): Promise<WorkOrderPhotoDto[]> {
    await this.workOrders.requireRow(workOrderId);
    const photos = await this.prisma.db.workOrderPhoto.findMany({
      where: { workOrderId },
      orderBy: { takenAt: 'asc' },
    });
    const docs = photos.length
      ? await this.prisma.db.document.findMany({
          where: { id: { in: photos.map((p) => p.documentId) } },
        })
      : [];
    const out: WorkOrderPhotoDto[] = [];
    for (const p of photos) {
      const doc = docs.find((d) => d.id === p.documentId);
      out.push(
        this.toPhotoDto(
          p,
          doc
            ? await this.s3.presignedDownloadUrl(
                doc.storageKey,
                doc.filename,
                PHOTO_URL_TTL_SECONDS,
              )
            : '',
        ),
      );
    }
    return out;
  }

  /** Assinatura do cliente (imagem PNG desenhada na tela), com o nome de quem assinou. */
  async saveSignature(
    workOrderId: string,
    file: UploadedFile | undefined,
    input: SaveFieldSignatureInput,
    actor: RequestUser,
  ): Promise<{ signedByName: string; signedAt: string }> {
    const order = await this.workOrders.requireRow(workOrderId);
    await this.workOrders.assertCanAct(order, actor);
    const already = await this.prisma.db.fieldAction.findFirst({
      where: { clientActionId: input.clientActionId },
    });
    if (already?.status === 'APPLIED' && order.signedAt)
      return {
        signedByName: order.signedByName ?? input.signedByName,
        signedAt: order.signedAt.toISOString(),
      };
    if (!['IN_PROGRESS', 'DONE'].includes(order.status))
      throw new UnprocessableEntityException(
        'A assinatura só vale para ordem em execução ou concluída.',
      );
    if (!file || file.mimetype !== 'image/png')
      throw new UnprocessableEntityException('Envie a assinatura como imagem PNG.');
    const document = await this.documents.upload(file, {
      entityType: 'WorkOrderSignature',
      entityId: workOrderId,
      ...(order.signatureDocumentId ? { replacesDocumentId: order.signatureDocumentId } : {}),
    });
    const signedAt = new Date();
    await this.prisma.db.$transaction(async (tx) => {
      await tx.workOrder.update({
        where: { id: workOrderId },
        data: { signatureDocumentId: document.id, signedByName: input.signedByName, signedAt },
      });
      await this.audit.record(
        {
          action: 'work_order.signed',
          entity: 'WorkOrder',
          entityId: workOrderId,
          after: { signedByName: input.signedByName },
        },
        tx,
      );
    });
    await this.recordAction(
      {
        clientActionId: input.clientActionId,
        workOrderId,
        type: 'SIGNATURE',
        capturedAt: signedAt.toISOString(),
      },
      actor,
      'APPLIED',
      null,
    );
    return { signedByName: input.signedByName, signedAt: signedAt.toISOString() };
  }
}
