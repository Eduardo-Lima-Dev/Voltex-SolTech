import { Injectable } from '@nestjs/common';
import type { ListAuditLogsQuery } from '@voltex/shared';
import { RequestContext } from '../../common/context/request-context';
import { toPaginated, toSkipTake } from '../../common/pagination';
import { redact } from '../../common/redact';
import { PrismaService, type ScopedPrismaClient } from '../prisma/prisma.service';

export interface AuditEntry {
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  /** Obrigatório quando não há tenant no contexto (ex.: login). */
  tenantId?: string;
  actorId?: string | null;
}

export type AuditClient = Pick<ScopedPrismaClient, 'auditLog'>;

@Injectable()
export class AuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
  ) {}

  /**
   * Grava uma entrada de auditoria. Passe `client` (a transação) para que a auditoria seja atômica com a
   * mudança. Valores sensíveis (senha, token, hash...) são removidos antes de gravar.
   */
  async record(entry: AuditEntry, client?: AuditClient): Promise<void> {
    const tenantId = entry.tenantId ?? this.context.requireTenantId();
    const data = {
      tenantId,
      actorId: entry.actorId === undefined ? (this.context.userId ?? null) : entry.actorId,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      before: entry.before === undefined ? undefined : (redact(entry.before) as object),
      after: entry.after === undefined ? undefined : (redact(entry.after) as object),
      ip: this.context.ip ?? null,
      userAgent: this.context.userAgent ?? null,
      requestId: this.context.requestId ?? null,
    };
    // Sem contexto de tenant (login, convite) o cliente escopado recusaria a gravação: usa o de sistema.
    const target = client ?? (this.context.tenantId ? this.prisma.db : this.prisma.system);
    await target.auditLog.create({ data });
  }

  async list(query: ListAuditLogsQuery) {
    const where = {
      ...(query.entity ? { entity: query.entity } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lte: query.to } : {}),
            },
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.db.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...toSkipTake(query),
      }),
      this.prisma.db.auditLog.count({ where }),
    ]);
    return toPaginated(data, total, query);
  }
}
