import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@voltex/database';
import {
  INTEGRATION_MAX_FAILURES,
  type ActivateIntegrationConnectionInput,
  type CreateIntegrationConnectionInput,
  type IntegrationConnectionDto,
  type IntegrationDeadLetterDto,
  type IntegrationHealth,
  type IntegrationProviderDto,
  type IntegrationRunDto,
  type UpdateIntegrationConnectionInput,
} from '@voltex/shared';
import { RequestContext } from '../../common/context/request-context';
import { AuditService } from '../audit/audit.service';
import { PlanService } from '../tenancy/plan.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AdapterContext, IntegrationAdapter } from './integration-adapter';
import { IntegrationHttp } from './integration-http';
import { IntegrationRegistry } from './integration-registry';

type Db = PrismaService['db'];
type ConnectionRow = Awaited<ReturnType<Db['integrationConnection']['findFirstOrThrow']>>;
type RunRow = Awaited<ReturnType<Db['integrationRun']['findFirstOrThrow']>>;
type DeadLetterRow = Awaited<ReturnType<Db['integrationDeadLetter']['findFirstOrThrow']>>;

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asStringRecord = (value: unknown): Record<string, string> =>
  Object.fromEntries(
    Object.entries(asRecord(value)).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );

const toRunDto = (row: RunRow): IntegrationRunDto => ({
  id: row.id,
  connectionId: row.connectionId,
  trigger: row.trigger,
  status: row.status,
  attempt: row.attempt,
  startedAt: row.startedAt.toISOString(),
  finishedAt: row.finishedAt?.toISOString() ?? null,
  error: row.error,
  summary: asRecord(row.summary),
});

const toDeadLetterDto = (row: DeadLetterRow): IntegrationDeadLetterDto => ({
  id: row.id,
  connectionId: row.connectionId,
  error: row.error,
  attempts: row.attempts,
  createdAt: row.createdAt.toISOString(),
  resolvedAt: row.resolvedAt?.toISOString() ?? null,
});

/** Saúde pela contagem de falhas seguidas: 1–2 amarelo, 3 ou mais vermelho. */
export const healthFor = (failures: number): IntegrationHealth =>
  failures === 0 ? 'GREEN' : failures < 3 ? 'YELLOW' : 'RED';

export interface RunOutcome {
  status: 'SUCCEEDED' | 'FAILED' | 'SKIPPED';
  runId: string;
  error?: string;
  summary: Record<string, unknown>;
}

/**
 * Conexões com serviços externos (ADR-0019). Credenciais cifradas por empresa e nunca devolvidas; cada execução fica
 * registrada; falhas seguidas pausam a conexão e vão para a fila de falhas, à espera de uma pessoa.
 */
