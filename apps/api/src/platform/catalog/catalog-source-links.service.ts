import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type {
  CatalogLinkDocumentDto,
  CatalogSourceLinkDto,
  EquipmentKind,
  ImportPreviewDto,
  ListLinkDocumentsQuery,
  Paginated,
} from '@voltex/shared';
import {
  analyzeSourcePage,
  classifyDocument,
  fileTypeOf,
  type AnalyzedDocument,
} from '@voltex/solar-engine';
import { RequestContext } from '../../common/context/request-context';
import { toPaginated, toSkipTake } from '../../common/pagination';
import { AuditService } from '../audit/audit.service';
import { DataHubHttp, assertPublicUrl } from '../data-hub/data-hub-http';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogImportService } from './catalog-import.service';

const MAX_PAGES = 12;
const MAX_DOCUMENTS = 1500;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const PAGE_DELAY_MS = process.env.NODE_ENV === 'test' ? 0 : 500;
const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

const FORMAT_BY_FILE = { pdf: 'datasheet-pdf', csv: 'csv', pan: 'pan', ond: 'ond' } as const;

/**
 * Fontes por link (a empresa cola o endereço): o sistema analisa a página, cataloga os arquivos que sabe ler (PDF, CSV,
 * PAN, OND) com a classificação e os motivos, e a pessoa escolhe o que importar. Acesso educado (uma página por vez,
 * com pausa), só a endereços públicos e só à mesma listagem; o arquivo é baixado sob demanda e descartado.
 */
