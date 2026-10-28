import { randomBytes } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  DomainEvent,
  LeadSource,
  LeadStatus,
  OpportunityStage,
  hasPermission,
  normalizeDocument,
  normalizeEmail,
  normalizePhone,
  type ConvertLeadData,
  type ConvertLeadResult,
  type CreateLeadData,
  type ImportLeadsResult,
  type LeadDto,
  type LeadScoringConfig,
  type ListLeadsQuery,
  type PublicLeadData,
  type UpdateLeadData,
} from '@voltex/shared';
import type { Lead } from '@voltex/database';
import { RequestContext } from '../../common/context/request-context';
import { toPaginated, toSkipTake } from '../../common/pagination';
import { AuditService } from '../../platform/audit/audit.service';
import { EventBus } from '../../platform/events/event-bus.service';
import { isOwnershipRestricted } from '../../platform/prisma/ownership-scope';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { OpportunitiesService } from './opportunities.service';
import { LeadScoringService } from './lead-scoring.service';
import { UserDirectory } from './support/user-directory.service';

export const DEFAULT_LEAD_SLA_MINUTES = 30;

type LeadRow = Lead;
type Keys = { email: string | null; phone: string | null; document: string | null };

const keysOf = (data: {
  email?: string | null;
  phone?: string | null;
  document?: string | null;
}): Keys => ({
  email: normalizeEmail(data.email),
  phone: normalizePhone(data.phone),
  document: normalizeDocument(data.document),
});

/** Etapa inicial da oportunidade criada na conversão, conforme o andamento do lead. */
const stageForLead = (status: LeadStatus): OpportunityStage =>
  status === LeadStatus.QUALIFIED
    ? OpportunityStage.QUALIFICATION
    : status === LeadStatus.CONTACTED
      ? OpportunityStage.FIRST_CONTACT
      : OpportunityStage.NEW_LEAD;

