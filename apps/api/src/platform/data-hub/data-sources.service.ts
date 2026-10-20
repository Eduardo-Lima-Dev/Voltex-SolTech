import { Injectable, Logger, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DataSourceDto } from '@voltex/shared';
import type { Env } from '../../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { DATA_SOURCES, dataSourceDefinition } from './data-hub.registry';

type CollectionStatus = 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED';

/** Cadastro das fontes (tabela global), decisão de ligar/desligar e registro das coletas. */
@Injectable()
export class DataSourcesService implements OnModuleInit {
  private readonly logger = new Logger(DataSourcesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Mantém o cadastro do banco igual à decisão documentada sobre licença, atribuição e fonte. */
  async onModuleInit(): Promise<void> {
    try {
      await this.sync();
    } catch (error) {
      this.logger.warn(`Não foi possível sincronizar o cadastro de fontes: ${String(error)}`);
    }
  }

  async sync(): Promise<void> {
    for (const def of DATA_SOURCES) {
      await this.prisma.system.dataSource.upsert({
        where: { key: def.key },
        create: {
          key: def.key,
          label: def.label,
          baseUrl: def.baseUrl,
          license: def.license,
          attribution: def.attribution,
          licenseStatus: def.licenseStatus,
          notes: def.notes,
        },
        update: {
          label: def.label,
          baseUrl: def.baseUrl,
          license: def.license,
          attribution: def.attribution,
          licenseStatus: def.licenseStatus,
          notes: def.notes,
        },
      });
    }
  }

  private enabledKeys(): Set<string> {
    return new Set(
      this.config
        .get('DATA_HUB_ENABLED_SOURCES', { infer: true })
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean),
    );
  }

  isEnabled(key: string): boolean {
    return this.enabledKeys().has(key);
  }

  /** Falha com 503 se a fonte não foi ligada na configuração do servidor. */
  requireEnabled(key: string): void {
    if (!this.isEnabled(key))
      throw new ServiceUnavailableException(
        `A fonte "${dataSourceDefinition(key)?.label ?? key}" está desligada neste servidor. Ela só é consultada depois de conferidos os termos de uso (veja a tela de fontes).`,
      );
  }

  async get(key: string) {
    const source = await this.prisma.system.dataSource.findUnique({ where: { key } });
    if (!source) throw new ServiceUnavailableException(`Fonte desconhecida: ${key}`);
    return source;
  }

  async list(): Promise<DataSourceDto[]> {
    const sources = await this.prisma.system.dataSource.findMany({ orderBy: { label: 'asc' } });
    const dtos: DataSourceDto[] = [];
    for (const source of sources) {
      const last = await this.prisma.system.dataCollection.findFirst({
        where: { sourceId: source.id },
        orderBy: { startedAt: 'desc' },
      });
      dtos.push({
        key: source.key,
        label: source.label,
        baseUrl: source.baseUrl,
        license: source.license,
        attribution: source.attribution,
        licenseStatus: source.licenseStatus as DataSourceDto['licenseStatus'],
        termsCheckedAt: source.termsCheckedAt?.toISOString() ?? null,
        termsCheckedBy: source.termsCheckedBy,
        enabled: this.isEnabled(source.key),
        notes: source.notes,
        lastCollection: last
          ? {
              status: last.status,
              startedAt: last.startedAt.toISOString(),
              finishedAt: last.finishedAt?.toISOString() ?? null,
              error: last.error,
            }
          : null,
      });
    }
    return dtos;
  }

  async startCollection(sourceKey: string, summary: Record<string, unknown>) {
    const source = await this.get(sourceKey);
    return this.prisma.system.dataCollection.create({
      data: { sourceId: source.id, status: 'RUNNING', summary: summary as object },
    });
  }

  async finishCollection(
    id: string,
    status: CollectionStatus,
    extra: { contentHash?: string; error?: string; summary?: Record<string, unknown> } = {},
  ): Promise<void> {
    await this.prisma.system.dataCollection.update({
      where: { id },
      data: {
        status,
        finishedAt: new Date(),
        contentHash: extra.contentHash ?? null,
        error: extra.error ?? null,
        ...(extra.summary ? { summary: extra.summary as object } : {}),
      },
    });
  }
}
