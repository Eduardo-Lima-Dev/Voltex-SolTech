import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@voltex/database';
import {
  DomainEvent,
  type CreateSourceWatchInput,
  type SourceWatchDto,
  type UpdateSourceWatchInput,
} from '@voltex/shared';
import { diffLines, htmlToText, normalizeText } from '@voltex/solar-engine';
import { createHash } from 'node:crypto';
import { extractText, getDocumentProxy } from 'unpdf';
import { RequestContext } from '../../common/context/request-context';
import { AuditService } from '../audit/audit.service';
import { EventBus } from '../events/event-bus.service';
import { PrismaService } from '../prisma/prisma.service';
import { DataHubHttp, assertPublicUrl } from './data-hub-http';
import { UpdateProposalsService } from './update-proposals.service';

type WatchRow = Awaited<ReturnType<PrismaService['db']['sourceWatch']['findFirstOrThrow']>>;

const toDto = (row: WatchRow): SourceWatchDto => ({
  id: row.id,
  label: row.label,
  url: row.url,
  kind: row.kind,
  enabled: row.enabled,
  checkedAt: row.checkedAt?.toISOString() ?? null,
  changedAt: row.changedAt?.toISOString() ?? null,
  lastError: row.lastError,
  createdAt: row.createdAt.toISOString(),
});

export type WatchCheckStatus = 'BASELINE' | 'UNCHANGED' | 'CHANGED' | 'ERROR';

/** Texto guardado como base da diferença: o suficiente para uma norma longa, sem inflar o banco. */
const MAX_TEXT_CHARS = 2_000_000;

/**
 * Vigilância de fontes (páginas, PDFs e textos de normas, resoluções e leis). A coleta só **detecta mudança** e entrega
 * a diferença ao responsável técnico pela caixa de atualizações: nenhuma regra é criada ou alterada sozinha (ADR-0018).
 */
@Injectable()
export class SourceWatchService {
  private readonly logger = new Logger(SourceWatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly proposals: UpdateProposalsService,
    private readonly http: DataHubHttp,
  ) {}

  async list(): Promise<SourceWatchDto[]> {
    const rows = await this.prisma.db.sourceWatch.findMany({
      where: { deletedAt: null },
      orderBy: { label: 'asc' },
    });
    return rows.map(toDto);
  }

