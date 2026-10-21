import { type PrismaClient, type Prisma } from '@voltex/database';
import { INTERNAL_TEST_RULE_MARK, isInternalTestRule } from '@voltex/shared';

/** Quem consta como revisor das regras de teste interno: deixa claro que NÃO é revisão de engenheiro. */
export const INTERNAL_TEST_REVIEWER =
  'TESTE INTERNO (valores de exemplo, sem revisão de engenheiro)';
export const INTERNAL_TEST_REGISTRATION = 'SEM REGISTRO (teste interno)';

const SOURCE = {
  type: 'INTERNAL_POLICY' as const,
  reference: `${INTERNAL_TEST_RULE_MARK}: valores de exemplo para testes internos e demonstração`,
  notes:
    'Não são norma, não foram revisados por engenheiro e não valem para proposta, projeto ou obra reais. Substitua por uma regra revisada pelo responsável técnico.',
};

export interface InternalTestRule {
  key: 'engine.design' | 'engine.cables' | 'engine.connection' | 'engine.economics';
  definition: Record<string, unknown>;
  sources: (typeof SOURCE)[];
  notes: string;
}

/** Valores de TESTE. Não são regra de nenhuma norma. */
export const INTERNAL_TEST_RULES: InternalTestRule[] = [
  {
    key: 'engine.design',
    definition: {
      parameters: {
        hotCellIrradianceWm2: 1000,
        dcAcRatioMin: 0.8,
        dcAcRatioMax: 1.5,
        maxParallelStringsWithoutFuse: 2,
        fuseMinFactor: 1.25,
        dcSwitchCurrentFactor: 1.25,
        acBreakerFactor: 1.25,
        rcdSensitivityMa: 30,
      },
    },
  },
  {
    key: 'engine.cables',
    definition: {
      parameters: {
        conductorTempC: 70,
        maxVoltageDropDcPct: 1,
        maxVoltageDropAcPct: 3,
        cableCurrentFactorDc: 1.25,
        cableCurrentFactorAc: 1,
      },
      tables: {
        // Capacidades de condução de EXEMPLO (não vêm da NBR 16612 nem da NBR 5410).
        ampacity: [
          { crossSectionMm2: 2.5, method: 'A', ampacityA: 30 },
          { crossSectionMm2: 4, method: 'A', ampacityA: 40 },
          { crossSectionMm2: 6, method: 'A', ampacityA: 52 },
          { crossSectionMm2: 10, method: 'A', ampacityA: 72 },
          { crossSectionMm2: 16, method: 'A', ampacityA: 96 },
          { crossSectionMm2: 25, method: 'A', ampacityA: 127 },
        ],
      },
    },
  },
  {
    key: 'engine.connection',
    definition: {
      rules: [
        {
          id: 'potencia-acima-da-disponibilizada',
          when: { field: 'plant.acKw', op: '>', valueFrom: 'connection.availableKw' },
          then: {
            severity: 'BLOCKING',
            code: 'CONN_POWER_ABOVE_AVAILABLE',
            message: 'A potência CA excede a disponibilizada (regra de teste interno).',
            source: `${INTERNAL_TEST_RULE_MARK}: regra de exemplo`,
          },
        },
      ],
    },
  },
  {
    key: 'engine.economics',
    definition: { parameters: { compensationFactor: 1 } },
  },
].map((rule) => ({
  ...rule,
  sources: [SOURCE],
  notes: 'TESTE INTERNO: valores de exemplo; não usar em obra.',
})) as InternalTestRule[];

/**
 * Cria e ativa as regras de teste interno de uma empresa. Nunca sobrescreve uma regra ativa (própria ou de teste).
 * Devolve uma linha de resumo por chave.
 */
export async function seedInternalTestRules(
  prisma: PrismaClient,
  tenantId: string,
): Promise<string[]> {
  const report: string[] = [];
  for (const rule of INTERNAL_TEST_RULES) {
    const active = await prisma.ruleSet.findFirst({
      where: { tenantId, key: rule.key, scopeKey: '', status: 'ACTIVE' },
    });
    if (active) {
      report.push(
        `${rule.key}: já há regra ativa (v${active.version}${isInternalTestRule(active) ? ', de teste interno' : ', revisada'}); nada foi alterado.`,
      );
      continue;
    }
    const last = await prisma.ruleSet.findFirst({
      where: { tenantId, key: rule.key },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const now = new Date();
    const created = await prisma.$transaction(async (tx) => {
      const draft = await tx.ruleSet.create({
        data: {
          tenantId,
          key: rule.key,
          version: (last?.version ?? 0) + 1,
          status: 'DRAFT',
          scopeKey: '',
          definition: rule.definition as Prisma.InputJsonValue,
          sources: rule.sources as unknown as Prisma.InputJsonValue,
          notes: rule.notes,
        },
      });
      return tx.ruleSet.update({
        where: { id: draft.id },
        data: {
          status: 'ACTIVE',
          validFrom: now,
          reviewedBy: INTERNAL_TEST_REVIEWER,
          reviewedByRegistration: INTERNAL_TEST_REGISTRATION,
          reviewedAt: now,
        },
      });
    });
    report.push(`${rule.key}: v${created.version} ativada como TESTE INTERNO.`);
  }
  return report;
}