@Injectable()
export class CatalogSourceLinksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
    private readonly http: DataHubHttp,
    private readonly imports: CatalogImportService,
  ) {}

  private async require(id: string) {
    const link = await this.prisma.db.catalogSourceLink.findFirst({ where: { id } });
    if (!link) throw new NotFoundException('Fonte não encontrada');
    return link;
  }

  private async toDto(link: {
    id: string;
    url: string;
    label: string;
    status: string;
    lastAnalyzedAt: Date | null;
    lastError: string | null;
    pagesRead: number;
    createdAt: Date;
  }): Promise<CatalogSourceLinkDto> {
    const groups = await this.prisma.db.catalogSourceDocument.groupBy({
      by: ['equipmentHint'],
      where: { linkId: link.id },
      _count: { _all: true },
    });
    const byEquipment = Object.fromEntries(groups.map((g) => [g.equipmentHint, g._count._all]));
    return {
      id: link.id,
      url: link.url,
      label: link.label,
      status: link.status as CatalogSourceLinkDto['status'],
      lastAnalyzedAt: link.lastAnalyzedAt?.toISOString() ?? null,
      lastError: link.lastError,
      pagesRead: link.pagesRead,
      documentCount: Object.values(byEquipment).reduce((a, b) => a + b, 0),
      byEquipment,
      createdAt: link.createdAt.toISOString(),
    };
  }

  async list(): Promise<CatalogSourceLinkDto[]> {
    const links = await this.prisma.db.catalogSourceLink.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(links.map((l) => this.toDto(l)));
  }

  /** Cadastra a fonte e já analisa. Endereço repetido: 409. */
  async add(input: { url: string; label?: string | undefined }): Promise<CatalogSourceLinkDto> {
    const url = (await assertPublicUrl(input.url)).toString();
    const exists = await this.prisma.db.catalogSourceLink.findFirst({ where: { url } });
    if (exists) throw new ConflictException('Esta fonte já está cadastrada');
    const link = await this.prisma.db.catalogSourceLink.create({
      data: {
        tenantId: this.context.requireTenantId(),
        url,
        label: input.label?.trim() || new URL(url).hostname,
        createdById: this.context.userId ?? null,
      },
    });
    await this.audit.record({
      action: 'catalog.source_link_added',
      entity: 'CatalogSourceLink',
      entityId: link.id,
      after: { url },
    });
    return this.analyze(link.id);
  }

  /** Lê a página (e as seguintes da mesma listagem) e atualiza o catálogo de arquivos da fonte. */
  async analyze(id: string): Promise<CatalogSourceLinkDto> {
    const link = await this.require(id);
    const found = new Map<string, AnalyzedDocument>();
    let pagesRead = 0;
    let error: string | null = null;
    try {
      const direct = fileTypeOf(link.url);
      if (direct) {
        const name = decodeURIComponent(link.url.split(/[?#]/)[0]?.split('/').pop() ?? link.label);
        const c = classifyDocument({ title: name.replace(/\.[a-z0-9]+$/i, ''), url: link.url });
        found.set(link.url, {
          url: link.url,
          fileType: direct,
          title: name.replace(/\.[a-z0-9]+$/i, ''),
          brand: c.brand,
          docType: c.docType,
          equipmentHint: c.equipmentHint,
          pageUrl: link.url,
          productUrl: null,
          confidence: c.confidence,
          reasons: ['Endereço direto de arquivo', ...c.reasons],
        });
      } else {
        const queue = [link.url];
        const visited = new Set<string>();
        const host = new URL(link.url).hostname;
        while (queue.length && pagesRead < MAX_PAGES && found.size < MAX_DOCUMENTS) {
          const next = queue.shift() as string;
          if (visited.has(next)) continue;
          visited.add(next);
          await assertPublicUrl(next);
          const { body, contentType } = await this.http.getBuffer(next, {
            maxBytes: 4 * 1024 * 1024,
          });
          if (contentType && !/html|xml|text/i.test(contentType)) {
            if (pagesRead === 0)
              throw new UnprocessableEntityException(
                'O endereço não é uma página nem um arquivo que o sistema leia (PDF, CSV, PAN ou OND).',
              );
            continue;
          }
          pagesRead += 1;
          const page = analyzeSourcePage(body.toString('utf8'), next);
          for (const doc of page.documents) if (!found.has(doc.url)) found.set(doc.url, doc);
          for (const p of page.nextPages)
            if (new URL(p).hostname === host && !visited.has(p)) queue.push(p);
          if (queue.length) await sleep(PAGE_DELAY_MS);
        }
      }
      if (found.size === 0)
        error =
          'Não achei arquivos PDF, CSV, PAN ou OND nesta página (pode precisar de login ou ser montada por script).';
    } catch (e) {
      error = e instanceof Error ? e.message : 'Não foi possível ler o endereço';
    }

    await this.prisma.db.$transaction(async (tx) => {
      for (const doc of found.values()) {
        const data = {
          fileType: doc.fileType,
          title: doc.title.slice(0, 300),
          brand: doc.brand.slice(0, 80),
          docType: doc.docType,
          equipmentHint: doc.equipmentHint,
          productUrl: doc.productUrl,
          pageUrl: doc.pageUrl,
          confidence: doc.confidence,
          reasons: doc.reasons,
          collectedAt: new Date(),
        };
        await tx.catalogSourceDocument.upsert({
          where: { linkId_url: { linkId: id, url: doc.url } },
          create: { tenantId: this.context.requireTenantId(), linkId: id, url: doc.url, ...data },
          update: data,
        });
      }
      await tx.catalogSourceLink.update({
        where: { id },
        data: {
          status: error && found.size === 0 ? 'ERROR' : 'ACTIVE',
          lastAnalyzedAt: new Date(),
          lastError: error,
          pagesRead,
        },
      });
    });
    return this.toDto(await this.require(id));
  }

  async remove(id: string): Promise<{ id: string }> {
    await this.require(id);
    await this.prisma.db.catalogSourceLink.delete({ where: { id } });
    await this.audit.record({
      action: 'catalog.source_link_removed',
      entity: 'CatalogSourceLink',
      entityId: id,
    });
    return { id };
  }

  async documents(
    linkId: string,
    query: ListLinkDocumentsQuery,
  ): Promise<Paginated<CatalogLinkDocumentDto>> {
    await this.require(linkId);
    const where = {
      linkId,
      ...(query.equipment ? { equipmentHint: query.equipment } : {}),
      ...(query.fileType ? { fileType: query.fileType } : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' as const } },
              { brand: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.db.catalogSourceDocument.findMany({
        where,
        orderBy: [{ brand: 'asc' }, { title: 'asc' }],
        ...toSkipTake(query),
      }),
      this.prisma.db.catalogSourceDocument.count({ where }),
    ]);
    return toPaginated(
      rows.map((r) => this.docDto(r)),
      total,
      query,
    );
  }

  docDto(r: {
    id: string;
    linkId: string;
    url: string;
    fileType: string;
    title: string;
    brand: string;
    docType: string;
    equipmentHint: string;
    productUrl: string | null;
    confidence: string;
    reasons: unknown;
    collectedAt: Date;
  }): CatalogLinkDocumentDto {
    return {
      id: r.id,
      linkId: r.linkId,
      url: r.url,
      fileType: r.fileType as CatalogLinkDocumentDto['fileType'],
      title: r.title,
      brand: r.brand,
      docType: r.docType,
      equipmentHint: r.equipmentHint as CatalogLinkDocumentDto['equipmentHint'],
      productUrl: r.productUrl,
      confidence: r.confidence as CatalogLinkDocumentDto['confidence'],
      reasons: r.reasons as string[],
      collectedAt: r.collectedAt.toISOString(),
    };
  }

  /** Baixa o arquivo escolhido, lê pelo caminho do tipo (PDF, CSV, PAN ou OND) e devolve a prévia. Nada é gravado. */
  async preview(documentId: string, kind?: EquipmentKind): Promise<ImportPreviewDto> {
    const doc = await this.prisma.db.catalogSourceDocument.findFirst({
      where: { id: documentId },
      include: { link: true },
    });
    if (!doc) throw new NotFoundException('Documento não encontrado');
    const url = await assertPublicUrl(doc.url);
    const { body } = await this.http.getBuffer(url.toString(), { maxBytes: MAX_FILE_BYTES });
    const fileType = doc.fileType as keyof typeof FORMAT_BY_FILE;
    const hint = doc.equipmentHint === 'OTHER' ? undefined : (doc.equipmentHint as EquipmentKind);
    const resolvedKind = kind ?? hint;
    if (fileType === 'csv' && !resolvedKind)
      throw new BadRequestException('Informe o tipo de equipamento da planilha (kind)');
    const result = await this.imports.preview(
      {
        originalname: `${doc.title}.${fileType}`,
        mimetype: fileType === 'pdf' ? 'application/pdf' : 'text/plain',
        buffer: body,
        size: body.length,
      },
      FORMAT_BY_FILE[fileType],
      fileType === 'pdf' || fileType === 'csv' ? resolvedKind : undefined,
      doc.title,
    );
    return {
      ...result,
      candidates: result.candidates.map((c) => ({
        ...c,
        manufacturer: c.manufacturer || doc.brand,
      })),
      notes: [`Fonte: ${doc.link.label} — ${doc.url}`, ...result.notes],
    };
  }
}
