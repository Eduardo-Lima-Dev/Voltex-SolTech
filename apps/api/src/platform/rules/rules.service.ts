import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CALCULATOR_RULESET_KEY,
  DEFAULT_CALCULATOR_RULES,
  calculatorRulesDefinitionSchema,
  thresholdsSchema,
  type ActivateRuleSetInput,
  type AvailabilityCost,
  type CreateRuleSetData,
  type RuleSource,
  type Thresholds,
} from '@voltex/shared';
import { RequestContext } from '../../common/context/request-context';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

export interface EffectiveRules {
  /** `builtin@1` (padrão do produto) ou `<id>@<versão>` (regra ativa do tenant). Gravado nos snapshots. */
  ref: string;
  key: string;
  thresholds: Thresholds;
  availabilityCostKwh: AvailabilityCost;
  sources: RuleSource[];
}

/** Rules Engine (base): regras versionadas, com fonte, vigência e responsável pela revisão. */
@Injectable()
export class RulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
  ) {}

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
    const definition = calculatorRulesDefinitionSchema.parse(input.definition);
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
          after: { key, version: created.version, definition },
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
    const now = new Date();
    if (draft.validFrom && draft.validFrom.getTime() > now.getTime()) {
      throw new BadRequestException(
        'Vigência futura ainda não é suportada: ative na data de início',
      );
    }
    return this.prisma.db.$transaction(async (tx) => {
      const current = await tx.ruleSet.findFirst({ where: { key: draft.key, status: 'ACTIVE' } });
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
          reviewedAt: now,
        },
      });
      await this.audit.record(
        {
          action: 'rule.activated',
          entity: 'RuleSet',
          entityId: id,
          before: current ? { activeVersion: current.version } : null,
          after: { key: draft.key, version: activated.version, reviewedBy: input.reviewedBy },
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
