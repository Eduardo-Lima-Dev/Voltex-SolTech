import type { FieldActionInput, FieldWorkOrderDto } from '@voltex/shared';

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
