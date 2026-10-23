import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  CALCULATOR_RULESET_KEY,
  DEFAULT_CALCULATOR_RULES,
  DomainEvent,
  RULESET_DEFINITIONS,
  calculatorRulesDefinitionSchema,
  ruleScopeKey,
  ruleScopeMatches,
  ruleScopeSpecificity,
  ruleScopeSchema,
  thresholdsSchema,
  type ActivateRuleSetInput,
  type AvailabilityCost,
  type CreateRuleSetData,
  type RuleScope,
  type RuleSetKey,
  type RuleSource,
  type Thresholds,
} from '@voltex/shared';
import { RequestContext } from '../../common/context/request-context';
import { AuditService } from '../audit/audit.service';
import { EventBus } from '../events/event-bus.service';
import { PrismaService } from '../prisma/prisma.service';

export interface EffectiveRules {
  /** `builtin@1` (padrão do produto) ou `<id>@<versão>` (regra ativa do tenant). Gravado nos snapshots. */
  ref: string;
  key: string;
  thresholds: Thresholds;
  availabilityCostKwh: AvailabilityCost;
  sources: RuleSource[];
}

/** Regra de uma chave do Engine em vigor para um escopo. Sem regra ativa NÃO há padrão: o consumidor trava. */
export interface ResolvedRuleSet {
  /** `<id>@<versão>`: gravado nos resultados e snapshots. */
  ref: string;
  key: string;
  scope: RuleScope | null;
  definition: unknown;
  sources: RuleSource[];
  reviewedBy: string | null;
}

