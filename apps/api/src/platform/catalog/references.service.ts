import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { Prisma } from '@voltex/database';
import { ZodValidationException } from 'nestjs-zod';
import { createHash } from 'node:crypto';
import {
  SPEC_SCHEMAS,
  createEquipmentSchema,
  type EquipmentDto,
  type ExternalReferenceDto,
  type ImportCandidateDto,
  type ImportPreviewDto,
  type ListReferencesQuery,
  type Paginated,
} from '@voltex/shared';
import {
  ImportParseError,
  missingFields,
  validateSpec,
  parseCecInverters,
  parseCecModules,
  type ParsedEquipment,
} from '@voltex/solar-engine';
import { toPaginated, toSkipTake } from '../../common/pagination';
import { DataHubHttp } from '../data-hub/data-hub-http';
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
    private readonly http: DataHubHttp,
  ) {}

  async list(query: ListReferencesQuery): Promise<Paginated<ExternalReferenceDto>> {
    const where = {
      kind: query.kind ? `CEC_${query.kind}` : { startsWith: 'CEC_' },
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

  /** Baixa as duas planilhas da biblioteca CEC/SAM (módulos e inversores) do repositório público do NREL e carrega. */
  async syncCec(): Promise<{
    modules: { read: number; created: number; updated: number };
    inverters: { read: number; created: number; updated: number };
  }> {
    this.sources.requireEnabled(SOURCE);
    const base = 'https://raw.githubusercontent.com/NREL/SAM/develop/deploy/libraries';
    const get = async (file: string): Promise<string> =>
      (
        await this.http.getBuffer(`${base}/${encodeURIComponent(file)}`, {
          maxBytes: 30 * 1024 * 1024,
        })
      ).body.toString('utf8');
    const modules = await this.importCec('MODULE', await get('CEC Modules.csv'));
    const inverters = await this.importCec('INVERTER', await get('CEC Inverters.csv'));
    return { modules, inverters };
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
    // Uma consulta para todos os registros já guardados e inserção em lotes: a biblioteca tem milhares de linhas.
    const existing = new Map(
      (
        await this.prisma.system.externalRecord.findMany({
          where: { sourceId: source.id, kind: recordKind },
          select: { id: true, manufacturer: true, model: true, contentHash: true },
        })
      ).map((r) => [`${r.manufacturer}\u0000${r.model}`, r]),
    );
    const fresh: Prisma.ExternalRecordCreateManyInput[] = [];
    for (const item of items) {
      const hash = createHash('sha256').update(JSON.stringify(item.spec)).digest('hex');
      const key = `${item.manufacturer}\u0000${item.model}`;
      const found = existing.get(key);
      if (!found) {
        existing.set(key, {
          id: '',
          manufacturer: item.manufacturer,
          model: item.model,
          contentHash: hash,
        });
        fresh.push({
          sourceId: source.id,
          kind: recordKind,
          manufacturer: item.manufacturer,
          model: item.model,
          spec: item.spec as object,
          fieldConfidence: item.fieldConfidence,
          contentHash: hash,
        });
      } else if (found.id && found.contentHash !== hash) {
        await this.prisma.system.externalRecord.update({
          where: { id: found.id },
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
    for (let at = 0; at < fresh.length; at += 1000) {
      const result = await this.prisma.system.externalRecord.createMany({
        data: fresh.slice(at, at + 1000),
        skipDuplicates: true,
      });
      created += result.count;
    }
    return { read: items.length, created, updated };
  }

  /** Monta a prévia de um registro de referência (campos que faltam e conferência física), para completar e importar. */
  async preview(id: string): Promise<ImportPreviewDto> {
    const record = await this.prisma.system.externalRecord.findUnique({ where: { id } });
    if (!record || !record.kind.startsWith('CEC_'))
      throw new NotFoundException('Registro de referência não encontrado');
    const kind = record.kind === 'CEC_INVERTER' ? 'INVERTER' : 'MODULE';
    const spec = record.spec as Record<string, unknown>;
    const parsed = SPEC_SCHEMAS[kind].safeParse(spec);
    const exists =
      (await this.prisma.db.equipmentItem.count({
        where: { kind, manufacturer: record.manufacturer, model: record.model },
      })) > 0;
    return {
      format: 'cec',
      candidates: [
        {
          kind,
          manufacturer: record.manufacturer,
          model: record.model,
          spec,
          origin: 'CEC',
          fieldConfidence: record.fieldConfidence as ImportCandidateDto['fieldConfidence'],
          issues: parsed.success ? validateSpec(kind, parsed.data) : [],
          exists,
          missing: missingFields(kind, spec),
        },
      ],
      errors: [],
      notes: [
        'Biblioteca CEC/SAM (NREL): equipamento do mercado norte-americano. Confira se é vendido e homologado no Brasil.',
      ],
    };
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