@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly users: UserDirectory,
    private readonly opportunities: OpportunitiesService,
    private readonly scoring: LeadScoringService,
  ) {}

  // ---- Consulta ----

  async list(query: ListLeadsQuery) {
    const digits = query.search?.replace(/\D/g, '') ?? '';
    const where = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.source ? { source: query.source } : {}),
      ...(query.segment ? { segment: query.segment } : {}),
      ...(query.ownerId ? { ownerId: query.ownerId } : {}),
      ...(query.slaBreached
        ? {
            status: LeadStatus.NEW,
            firstContactAt: null,
            firstContactDueAt: { lt: new Date() },
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' as const } },
              { email: { contains: query.search, mode: 'insensitive' as const } },
              ...(digits.length >= 4
                ? [
                    { phoneNormalized: { contains: digits } },
                    // O documento é cifrado: a busca por ele é só pelo número completo.
                    ...(digits.length === 11 || digits.length === 14
                      ? [{ documentNormalized: digits }]
                      : []),
                  ]
                : []),
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.db.lead.findMany({
        where,
        orderBy:
          query.sort === 'score'
            ? [
                { score: { sort: 'desc' as const, nulls: 'last' as const } },
                { createdAt: 'desc' as const },
              ]
            : { createdAt: 'desc' as const },
        ...toSkipTake(query),
      }),
      this.prisma.db.lead.count({ where }),
    ]);
    const names = await this.users.names(rows.map((r) => r.ownerId));
    return toPaginated(
      rows.map((row) => this.toDto(row, names)),
      total,
      query,
    );
  }

  async get(id: string): Promise<LeadDto> {
    const row = await this.findOrThrow(id);
    return this.toDto(row, await this.users.names([row.ownerId]));
  }

  // ---- Criação, edição, exclusão ----

  async create(data: CreateLeadData, options: { ownerFallback?: boolean } = {}): Promise<LeadDto> {
    let ownerId =
      data.ownerId ?? (options.ownerFallback === false ? null : (this.context.userId ?? null));
    this.users.assertCanAssignPortfolio(data.ownerId);
    await this.users.assertActive(data.ownerId, 'responsável');
    const keys = keysOf(data);
    const duplicate = await this.findDuplicate(keys);
    if (duplicate) this.throwDuplicate(duplicate);
    const config = await this.scoring.getConfig();

    const row = await this.prisma.db.$transaction(async (tx) => {
      // Sem responsável definido, a regra de distribuição da empresa escolhe (se houver).
      ownerId ??= await this.scoring.pickOwner(config, { state: data.state ?? null }, tx);
      const created = await tx.lead.create({
        data: await this.toCreateData(data, keys, ownerId, config),
      });
      await this.audit.record(
        {
          action: 'lead.created',
          entity: 'Lead',
          entityId: created.id,
          after: { name: created.name, source: created.source },
        },
        tx,
      );
      await this.events.publish(
        {
          type: DomainEvent.LEAD_CREATED,
          payload: {
            leadId: created.id,
            source: created.source,
            segment: created.segment,
            state: created.state,
            ownerId: created.ownerId,
          },
        },
        tx,
      );
      return created;
    });
    return this.toDto(row, await this.users.names([row.ownerId]));
  }

  async update(id: string, input: UpdateLeadData): Promise<LeadDto> {
    const before = await this.findOrThrow(id);
    if (before.status === LeadStatus.CONVERTED)
      throw new ConflictException('Lead já convertido: edite a conta ou a oportunidade');
    const { status, disqualifiedReason, ...fields } = input;
    this.users.assertCanAssignPortfolio(fields.ownerId);
    await this.users.assertActive(fields.ownerId, 'responsável');

    const merged = {
      email: fields.email ?? before.email,
      phone: fields.phone ?? before.phone,
      document: fields.document ?? before.document,
    };
    const keys = keysOf(merged);
    const duplicate = await this.findDuplicate(keys, id);
    if (duplicate) this.throwDuplicate(duplicate);

    const now = new Date();
    const becameContacted =
      status === LeadStatus.CONTACTED || status === LeadStatus.QUALIFIED
        ? before.firstContactAt === null
        : false;

    const rescore =
      fields.segment !== undefined ||
      fields.state !== undefined ||
      fields.monthlyBillCents !== undefined
        ? this.scoring.scoreFields(await this.scoring.getConfig(), {
            source: before.source,
            segment: fields.segment ?? before.segment,
            state: fields.state ?? before.state,
            monthlyBillCents: fields.monthlyBillCents ?? before.monthlyBillCents,
          })
        : {};

    const row = await this.prisma.db.$transaction(async (tx) => {
      const updated = await tx.lead.update({
        where: { id },
        data: {
          ...rescore,
          ...fields,
          utm: fields.utm === undefined ? undefined : (fields.utm as object),
          emailNormalized: keys.email,
          phoneNormalized: keys.phone,
          documentNormalized: keys.document,
          ...(status ? { status } : {}),
          ...(status === LeadStatus.DISQUALIFIED
            ? { disqualifiedReason: disqualifiedReason ?? null }
            : {}),
          ...(becameContacted ? { firstContactAt: now } : {}),
        },
      });
      await this.audit.record(
        {
          action: 'lead.updated',
          entity: 'Lead',
          entityId: id,
          before: { status: before.status, ownerId: before.ownerId },
          after: { status: updated.status, ownerId: updated.ownerId },
        },
        tx,
      );
      if (status === LeadStatus.QUALIFIED && before.status !== LeadStatus.QUALIFIED) {
        await this.events.publish(
          { type: DomainEvent.LEAD_QUALIFIED, payload: { leadId: id } },
          tx,
        );
      }
      return updated;
    });
    return this.toDto(row, await this.users.names([row.ownerId]));
  }

  async remove(id: string) {
    const lead = await this.findOrThrow(id);
    await this.prisma.db.$transaction(async (tx) => {
      await tx.lead.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.record(
        { action: 'lead.deleted', entity: 'Lead', entityId: id, before: { name: lead.name } },
        tx,
      );
    });
    return { id };
  }

  // ---- Importação (RF-CRM-001/003) ----

  async import(rows: CreateLeadData[]): Promise<ImportLeadsResult> {
    const result: ImportLeadsResult = { created: 0, duplicates: 0, duplicateRows: [] };
    const seen = new Map<string, number>(); // chave de dedup dentro do arquivo → posição da primeira linha
    const config = await this.scoring.getConfig();

    await this.prisma.db.$transaction(
      async (tx) => {
        for (const [index, data] of rows.entries()) {
          const keys = keysOf(data);
          const position = index + 1;

          const inFile = (['email', 'phone', 'document'] as const).find(
            (k) => keys[k] && seen.has(`${k}:${keys[k]}`),
          );
          const existing = inFile ? null : await this.findDuplicate(keys, undefined, tx);
          if (inFile || existing) {
            result.duplicates += 1;
            result.duplicateRows.push({
              row: position,
              name: data.name,
              matchedLeadId: existing?.id ?? '',
              matchedBy: existing ? existing.matchedBy : [inFile as string],
            });
            continue;
          }
          for (const k of ['email', 'phone', 'document'] as const)
            if (keys[k]) seen.set(`${k}:${keys[k]}`, position);

          this.users.assertCanAssignPortfolio(data.ownerId);
          const created = await tx.lead.create({
            data: await this.toCreateData(
              {
                ...data,
                source: data.source === LeadSource.MANUAL ? LeadSource.CSV_IMPORT : data.source,
              },
              keys,
              data.ownerId ??
                (this.context.role === 'SALESPERSON'
                  ? (this.context.userId ?? null)
                  : await this.scoring.pickOwner(config, { state: data.state ?? null }, tx)),
              config,
            ),
          });
          await this.events.publish(
            {
              type: DomainEvent.LEAD_CREATED,
              payload: { leadId: created.id, source: created.source, state: created.state },
            },
            tx,
          );
          result.created += 1;
        }
        await this.audit.record(
          {
            action: 'lead.imported',
            entity: 'Lead',
            after: { created: result.created, duplicates: result.duplicates, rows: rows.length },
          },
          tx,
        );
      },
      { timeout: 60_000 },
    );
    return result;
  }

  // ---- Conversão (RF-CRM-011) ----

  async convert(id: string, dto: ConvertLeadData): Promise<ConvertLeadResult> {
    const lead = await this.findOrThrow(id);
    if (lead.status === LeadStatus.CONVERTED)
      throw new ConflictException('Este lead já foi convertido');
    if (lead.status === LeadStatus.DISQUALIFIED)
      throw new UnprocessableEntityException('Lead desqualificado: reabra-o antes de converter');
    if (
      dto.createOpportunity &&
      !(this.context.role && hasPermission(this.context.role, 'crm.opportunity.write'))
    )
      throw new ForbiddenException(
        'Seu perfil pode converter o lead em conta, mas não criar a oportunidade',
      );

    const now = new Date();
    const { updated, accountId, opportunityId } = await this.prisma.db.$transaction(async (tx) => {
      // Cliente que já existe (mesmo documento) é reaproveitado em vez de duplicado.
      const existingAccount = lead.documentNormalized
        ? await tx.account.findFirst({
            where: { documentNormalized: lead.documentNormalized, deletedAt: null },
          })
        : null;
      if (
        !existingAccount &&
        lead.documentNormalized &&
        isOwnershipRestricted(this.context.role) &&
        (await this.context.withoutOwnership(() =>
          tx.account.count({
            where: { documentNormalized: lead.documentNormalized, deletedAt: null },
          }),
        )) > 0
      )
        throw new ConflictException({
          message:
            'Já existe uma conta com este documento na carteira de outro responsável. Fale com a gestão.',
          code: 'DUPLICATE_ACCOUNT',
        });
      const account =
        existingAccount ??
        (await tx.account.create({
          data: {
            tenantId: this.context.requireTenantId(),
            ownerId: lead.ownerId ?? this.context.userId ?? null,
            type: dto.accountType,
            name: lead.name,
            document: lead.document,
            documentNormalized: lead.documentNormalized,
            segment: lead.segment,
            email: lead.email,
            phone: lead.phone,
            notes: lead.notes,
            contacts: {
              create: {
                tenantId: this.context.requireTenantId(),
                name: lead.name,
                email: lead.email,
                phone: lead.phone,
                isPrimary: true,
              },
            },
          },
        }));

      const opportunity = dto.createOpportunity
        ? await this.opportunities.createWithin(tx, {
            accountId: account.id,
            leadId: lead.id,
            projectType: dto.projectType,
            title: dto.opportunityTitle ?? `Sistema solar — ${lead.name}`,
            ownerId: lead.ownerId ?? this.context.userId ?? null,
            stage: stageForLead(lead.status),
            expectedCloseDate: null,
          })
        : null;

      const converted = await tx.lead.update({
        where: { id },
        data: {
          status: LeadStatus.CONVERTED,
          convertedAccountId: account.id,
          convertedOpportunityId: opportunity?.id ?? null,
          firstContactAt: lead.firstContactAt ?? now,
        },
      });
      await this.audit.record(
        {
          action: 'lead.converted',
          entity: 'Lead',
          entityId: id,
          after: {
            accountId: account.id,
            opportunityId: opportunity?.id ?? null,
            reusedAccount: !!existingAccount,
          },
        },
        tx,
      );
      return { updated: converted, accountId: account.id, opportunityId: opportunity?.id ?? null };
    });

    return {
      lead: this.toDto(updated, await this.users.names([updated.ownerId])),
      accountId,
      opportunityId,
    };
  }

  // ---- Captação pública (RF-CRM-001) ----

  /** Chave do formulário público do tenant (criada na primeira consulta). */
  async captureKey() {
    const tenantId = this.context.requireTenantId();
    const tenant = await this.prisma.system.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    if (tenant.leadCaptureKey) return { key: tenant.leadCaptureKey };
    return this.rotateCaptureKey();
  }

  async rotateCaptureKey() {
    const tenantId = this.context.requireTenantId();
    const key = `lk_${randomBytes(18).toString('base64url')}`;
    await this.prisma.system.tenant.update({
      where: { id: tenantId },
      data: { leadCaptureKey: key },
    });
    await this.audit.record({
      action: 'lead_capture.key_rotated',
      entity: 'Tenant',
      entityId: tenantId,
    });
    return { key };
  }

  /**
   * Recebe um lead do formulário público. Sempre responde igual (mesmo em duplicidade), para que o endpoint
   * não revele quem já é cliente. Chave inválida → 404.
   */
  async capturePublic(key: string, input: PublicLeadData, meta: { ip?: string }) {
    const tenant = await this.prisma.system.tenant.findUnique({ where: { leadCaptureKey: key } });
    if (!tenant || tenant.status !== 'ACTIVE')
      throw new NotFoundException('Formulário não encontrado');

    await this.context.run({ tenantId: tenant.id }, async () => {
      const keys = keysOf(input);
      if (await this.findDuplicate(keys)) return;
      const config = await this.scoring.getConfig();
      await this.prisma.db.$transaction(async (tx) => {
        const ownerId = await this.scoring.pickOwner(config, { state: input.state ?? null }, tx);
        const lead = await tx.lead.create({
          data: await this.toCreateData(
            {
              name: input.name,
              email: input.email,
              phone: input.phone,
              segment: input.segment,
              city: input.city,
              state: input.state,
              notes: input.notes,
              utm: input.utm,
              source: input.utm?.source ? LeadSource.CAMPAIGN : LeadSource.LANDING_PAGE,
            } as CreateLeadData,
            keys,
            ownerId,
            config,
          ),
        });
        await this.audit.record(
          {
            action: 'lead.captured',
            entity: 'Lead',
            entityId: lead.id,
            actorId: null,
            after: { source: lead.source, consent: true, ip: meta.ip ?? null },
          },
          tx,
        );
        await this.events.publish(
          {
            type: DomainEvent.LEAD_CREATED,
            actorId: null,
            payload: {
              leadId: lead.id,
              source: lead.source,
              state: lead.state,
              ownerId: lead.ownerId,
            },
          },
          tx,
        );
      });
    });
  }

  // ---- Internos ----

  private async slaMinutes(): Promise<number> {
    const tenant = await this.prisma.system.tenant.findUnique({
      where: { id: this.context.requireTenantId() },
      select: { settings: true },
    });
    const value = (tenant?.settings as { leadFirstContactSlaMinutes?: unknown } | null)
      ?.leadFirstContactSlaMinutes;
    return typeof value === 'number' && value > 0 ? value : DEFAULT_LEAD_SLA_MINUTES;
  }

  private async toCreateData(
    data: CreateLeadData,
    keys: Keys,
    ownerId: string | null,
    scoringConfig?: LeadScoringConfig,
  ) {
    const minutes = await this.slaMinutes();
    const config = scoringConfig ?? (await this.scoring.getConfig());
    return {
      tenantId: this.context.requireTenantId(),
      name: data.name,
      email: data.email ?? null,
      phone: data.phone ?? null,
      document: data.document ?? null,
      emailNormalized: keys.email,
      phoneNormalized: keys.phone,
      documentNormalized: keys.document,
      source: data.source,
      segment: data.segment ?? null,
      preliminaryGroup: data.preliminaryGroup ?? null,
      city: data.city ?? null,
      state: data.state ?? null,
      notes: data.notes ?? null,
      utm: (data.utm ?? undefined) as object | undefined,
      monthlyBillCents: data.monthlyBillCents ?? null,
      ...this.scoring.scoreFields(config, {
        source: data.source,
        segment: data.segment ?? null,
        state: data.state ?? null,
        monthlyBillCents: data.monthlyBillCents ?? null,
      }),
      ownerId,
      firstContactDueAt: new Date(Date.now() + minutes * 60_000),
    };
  }

  /**
   * Procura outro lead com o mesmo e-mail, telefone ou documento (normalizados). Quem trabalha só com a própria
   * carteira também é avisado de duplicidade com a carteira dos outros, mas sem ver quem é (`foreign`).
   */
  private async findDuplicate(
    keys: Keys,
    excludeId?: string,
    client: Pick<PrismaService['db'], 'lead'> = this.prisma.db,
  ) {
    const own = await this.findDuplicateIn(keys, excludeId, client);
    if (own || !isOwnershipRestricted(this.context.role)) return own;
    const foreign = await this.context.withoutOwnership(() =>
      this.findDuplicateIn(keys, excludeId, client),
    );
    return foreign ? { id: '', name: '', matchedBy: foreign.matchedBy, foreign: true } : null;
  }

  private async findDuplicateIn(
    keys: Keys,
    excludeId: string | undefined,
    client: Pick<PrismaService['db'], 'lead'>,
  ) {
    const or = [
      ...(keys.email ? [{ emailNormalized: keys.email }] : []),
      ...(keys.phone ? [{ phoneNormalized: keys.phone }] : []),
      ...(keys.document ? [{ documentNormalized: keys.document }] : []),
    ];
    if (or.length === 0) return null;
    const found = await client.lead.findFirst({
      where: { deletedAt: null, ...(excludeId ? { id: { not: excludeId } } : {}), OR: or },
      orderBy: { createdAt: 'asc' },
    });
    if (!found) return null;
    const matchedBy = [
      ...(keys.email && found.emailNormalized === keys.email ? ['e-mail'] : []),
      ...(keys.phone && found.phoneNormalized === keys.phone ? ['telefone'] : []),
      // `documentNormalized` é um índice cego: a comparação passa pelo filtro (que o converte), não pelo valor lido.
      ...(keys.document &&
      (await client.lead.count({ where: { id: found.id, documentNormalized: keys.document } })) > 0
        ? ['documento']
        : []),
    ];
    return { id: found.id, name: found.name, matchedBy };
  }

  private throwDuplicate(duplicate: {
    id: string;
    name: string;
    matchedBy: string[];
    foreign?: boolean;
  }): never {
    if (duplicate.foreign)
      throw new ConflictException({
        message: `Já existe um lead com o mesmo ${duplicate.matchedBy.join(' e ')} na carteira de outro responsável. Fale com a gestão.`,
        code: 'DUPLICATE_LEAD',
        data: { matchedBy: duplicate.matchedBy },
      });
    throw new ConflictException({
      message: `Já existe um lead com o mesmo ${duplicate.matchedBy.join(' e ')} (${duplicate.name})`,
      code: 'DUPLICATE_LEAD',
      data: { matchedLeadId: duplicate.id, matchedBy: duplicate.matchedBy },
    });
  }

  private async findOrThrow(id: string) {
    const row = await this.prisma.db.lead.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundException('Lead não encontrado');
    return row;
  }

  private toDto(row: LeadRow, names: Map<string, string>): LeadDto {
    const breached =
      row.status === LeadStatus.NEW &&
      row.firstContactAt === null &&
      row.firstContactDueAt !== null &&
      row.firstContactDueAt.getTime() < Date.now();
    return {
      id: row.id,
      tenantId: row.tenantId,
      name: row.name,
      email: row.email,
      phone: row.phone,
      document: row.document,
      source: row.source,
      segment: row.segment,
      preliminaryGroup: row.preliminaryGroup,
      city: row.city,
      state: row.state,
      notes: row.notes,
      utm: (row.utm as LeadDto['utm']) ?? null,
      monthlyBillCents: row.monthlyBillCents,
      score: row.score,
      scoreBreakdown: (row.scoreBreakdown as LeadDto['scoreBreakdown']) ?? null,
      scoredAt: row.scoredAt?.toISOString() ?? null,
      status: row.status,
      ownerId: row.ownerId,
      ownerName: row.ownerId ? (names.get(row.ownerId) ?? null) : null,
      firstContactDueAt: row.firstContactDueAt?.toISOString() ?? null,
      firstContactAt: row.firstContactAt?.toISOString() ?? null,
      slaBreached: breached,
      disqualifiedReason: row.disqualifiedReason,
      convertedAccountId: row.convertedAccountId,
      convertedOpportunityId: row.convertedOpportunityId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