  async create(input: CreateSourceWatchInput): Promise<SourceWatchDto> {
    const parsedUrl = await assertPublicUrl(input.url);
    const url = parsedUrl.toString();
    try {
      const row = await this.prisma.db.$transaction(async (tx) => {
        const created = await tx.sourceWatch.create({
          data: {
            tenantId: this.context.requireTenantId(),
            label: input.label,
            url,
            kind: input.kind ?? 'NORM',
            createdById: this.context.userId ?? null,
          },
        });
        await this.audit.record(
          {
            action: 'source_watch.created',
            entity: 'SourceWatch',
            entityId: created.id,
            after: { label: created.label, url },
          },
          tx,
        );
        return created;
      });
      return toDto(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException('Este endereço já está sendo vigiado');
      throw error;
    }
  }

  async update(id: string, input: UpdateSourceWatchInput): Promise<SourceWatchDto> {
    const row = await this.require(id);
    const updated = await this.prisma.db.sourceWatch.update({
      where: { id: row.id },
      data: {
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.kind !== undefined ? { kind: input.kind } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      },
    });
    return toDto(updated);
  }

  async remove(id: string): Promise<{ id: string }> {
    const row = await this.require(id);
    await this.prisma.db.$transaction(async (tx) => {
      await tx.sourceWatch.update({
        where: { id: row.id },
        data: { deletedAt: new Date(), enabled: false },
      });
      await this.audit.record(
        {
          action: 'source_watch.deleted',
          entity: 'SourceWatch',
          entityId: id,
          before: { url: row.url },
        },
        tx,
      );
    });
    return { id };
  }

  /** Coleta a página, compara com a anterior e, se mudou, abre uma proposta de revisão. */
  async check(id: string): Promise<{ status: WatchCheckStatus; watch: SourceWatchDto }> {
    const row = await this.require(id);
    let text: string;
    try {
      text = await this.fetchText(row.url);
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
      const failed = await this.prisma.db.sourceWatch.update({
        where: { id },
        data: { checkedAt: new Date(), lastError: message },
      });
      return { status: 'ERROR', watch: toDto(failed) };
    }
    const hash = createHash('sha256').update(text).digest('hex');
    const now = new Date();

    if (row.lastHash === null) {
      const baseline = await this.prisma.db.sourceWatch.update({
        where: { id },
        data: { lastHash: hash, lastText: text, checkedAt: now, lastError: null },
      });
      return { status: 'BASELINE', watch: toDto(baseline) };
    }
    if (row.lastHash === hash) {
      const same = await this.prisma.db.sourceWatch.update({
        where: { id },
        data: { checkedAt: now, lastError: null },
      });
      return { status: 'UNCHANGED', watch: toDto(same) };
    }

    const diff = diffLines(row.lastText ?? '', text);
    const changed = await this.prisma.db.$transaction(async (tx) => {
      const updated = await tx.sourceWatch.update({
        where: { id },
        data: { lastHash: hash, lastText: text, checkedAt: now, changedAt: now, lastError: null },
      });
      await this.proposals.create(
        {
          type: 'WATCH_CHANGE',
          title: `A fonte "${row.label}" mudou`,
          target: { watchId: id },
          proposed: { url: row.url, kind: row.kind },
          diff: { ...diff },
          origin: {
            source: 'source-watch',
            url: row.url,
            collectedAt: now.toISOString(),
            contentHash: hash,
          },
          dedupeKey: `watch:${id}:${hash}`,
        },
        tx,
      );
      await this.events.publish(
        {
          type: DomainEvent.EXTERNAL_SOURCE_CHANGED,
          actorId: null,
          payload: {
            watchId: id,
            label: row.label,
            url: row.url,
            addedLines: diff.addedCount,
            removedLines: diff.removedCount,
          },
        },
        tx,
      );
      await this.audit.record(
        {
          action: 'source_watch.changed',
          entity: 'SourceWatch',
          entityId: id,
          actorId: null,
          after: { url: row.url, addedLines: diff.addedCount, removedLines: diff.removedCount },
        },
        tx,
      );
      return updated;
    });
    return { status: 'CHANGED', watch: toDto(changed) };
  }

  /** Verifica todas as fontes ligadas da empresa do contexto. Um erro numa página não interrompe as outras. */
  async checkAll(): Promise<Record<WatchCheckStatus, number>> {
    const totals: Record<WatchCheckStatus, number> = {
      BASELINE: 0,
      UNCHANGED: 0,
      CHANGED: 0,
      ERROR: 0,
    };
    const watches = await this.prisma.db.sourceWatch.findMany({
      where: { enabled: true, deletedAt: null },
      select: { id: true },
    });
    for (const { id } of watches) {
      try {
        totals[(await this.check(id)).status] += 1;
      } catch (error) {
        totals.ERROR += 1;
        this.logger.warn(`Falha ao verificar a fonte ${id}: ${String(error)}`);
      }
    }
    return totals;
  }

  private async require(id: string): Promise<WatchRow> {
    const row = await this.prisma.db.sourceWatch.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundException('Fonte vigiada não encontrada');
    return row;
  }

  private async fetchText(url: string): Promise<string> {
    await assertPublicUrl(url);
    const { body, contentType } = await this.http.getBuffer(url);
    const isPdf = (contentType ?? '').includes('pdf') || body.subarray(0, 4).toString() === '%PDF';
    let text: string;
    if (isPdf) {
      try {
        const pdf = await getDocumentProxy(new Uint8Array(body));
        text = (await extractText(pdf, { mergePages: true })).text;
      } catch {
        throw new Error('O PDF não pôde ser lido (corrompido ou protegido)');
      }
    } else {
      const raw = body.toString('utf8');
      text =
        (contentType ?? '').includes('html') || /<\s*html|<\s*body/i.test(raw)
          ? htmlToText(raw)
          : raw;
    }
    const normalized = normalizeText(text).slice(0, MAX_TEXT_CHARS);
    if (normalized.length === 0)
      throw new Error('A página não tem texto legível (PDF escaneado ou vazio)');
    return normalized;
  }
}
