import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { CommissioningRecord, CommissioningTest } from '@voltex/database';
import {
  COMMISSIONING_RULESET_KEY,
  DomainEvent,
  commissioningRulesDefinitionSchema,
  engineeringDesignSchema,
  isInternalTestRule,
  type AddCommissioningStringsInput,
  type CommissioningLevel,
  type CommissioningRecordDto,
  type CommissioningRulesDefinition,
  type CommissioningStatus,
  type CommissioningTestDto,
  type DecideCommissioningInput,
  type FieldCommissioningDto,
  type MeasurementConditionsInput,
  type RecordMeasurementInput,
  type UpdateCommissioningInput,
} from '@voltex/shared';
import {
  approvalBlockers,
  commissioningSubjects,
  evaluateTest,
  generateTests,
  resolveCommissioningModel,
  summarize,
  type CommissioningSubject,
  type CommissioningTestInstance,
  type Evaluation,
  type StringElectrical,
} from '@voltex/solar-engine';
import type { RequestUser } from '../../common/context/request-user';
import { RequestContext } from '../../common/context/request-context';
import { AuditService } from '../../platform/audit/audit.service';
import { DocumentsService } from '../../platform/documents/documents.service';
import { EventBus } from '../../platform/events/event-bus.service';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { RulesService } from '../../platform/rules/rules.service';
import { UserDirectory } from '../crm/support/user-directory.service';
import { buildCommissioningReportPdf } from './commissioning-report-pdf';
import { InstallationsService } from './installations.service';

type Tx = Parameters<Parameters<PrismaService['db']['$transaction']>[0]>[0];

const DAY = 86_400_000;

const asConditions = (value: unknown): MeasurementConditionsInput => {
  if (!value || typeof value !== 'object') return {};
  const v = value as Record<string, unknown>;
  const pick = (k: string) =>
    typeof v[k] === 'number' && Number.isFinite(v[k]) ? (v[k] as number) : undefined;
  return {
    ...(pick('irradianceWm2') !== undefined ? { irradianceWm2: pick('irradianceWm2') } : {}),
    ...(pick('moduleTempC') !== undefined ? { moduleTempC: pick('moduleTempC') } : {}),
    ...(pick('ambientC') !== undefined ? { ambientC: pick('ambientC') } : {}),
  };
};

const asElectrical = (value: unknown): StringElectrical | null =>
  value &&
  typeof value === 'object' &&
  typeof (value as StringElectrical).modulesInSeries === 'number'
    ? (value as StringElectrical)
    : null;

export const toTestDto = (t: CommissioningTest): CommissioningTestDto => ({
  id: t.id,
  position: t.position,
  code: t.code,
  label: t.label,
  group: t.testGroup,
  kind: t.kind as CommissioningTestDto['kind'],
  level: t.level as CommissioningTestDto['level'],
  scope: t.scope as CommissioningTestDto['scope'],
  unit: t.unit,
  expectedKind: t.expectedKind as CommissioningTestDto['expectedKind'],
  tolerancePct: t.tolerancePct,
  min: t.minValue,
  max: t.maxValue,
  required: t.required,
  source: t.source,
  subjectKey: t.subjectKey,
  subjectLabel: t.subjectLabel,
  electrical: asElectrical(t.electrical),
  result: t.result,
  measuredValue: t.measuredValue,
  passed: t.passed,
  expectedValue: t.expectedValue,
  deviationPct: t.deviationPct,
  basis: t.basis,
  reason: t.reason,
  note: t.note,
  conditions: t.conditions ? asConditions(t.conditions) : null,
  measuredAt: t.measuredAt?.toISOString() ?? null,
  measuredById: t.measuredById,
  evidencePhotoIds: Array.isArray(t.evidencePhotoIds) ? (t.evidencePhotoIds as string[]) : [],
});

const rowOf = (
  instance: CommissioningTestInstance,
  recordId: string,
  tenantId: string,
  position: number,
) => ({
  tenantId,
  recordId,
  position,
  code: instance.code,
  label: instance.label,
  testGroup: instance.group,
  kind: instance.kind,
  level: instance.level,
  scope: instance.scope,
  unit: instance.unit,
  expectedKind: instance.expected,
  tolerancePct: instance.tolerancePct,
  minValue: instance.min,
  maxValue: instance.max,
  required: instance.required,
  source: instance.source,
  subjectKey: instance.subjectKey,
  subjectLabel: instance.subjectLabel,
  electrical: (instance.electrical ?? undefined) as object | undefined,
});