@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
    private readonly registry: IntegrationRegistry,
    private readonly http: IntegrationHttp,
    private readonly plan: PlanService,
  ) {}

  // --- catálogo de provedores -------------------------------------------------------------------------------

  listProviders(): IntegrationProviderDto[] {
    return this.registry.list().map((a) => ({
      key: a.key,
      kind: a.kind,
      label: a.label,
      official: a.official,
      docsUrl: a.docsUrl ?? null,
      licenseStatus: a.licenseStatus,
      notes: a.notes ?? null,
      credentialFields: a.credentialFields,
      enabled: this.registry.isEnabled(a.key),
      rateBudget: a.rateBudget ?? null,
      minIntervalMinutes: a.minIntervalMinutes,
    }));
  }

  private adapterOrThrow(provider: string): IntegrationAdapter {
    const adapter = this.registry.get(provider);
    if (!adapter) throw new BadRequestException(`Provedor desconhecido: ${provider}`);
    return adapter;
  }

  // --- conexões ---------------------------------------------------------------------------------------------

  private toDto(row: ConnectionRow): IntegrationConnectionDto {
    const adapter = this.registry.get(row.provider);
    const credentials = asStringRecord(row.credentials);
    return {
      id: row.id,
      provider: row.provider,
      providerLabel: adapter?.label ?? row.provider,
      kind: row.kind,
      label: row.label,
      status: row.status,
      official: row.official,
      health: row.health,
      consecutiveFailures: row.consecutiveFailures,
      lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
      lastError: row.lastError,
      termsAcceptedAt: row.termsAcceptedAt?.toISOString() ?? null,
      termsAcceptedById: row.termsAcceptedById,
      config: asRecord(row.config),
      credentials: (adapter?.credentialFields ?? []).map((f) => ({
        name: f.name,
        label: f.label,
        secret: f.secret,
        configured: Boolean(credentials[f.name]),
        // Só campos que não são segredo voltam em claro (ex.: ID da usina).
        value: f.secret ? null : (credentials[f.name] ?? null),
      })),
      createdAt: row.createdAt.toISOString(),
    };
  }

  async list(): Promise<IntegrationConnectionDto[]> {
    const rows = await this.prisma.db.integrationConnection.findMany({
      where: { deletedAt: null },
      orderBy: [{ kind: 'asc' }, { label: 'asc' }],
    });
    return rows.map((r) => this.toDto(r));
  }

  async get(id: string): Promise<IntegrationConnectionDto> {
    return this.toDto(await this.require(id));
  }

  private async require(id: string): Promise<ConnectionRow> {
    const row = await this.prisma.db.integrationConnection.findFirst({
      where: { id, deletedAt: null },
    });
    if (!row) throw new NotFoundException('Conexão não encontrada');
    return row;
  }

  private validateCredentials(
    adapter: IntegrationAdapter,
    credentials: Record<string, string>,
  ): Record<string, string> {
    const parsed = adapter.credentialSchema.safeParse(credentials);
    if (!parsed.success)
      throw new UnprocessableEntityException({
        code: 'INVALID_CREDENTIALS',
        message: `Credenciais inválidas para ${adapter.label}: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'credenciais'} ${i.message}`).join('; ')}`,
      });
    return parsed.data;
  }

  async create(input: CreateIntegrationConnectionInput): Promise<IntegrationConnectionDto> {
    const adapter = this.adapterOrThrow(input.provider);
    const credentials = this.validateCredentials(adapter, input.credentials);
    if (adapter.kind === 'MONITORING') await this.plan.assertWithinLimit('monitoringConnections');
    try {
      const row = await this.prisma.db.$transaction(async (tx) => {
        const created = await tx.integrationConnection.create({
          data: {
            tenantId: this.context.requireTenantId(),
            provider: adapter.key,
            kind: adapter.kind,
            label: input.label,
            official: adapter.official,
            credentials,
            config: input.config as Prisma.InputJsonValue,
            createdById: this.context.userId ?? null,
          },
        });
        // A auditoria guarda só o fato, nunca as credenciais.
        await this.audit.record(
          {
            action: 'integration.created',
            entity: 'IntegrationConnection',
            entityId: created.id,
            after: { provider: adapter.key, label: created.label, official: adapter.official },
          },
          tx,
        );
        return created;
      });
      return this.toDto(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException('Já existe uma conexão deste provedor com esse nome');
      throw error;
    }
  }

  async update(
    id: string,
    input: UpdateIntegrationConnectionInput,
  ): Promise<IntegrationConnectionDto> {
    const row = await this.require(id);
    const adapter = this.adapterOrThrow(row.provider);
    let credentials: Record<string, string> | undefined;
    if (input.credentials) {
      // Só os campos enviados são trocados; os demais ficam como estavam.
      credentials = this.validateCredentials(adapter, {
        ...asStringRecord(row.credentials),
        ...input.credentials,
      });
    }
    const updated = await this.prisma.db.$transaction(async (tx) => {
      const next = await tx.integrationConnection.update({
        where: { id: row.id },
        data: {
          ...(input.label !== undefined ? { label: input.label } : {}),
          ...(credentials ? { credentials } : {}),
          ...(input.config !== undefined ? { config: input.config as Prisma.InputJsonValue } : {}),
          // Credencial nova: recomeça a contagem de falhas.
          ...(credentials
            ? { consecutiveFailures: 0, health: 'UNKNOWN' as const, lastError: null }
            : {}),
        },
      });
      await this.audit.record(
        {
          action: 'integration.updated',
          entity: 'IntegrationConnection',
          entityId: row.id,
          after: { credentialsChanged: Boolean(credentials), label: next.label },
        },
        tx,
      );
      return next;
    });
    return this.toDto(updated);
  }

  async activate(
    id: string,
    input: ActivateIntegrationConnectionInput,
  ): Promise<IntegrationConnectionDto> {
    const row = await this.require(id);
    const adapter = this.adapterOrThrow(row.provider);
    if (!this.registry.isEnabled(adapter.key))
      throw new ServiceUnavailableException(
        `O provedor "${adapter.label}" está desligado neste servidor. Ele só é consultado depois de conferidos os termos de uso.`,
      );
    if (adapter.licenseStatus === 'BLOCKED')
      throw new UnprocessableEntityException(`O provedor "${adapter.label}" está bloqueado.`);
    if (!adapter.official && !input.acceptTerms && !row.termsAcceptedAt)
      throw new UnprocessableEntityException({
        code: 'TERMS_NOT_ACCEPTED',
        message:
          'Este provedor usa um endpoint não oficial: pode violar os termos do fabricante e parar sem aviso. Confirme o aceite para ligar.',
      });
    const accepting = !adapter.official && input.acceptTerms && !row.termsAcceptedAt;
    const updated = await this.prisma.db.$transaction(async (tx) => {
      const next = await tx.integrationConnection.update({
        where: { id: row.id },
        data: {
          status: 'ACTIVE',
          consecutiveFailures: 0,
          ...(accepting
            ? { termsAcceptedAt: new Date(), termsAcceptedById: this.context.userId ?? null }
            : {}),
        },
      });
      await this.audit.record(
        {
          action: 'integration.activated',
          entity: 'IntegrationConnection',
          entityId: row.id,
          after: { termsAccepted: accepting || Boolean(row.termsAcceptedAt) },
        },
        tx,
      );
      return next;
    });
    return this.toDto(updated);
  }

  async pause(id: string): Promise<IntegrationConnectionDto> {
    const row = await this.require(id);
    const updated = await this.prisma.db.$transaction(async (tx) => {
      const next = await tx.integrationConnection.update({
        where: { id: row.id },
        data: { status: 'PAUSED' },
      });
      await this.audit.record(
        { action: 'integration.paused', entity: 'IntegrationConnection', entityId: row.id },
        tx,
      );
      return next;
    });
    return this.toDto(updated);
  }

  async remove(id: string): Promise<{ id: string }> {
    const row = await this.require(id);
    await this.prisma.db.$transaction(async (tx) => {
      await tx.integrationConnection.update({
        where: { id: row.id },
        data: { deletedAt: new Date(), status: 'DISABLED' },
      });
      await this.audit.record(
        { action: 'integration.deleted', entity: 'IntegrationConnection', entityId: id },
        tx,
      );
    });
    return { id };
  }

  // --- execução ---------------------------------------------------------------------------------------------

  private adapterContext(row: ConnectionRow): AdapterContext {
    return {
      tenantId: row.tenantId,
      connectionId: row.id,
      credentials: asStringRecord(row.credentials),
      config: asRecord(row.config),
      http: this.http,
    };
  }

  /** Chamadas já feitas na janela do orçamento (cada execução conta como uma; o adaptador pode fazer várias). */
  private async budgetExceeded(
    row: ConnectionRow,
    adapter: IntegrationAdapter,
    currentRunId: string,
  ): Promise<string | null> {
    const budget = adapter.rateBudget;
    if (!budget) return null;
    const count = (since: Date) =>
      this.prisma.db.integrationRun.count({
        where: {
          connectionId: row.id,
          // A execução em curso ainda não gastou a chamada.
          id: { not: currentRunId },
          startedAt: { gte: since },
          status: { in: ['RUNNING', 'SUCCEEDED', 'FAILED'] },
        },
      });
    if (budget.perDay && (await count(new Date(Date.now() - 24 * 3_600_000))) >= budget.perDay)
      return `orçamento diário de ${budget.perDay} chamadas esgotado`;
    if (
      budget.perMonth &&
      (await count(new Date(Date.now() - 30 * 24 * 3_600_000))) >= budget.perMonth
    )
      return `orçamento mensal de ${budget.perMonth} chamadas esgotado`;
    return null;
  }

  private async finishRun(
    runId: string,
    status: 'SUCCEEDED' | 'FAILED' | 'SKIPPED',
    extra: { error?: string; summary?: Record<string, unknown> } = {},
  ): Promise<void> {
    await this.prisma.db.integrationRun.update({
      where: { id: runId },
      data: {
        status,
        finishedAt: new Date(),
        error: extra.error ?? null,
        ...(extra.summary ? { summary: extra.summary as Prisma.InputJsonValue } : {}),
      },
    });
  }

  /** Testa as credenciais chamando o provedor. Não conta falha nem pausa a conexão. */
  async test(id: string): Promise<{ ok: boolean; message: string; run: IntegrationRunDto }> {
    const row = await this.require(id);
    const adapter = this.adapterOrThrow(row.provider);
    const run = await this.prisma.db.integrationRun.create({
      data: { tenantId: row.tenantId, connectionId: row.id, trigger: 'TEST' },
    });
    if (!this.registry.isEnabled(adapter.key)) {
      const message = 'Provedor desligado neste servidor: nada foi consultado.';
      await this.finishRun(run.id, 'SKIPPED', { error: message });
      return {
        ok: false,
        message,
        run: toRunDto(
          await this.prisma.db.integrationRun.findFirstOrThrow({ where: { id: run.id } }),
        ),
      };
    }
    try {
      const result = await adapter.test(this.adapterContext(row));
      await this.finishRun(run.id, result.ok ? 'SUCCEEDED' : 'FAILED', {
        ...(result.ok ? {} : { error: result.message }),
        summary: { message: result.message },
      });
      return {
        ...result,
        run: toRunDto(
          await this.prisma.db.integrationRun.findFirstOrThrow({ where: { id: run.id } }),
        ),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha desconhecida';
      await this.finishRun(run.id, 'FAILED', { error: message });
      return {
        ok: false,
        message,
        run: toRunDto(
          await this.prisma.db.integrationRun.findFirstOrThrow({ where: { id: run.id } }),
        ),
      };
    }
  }

  /**
   * Uma sincronização. `attempt` e `final` vêm da fila (retentativa com recuo); na última tentativa que falha, a
   * conexão vai para a fila de falhas. Falhas seguidas demais pausam a conexão. Idempotente por natureza: o
   * adaptador grava por chave natural.
   */
  async runSync(
    id: string,
    options: { attempt?: number; final?: boolean; trigger?: string } = {},
  ): Promise<RunOutcome> {
    const row = await this.require(id);
    const adapter = this.adapterOrThrow(row.provider);
    const attempt = options.attempt ?? 1;
    const run = await this.prisma.db.integrationRun.create({
      data: {
        tenantId: row.tenantId,
        connectionId: row.id,
        trigger: options.trigger ?? 'SYNC',
        attempt,
      },
    });
    const skip = async (reason: string): Promise<RunOutcome> => {
      await this.finishRun(run.id, 'SKIPPED', { error: reason });
      return { status: 'SKIPPED', runId: run.id, error: reason, summary: {} };
    };
    if (!this.registry.isEnabled(adapter.key)) return skip('provedor desligado neste servidor');
    if (row.status !== 'ACTIVE') return skip('conexão não está ativa');
    if (!adapter.sync) return skip('o provedor não tem sincronização');
    const exceeded = await this.budgetExceeded(row, adapter, run.id);
    if (exceeded) return skip(exceeded);
    try {
      const result = await adapter.sync(this.adapterContext(row));
      await this.finishRun(run.id, 'SUCCEEDED', { summary: result.summary });
      await this.prisma.db.integrationConnection.update({
        where: { id: row.id },
        data: { consecutiveFailures: 0, health: 'GREEN', lastSyncAt: new Date(), lastError: null },
      });
      return { status: 'SUCCEEDED', runId: run.id, summary: result.summary };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha desconhecida';
      await this.finishRun(run.id, 'FAILED', { error: message });
      // Tentativas intermediárias da fila (final === false) só registram a execução: a falha conta uma vez por trabalho.
      const failures = row.consecutiveFailures + (options.final === false ? 0 : 1);
      const pause = failures >= INTEGRATION_MAX_FAILURES;
      await this.prisma.db.integrationConnection.update({
        where: { id: row.id },
        data: {
          consecutiveFailures: failures,
          health: pause ? 'RED' : healthFor(failures),
          lastError: message,
          ...(pause ? { status: 'PAUSED' as const } : {}),
        },
      });
      if (options.final || pause) {
        await this.prisma.db.integrationDeadLetter.create({
          data: {
            tenantId: row.tenantId,
            connectionId: row.id,
            payload: { trigger: options.trigger ?? 'SYNC', provider: row.provider },
            error: message,
            attempts: attempt,
          },
        });
        this.logger.warn(
          `Integração ${row.provider} (${row.id}) foi para a fila de falhas: ${message}`,
        );
      }
      return { status: 'FAILED', runId: run.id, error: message, summary: {} };
    }
  }

  // --- histórico e fila de falhas ---------------------------------------------------------------------------

  async listRuns(query: { connectionId?: string; limit: number }): Promise<IntegrationRunDto[]> {
    const rows = await this.prisma.db.integrationRun.findMany({
      where: query.connectionId ? { connectionId: query.connectionId } : {},
      orderBy: { startedAt: 'desc' },
      take: query.limit,
    });
    return rows.map(toRunDto);
  }

  async listDeadLetters(): Promise<IntegrationDeadLetterDto[]> {
    const rows = await this.prisma.db.integrationDeadLetter.findMany({
      where: { resolvedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map(toDeadLetterDto);
  }

  /** Reprocessa: reativa a conexão, tenta uma sincronização e, se der certo, dá a falha por resolvida. */
  async retryDeadLetter(id: string): Promise<{ resolved: boolean; outcome: RunOutcome }> {
    const letter = await this.prisma.db.integrationDeadLetter.findFirst({
      where: { id, resolvedAt: null },
    });
    if (!letter) throw new NotFoundException('Falha não encontrada ou já resolvida');
    await this.prisma.db.integrationConnection.update({
      where: { id: letter.connectionId },
      data: { status: 'ACTIVE', consecutiveFailures: 0 },
    });
    const outcome = await this.runSync(letter.connectionId, { trigger: 'MANUAL_RETRY' });
    const resolved = outcome.status === 'SUCCEEDED';
    if (resolved) {
      await this.prisma.db.$transaction(async (tx) => {
        await tx.integrationDeadLetter.update({
          where: { id: letter.id },
          data: { resolvedAt: new Date(), resolvedById: this.context.userId ?? null },
        });
        await this.audit.record(
          {
            action: 'integration.dead_letter_resolved',
            entity: 'IntegrationDeadLetter',
            entityId: letter.id,
          },
          tx,
        );
      });
    }
    return { resolved, outcome };
  }

  async dismissDeadLetter(id: string): Promise<{ id: string }> {
    const letter = await this.prisma.db.integrationDeadLetter.findFirst({
      where: { id, resolvedAt: null },
    });
    if (!letter) throw new NotFoundException('Falha não encontrada ou já resolvida');
    await this.prisma.db.$transaction(async (tx) => {
      await tx.integrationDeadLetter.update({
        where: { id },
        data: { resolvedAt: new Date(), resolvedById: this.context.userId ?? null },
      });
      await this.audit.record(
        {
          action: 'integration.dead_letter_dismissed',
          entity: 'IntegrationDeadLetter',
          entityId: id,
        },
        tx,
      );
    });
    return { id };
  }
}
