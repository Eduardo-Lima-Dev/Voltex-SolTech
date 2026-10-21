import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@voltex/database';
import type {
  HorizonQuery,
  HorizonResultDto,
  WeatherQuery,
  WeatherResultDto,
  WeatherSummaryDto,
} from '@voltex/shared';
import {
  type HourlySeries,
  WeatherParseError,
  parseNasaPowerClimatology,
  parseNasaPowerHourly,
  parsePvgisHorizon,
  parsePvgisSeries,
  summarizeHourly,
} from '@voltex/solar-engine';
import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { PrismaService } from '../prisma/prisma.service';
import { DataHubHttp, ExternalFetchError, ExternalRateLimitedError } from './data-hub-http';
import { dataSourceDefinition } from './data-hub.registry';
import { DataSourcesService } from './data-sources.service';

/** Coordenadas na grade do cache: 2 casas decimais (~1 km), bem mais fino que a resolução das bases. */
export const roundCoordinate = (value: number): number => Math.round(value * 100) / 100;

const CLIMATOLOGY_PERIOD = 'climatologia';

/**
 * Clima de um local vindo da NASA POWER e do PVGIS, com cache global por coordenada. Dado público, sem dado pessoal.
 * Toda coleta fica registrada (`DataCollection`) e toda resposta carrega a atribuição e a situação dos termos de uso.
 */
