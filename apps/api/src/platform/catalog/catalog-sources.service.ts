import { createHash } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type {
  CatalogSourceDocumentDto,
  CatalogSourceDto,
  ImportPreviewDto,
  ListSourceDocumentsQuery,
  Paginated,
} from '@voltex/shared';
import { parseCatalogSiteDownloads } from '@voltex/solar-engine';
import { toPaginated, toSkipTake } from '../../common/pagination';
import { DataHubHttp, assertPublicUrl } from '../data-hub/data-hub-http';
import { dataSourceDefinition } from '../data-hub/data-hub.registry';
import { DataSourcesService } from '../data-hub/data-sources.service';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogImportService } from './catalog-import.service';

/** Sites com listagem pública de fichas técnicas. A página `?page=N` devolve os documentos até acabarem. */
const SITES: Record<string, { listUrl: string; maxPages: number }> = {
  techlux: { listUrl: 'https://techlux.com.br/download', maxPages: 80 },
};
const DOC_KIND = 'DOC';
const PAGE_DELAY_MS = process.env.NODE_ENV === 'test' ? 0 : 600;
const MAX_PDF_BYTES = 20 * 1024 * 1024;

/** `Inversor Sungrow 8K SG8.0RS-L 220V Monofásico On-Grid` → `8K SG8.0RS-L 220V Monofásico On-Grid` (a pessoa ajusta na prévia). */
export const modelFromTitle = (title: string, brand: string): string =>
  title
    .replace(/^\s*(micro-?\s*inversor|inversor)\s+/i, '')
    .replace(new RegExp(`^${brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+`, 'i'), '')
    .replace(/\s+/g, ' ')
    .trim();

const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

/**
 * Fontes de catálogo na internet (9C+): lê a **listagem pública** de fichas técnicas, guarda só os links e, quando a
 * pessoa escolhe uma ficha, baixa o PDF, lê e mostra a prévia pelo mesmo caminho do envio manual. Nada é gravado no
 * catálogo sem a conferência. O acesso é educado: um pedido por vez, com pausa, e só a hosts públicos da fonte.
 */
@Injectable()
export class CatalogSourcesService {
  private readonly logger = new Logger(CatalogSourcesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sources: DataSourcesService,
    private readonly http: DataHubHttp,
    private readonly imports: CatalogImportService,
  ) {}

  private site(key: string) {
    const site = SITES[key];
    if (!site) throw new NotFoundException('Fonte de catálogo desconhecida');
    return site;
  }

  async list(): Promise<CatalogSourceDto[]> {
    const all = await this.sources.list();
    const result: CatalogSourceDto[] = [];
    for (const source of all) {
      const isSite = source.key in SITES;
      if (!isSite && source.key !== 'cec-library') continue;
      let documentCount = 0;
      let indexedAt: string | null = null;
      if (isSite) {
        const row = await this.prisma.system.dataSource.findUnique({ where: { key: source.key } });
        if (row) {
          const where = { sourceId: row.id, kind: { startsWith: DOC_KIND } };
          documentCount = await this.prisma.system.externalRecord.count({ where });
          indexedAt =
            (
              await this.prisma.system.externalRecord.findFirst({
                where,
                orderBy: { collectedAt: 'desc' },
                select: { collectedAt: true },
              })
            )?.collectedAt.toISOString() ?? null;
        }
      } else {
        documentCount = await this.prisma.system.externalRecord.count({
          where: { kind: { startsWith: 'CEC_' } },
        });
      }
      result.push({
        key: source.key,
        label: source.label,
        baseUrl: source.baseUrl,
        license: source.license,
        attribution: source.attribution,
        licenseStatus: source.licenseStatus,
        enabled: source.enabled,
        notes: source.notes,
        documentCount,
        indexedAt,
        mode: isSite ? 'documents' : 'library',
      });
    }
    return result;
  }

