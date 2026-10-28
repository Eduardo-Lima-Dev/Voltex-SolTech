/**
 * Carteira por responsável (Fase 12.0, ADR-0028). Regras puras, testáveis sem banco.
 *
 * Vendedor (`SALESPERSON`) só enxerga o que é da própria carteira; SDR enxerga os leads e as contas dele e os sem
 * responsável (para poder distribuir). Os demais perfis (gestão, administração, engenharia, operação…) não mudam.
 *
 * O filtro entra na extensão do Prisma (`prisma.db`), depois do filtro de tenant, para valer em TODA consulta,
 * inclusive as que um serviço esquecer: leitura, contagem, agregação e também alteração e exclusão. O trabalho
 * feito sem usuário (filas, eventos) não tem perfil no contexto e, portanto, não é restrito.
 */

export type RestrictedRole = 'SALESPERSON' | 'SDR';

export const OWNERSHIP_RESTRICTED_ROLES: readonly string[] = ['SALESPERSON', 'SDR'];

export const isOwnershipRestricted = (role: string | undefined): role is RestrictedRole =>
  !!role && OWNERSHIP_RESTRICTED_ROLES.includes(role);

type Where = Record<string, unknown>;

/** Contas visíveis ao vendedor: as dele ou as que têm alguma oportunidade dele. */
const sellerAccounts = (userId: string): Where => ({
  OR: [{ ownerId: userId }, { opportunities: { some: { ownerId: userId } } }],
});

/** Contas visíveis ao SDR: as dele e as sem responsável. */
const sdrAccounts = (userId: string): Where => ({ OR: [{ ownerId: userId }, { ownerId: null }] });

const sellerOpportunity = (userId: string): Where => ({ opportunity: { ownerId: userId } });

const sellerProject = (userId: string): Where => ({
  OR: [{ responsibleId: userId }, { opportunity: { ownerId: userId } }],
});

/** Cálculo feito por ele, ou ligado a uma oportunidade dele (mesmo que outra pessoa o tenha feito). */
const sellerSession = (userId: string): Where => ({
  OR: [{ createdById: userId }, { opportunity: { ownerId: userId } }],
});

const sellerBill = (userId: string): Where => ({
  OR: [{ createdById: userId }, { opportunity: { ownerId: userId } }],
});

/** Modelos filtrados pelo vendedor, só para a conferência de cobertura nos testes. */
export const SELLER_SCOPED_MODELS = [
  'Lead',
  'Opportunity',
  'Account',
  'Contact',
  'Site',
  'ConsumerUnit',
  'Task',
  'TimelineEvent',
  'EnergyBill',
  'EnergyBillSnapshot',
  'TriageSnapshot',
  'TriageOverride',
  'ApprovalRequest',
  'Quote',
  'Proposal',
  'ProposalSnapshot',
  'Contract',
  'EngineeringRequest',
  'Project',
  'ProjectChecklistItem',
  'Receivable',
  'ProjectCostEntry',
  'CreditApplication',
  'Commission',
  'PortalAccess',
  'CalculationSession',
  'QuickCalculationSnapshot',
] as const;

/** Filtro do Prisma a juntar (AND) em toda consulta do modelo, ou `null` se o modelo/perfil não é restrito. */
export function ownershipWhere(model: string, role: string, userId: string): Where | null {
  if (role === 'SALESPERSON') {
    switch (model) {
      case 'Lead':
        return { ownerId: userId };
      case 'Opportunity':
        return { ownerId: userId };
      case 'Account':
        return sellerAccounts(userId);
      case 'Contact':
      case 'Site':
      case 'ConsumerUnit':
      case 'PortalAccess':
        return { account: sellerAccounts(userId) };
      case 'Task':
        return {
          OR: [
            { assigneeId: userId },
            { createdById: userId },
            { opportunity: { ownerId: userId } },
          ],
        };
      case 'TimelineEvent':
      case 'TriageSnapshot':
      case 'ApprovalRequest':
      case 'Quote':
      case 'Proposal':
      case 'Contract':
      case 'EngineeringRequest':
        return sellerOpportunity(userId);
      case 'TriageOverride':
        return { evaluation: sellerOpportunity(userId) };
      case 'ProposalSnapshot':
        return { proposal: sellerOpportunity(userId) };
      case 'EnergyBill':
        return sellerBill(userId);
      case 'EnergyBillSnapshot':
        return { bill: sellerBill(userId) };
      case 'Project':
        return sellerProject(userId);
      case 'ProjectChecklistItem':
      case 'Receivable':
      case 'ProjectCostEntry':
      case 'CreditApplication':
        return { project: sellerProject(userId) };
      case 'Commission':
        return { userId };
      case 'CalculationSession':
        return sellerSession(userId);
      case 'QuickCalculationSnapshot':
        return { session: sellerSession(userId) };
      default:
        return null;
    }
  }
  if (role === 'SDR') {
    switch (model) {
      case 'Lead':
        return { OR: [{ ownerId: userId }, { ownerId: null }] };
      case 'Account':
        return sdrAccounts(userId);
      case 'Contact':
      case 'Site':
      case 'ConsumerUnit':
        return { account: sdrAccounts(userId) };
      case 'Task':
        return { OR: [{ assigneeId: userId }, { createdById: userId }] };
      case 'CalculationSession':
        return { createdById: userId };
      case 'QuickCalculationSnapshot':
        return { session: { createdById: userId } };
      default:
        return null;
    }
  }
  return null;
}

const FILTERED_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
]);

/** Junta o filtro da carteira ao `where` da operação. Criação e `upsert` não mudam. */
export function applyOwnership(
  model: string,
  operation: string,
  args: Record<string, unknown> | undefined,
  subject: { role: string | undefined; userId: string | undefined },
): Record<string, unknown> | undefined {
  if (!subject.role || !subject.userId || !isOwnershipRestricted(subject.role)) return args;
  if (!FILTERED_OPERATIONS.has(operation)) return args;
  const filter = ownershipWhere(model, subject.role, subject.userId);
  if (!filter) return args;
  const input = args ?? {};
  const current = (input.where ?? {}) as Record<string, unknown>;
  const existing = current.AND;
  const and = Array.isArray(existing) ? existing : existing ? [existing] : [];
  return { ...input, where: { ...current, AND: [...and, filter] } };
}