/**
 * Comissionamento (ADR-0022). O modelo de ensaios, as tolerâncias e os limites vêm da regra `ops.commissioning` ativa
 * e revisada pelo responsável técnico; sem ela vale o modelo-base provisório (só a estrutura do livro, sem nenhum
 * limite) e a aprovação fica travada. O sistema calcula o valor esperado de cada string a partir do projeto técnico e
 * das condições medidas, mas **nunca presume uma tolerância**.
 */
@Injectable()
export class CommissioningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly rules: RulesService,
    private readonly installations: InstallationsService,
    private readonly documents: DocumentsService,
    private readonly directory: UserDirectory,
  ) {}

  // --- leitura ----------------------------------------------------------------------------------------------

  private toDto(record: CommissioningRecord, tests: CommissioningTest[]): CommissioningRecordDto {
    const testDtos = tests.sort((a, b) => a.position - b.position).map(toTestDto);
    const view = testDtos.map((t) => ({ result: t.result, required: t.required }));
    const open = record.status === 'IN_PROGRESS' || record.status === 'SUBMITTED';
    return {
      id: record.id,
      installationId: record.installationId,
      attempt: record.attempt,
      status: record.status,
      level: record.level as CommissioningLevel,
      ruleRef: record.ruleRef,
      provisional: record.provisional,
      ruleNote: record.ruleNote,
      ruleReviewedBy: record.ruleReviewedBy,
      internalTestRule: record.internalTestRule,
      conditions: asConditions(record.conditions),
      skipped: (Array.isArray(record.skipped) ? record.skipped : []) as {
        code: string;
        reason: string;
      }[],
      notes: (Array.isArray(record.notes) ? record.notes : []) as string[],
      startedAt: record.startedAt.toISOString(),
      submittedAt: record.submittedAt?.toISOString() ?? null,
      decidedAt: record.decidedAt?.toISOString() ?? null,
      decidedById: record.decidedById,
      decisionNote: record.decisionNote,
      hasReport: record.reportDocumentId !== null,
      summary: summarize(view),
      blockers: open ? approvalBlockers(view, { provisional: record.provisional }) : [],
      tests: testDtos,
    };
  }

  private async load(
    recordId: string,
  ): Promise<{ record: CommissioningRecord; tests: CommissioningTest[] }> {
    const record = await this.prisma.db.commissioningRecord.findFirst({ where: { id: recordId } });
    if (!record) throw new NotFoundException('Comissionamento não encontrado');
    const tests = await this.prisma.db.commissioningTest.findMany({ where: { recordId } });
    return { record, tests };
  }

  async get(recordId: string): Promise<CommissioningRecordDto> {
    const { record, tests } = await this.load(recordId);
    return this.toDto(record, tests);
  }

  /** O registro mais recente da instalação e o histórico das tentativas anteriores. */
  async forInstallation(installationId: string): Promise<{
    current: CommissioningRecordDto | null;
    previous: {
      id: string;
      attempt: number;
      status: CommissioningStatus;
      decidedAt: string | null;
      decisionNote: string | null;
    }[];
  }> {
    await this.installations.require(installationId);
    const records = await this.prisma.db.commissioningRecord.findMany({
      where: { installationId },
      orderBy: { attempt: 'desc' },
    });
    const [latest, ...older] = records;
    return {
      current: latest ? await this.get(latest.id) : null,
      previous: older.map((r) => ({
        id: r.id,
        attempt: r.attempt,
        status: r.status,
        decidedAt: r.decidedAt?.toISOString() ?? null,
        decisionNote: r.decisionNote,
      })),
    };
  }

  // --- criação ----------------------------------------------------------------------------------------------

  /**
   * Garante o registro do comissionamento da instalação. Reprovado, a nova tentativa só abre quando pedida
   * (`newAttemptIfRejected`), por exemplo ao começar uma nova ordem de comissionamento.
   */
  async ensureRecord(
    installationId: string,
    options: { newAttemptIfRejected?: boolean; level?: CommissioningLevel } = {},
  ): Promise<CommissioningRecord> {
    const latest = await this.prisma.db.commissioningRecord.findFirst({
      where: { installationId },
      orderBy: { attempt: 'desc' },
    });
    if (latest && !(latest.status === 'REJECTED' && options.newAttemptIfRejected)) return latest;
    const inst = await this.installations.require(installationId);
    const level = options.level ?? (latest?.level as CommissioningLevel | undefined) ?? 'STANDARD';

    const resolved = await this.rules.resolve(COMMISSIONING_RULESET_KEY);
    const model = resolveCommissioningModel(
      resolved
        ? {
            ref: resolved.ref,
            definition: commissioningRulesDefinitionSchema.parse(resolved.definition),
          }
        : null,
    );

    // Alvos do projeto técnico aprovado (strings com os dados do módulo, inversores). Sem ele, só ensaios de sistema.
    let subjects: { strings: CommissioningSubject[]; inverters: CommissioningSubject[] } = {
      strings: [],
      inverters: [],
    };
    const warnings: string[] = [];
    if (inst.engineeringSnapshotId) {
      const snapshot = await this.prisma.db.engineeringSnapshot.findFirst({
        where: { id: inst.engineeringSnapshotId },
        select: { content: true },
      });
      const content = snapshot?.content as
        | {
            version?: { design?: unknown };
            equipment?: { id: string; kind: string; spec: unknown }[];
          }
        | undefined;
      const design = engineeringDesignSchema.safeParse(content?.version?.design);
      if (design.success) {
        const found = commissioningSubjects(design.data, content?.equipment ?? []);
        subjects = { strings: found.strings, inverters: found.inverters };
        warnings.push(...found.notes);
      } else
        warnings.push('O projeto técnico aprovado não pôde ser lido: informe as strings à mão.');
    } else
      warnings.push(
        'A venda não veio de um projeto técnico aprovado: as strings e os inversores são informados à mão e o valor esperado não é calculado.',
      );

    const generated = generateTests(model.definition, level, subjects);
    const tenantId = this.context.requireTenantId();
    return this.prisma.db.$transaction(async (tx) => {
      const record = await tx.commissioningRecord.create({
        data: {
          tenantId,
          installationId,
          attempt: (latest?.attempt ?? 0) + 1,
          level,
          ruleRef: model.ref,
          provisional: model.provisional,
          ruleNote: model.note,
          ruleSources: (resolved?.sources ?? []) as object[],
          ruleReviewedBy: resolved?.reviewedBy ?? null,
          internalTestRule: resolved ? isInternalTestRule({ sources: resolved.sources }) : false,
          engineeringSnapshotId: inst.engineeringSnapshotId,
          model: model.definition as object,
          skipped: generated.skipped as object[],
          notes: warnings,
        },
      });
      await tx.commissioningTest.createMany({
        data: generated.tests.map((t, i) => rowOf(t, record.id, tenantId, i)),
      });
      await this.audit.record(
        {
          action: 'commissioning.started',
          entity: 'CommissioningRecord',
          entityId: record.id,
          after: {
            attempt: record.attempt,
            level,
            ruleRef: model.ref,
            provisional: model.provisional,
            tests: generated.tests.length,
          },
        },
        tx,
      );
      return record;
    });
  }

  // --- registro dos ensaios ---------------------------------------------------------------------------------

  private effectiveConditions(
    record: CommissioningRecord,
    test: CommissioningTest,
  ): MeasurementConditionsInput {
    return {
      ...asConditions(record.conditions),
      ...(test.conditions ? asConditions(test.conditions) : {}),
    };
  }

  private evaluationFor(record: CommissioningRecord, test: CommissioningTest): Evaluation {
    return evaluateTest(
      {
        kind: test.kind as 'CHECK' | 'MEASURE',
        expected: test.expectedKind as 'NONE' | 'VOC_STRING' | 'ISC_STRING',
        tolerancePct: test.tolerancePct,
        min: test.minValue,
        max: test.maxValue,
        electrical: asElectrical(test.electrical),
        unit: test.unit,
      },
      { value: test.measuredValue, passed: test.passed },
      this.effectiveConditions(record, test),
    );
  }

  private resultData(evaluation: Evaluation) {
    return {
      result: evaluation.result,
      expectedValue: evaluation.expectedValue,
      deviationPct: evaluation.deviationPct,
      basis: evaluation.basis,
      reason: evaluation.reason,
    };
  }

  private assertOpen(record: CommissioningRecord): void {
    if (record.status !== 'IN_PROGRESS')
      throw new UnprocessableEntityException({
        code: 'COMMISSIONING_CLOSED',
        message:
          record.status === 'SUBMITTED'
            ? 'O comissionamento já foi enviado para revisão.'
            : 'Este comissionamento já foi encerrado.',
      });
  }

  /** Registra o resultado de um ensaio e o julga com a regra do registro. */
  async recordMeasurement(
    testId: string,
    input: RecordMeasurementInput,
    actor: RequestUser,
  ): Promise<CommissioningTestDto> {
    const test = await this.prisma.db.commissioningTest.findFirst({ where: { id: testId } });
    if (!test) throw new NotFoundException('Ensaio não encontrado');
    const record = await this.prisma.db.commissioningRecord.findFirstOrThrow({
      where: { id: test.recordId },
    });
    this.assertOpen(record);
    if (test.kind === 'CHECK' && input.value !== undefined && input.value !== null)
      throw new UnprocessableEntityException(
        'Este ensaio é de conferência: informe conforme ou não conforme.',
      );
    if (test.kind === 'MEASURE' && input.passed !== undefined && input.passed !== null)
      throw new UnprocessableEntityException('Este ensaio é de medição: informe o valor medido.');

    const touchesResult = input.value !== undefined || input.passed !== undefined;
    const ownConditions =
      input.irradianceWm2 !== undefined || input.moduleTempC !== undefined
        ? {
            ...asConditions(test.conditions),
            ...(input.irradianceWm2 !== undefined ? { irradianceWm2: input.irradianceWm2 } : {}),
            ...(input.moduleTempC !== undefined ? { moduleTempC: input.moduleTempC } : {}),
          }
        : undefined;
    const draft: CommissioningTest = {
      ...test,
      ...(ownConditions ? { conditions: ownConditions as object } : {}),
      ...(touchesResult
        ? {
            measuredValue: input.value === undefined ? test.measuredValue : input.value,
            passed: input.passed === undefined ? test.passed : input.passed,
          }
        : {}),
    };
    const evaluation = touchesResult || ownConditions ? this.evaluationFor(record, draft) : null;
    const updated = await this.prisma.db.$transaction(async (tx) => {
      const next = await tx.commissioningTest.update({
        where: { id: testId },
        data: {
          ...(ownConditions ? { conditions: ownConditions as object } : {}),
          ...(touchesResult
            ? {
                measuredValue: draft.measuredValue,
                passed: draft.passed,
                measuredAt: new Date(),
                measuredById: actor.id,
              }
            : {}),
          ...(evaluation ? this.resultData(evaluation) : {}),
          ...(input.note !== undefined ? { note: input.note || null } : {}),
        },
      });
      await this.audit.record(
        {
          action: 'commissioning.test_recorded',
          entity: 'CommissioningTest',
          entityId: testId,
          after: {
            code: test.code,
            subject: test.subjectLabel,
            value: draft.measuredValue,
            passed: draft.passed,
            result: next.result,
          },
        },
        tx,
      );
      return next;
    });
    return toTestDto(updated);
  }

  /** Atualiza o nível (só enquanto nada foi registrado) e as condições (e rejulga as medições). */
  async update(recordId: string, input: UpdateCommissioningInput): Promise<CommissioningRecordDto> {
    const { record, tests } = await this.load(recordId);
    this.assertOpen(record);
    if (input.level && input.level !== record.level) {
      if (tests.some((t) => t.result !== 'PENDING' || t.note))
        throw new UnprocessableEntityException({
          code: 'LEVEL_LOCKED',
          message: 'Já há ensaios registrados: não dá para trocar o nível.',
        });
      const strings = new Map<string, CommissioningSubject>();
      const inverters = new Map<string, CommissioningSubject>();
      for (const t of tests) {
        const subject: CommissioningSubject = {
          key: t.subjectKey,
          scope: t.scope as 'STRING' | 'INVERTER' | 'SYSTEM',
          label: t.subjectLabel,
          ...(asElectrical(t.electrical) ? { electrical: asElectrical(t.electrical)! } : {}),
        };
        if (t.scope === 'STRING') strings.set(t.subjectKey, subject);
        if (t.scope === 'INVERTER') inverters.set(t.subjectKey, subject);
      }
      const definition = commissioningRulesDefinitionSchema.parse(
        record.model,
      ) as CommissioningRulesDefinition;
      const generated = generateTests(definition, input.level, {
        strings: [...strings.values()],
        inverters: [...inverters.values()],
      });
      const tenantId = this.context.requireTenantId();
      await this.prisma.db.$transaction(async (tx) => {
        await tx.commissioningTest.deleteMany({ where: { recordId } });
        await tx.commissioningTest.createMany({
          data: generated.tests.map((t, i) => rowOf(t, recordId, tenantId, i)),
        });
        await tx.commissioningRecord.update({
          where: { id: recordId },
          data: { level: input.level, skipped: generated.skipped as object[] },
        });
        await this.audit.record(
          {
            action: 'commissioning.level_changed',
            entity: 'CommissioningRecord',
            entityId: recordId,
            after: { level: input.level },
          },
          tx,
        );
      });
    }
    if (input.conditions) {
      const merged = { ...asConditions(record.conditions), ...stripNulls(input.conditions) };
      for (const key of ['irradianceWm2', 'moduleTempC', 'ambientC'] as const)
        if (input.conditions[key] === null) delete merged[key];
      await this.setConditions(recordId, merged);
    }
    return this.get(recordId);
  }

  /** Grava as condições do registro e rejulga as medições que dependem delas. */
  async setConditions(recordId: string, conditions: MeasurementConditionsInput): Promise<void> {
    const { record, tests } = await this.load(recordId);
    this.assertOpen(record);
    const updatedRecord: CommissioningRecord = { ...record, conditions: conditions as object };
    await this.prisma.db.$transaction(async (tx) => {
      await tx.commissioningRecord.update({
        where: { id: recordId },
        data: { conditions: conditions as object },
      });
      for (const t of tests) {
        if (t.kind !== 'MEASURE' || t.measuredValue === null) continue;
        await tx.commissioningTest.update({
          where: { id: t.id },
          data: this.resultData(this.evaluationFor(updatedRecord, t)),
        });
      }
      await this.audit.record(
        {
          action: 'commissioning.conditions_set',
          entity: 'CommissioningRecord',
          entityId: recordId,
          after: conditions,
        },
        tx,
      );
    });
  }

  /** Strings informadas à mão (venda sem projeto técnico): ganham os ensaios por string, sem valor esperado. */
  async addStrings(
    recordId: string,
    input: AddCommissioningStringsInput,
  ): Promise<CommissioningRecordDto> {
    const { record, tests } = await this.load(recordId);
    this.assertOpen(record);
    const existing = new Set(
      tests.filter((t) => t.scope === 'STRING').map((t) => t.subjectLabel.toLowerCase()),
    );
    // Sem repetir nomes (já existentes ou repetidos no próprio pedido), sem diferenciar maiúsculas.
    const labels: string[] = [];
    for (const label of input.labels) {
      const key = label.toLowerCase();
      if (existing.has(key)) continue;
      existing.add(key);
      labels.push(label);
    }
    if (labels.length === 0) return this.toDto(record, tests);
    const manual = new Set(
      tests.filter((t) => t.subjectKey.startsWith('manual:')).map((t) => t.subjectKey),
    ).size;
    const subjects = labels.map((label, i) => ({
      key: `manual:${manual + i + 1}`,
      scope: 'STRING' as const,
      label,
    }));
    const definition = commissioningRulesDefinitionSchema.parse(
      record.model,
    ) as CommissioningRulesDefinition;
    const generated = generateTests(definition, record.level as CommissioningLevel, {
      strings: subjects,
      inverters: [],
    });
    const rows = generated.tests.filter((t) => t.scope === 'STRING');
    const start = Math.max(-1, ...tests.map((t) => t.position)) + 1;
    const tenantId = this.context.requireTenantId();
    await this.prisma.db.$transaction(async (tx) => {
      await tx.commissioningTest.createMany({
        data: rows.map((t, i) => rowOf(t, recordId, tenantId, start + i)),
      });
      await this.audit.record(
        {
          action: 'commissioning.strings_added',
          entity: 'CommissioningRecord',
          entityId: recordId,
          after: { labels },
        },
        tx,
      );
    });
    return this.get(recordId);
  }

  // --- envio e decisão --------------------------------------------------------------------------------------

  /** Ensaios obrigatórios sem registro (lista vazia = pode enviar). */
  async missingRequired(
    installationId: string,
  ): Promise<{ record: CommissioningRecord; missing: number }> {
    const record = await this.ensureRecord(installationId);
    const missing = await this.prisma.db.commissioningTest.count({
      where: { recordId: record.id, required: true, result: 'PENDING' },
    });
    return { record, missing };
  }

  async submit(
    recordId: string,
    actor: RequestUser | null,
    tx?: Tx,
  ): Promise<CommissioningRecordDto> {
    const { record } = await this.load(recordId);
    this.assertOpen(record);
    const missing = await (tx ?? this.prisma.db).commissioningTest.count({
      where: { recordId, required: true, result: 'PENDING' },
    });
    if (missing > 0)
      throw new UnprocessableEntityException({
        code: 'REQUIRED_TESTS_PENDING',
        message: `Faltam ${missing} ensaio(s) obrigatório(s) sem registro.`,
      });
    const run = async (client: Tx) => {
      await client.commissioningRecord.update({
        where: { id: recordId },
        data: {
          status: 'SUBMITTED',
          submittedAt: new Date(),
          submittedById: actor?.id ?? this.context.userId ?? null,
        },
      });
      await this.audit.record(
        { action: 'commissioning.submitted', entity: 'CommissioningRecord', entityId: recordId },
        client,
      );
    };
    if (tx) await run(tx);
    else await this.prisma.db.$transaction(run);
    return this.get(recordId);
  }

  async decide(
    recordId: string,
    input: DecideCommissioningInput,
    actor: RequestUser,
  ): Promise<CommissioningRecordDto> {
    const { record, tests } = await this.load(recordId);
    if (record.status !== 'SUBMITTED')
      throw new UnprocessableEntityException({
        code: 'COMMISSIONING_NOT_SUBMITTED',
        message: 'Só um comissionamento enviado para revisão pode ser decidido.',
      });
    const inst = await this.installations.require(record.installationId);
    if (inst.status !== 'COMMISSIONING')
      throw new UnprocessableEntityException({
        code: 'INSTALLATION_NOT_COMMISSIONING',
        message: 'A instalação não está em comissionamento.',
      });

    if (input.decision === 'REJECT') {
      await this.prisma.db.$transaction(async (tx) => {
        await tx.commissioningRecord.update({
          where: { id: recordId },
          data: {
            status: 'REJECTED',
            decidedAt: new Date(),
            decidedById: actor.id,
            decisionNote: input.note ?? null,
          },
        });
        await this.installations.transition(inst, 'IN_PROGRESS', {
          tx,
          reason: `Reprovado no comissionamento: ${input.note}`,
        });
        await this.installations.upsertTask(tx, inst, {
          key: `commissioning-fix:${recordId}`,
          title: `Corrigir e reinstalar: comissionamento reprovado (${input.note})`,
          dueAt: new Date(Date.now() + 2 * DAY),
          assigneeId: inst.responsibleId,
        });
        await this.audit.record(
          {
            action: 'commissioning.rejected',
            entity: 'CommissioningRecord',
            entityId: recordId,
            after: { note: input.note },
          },
          tx,
        );
      });
      return this.get(recordId);
    }

    // Aprovar: nenhuma trava pode estar de pé (regra provisória, ensaio reprovado, sem juízo ou sem registro).
    const blockers = approvalBlockers(
      tests.map((t) => ({ result: t.result, required: t.required })),
      { provisional: record.provisional },
    );
    if (blockers.length > 0)
      throw new UnprocessableEntityException({
        code: 'COMMISSIONING_BLOCKED',
        message: blockers.join(' '),
        data: { blockers },
      });

    const dto = this.toDto(record, tests);
    const [account, submitter, decider] = await Promise.all([
      this.prisma.db.account.findFirst({ where: { id: inst.accountId }, select: { name: true } }),
      this.directory.names([record.submittedById, actor.id]),
      Promise.resolve(null),
    ]);
    void decider;
    const site = inst.siteId
      ? await this.prisma.db.site.findFirst({
          where: { id: inst.siteId },
          select: { name: true, city: true, state: true },
        })
      : null;
    const buffer = await buildCommissioningReportPdf({
      projectCode: inst.projectCode,
      accountName: account?.name ?? '—',
      siteLabel: site ? `${site.name} – ${site.city}/${site.state}` : null,
      record: {
        ...dto,
        status: 'APPROVED',
        decidedAt: new Date().toISOString(),
        decisionNote: input.note ?? null,
      },
      submittedBy: record.submittedById ? (submitter.get(record.submittedById) ?? null) : null,
      decidedBy: submitter.get(actor.id) ?? actor.name,
      generatedAt: new Date(),
    });
    const document = await this.documents.upload(
      {
        originalname: `relatorio-comissionamento-${inst.projectCode}-t${record.attempt}.pdf`,
        mimetype: 'application/pdf',
        buffer,
        size: buffer.length,
      },
      { entityType: 'CommissioningRecord', entityId: recordId },
    );
    await this.prisma.db.$transaction(async (tx) => {
      await tx.commissioningRecord.update({
        where: { id: recordId },
        data: {
          status: 'APPROVED',
          decidedAt: new Date(),
          decidedById: actor.id,
          decisionNote: input.note ?? null,
          reportDocumentId: document.id,
        },
      });
      await this.installations.transition(inst, 'CUSTOMER_ACCEPTANCE', {
        tx,
        reason: 'Comissionamento aprovado',
      });
      await this.events.publish(
        {
          type: DomainEvent.COMMISSIONING_COMPLETED,
          projectCode: inst.projectCode,
          payload: {
            installationId: inst.id,
            projectId: inst.projectId,
            opportunityId: inst.opportunityId,
            recordId,
          },
        },
        tx,
      );
      await this.installations.upsertTask(tx, inst, {
        key: `acceptance-request:${inst.id}`,
        title: 'Colher o aceite do cliente: o comissionamento foi aprovado',
        dueAt: new Date(Date.now() + 2 * DAY),
        assigneeId: inst.responsibleId,
      });
      await this.audit.record(
        {
          action: 'commissioning.approved',
          entity: 'CommissioningRecord',
          entityId: recordId,
          after: { reportDocumentId: document.id },
        },
        tx,
      );
    });
    return this.get(recordId);
  }

  async reportUrl(recordId: string): Promise<{ url: string; expiresIn: number }> {
    const { record } = await this.load(recordId);
    if (!record.reportDocumentId)
      throw new NotFoundException('O relatório só existe depois da aprovação do comissionamento.');
    return this.documents.downloadUrl(record.reportDocumentId);
  }

  // --- app de campo -----------------------------------------------------------------------------------------

  /** Cópia dos ensaios para o app de campo (a ordem de comissionamento garante o registro). */
  async fieldView(installationId: string): Promise<FieldCommissioningDto | null> {
    const inst = await this.installations.require(installationId);
    if (!['INSTALLED', 'COMMISSIONING', 'CUSTOMER_ACCEPTANCE', 'DONE'].includes(inst.status))
      return null;
    const record = await this.ensureRecord(installationId, {
      newAttemptIfRejected: inst.status === 'INSTALLED',
    });
    const tests = await this.prisma.db.commissioningTest.findMany({
      where: { recordId: record.id },
    });
    return {
      recordId: record.id,
      status: record.status as CommissioningStatus,
      level: record.level as CommissioningLevel,
      provisional: record.provisional,
      ruleNote: record.ruleNote,
      conditions: asConditions(record.conditions),
      tests: tests.sort((a, b) => a.position - b.position).map(toTestDto),
    };
  }

  /** O ensaio precisa ser do comissionamento da instalação da ordem (o técnico só mexe no que é da ordem dele). */
  async assertTestOfInstallation(testId: string, installationId: string | null): Promise<void> {
    const test = await this.prisma.db.commissioningTest.findFirst({
      where: { id: testId },
      select: { record: { select: { installationId: true } } },
    });
    if (!test || !installationId || test.record.installationId !== installationId)
      throw new UnprocessableEntityException('O ensaio não é do comissionamento desta ordem.');
  }
}

function stripNulls(c: MeasurementConditionsInput): MeasurementConditionsInput {
  return Object.fromEntries(
    Object.entries(c).filter(([, v]) => v !== null && v !== undefined),
  ) as MeasurementConditionsInput;
}
