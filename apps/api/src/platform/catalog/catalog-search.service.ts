import { Injectable } from '@nestjs/common';
import type { CatalogSearchQuery, CatalogSearchResultDto } from '@voltex/shared';
import { PrismaService } from '../prisma/prisma.service';
import { dataSourceDefinition } from '../data-hub/data-hub.registry';

const KIND_LABEL: Record<string, string> = {
  MODULE: 'Módulo',
  INVERTER: 'Inversor',
  PROTECTION: 'Proteção',
  CABLE: 'Cabo',
  OTHER: 'Outro',
};

/**
 * Busca unificada ao digitar: o que já está no catálogo da empresa, as bibliotecas de referência (CEC) e os documentos
 * das fontes (públicas e as cadastradas por link). Cada resultado diz de onde vem e o que é. Escolher um item de fonte
 * abre a prévia para importar; o que já está no catálogo é usado direto.
 */
@Injectable()
export class CatalogSearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(query: CatalogSearchQuery): Promise<CatalogSearchResultDto[]> {
    const contains = { contains: query.q, mode: 'insensitive' as const };
    const limit = query.limit;
    const [items, linkDocs, publicDocs, refs] = await Promise.all([
      this.prisma.db.equipmentItem.findMany({
        where: {
          status: { not: 'RETIRED' },
          ...(query.kind ? { kind: query.kind } : {}),
          OR: [{ manufacturer: contains }, { model: contains }],
        },
        orderBy: [{ status: 'asc' }, { manufacturer: 'asc' }, { model: 'asc' }],
        take: limit,
      }),
      this.prisma.db.catalogSourceDocument.findMany({
        where: {
          ...(query.kind ? { equipmentHint: query.kind } : {}),
          OR: [{ title: contains }, { brand: contains }],
        },
        include: { link: { select: { label: true } } },
        orderBy: [{ confidence: 'asc' }, { title: 'asc' }],
        take: limit,
      }),
      !query.kind || query.kind === 'INVERTER' || query.kind === 'MODULE'
        ? this.prisma.system.externalRecord.findMany({
            where: {
              kind: { startsWith: 'DOC_' },
              OR: [{ model: contains }, { manufacturer: contains }],
              ...(query.kind ? { spec: { path: ['equipmentHint'], equals: query.kind } } : {}),
            },
            include: { source: { select: { key: true, label: true } } },
            orderBy: [{ manufacturer: 'asc' }, { model: 'asc' }],
            take: limit,
          })
        : Promise.resolve([]),
      !query.kind || query.kind === 'INVERTER' || query.kind === 'MODULE'
        ? this.prisma.system.externalRecord.findMany({
            where: {
              kind: query.kind ? `CEC_${query.kind}` : { startsWith: 'CEC_' },
              OR: [{ model: contains }, { manufacturer: contains }],
            },
            orderBy: [{ manufacturer: 'asc' }, { model: 'asc' }],
            take: limit,
          })
        : Promise.resolve([]),
    ]);

    const results: CatalogSearchResultDto[] = [
      ...items.map((i) => ({
        origin: 'CATALOG' as const,
        id: i.id,
        kind: i.kind as CatalogSearchResultDto['kind'],
        manufacturer: i.manufacturer,
        model: i.model,
        sourceLabel: 'Seu catálogo',
        detail: `${KIND_LABEL[i.kind]} · ${i.status === 'APPROVED' ? 'aprovado' : 'rascunho'}`,
        status: i.status,
      })),
      ...linkDocs.map((d) => ({
        origin: 'LINK' as const,
        id: d.id,
        kind: d.equipmentHint as CatalogSearchResultDto['kind'],
        manufacturer: d.brand,
        model: d.title,
        sourceLabel: d.link.label,
        detail: `${KIND_LABEL[d.equipmentHint]} · .${d.fileType.toUpperCase()}`,
        fileType: d.fileType as CatalogSearchResultDto['fileType'],
      })),
      ...publicDocs.map((r) => {
        const spec = r.spec as Record<string, string>;
        return {
          origin: 'SOURCE' as const,
          id: r.id,
          kind: (spec.equipmentHint ?? 'OTHER') as CatalogSearchResultDto['kind'],
          manufacturer: r.manufacturer === '—' ? '' : r.manufacturer,
          model: r.model,
          sourceLabel: r.source.label,
          detail: `${KIND_LABEL[spec.equipmentHint ?? 'OTHER']} · ${spec.docType ?? 'documento'} (PDF)`,
          fileType: 'pdf' as const,
        };
      }),
      ...refs.map((r) => ({
        origin: 'REFERENCE' as const,
        id: r.id,
        kind: (r.kind === 'CEC_INVERTER' ? 'INVERTER' : 'MODULE') as CatalogSearchResultDto['kind'],
        manufacturer: r.manufacturer,
        model: r.model,
        sourceLabel: dataSourceDefinition('cec-library')?.label ?? 'Biblioteca CEC/SAM',
        detail: `${r.kind === 'CEC_INVERTER' ? 'Inversor' : 'Módulo'} · referência`,
      })),
    ];
    return results.slice(0, limit * 2);
  }
}
