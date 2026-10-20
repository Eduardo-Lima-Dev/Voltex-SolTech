import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ZodValidationException } from 'nestjs-zod';
import { createHash } from 'node:crypto';
import {
  SPEC_SCHEMAS,
  createEquipmentSchema,
  type EquipmentDto,
  type ExternalReferenceDto,
  type ListReferencesQuery,
  type Paginated,
} from '@voltex/shared';
import {
  ImportParseError,
  parseCecInverters,
  parseCecModules,
  type ParsedEquipment,
} from '@voltex/solar-engine';
import { toPaginated, toSkipTake } from '../../common/pagination';
import { DataSourcesService } from '../data-hub/data-sources.service';
import { dataSourceDefinition } from '../data-hub/data-hub.registry';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogService } from './catalog.service';

const SOURCE = 'cec-library';

/**
 * Equipamentos de referência de bibliotecas públicas (tabela global). A empresa **adota** um registro: ele vira
 * rascunho no catálogo dela, com a origem registrada, e só vale depois de aprovado. A carga da biblioteca exige a
 * fonte ligada no servidor (licença dos arquivos ainda não conferida).
 */
@Injectable()
export class ReferencesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sources: DataSourcesService,
    private readonly catalog: CatalogService,
  ) {}

  async list(query: ListReferencesQuery): Promise<Paginated<ExternalReferenceDto>> {
    const where = {
      ...(query.kind ? { kind: `CEC_${query.kind}` } : {}),
      ...(query.search
        ? {
            OR: [
              { manufacturer: { contains: query.search, mode: 'insensitive' as const } },
              { model: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.system.externalRecord.findMany({
        where,
        orderBy: [{ manufacturer: 'asc' }, { model: 'asc' }],
        ...toSkipTake(query),
      }),
      this.prisma.system.externalRecord.count({ where }),
    ]);
    const attribution = dataSourceDefinition(SOURCE)?.attribution ?? '';
    return toPaginated(
      rows.map((r) => ({
        id: r.id,
        kind: r.kind === 'CEC_INVERTER' ? ('INVERTER' as const) : ('MODULE' as const),
        manufacturer: r.manufacturer,
        model: r.model,
        source: SOURCE,
        collectedAt: r.collectedAt.toISOString(),
        attribution,
        spec: r.spec as Record<string, unknown>,
      })),
      total,
      query,
    );
  }

  /** Carrega uma planilha CEC na tabela global (cria ou atualiza por fabricante e modelo). */
  async importCec(
    kind: 'MODULE' | 'INVERTER',
    text: string,
  ): Promise<{ read: number; created: number; updated: number }> {
    this.sources.requireEnabled(SOURCE);
    let items: ParsedEquipment[];
    try {
      items = kind === 'MODULE' ? parseCecModules(text) : parseCecInverters(text);
    } catch (error) {
      if (error instanceof ImportParseError) throw new UnprocessableEntityException(error.message);
      throw error;
    }
    const source = await this.sources.get(SOURCE);
    const recordKind = `CEC_${kind}`;
    let created = 0;
    let updated = 0;
    for (const item of items) {
      const hash = createHash('sha256').update(JSON.stringify(item.spec)).digest('hex');
      const existing = await this.prisma.system.externalRecord.findUnique({
        where: {
          sourceId_kind_manufacturer_model: {
            sourceId: source.id,
            kind: recordKind,
            manufacturer: item.manufacturer,
            model: item.model,
          },
        },
      });
      if (!existing) {
        await this.prisma.system.externalRecord.create({
          data: {
            sourceId: source.id,
            kind: recordKind,
            manufacturer: item.manufacturer,
            model: item.model,
            spec: item.spec as object,
            fieldConfidence: item.fieldConfidence,
            contentHash: hash,
          },
        });
        created += 1;
      } else if (existing.contentHash !== hash) {
        await this.prisma.system.externalRecord.update({
          where: { id: existing.id },
          data: {
            spec: item.spec as object,
            fieldConfidence: item.fieldConfidence,
            contentHash: hash,
            collectedAt: new Date(),
          },
        });
        updated += 1;
      }
    }
    return { read: items.length, created, updated };
  }

  /** Adota um registro: cria um rascunho na empresa. `spec` completa os campos que a biblioteca não traz. */
  async adopt(id: string, extra: Record<string, unknown> = {}): Promise<EquipmentDto> {
    const record = await this.prisma.system.externalRecord.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('Registro de referência não encontrado');
    const kind = record.kind === 'CEC_INVERTER' ? 'INVERTER' : 'MODULE';
    const spec = { ...(record.spec as Record<string, unknown>), ...extra };
    const check = SPEC_SCHEMAS[kind].safeParse(spec);
    if (!check.success) throw new ZodValidationException(check.error);
    const data = createEquipmentSchema.parse({
      kind,
      manufacturer: record.manufacturer,
      model: record.model,
      spec: check.data,
      origin: 'CEC',
      fieldConfidence: record.fieldConfidence,
      externalRecordId: record.id,
    });
    return this.catalog.create(data);
  }
}