@Injectable()
export class ClimateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sources: DataSourcesService,
    private readonly http: DataHubHttp,
  ) {}

  async weather(query: WeatherQuery): Promise<WeatherResultDto> {
    const latitude = roundCoordinate(query.latitude);
    const longitude = roundCoordinate(query.longitude);
    const hourly = query.kind === 'hourly';
    if (!hourly && query.source === 'pvgis')
      throw new BadRequestException(
        'O PVGIS só entrega série horária neste conector. Use a NASA POWER para a climatologia mensal.',
      );
    const kind = hourly ? 'HOURLY' : 'CLIMATOLOGY';
    const period = hourly ? String(query.year) : CLIMATOLOGY_PERIOD;
    const source = await this.sources.get(query.source);
    const where = {
      sourceId_kind_latitude_longitude_period: {
        sourceId: source.id,
        kind,
        latitude,
        longitude,
        period,
      },
    };

    if (!query.refresh) {
      const cached = await this.prisma.system.weatherSeries.findUnique({ where });
      if (cached) return this.toResult(query.source, cached, true);
    }

    this.sources.requireEnabled(query.source);
    const collection = await this.sources.startCollection(query.source, {
      kind,
      latitude,
      longitude,
      period,
    });
    try {
      const { summary, payload, hash } = await this.collect(query, latitude, longitude);
      const row = await this.prisma.system.weatherSeries
        .upsert({
          where,
          create: {
            sourceId: source.id,
            kind,
            latitude,
            longitude,
            period,
            summary: summary as object,
            payload: payload ? new Uint8Array(payload) : null,
            collectionId: collection.id,
          },
          update: {
            summary: summary as object,
            payload: payload ? new Uint8Array(payload) : null,
            collectionId: collection.id,
            fetchedAt: new Date(),
          },
        })
        .catch(async (error: unknown) => {
          // Duas requisições iguais ao mesmo tempo: a outra gravou primeiro; usa a dela.
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            const existing = await this.prisma.system.weatherSeries.findUnique({ where });
            if (existing) return existing;
          }
          throw error;
        });
      await this.sources.finishCollection(collection.id, 'SUCCEEDED', { contentHash: hash });
      return this.toResult(query.source, row, false);
    } catch (error) {
      await this.sources.finishCollection(collection.id, 'FAILED', { error: errorMessage(error) });
      throw this.translate(error);
    }
  }

  /**
   * Obtém a série horária normalizada para o Engine. O método público de clima continua retornando só o resumo;
   * esta variante é interna, para que a carga compactada nunca seja enviada sem necessidade ao navegador.
   */
  async hourlySeries(query: WeatherQuery & { kind: 'hourly'; year: number }): Promise<{
    weather: WeatherResultDto;
    series: HourlySeries;
  }> {
    const weather = await this.weather(query);
    const source = await this.sources.get(query.source);
    const row = await this.prisma.system.weatherSeries.findUnique({
      where: {
        sourceId_kind_latitude_longitude_period: {
          sourceId: source.id,
          kind: 'HOURLY',
          latitude: roundCoordinate(query.latitude),
          longitude: roundCoordinate(query.longitude),
          period: String(query.year),
        },
      },
    });
    if (!row?.payload)
      throw new ServiceUnavailableException('A série horária não ficou disponível no cache.');
    try {
      return {
        weather,
        series: JSON.parse(gunzipSync(row.payload).toString('utf8')) as HourlySeries,
      };
    } catch {
      throw new ServiceUnavailableException(
        'A série horária em cache está inválida; solicite nova coleta.',
      );
    }
  }

  async horizon(query: HorizonQuery): Promise<HorizonResultDto> {
    const latitude = roundCoordinate(query.latitude);
    const longitude = roundCoordinate(query.longitude);
    const source = await this.sources.get('pvgis');
    const where = {
      sourceId_latitude_longitude: { sourceId: source.id, latitude, longitude },
    };
    const cached = await this.prisma.system.horizonProfile.findUnique({ where });
    if (cached) return this.toHorizon(cached, true, source.licenseStatus);

    this.sources.requireEnabled('pvgis');
    const collection = await this.sources.startCollection('pvgis', {
      kind: 'HORIZON',
      latitude,
      longitude,
    });
    try {
      const base = dataSourceDefinition('pvgis')?.baseUrl ?? '';
      const raw = await this.http.getJson(
        `${base}/printhorizon?lat=${latitude}&lon=${longitude}&outputformat=json`,
      );
      const profile = parsePvgisHorizon(raw);
      const row = await this.prisma.system.horizonProfile.upsert({
        where,
        create: {
          sourceId: source.id,
          latitude,
          longitude,
          elevationM: profile.elevationM,
          points: profile.points,
          collectionId: collection.id,
        },
        update: {
          elevationM: profile.elevationM,
          points: profile.points,
          collectionId: collection.id,
          fetchedAt: new Date(),
        },
      });
      await this.sources.finishCollection(collection.id, 'SUCCEEDED', {
        contentHash: createHash('sha256').update(JSON.stringify(raw)).digest('hex'),
      });
      return this.toHorizon(row, false, source.licenseStatus);
    } catch (error) {
      await this.sources.finishCollection(collection.id, 'FAILED', { error: errorMessage(error) });
      throw this.translate(error);
    }
  }

  private async collect(
    query: WeatherQuery,
    latitude: number,
    longitude: number,
  ): Promise<{ summary: WeatherSummaryDto; payload: Buffer | null; hash: string }> {
    const base = dataSourceDefinition(query.source)?.baseUrl ?? '';
    if (query.kind === 'climatology') {
      const raw = await this.http.getJson(
        `${base}/temporal/climatology/point?parameters=ALLSKY_SFC_SW_DWN,T2M,T2M_MIN,T2M_MAX&community=RE&longitude=${longitude}&latitude=${latitude}&format=JSON`,
      );
      const c = parseNasaPowerClimatology(raw);
      return {
        summary: {
          ghiKwhM2Day: c.ghiKwhM2Day,
          tempMeanC: c.tempMeanC,
          tempMinC: c.tempMinC,
          tempMaxC: c.tempMaxC,
          elevationM: c.elevationM,
        },
        payload: null,
        hash: sha256(raw),
      };
    }
    const year = query.year as number;
    const raw =
      query.source === 'nasa-power'
        ? await this.http.getJson(
            `${base}/temporal/hourly/point?parameters=ALLSKY_SFC_SW_DWN,ALLSKY_SFC_SW_DIFF,T2M&community=RE&longitude=${longitude}&latitude=${latitude}&start=${year}0101&end=${year}1231&format=JSON`,
          )
        : await this.http.getJson(
            `${base}/seriescalc?lat=${latitude}&lon=${longitude}&startyear=${year}&endyear=${year}&angle=0&aspect=0&components=1&outputformat=json`,
          );
    const series =
      query.source === 'nasa-power' ? parseNasaPowerHourly(raw) : parsePvgisSeries(raw);
    const summary = summarizeHourly(series);
    return {
      summary: {
        ghiKwhM2Day: summary.ghiKwhM2Day,
        tempMeanC: summary.tempMeanC,
        tempMinC: summary.tempMinC,
        tempMaxC: summary.tempMaxC,
        elevationM: null,
        hours: summary.hours,
        missingHours: summary.missingHours,
      },
      payload: gzipSync(Buffer.from(JSON.stringify(series))),
      hash: sha256(raw),
    };
  }

  private toResult(
    sourceKey: WeatherQuery['source'],
    row: {
      kind: string;
      latitude: number;
      longitude: number;
      period: string;
      summary: unknown;
      fetchedAt: Date;
    },
    cached: boolean,
  ): WeatherResultDto {
    const def = dataSourceDefinition(sourceKey);
    const warnings = this.warningsFor(sourceKey, row.kind);
    return {
      source: sourceKey,
      kind: row.kind as WeatherResultDto['kind'],
      latitude: row.latitude,
      longitude: row.longitude,
      period: row.period,
      summary: row.summary as WeatherSummaryDto,
      fetchedAt: row.fetchedAt.toISOString(),
      cached,
      attribution: def?.attribution ?? '',
      license: def?.license ?? '',
      licenseStatus: def?.licenseStatus ?? 'PENDING_REVIEW',
      warnings,
    };
  }

  private toHorizon(
    row: {
      latitude: number;
      longitude: number;
      elevationM: number | null;
      points: unknown;
      fetchedAt: Date;
    },
    cached: boolean,
    licenseStatus: string,
  ): HorizonResultDto {
    const warnings: string[] = [];
    if (licenseStatus !== 'CLEARED') warnings.push(LICENSE_WARNING);
    return {
      source: 'pvgis',
      latitude: row.latitude,
      longitude: row.longitude,
      elevationM: row.elevationM,
      points: row.points as HorizonResultDto['points'],
      fetchedAt: row.fetchedAt.toISOString(),
      cached,
      attribution: dataSourceDefinition('pvgis')?.attribution ?? '',
      licenseStatus: licenseStatus as HorizonResultDto['licenseStatus'],
      warnings,
    };
  }

  private warningsFor(source: string, kind: string): string[] {
    const warnings: string[] = [];
    if ((dataSourceDefinition(source)?.licenseStatus ?? 'PENDING_REVIEW') !== 'CLEARED')
      warnings.push(LICENSE_WARNING);
    if (source === 'nasa-power' && kind === 'HOURLY')
      warnings.push('A série da NASA POWER está em hora solar local (LST), não em UTC.');
    if (kind === 'CLIMATOLOGY')
      warnings.push(
        'As temperaturas mínima e máxima mensais são da climatologia da fonte: o responsável técnico define a temperatura de projeto.',
      );
    return warnings;
  }

  private translate(error: unknown): Error {
    if (error instanceof ExternalRateLimitedError)
      return new ServiceUnavailableException(`${error.message}. Tente novamente mais tarde.`);
    if (error instanceof ExternalFetchError) return new BadGatewayException(error.message);
    if (error instanceof WeatherParseError)
      return new BadGatewayException(`Resposta inesperada da fonte: ${error.message}`);
    return error instanceof Error ? error : new Error(String(error));
  }
}

const LICENSE_WARNING =
  'Os termos de uso desta fonte ainda não foram conferidos para uso comercial. Use só como apoio até a conferência.';

const errorMessage = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).slice(0, 500);

const sha256 = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
