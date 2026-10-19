import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { parse } from 'csv-parse';
import { Readable } from 'node:stream';
import type { AneelImportResult } from '@voltex/shared';
import { RequestContext } from '../../common/context/request-context';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Dados Abertos da ANEEL — "Tarifas das distribuidoras de energia elétrica" (licença ODbL, atualizado semanalmente).
 * Página do conjunto: https://dadosabertos.aneel.gov.br/dataset/tarifas-distribuidoras-energia-eletrica
 */
export const ANEEL_DATASET = 'tarifas-distribuidoras-energia-eletrica';
export const ANEEL_LICENSE = 'ODbL (Open Data Commons Open Database License)';
export const ANEEL_CSV_URL =
  'https://dadosabertos.aneel.gov.br/dataset/5a583f3e-1646-4f67-bf0f-69db4203e89e/resource/fcf2906c-7c32-4b9b-a637-054e7a5234f4/download/tarifas-homologadas-distribuidoras-energia-eletrica.csv';

/** De onde vem o CSV. Em testes é substituído por um arquivo pequeno; em produção baixa da ANEEL. */
export abstract class AneelSource {
  abstract open(): Promise<Readable>;
}

@Injectable()
export class HttpAneelSource extends AneelSource {
  async open(): Promise<Readable> {
    let response: Response;
    try {
      response = await fetch(ANEEL_CSV_URL, { signal: AbortSignal.timeout(10 * 60_000) });
    } catch (error) {
      throw new ServiceUnavailableException(
        `Não foi possível acessar o portal de Dados Abertos da ANEEL (${error instanceof Error ? error.message : 'erro de rede'}). Tente novamente mais tarde.`,
      );
    }
    if (!response.ok || !response.body)
      throw new ServiceUnavailableException(
        `O portal de Dados Abertos da ANEEL respondeu ${response.status}. Tente novamente mais tarde.`,
      );
    return Readable.fromWeb(response.body as never);
  }
}

/** Uma tarifa já normalizada: grupo B1 residencial, modalidade convencional, em centavos por kWh. */
export interface AneelTariff {
  agent: string;
  cnpj: string;
  resolution: string;
  validFrom: Date;
  validTo: Date | null;
  /** TUSD + TE, sem impostos, em centavos por kWh. */
  energyCentsPerKwh: number;
  tusdPerMwh: number;
  tePerMwh: number;
}

export interface ParsedAneel {
  /** Todas as distribuidoras que aparecem no arquivo (sigla → CNPJ). */
  agents: Map<string, string>;
  tariffs: AneelTariff[];
  rowsRead: number;
  rowsSkipped: number;
}

const brNumber = (raw: string | undefined): number =>
  Number((raw ?? '').trim().replace(/\./g, '').replace(',', '.'));
