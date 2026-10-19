import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { DomainEvent, type ListDocumentsQuery, type UploadDocumentInput } from '@voltex/shared';
import { RequestContext } from '../../common/context/request-context';
import { toPaginated, toSkipTake } from '../../common/pagination';
import { AuditService } from '../audit/audit.service';
import { EventBus } from '../events/event-bus.service';
import { PrismaService } from '../prisma/prisma.service';
import { assertAllowedFile, sanitizeFilename, toStorageName } from './file-validation';
import { S3Service } from './s3.service';

export const DOWNLOAD_URL_TTL_SECONDS = 300;

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly s3: S3Service,
    private readonly audit: AuditService,
    private readonly events: EventBus,
  ) {}

  async upload(file: UploadedFile | undefined, input: UploadDocumentInput) {
    if (!file) throw new BadRequestException('Envie o arquivo no campo "file"');
    if (file.size === 0) throw new BadRequestException('Arquivo vazio');
    assertAllowedFile(file.mimetype, file.buffer);
    if ((input.entityType && !input.entityId) || (!input.entityType && input.entityId)) {
      throw new BadRequestException('Informe entityType e entityId juntos');
    }

    const tenantId = this.context.requireTenantId();
    const filename = sanitizeFilename(file.originalname);

    let groupId: string = randomUUID();
    let nextVersion = 1;
    let entityType = input.entityType ?? null;
    let entityId = input.entityId ?? null;
    if (input.replacesDocumentId) {
      const previous = await this.getOrThrow(input.replacesDocumentId);
      groupId = previous.groupId;
      entityType = previous.entityType;
      entityId = previous.entityId;
      const latest = await this.prisma.db.document.findFirst({
        where: { groupId },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      nextVersion = (latest?.version ?? 0) + 1;
    }

    const now = new Date();
    const storageKey = `${tenantId}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}-${toStorageName(filename)}`;
    const checksumSha256 = createHash('sha256').update(file.buffer).digest('hex');

    await this.s3.put(storageKey, file.buffer, file.mimetype);
    try {
      return await this.prisma.db.$transaction(async (tx) => {
        const document = await tx.document.create({
          data: {
            tenantId,
            uploadedById: this.context.userId ?? null,
            groupId,
            version: nextVersion,
            filename,
            mimeType: file.mimetype,
            sizeBytes: file.size,
            storageKey,
            checksumSha256,
            entityType,
            entityId,
          },
        });
        await this.audit.record(
          {
            action: 'document.uploaded',
            entity: 'Document',
            entityId: document.id,
            after: { filename, version: nextVersion, entityType, entityId },
          },
          tx,
        );
        await this.events.publish(
          {
            type: DomainEvent.DOCUMENT_UPLOADED,
            payload: {
              documentId: document.id,
              groupId,
              version: nextVersion,
              entityType,
              entityId,
            },
          },
          tx,
        );
        return this.toPublic(document);
      });
    } catch (error) {
      // O registro não foi gravado: remove o objeto órfão para não acumular lixo no bucket.
      await this.s3
        .remove(storageKey)
        .catch((cleanupError: unknown) =>
          this.logger.error({ err: cleanupError, storageKey }, 'Falha ao remover objeto órfão'),
        );
      throw error;
    }
  }

  async list(query: ListDocumentsQuery) {
    const where = {
      deletedAt: null,
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.db.document.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...toSkipTake(query),
      }),
      this.prisma.db.document.count({ where }),
    ]);
    return toPaginated(
      rows.map((row) => this.toPublic(row)),
      total,
      query,
    );
  }

  async get(id: string) {
    return this.toPublic(await this.getOrThrow(id));
  }

  async versions(id: string) {
    const document = await this.getOrThrow(id);
    const rows = await this.prisma.db.document.findMany({
      where: { groupId: document.groupId, deletedAt: null },
      orderBy: { version: 'desc' },
    });
    return rows.map((row) => this.toPublic(row));
  }

  async downloadUrl(id: string) {
    const document = await this.getOrThrow(id);
    const url = await this.s3.presignedDownloadUrl(
      document.storageKey,
      document.filename,
      DOWNLOAD_URL_TTL_SECONDS,
    );
    await this.audit.record({
      action: 'document.download_url_issued',
      entity: 'Document',
      entityId: id,
    });
    return { url, expiresIn: DOWNLOAD_URL_TTL_SECONDS };
  }

  /** Conteúdo e metadados de um documento, para uso interno de outros módulos. */
  async readContent(id: string) {
    const document = await this.getOrThrow(id);
    const buffer = await this.s3.getBuffer(document.storageKey);
    return { buffer, filename: document.filename, mimeType: document.mimeType };
  }

  /** Exclusão lógica: o objeto permanece no bucket (retenção/LGPD é política de infraestrutura). */
  async remove(id: string) {
    const document = await this.getOrThrow(id);
    await this.prisma.db.$transaction(async (tx) => {
      await tx.document.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.record(
        {
          action: 'document.deleted',
          entity: 'Document',
          entityId: id,
          before: { filename: document.filename, version: document.version },
        },
        tx,
      );
    });
    return { id };
  }

  private async getOrThrow(id: string) {
    const document = await this.prisma.db.document.findFirst({ where: { id, deletedAt: null } });
    if (!document) throw new NotFoundException('Documento não encontrado');
    return document;
  }

  /** Nunca expõe a chave interna do objeto. */
  private toPublic<T extends { storageKey: string }>(row: T): Omit<T, 'storageKey'> {
    const { storageKey: _storageKey, ...rest } = row;
    return rest;
  }
}