/** Rules Engine (base): regras versionadas, com fonte, vigência e responsável pela revisão. */
@Injectable()
export class RulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
    private readonly events: EventBus,
  ) {}

  /**
   * Regra ativa de uma chave para um contexto (ADR-0016): entre as ativas e vigentes em `at` cujo escopo casa com
   * `context`, vence a de escopo mais específico (e, empatando, a de versão maior). Devolve `null` quando não há
   * nenhuma: chaves do Engine **não têm padrão embutido**, pois fator normativo sem revisão não pode ser presumido.
   */
  async resolve(
    key: RuleSetKey,
    context: RuleScope = {},
    at: Date = new Date(),
  ): Promise<ResolvedRuleSet | null> {
    const rows = await this.prisma.db.ruleSet.findMany({
      where: {
        key,
        status: 'ACTIVE',
        validFrom: { lte: at },
        OR: [{ validTo: null }, { validTo: { gt: at } }],
      },
    });
    const candidates = rows
      .map((row) => ({ row, scope: row.scope ? ruleScopeSchema.parse(row.scope) : null }))
      .filter(({ scope }) => ruleScopeMatches(scope, context))
      .sort(
        (a, b) =>
          ruleScopeSpecificity(b.scope) - ruleScopeSpecificity(a.scope) ||
          b.row.version - a.row.version,
      );
    const best = candidates[0];
    if (!best) return null;
    return {
      ref: `${best.row.id}@${best.row.version}`,
      key,
      scope: best.scope,
      definition: RULESET_DEFINITIONS[key].schema.parse(best.row.definition),
      sources: best.row.sources as unknown as RuleSource[],
      reviewedBy: best.row.reviewedBy,
    };
  }

  /** Regra em vigor em `at` (ativa e dentro da vigência) ou o padrão do produto. */
  async effective(
    key: string = CALCULATOR_RULESET_KEY,
    at: Date = new Date(),
  ): Promise<EffectiveRules> {
    const row = await this.prisma.db.ruleSet.findFirst({
      where: {
        key,
        status: 'ACTIVE',
        validFrom: { lte: at },
        OR: [{ validTo: null }, { validTo: { gt: at } }],
      },
      orderBy: { version: 'desc' },
    });
    if (!row) {
      return {
        ref: DEFAULT_CALCULATOR_RULES.ref,
        key,
        thresholds: thresholdsSchema.parse({}),
        availabilityCostKwh: {},
        sources: [...DEFAULT_CALCULATOR_RULES.sources],
      };
    }
    const definition = calculatorRulesDefinitionSchema.parse(row.definition);
    return {
      ref: `${row.id}@${row.version}`,
      key,
      // Valores não definidos na regra caem nos padrões do produto.
      thresholds: thresholdsSchema.parse(definition.thresholds),
      availabilityCostKwh: definition.availabilityCostKwh,
      sources: row.sources as unknown as RuleSource[],
    };
  }

  list(key?: string) {
    return this.prisma.db.ruleSet.findMany({
      where: key ? { key } : {},
      orderBy: [{ key: 'asc' }, { version: 'desc' }],
    });
  }

  async get(id: string) {
    const row = await this.prisma.db.ruleSet.findFirst({ where: { id } });
    if (!row) throw new NotFoundException('Regra não encontrada');
    return row;
  }

  async create(input: CreateRuleSetData) {
    const key = input.key;
    const definition = RULESET_DEFINITIONS[key].schema.parse(input.definition ?? {});
    const scope = input.scope && ruleScopeSpecificity(input.scope) > 0 ? input.scope : null;
    return this.prisma.db.$transaction(async (tx) => {
      const last = await tx.ruleSet.findFirst({
        where: { key },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const created = await tx.ruleSet.create({
        data: {
          tenantId: this.context.requireTenantId(),
          key,
          version: (last?.version ?? 0) + 1,
          status: 'DRAFT',
          scope: scope as unknown as object | undefined,
          scopeKey: ruleScopeKey(scope),
          definition: definition as unknown as object,
          sources: input.sources as unknown as object,
          validFrom: input.validFrom ?? null,
          notes: input.notes ?? null,
          createdById: this.context.userId ?? null,
        },
      });
      await this.audit.record(
        {
          action: 'rule.created',
          entity: 'RuleSet',
          entityId: created.id,
          after: { key, scope, version: created.version, definition },
        },
        tx,
      );
      return created;
    });
  }

  /**
   * Ativa um rascunho: exige o responsável pela revisão (RN-012), aposenta a versão ativa anterior e passa a valer
   * a partir de agora. Vigência futura ainda não é suportada (evita lacuna entre versões).
   */
  async activate(id: string, input: ActivateRuleSetInput) {
    const draft = await this.get(id);
    if (draft.status !== 'DRAFT') throw new ConflictException('Só rascunhos podem ser ativados');
    // Regras técnicas (Engine e comissionamento) exigem o registro no conselho de quem as revisou.
    if (
      (draft.key.startsWith('engine.') || draft.key === 'ops.commissioning') &&
      !input.reviewedByRegistration
    )
      throw new UnprocessableEntityException(
        'Informe o registro no conselho (CREA/CFT/CAU) de quem revisou a regra técnica.',
      );
    const now = new Date();
    if (draft.validFrom && draft.validFrom.getTime() > now.getTime()) {
      throw new BadRequestException(
        'Vigência futura ainda não é suportada: ative na data de início',
      );
    }
    return this.prisma.db.$transaction(async (tx) => {
      const current = await tx.ruleSet.findFirst({
        where: { key: draft.key, scopeKey: draft.scopeKey, status: 'ACTIVE' },
      });
      if (current)
        await tx.ruleSet.update({
          where: { id: current.id },
          data: { status: 'RETIRED', validTo: now },
        });
      const activated = await tx.ruleSet.update({
        where: { id },
        data: {
          status: 'ACTIVE',
          validFrom: draft.validFrom ?? now,
          reviewedBy: input.reviewedBy,
          reviewedByRegistration: input.reviewedByRegistration ?? null,
          reviewedAt: now,
        },
      });
      await this.audit.record(
        {
          action: 'rule.activated',
          entity: 'RuleSet',
          entityId: id,
          before: current ? { activeVersion: current.version } : null,
          after: {
            key: draft.key,
            scope: draft.scope,
            version: activated.version,
            reviewedBy: input.reviewedBy,
            reviewedByRegistration: input.reviewedByRegistration ?? null,
          },
        },
        tx,
      );
      await this.events.publish(
        {
          type: DomainEvent.RULE_SET_ACTIVATED,
          payload: {
            ruleSetId: activated.id,
            key: draft.key,
            version: activated.version,
            scope: draft.scope,
            ref: `${activated.id}@${activated.version}`,
            previousRef: current ? `${current.id}@${current.version}` : null,
            reviewedBy: input.reviewedBy,
            reviewedByRegistration: input.reviewedByRegistration ?? null,
          },
        },
        tx,
      );
      return activated;
    });
  }

  async remove(id: string) {
    const row = await this.get(id);
    if (row.status !== 'DRAFT')
      throw new ConflictException('Regras já ativadas não podem ser excluídas');
    await this.prisma.db.$transaction(async (tx) => {
      await tx.ruleSet.delete({ where: { id } });
      await this.audit.record(
        {
          action: 'rule.deleted',
          entity: 'RuleSet',
          entityId: id,
          before: { key: row.key, version: row.version },
        },
        tx,
      );
    });
    return { id };
  }
}
