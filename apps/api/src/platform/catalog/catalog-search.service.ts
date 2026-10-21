import { Injectable } from '@nestjs/common';
import type { Prisma } from '@voltex/database';
import type { CatalogSearchQuery, CatalogSearchResultDto } from '@voltex/shared';
import { PrismaService } from '../prisma/prisma.service';
import { dataSourceDefinition } from '../data-hub/data-hub.registry';

const KIND_LABEL: Record<string, string> = {
  MODULE: 'Módulo',
  INVERTER: 'Inversor',
  PROTECTION: 'Proteção',
  CABLE: 'Cabo',
  BATTERY: 'Bateria',
  CHARGE_CONTROLLER: 'Controlador de carga',
  OFFGRID_INVERTER: 'Inversor off-grid',
  GENERATOR: 'Gerador',
  OTHER: 'Outro',
};

/** Palavras que identificam o tipo no título quando a fonte não classificou o documento. */
const KIND_WORDS: Record<string, string[]> = {
  BATTERY: ['bateria', 'battery', 'lifepo4', 'estacionaria', 'estacionária', 'litio', 'lítio'],
  CHARGE_CONTROLLER: ['controlador', 'controller', 'mppt', 'pwm', 'regulador de carga'],
  GENERATOR: ['gerador', 'generator'],
  OFFGRID_INVERTER: [
    'hibrido',
    'híbrido',
    'hybrid',
    'off-grid',
    'off grid',
    'offgrid',
    'isolado',
    'inversor carregador',
    'inversor/carregador',
  ],
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
    const text = query.q.trim();
    const contains = { contains: text, mode: 'insensitive' as const };
    const limit = query.limit;
    const kind = query.kind;
    const words = kind ? (KIND_WORDS[kind] ?? []) : [];
    /** Inversor off-grid também aparece entre os inversores comuns (muitos são híbridos): só ao digitar. */
    const alsoInverter = kind === 'OFFGRID_INVERTER' && text.length > 0;
    const typeFilter = (field: 'model' | 'title') =>
      kind && words.length > 0
        ? words.map((w) => ({ [field]: { contains: w, mode: 'insensitive' as const } }))
        : [];

    const publicWhere: Prisma.ExternalRecordWhereInput = {
      kind: { startsWith: 'DOC_' },
      ...(text ? { OR: [{ model: contains }, { manufacturer: contains }] } : {}),
      ...(kind
        ? {
            AND: [
              {
                OR: [
                  { spec: { path: ['equipmentHint'], equals: kind } },
                  ...(alsoInverter
                    ? [{ spec: { path: ['equipmentHint'], equals: 'INVERTER' } }]
                    : []),
                  ...typeFilter('model'),
                ],
              },
            ],
          }
        : {}),
    };
    const linkWhere: Prisma.CatalogSourceDocumentWhereInput = {
      ...(text ? { OR: [{ title: contains }, { brand: contains }] } : {}),
      ...(kind
        ? {
            AND: [
              {
                OR: [
                  { equipmentHint: kind },
                  ...(alsoInverter ? [{ equipmentHint: 'INVERTER' }] : []),
                  ...typeFilter('title'),
                ],
              },
            ],
          }
        : {}),
    };
    const refKind = kind === 'MODULE' || kind === 'INVERTER' ? kind : undefined;
    const [items, linkDocs, publicDocs, refs] = await Promise.all([
      this.prisma.db.equipmentItem.findMany({
        where: {
          status: { not: 'RETIRED' },
          ...(kind ? { kind } : {}),
          ...(text ? { OR: [{ manufacturer: contains }, { model: contains }] } : {}),
        },
        orderBy: [{ status: 'asc' }, { manufacturer: 'asc' }, { model: 'asc' }],
        take: limit,
      }),
      this.prisma.db.catalogSourceDocument.findMany({
        where: linkWhere,
        include: { link: { select: { label: true } } },
        orderBy: [{ confidence: 'asc' }, { title: 'asc' }],
        take: limit,
      }),
      this.prisma.system.externalRecord.findMany({
        where: publicWhere,
        include: { source: { select: { key: true, label: true } } },
        orderBy: [{ manufacturer: 'asc' }, { model: 'asc' }],
        take: limit,
      }),
      !kind || refKind
        ? this.prisma.system.externalRecord.findMany({
            where: {
              kind: refKind ? `CEC_${refKind}` : { startsWith: 'CEC_' },
              ...(text ? { OR: [{ model: contains }, { manufacturer: contains }] } : {}),
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
          kind: (kind && spec.equipmentHint !== kind && spec.equipmentHint !== 'INVERTER'
            ? kind
            : (spec.equipmentHint ?? 'OTHER')) as CatalogSearchResultDto['kind'],
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