const toDate = (raw: string | undefined): Date | null => {
  const value = (raw ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00.000Z`) : null;
};

/**
 * Lê o CSV da ANEEL em fluxo (o arquivo completo passa de 150 MB) e guarda só o que o Solar Calculator usa:
 * Grupo B, subgrupo B1, classe residencial, modalidade Convencional, "Tarifa de Aplicação" (a vigente, não a base
 * econômica), vigente em `today` ou no futuro. Valores vêm em R$/MWh e SEM impostos (ICMS, PIS/COFINS).
 */
export async function parseAneelCsv(
  source: Readable,
  today: Date = new Date(),
): Promise<ParsedAneel> {
  const result: ParsedAneel = { agents: new Map(), tariffs: [], rowsRead: 0, rowsSkipped: 0 };
  const seen = new Set<string>();
  const todayIso = today.toISOString().slice(0, 10);

  const parser = source.pipe(
    parse({ delimiter: ';', columns: true, bom: true, relax_quotes: true, skip_empty_lines: true }),
  );

  for await (const row of parser as AsyncIterable<Record<string, string>>) {
    result.rowsRead += 1;
    const agent = (row.SigAgente ?? '').trim();
    const cnpj = (row.NumCNPJDistribuidora ?? '').replace(/\D/g, '');
    if (agent && !result.agents.has(agent)) result.agents.set(agent, cnpj);

    const inScope =
      row.DscSubGrupo === 'B1' &&
      row.DscClasse === 'Residencial' &&
      row.DscSubClasse === 'Residencial' &&
      row.DscModalidadeTarifaria === 'Convencional' &&
      row.DscBaseTarifaria === 'Tarifa de Aplicação' &&
      row.DscDetalhe === 'Não se aplica' &&
      (row.DscUnidadeTerciaria ?? '').trim() === 'MWh';
    const validFrom = toDate(row.DatInicioVigencia);
    const validTo = toDate(row.DatFimVigencia);
    const current = !!validFrom && (!validTo || validTo.toISOString().slice(0, 10) >= todayIso);
    if (!inScope || !current || !agent) {
      if (row.DscSubGrupo === 'B1') result.rowsSkipped += 1;
      continue;
    }

    const tusd = brNumber(row.VlrTUSD);
    const te = brNumber(row.VlrTE);
    if (!Number.isFinite(tusd) || !Number.isFinite(te) || tusd + te <= 0) {
      result.rowsSkipped += 1;
      continue;
    }
    // O arquivo repete linhas idênticas: uma tarifa por distribuidora e início de vigência.
    const key = `${agent}|${row.DatInicioVigencia}|${row.DatFimVigencia}|${tusd}|${te}`;
    if (seen.has(key)) continue;
    seen.add(key);

    result.tariffs.push({
      agent,
      cnpj,
      resolution: (row.DscREH ?? '').trim(),
      validFrom: validFrom as Date,
      validTo,
      // R$/MWh → centavos/kWh: ÷1000 (MWh→kWh) × 100 (R$→centavos) = ÷10.
      energyCentsPerKwh: Math.round(((tusd + te) / 10) * 1000) / 1000,
      tusdPerMwh: tusd,
      tePerMwh: te,
    });
  }
  return result;
}

export const ANEEL_TARIFF_MODALITY = 'Convencional (ANEEL, sem impostos)';

@Injectable()
export class AneelImportService {
  private readonly logger = new Logger(AneelImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
    private readonly source: AneelSource,
  ) {}

  /**
   * Cadastra as concessionárias e a tarifa residencial vigente de cada uma, vindas da ANEEL.
   * Idempotente: rodar de novo só atualiza o que mudou. O valor NÃO inclui impostos: quem calcula deve preferir a
   * tarifa da fatura do cliente (que tem impostos) quando a tiver.
   */
  async importAll(): Promise<AneelImportResult> {
    const startedAt = Date.now();
    const parsed = await parseAneelCsv(await this.source.open());
    const tenantId = this.context.requireTenantId();
    const result: AneelImportResult = {
      rowsRead: parsed.rowsRead,
      distributorsCreated: 0,
      distributorsUpdated: 0,
      tariffsCreated: 0,
      tariffsUpdated: 0,
      tariffsUnchanged: 0,
      rowsSkipped: parsed.rowsSkipped,
      source: { dataset: ANEEL_DATASET, license: ANEEL_LICENSE, url: ANEEL_CSV_URL },
    };

    await this.prisma.db.$transaction(
      async (tx) => {
        const ids = new Map<string, string>();
        for (const [agent, cnpj] of parsed.agents) {
          const existing = await tx.distributor.findFirst({ where: { name: agent } });
          if (!existing) {
            const created = await tx.distributor.create({
              data: { tenantId, name: agent, cnpj: cnpj || null },
            });
            ids.set(agent, created.id);
            result.distributorsCreated += 1;
          } else {
            ids.set(agent, existing.id);
            if (existing.deletedAt || (cnpj && existing.cnpj !== cnpj)) {
              await tx.distributor.update({
                where: { id: existing.id },
                data: { deletedAt: null, ...(cnpj ? { cnpj } : {}) },
              });
              result.distributorsUpdated += 1;
            }
          }
        }

        for (const tariff of parsed.tariffs) {
          const distributorId = ids.get(tariff.agent) as string;
          const source = `ANEEL Dados Abertos — ${tariff.resolution} (TUSD R$ ${tariff.tusdPerMwh.toFixed(2)}/MWh + TE R$ ${tariff.tePerMwh.toFixed(2)}/MWh, sem impostos)`;
          const existing = await tx.tariff.findFirst({
            where: {
              distributorId,
              customerGroup: 'B',
              modality: ANEEL_TARIFF_MODALITY,
              validFrom: tariff.validFrom,
              deletedAt: null,
            },
          });
          if (!existing) {
            await tx.tariff.create({
              data: {
                tenantId,
                distributorId,
                customerGroup: 'B',
                modality: ANEEL_TARIFF_MODALITY,
                energyCentsPerKwh: tariff.energyCentsPerKwh,
                validFrom: tariff.validFrom,
                validTo: tariff.validTo,
                source,
              },
            });
            result.tariffsCreated += 1;
          } else if (
            existing.energyCentsPerKwh !== tariff.energyCentsPerKwh ||
            existing.validTo?.getTime() !== tariff.validTo?.getTime()
          ) {
            await tx.tariff.update({
              where: { id: existing.id },
              data: {
                energyCentsPerKwh: tariff.energyCentsPerKwh,
                validTo: tariff.validTo,
                source,
              },
            });
            result.tariffsUpdated += 1;
          } else {
            result.tariffsUnchanged += 1;
          }
        }

        await this.audit.record(
          {
            action: 'aneel.imported',
            entity: 'Tariff',
            after: { ...result, source: ANEEL_DATASET },
          },
          tx,
        );
      },
      { timeout: 120_000 },
    );
    this.logger.log(
      `Importação ANEEL: ${result.rowsRead} linhas lidas em ${Math.round((Date.now() - startedAt) / 1000)} s`,
    );
    return result;
  }
}
