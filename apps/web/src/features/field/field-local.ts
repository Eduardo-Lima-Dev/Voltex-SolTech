import type {
  CommissioningTestDto,
  FieldActionInput,
  FieldCommissioningDto,
  FieldWorkOrderDto,
} from '@voltex/shared';
import { evaluateTest } from '@voltex/solar-engine';

/**
 * Prévia do julgamento de um ensaio no aparelho, com a mesma função do servidor (a tolerância vem da regra, junto
 * com o ensaio). O servidor refaz o julgamento ao receber; esta prévia só mostra o resultado esperado na hora.
 */
export function previewTest(
  test: CommissioningTestDto,
  recordConditions: FieldCommissioningDto['conditions'],
): CommissioningTestDto {
  const evaluation = evaluateTest(
    {
      kind: test.kind,
      expected: test.expectedKind,
      tolerancePct: test.tolerancePct,
      min: test.min,
      max: test.max,
      electrical: test.electrical,
      unit: test.unit,
    },
    { value: test.measuredValue, passed: test.passed },
    { ...recordConditions, ...(test.conditions ?? {}) },
  );
  return {
    ...test,
    result: evaluation.result,
    expectedValue: evaluation.expectedValue,
    deviationPct: evaluation.deviationPct,
    basis: evaluation.basis,
    reason: evaluation.reason,
  };
}

/**
 * Aplica uma ação à cópia local da ordem, como o servidor fará quando ela chegar. Assim o técnico vê o resultado na
 * hora, mesmo sem internet. Quando o servidor responde, a cópia é refeita a partir dele (ver `rebase`).
 */
export function applyLocal(order: FieldWorkOrderDto, action: FieldActionInput): FieldWorkOrderDto {
  switch (action.type) {
    case 'START':
      return order.status === 'IN_PROGRESS' || order.status === 'DONE'
        ? order
        : { ...order, status: 'IN_PROGRESS', startedAt: action.capturedAt };
    case 'COMPLETE':
      return {
        ...order,
        status: 'DONE',
        completedAt: action.capturedAt,
        notes: action.notes ?? order.notes,
      };
    case 'CHECK':
      return {
        ...order,
        checklist: order.checklist.map((item) =>
          item.id === action.itemId
            ? {
                ...item,
                done: action.done,
                note: action.note ?? item.note,
                doneAt: action.done ? action.capturedAt : null,
              }
            : item,
        ),
      };
    case 'NOTE': {
      const line = `[${new Date(action.capturedAt).toLocaleString('pt-BR')}] ${action.text}`;
      return { ...order, notes: order.notes ? `${order.notes}\n${line}` : line };
    }
    case 'MEASURE': {
      const commissioning = order.commissioning;
      if (!commissioning) return order;
      return {
        ...order,
        commissioning: {
          ...commissioning,
          tests: commissioning.tests.map((test) => {
            if (test.id !== action.testId) return test;
            const touches = action.value !== undefined || action.passed !== undefined;
            const own =
              action.irradianceWm2 !== undefined || action.moduleTempC !== undefined
                ? {
                    ...(test.conditions ?? {}),
                    ...(action.irradianceWm2 !== undefined
                      ? { irradianceWm2: action.irradianceWm2 }
                      : {}),
                    ...(action.moduleTempC !== undefined
                      ? { moduleTempC: action.moduleTempC }
                      : {}),
                  }
                : test.conditions;
            const next: CommissioningTestDto = {
              ...test,
              conditions: own,
              measuredValue: action.value === undefined ? test.measuredValue : action.value,
              passed: action.passed === undefined ? test.passed : action.passed,
              note: action.note ?? test.note,
            };
            return touches || own !== test.conditions
              ? previewTest(next, commissioning.conditions)
              : next;
          }),
        },
      };
    }
    case 'CONDITIONS': {
      const commissioning = order.commissioning;
      if (!commissioning) return order;
      const conditions = {
        ...commissioning.conditions,
        ...Object.fromEntries(
          Object.entries(action.conditions).filter(([, v]) => v !== null && v !== undefined),
        ),
      };
      return {
        ...order,
        commissioning: {
          ...commissioning,
          conditions,
          tests: commissioning.tests.map((t) =>
            t.kind === 'MEASURE' && t.measuredValue !== null ? previewTest(t, conditions) : t,
          ),
        },
      };
    }
    case 'ISSUE':
      return {
        ...order,
        openIssues: [
          ...order.openIssues,
          {
            id: `local-${action.clientActionId}`,
            installationId: order.installationId ?? '',
            workOrderId: order.id,
            type: action.issueType,
            description: action.description,
            blocking: action.blocking,
            status: 'OPEN',
            resolution: null,
            reportedById: null,
            resolvedById: null,
            resolvedAt: null,
            createdAt: action.capturedAt,
          },
        ],
      };
  }
}

/** Refaz a cópia local: a versão do servidor com as ações ainda não enviadas por cima, na ordem em que ocorreram. */
export function rebase(
  server: FieldWorkOrderDto,
  pending: readonly FieldActionInput[],
): FieldWorkOrderDto {
  return [...pending]
    .filter((a) => a.workOrderId === server.id)
    .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
    .reduce(applyLocal, server);
}