  /** Percorre a listagem (página a página, com pausa) e atualiza os links guardados. */
  async refresh(key: string): Promise<{ pages: number; found: number; created: number }> {
    const site = this.site(key);
    this.sources.requireEnabled(key);
    const source = await this.sources.get(key);
    const collection = await this.sources.startCollection(key, { kind: 'DOCUMENT_LIST' });
    let found = 0;
    let created = 0;
    let pages = 0;
    try {
      for (let page = 1; page <= site.maxPages; page++) {
        const url = `${site.listUrl}?page=${page}`;
        await assertPublicUrl(url);
        const { body } = await this.http.getBuffer(url, { maxBytes: 4 * 1024 * 1024 });
        const documents = parseCatalogSiteDownloads(body.toString('utf8'), site.listUrl);
        if (documents.length === 0) break;
        pages += 1;
        for (const doc of documents) {
          found += 1;
          const kind = `${DOC_KIND}_${doc.docType.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
          const spec = {
            docType: doc.docType,
            title: doc.title,
            pdfUrl: doc.pdfUrl,
            productUrl: doc.productUrl,
            equipmentHint: doc.equipmentHint,
          };
          const where = {
            sourceId_kind_manufacturer_model: {
              sourceId: source.id,
              kind,
              manufacturer: doc.brand || '—',
              model: doc.title,
            },
          };
          const existing = await this.prisma.system.externalRecord.findUnique({ where });
          const contentHash = createHash('sha256').update(doc.pdfUrl).digest('hex');
          await this.prisma.system.externalRecord.upsert({
            where,
            create: {
              sourceId: source.id,
              kind,
              manufacturer: doc.brand || '—',
              model: doc.title,
              spec,
              contentHash,
            },
            update: { spec, contentHash, collectedAt: new Date() },
          });
          if (!existing) created += 1;
        }
        await sleep(PAGE_DELAY_MS);
      }
      await this.sources.finishCollection(collection.id, 'SUCCEEDED', {
        summary: { pages, found, created },
      });
      return { pages, found, created };
    } catch (error) {
      await this.sources.finishCollection(collection.id, 'FAILED', {
        error: error instanceof Error ? error.message : String(error),
      });
      this.logger.warn(`Falha ao listar ${key}: ${String(error)}`);
      throw error instanceof BadRequestException
        ? error
        : new UnprocessableEntityException(
            `Não foi possível ler a listagem de ${dataSourceDefinition(key)?.label ?? key}: ${error instanceof Error ? error.message : 'erro de rede'}`,
          );
    }
  }

  async documents(
    key: string,
    query: ListSourceDocumentsQuery,
  ): Promise<Paginated<CatalogSourceDocumentDto>> {
    this.site(key);
    const source = await this.sources.get(key);
    const rows = await this.prisma.system.externalRecord.findMany({
      where: {
        sourceId: source.id,
        kind: query.docType
          ? `${DOC_KIND}_${query.docType.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`
          : { startsWith: DOC_KIND },
        ...(query.search
          ? {
              OR: [
                { manufacturer: { contains: query.search, mode: 'insensitive' as const } },
                { model: { contains: query.search, mode: 'insensitive' as const } },
              ],
            }
          : {}),
        ...(query.equipment ? { spec: { path: ['equipmentHint'], equals: query.equipment } } : {}),
      },
      orderBy: [{ manufacturer: 'asc' }, { model: 'asc' }],
      ...toSkipTake(query),
    });
    const total = await this.prisma.system.externalRecord.count({
      where: {
        sourceId: source.id,
        kind: query.docType
          ? `${DOC_KIND}_${query.docType.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`
          : { startsWith: DOC_KIND },
        ...(query.search
          ? {
              OR: [
                { manufacturer: { contains: query.search, mode: 'insensitive' as const } },
                { model: { contains: query.search, mode: 'insensitive' as const } },
              ],
            }
          : {}),
        ...(query.equipment ? { spec: { path: ['equipmentHint'], equals: query.equipment } } : {}),
      },
    });
    return toPaginated(
      rows.map((r) => {
        const spec = r.spec as Record<string, string | null>;
        return {
          id: r.id,
          sourceKey: key,
          docType: String(spec.docType ?? ''),
          title: r.model,
          brand: r.manufacturer === '—' ? '' : r.manufacturer,
          pdfUrl: String(spec.pdfUrl ?? ''),
          productUrl: (spec.productUrl as string | null) ?? null,
          equipmentHint:
            (spec.equipmentHint as CatalogSourceDocumentDto['equipmentHint']) ?? 'OTHER',
          collectedAt: r.collectedAt.toISOString(),
        };
      }),
      total,
      query,
    );
  }

  /** Baixa a ficha escolhida, lê e devolve a prévia (mesmo caminho do envio manual). O PDF não é guardado. */
  async preview(documentId: string): Promise<ImportPreviewDto> {
    const record = await this.prisma.system.externalRecord.findUnique({
      where: { id: documentId },
      include: { source: true },
    });
    if (!record || !record.kind.startsWith(DOC_KIND))
      throw new NotFoundException('Documento não encontrado');
    const site = this.site(record.source.key);
    this.sources.requireEnabled(record.source.key);
    const spec = record.spec as Record<string, string>;
    const url = await assertPublicUrl(String(spec.pdfUrl));
    if (url.hostname !== new URL(site.listUrl).hostname)
      throw new BadRequestException('O documento não está no endereço da fonte');
    const { body, contentType } = await this.http.getBuffer(url.toString(), {
      maxBytes: MAX_PDF_BYTES,
    });
    if (contentType && !/pdf|octet-stream/i.test(contentType))
      throw new UnprocessableEntityException('O endereço não devolveu um PDF');
    const result = await this.imports.preview(
      {
        originalname: `${record.model}.pdf`,
        mimetype: 'application/pdf',
        buffer: body,
        size: body.length,
      },
      'datasheet-pdf',
      spec.equipmentHint === 'INVERTER' || spec.equipmentHint === 'MODULE'
        ? spec.equipmentHint
        : undefined,
      modelFromTitle(record.model, record.manufacturer),
    );
    const brand = record.manufacturer === '—' ? '' : record.manufacturer;
    return {
      ...result,
      candidates: result.candidates.map((c) => ({ ...c, manufacturer: c.manufacturer || brand })),
      notes: [
        `Fonte: ${spec.title} — ${spec.pdfUrl} (${record.source.attribution}).`,
        ...result.notes,
      ],
    };
  }
}
