import { BadRequestException, Injectable } from '@nestjs/common';
import type { PriceImportResultDto, PriceItemDto } from '@voltex/shared';
import { parseDelimited, toNumber } from '@voltex/solar-engine';
import { RequestContext } from '../../common/context/request-context';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

const stripAccents = (text: string): string =>
  text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Datas dd/mm/aaaa ou aaaa-mm-dd, em UTC. */
export function parseDate(raw: string): Date | undefined {
  const text = raw.trim();
  const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const [y, m, d] = br ? [br[3], br[2], br[1]] : iso ? [iso[1], iso[2], iso[3]] : [];
  if (!y || !m || !d) return undefined;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return date.getUTCMonth() === Number(m) - 1 && date.getUTCDate() === Number(d) ? date : undefined;
}

export const PRICE_TEMPLATE =
  'fabricante;modelo;descricao;fornecedor;sku;preco_reais;vigencia_inicio;vigencia_fim\n';

/**
 * Tabelas de preço de distribuidores, com vigência. Cada linha aponta para um equipamento **aprovado** (fabricante e
 * modelo) ou é um insumo avulso (só descrição). Linha sem correspondência não entra: aparece na lista de "sem par".
 */
@Injectable()
export class PriceListService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
  ) {}

  async list(equipmentId?: string): Promise<PriceItemDto[]> {
    const rows = await this.prisma.db.priceListItem.findMany({
      where: equipmentId ? { equipmentId } : {},
      orderBy: [{ validFrom: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    });
    return rows.map((r) => ({
      id: r.id,
      equipmentId: r.equipmentId,
      description: r.description,
      supplier: r.supplier,
      sku: r.sku,
      priceCents: r.priceCents,
      validFrom: r.validFrom.toISOString(),
      validTo: r.validTo?.toISOString() ?? null,
      source: r.source,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /** Preço vigente de um equipamento em `at`: o mais recente cuja vigência cobre a data. */
  async currentPrice(equipmentId: string, at: Date = new Date()): Promise<PriceItemDto | null> {
    const row = await this.prisma.db.priceListItem.findFirst({
      where: {
        equipmentId,
        validFrom: { lte: at },
        OR: [{ validTo: null }, { validTo: { gte: at } }],
      },
      orderBy: { validFrom: 'desc' },
    });
    return row
      ? {
          id: row.id,
          equipmentId: row.equipmentId,
          description: row.description,
          supplier: row.supplier,
          sku: row.sku,
          priceCents: row.priceCents,
          validFrom: row.validFrom.toISOString(),
          validTo: row.validTo?.toISOString() ?? null,
          source: row.source,
          createdAt: row.createdAt.toISOString(),
        }
      : null;
  }

  async import(buffer: Buffer, filename: string, dryRun: boolean): Promise<PriceImportResultDto> {
    const rows = parseDelimited(buffer.toString('utf8'));
    const headerRow = rows[0];
    if (!headerRow) throw new BadRequestException('A planilha está vazia');
    const headers = headerRow.map(stripAccents);
    const col = (cells: string[], name: string) => (cells[headers.indexOf(name)] ?? '').trim();
    for (const required of ['fornecedor', 'preco_reais', 'vigencia_inicio'])
      if (!headers.includes(required))
        throw new BadRequestException(`A planilha precisa da coluna "${required}"`);

    const approved = await this.prisma.db.equipmentItem.findMany({
      where: { status: 'APPROVED' },
      select: { id: true, manufacturer: true, model: true },
    });
    const byIdentity = new Map(
      approved.map((e) => [`${stripAccents(e.manufacturer)}|${stripAccents(e.model)}`, e.id]),
    );

    const result: PriceImportResultDto = {
      rowsRead: 0,
      created: 0,
      unmatched: [],
      errors: [],
      dryRun,
    };
    const toCreate: {
      equipmentId: string | null;
      description: string;
      supplier: string;
      sku: string | null;
      priceCents: number;
      validFrom: Date;
      validTo: Date | null;
    }[] = [];

    rows.slice(1).forEach((cells, offset) => {
      const row = offset + 2;
      result.rowsRead += 1;
      const manufacturer = col(cells, 'fabricante');
      const model = col(cells, 'modelo');
      const description = col(cells, 'descricao');
      const supplier = col(cells, 'fornecedor');
      const price = toNumber(col(cells, 'preco_reais'));
      const from = parseDate(col(cells, 'vigencia_inicio'));
      const toRaw = col(cells, 'vigencia_fim');
      const to = toRaw ? parseDate(toRaw) : null;
      if (!supplier) return void result.errors.push({ row, message: 'Fornecedor é obrigatório.' });
      if (price === undefined || price < 0)
        return void result.errors.push({
          row,
          message: 'Preço inválido (use reais, ex.: 1234,50).',
        });
      if (!from)
        return void result.errors.push({
          row,
          message: 'Início da vigência inválido (use dd/mm/aaaa).',
        });
      if (to === undefined)
        return void result.errors.push({
          row,
          message: 'Fim da vigência inválido (use dd/mm/aaaa).',
        });
      if (to && to < from)
        return void result.errors.push({ row, message: 'A vigência termina antes de começar.' });

      let equipmentId: string | null = null;
      if (manufacturer && model) {
        equipmentId =
          byIdentity.get(`${stripAccents(manufacturer)}|${stripAccents(model)}`) ?? null;
        if (!equipmentId) return void result.unmatched.push({ row, manufacturer, model });
      } else if (!description)
        return void result.errors.push({
          row,
          message: 'Informe fabricante e modelo, ou a descrição do insumo.',
        });
      toCreate.push({
        equipmentId,
        description: description || `${manufacturer} ${model}`,
        supplier,
        sku: col(cells, 'sku') || null,
        priceCents: Math.round(price * 100),
        validFrom: from,
        validTo: to,
      });
    });

    if (!dryRun && toCreate.length > 0) {
      await this.prisma.db.$transaction(async (tx) => {
        await tx.priceListItem.createMany({
          data: toCreate.map((item) => ({
            ...item,
            tenantId: this.context.requireTenantId(),
            source: filename,
            createdById: this.context.userId ?? null,
          })),
        });
        await this.audit.record(
          {
            action: 'price_list.imported',
            entity: 'PriceListItem',
            after: { filename, created: toCreate.length, unmatched: result.unmatched.length },
          },
          tx,
        );
      });
    }
    result.created = dryRun ? 0 : toCreate.length;
    return result;
  }
}
