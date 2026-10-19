import type { PrismaClient } from '@voltex/database';
import { normalizeDocument } from '@voltex/shared';
import {
  blindIndex,
  decryptField,
  encryptField,
  isEncrypted,
  isEncryptedWithCurrent,
  type Keyring,
} from '../platform/crypto/field-crypto';

export interface ReprotectResult {
  accounts: number;
  leads: number;
  proposals: number;
  contracts: number;
}

const needsWork = (value: string | null, ring: Keyring): boolean =>
  value !== null && (!isEncrypted(value) || !isEncryptedWithCurrent(value, ring));

/**
 * Protege (texto → cifrado) e recifra (chave antiga → chave atual) todos os dados pessoais, e refaz os índices cegos
 * com a chave atual. Idempotente: o que já está com a chave atual é ignorado. Usado na primeira proteção dos dados e
 * no rodízio de chave. Roda com o cliente de SISTEMA (sem filtro de tenant): passa o `tenantId` de cada linha.
 */
export async function reprotectAll(prisma: PrismaClient, ring: Keyring): Promise<ReprotectResult> {
  const result: ReprotectResult = { accounts: 0, leads: 0, proposals: 0, contracts: 0 };

  for (const model of ['account', 'lead'] as const) {
    const delegate = prisma[model] as typeof prisma.account;
    const rows = await delegate.findMany({
      where: { OR: [{ document: { not: null } }, { documentNormalized: { not: null } }] },
      select: { id: true, tenantId: true, document: true, documentNormalized: true },
    });
    for (const row of rows) {
      const plain = row.document ? decryptField(row.document, ring, row.tenantId) : null;
      const digits = normalizeDocument(plain);
      const nextIndex = digits ? blindIndex(digits, ring, row.tenantId) : row.documentNormalized;
      const documentStale = needsWork(row.document, ring);
      const indexStale = !!digits && row.documentNormalized !== nextIndex;
      if (!documentStale && !indexStale) continue;
      await delegate.update({
        where: { id: row.id },
        data: {
          document: plain ? encryptField(plain, ring, row.tenantId) : row.document,
          documentNormalized: nextIndex,
        },
      });
      result[model === 'account' ? 'accounts' : 'leads'] += 1;
    }
  }

  const proposals = await prisma.proposal.findMany({
    where: { acceptedByDocument: { not: null } },
    select: { id: true, tenantId: true, acceptedByDocument: true },
  });
  for (const row of proposals) {
    if (!needsWork(row.acceptedByDocument, ring) || !row.acceptedByDocument) continue;
    const plain = decryptField(row.acceptedByDocument, ring, row.tenantId);
    await prisma.proposal.update({
      where: { id: row.id },
      data: { acceptedByDocument: encryptField(plain, ring, row.tenantId) },
    });
    result.proposals += 1;
  }

  const contracts = await prisma.contract.findMany({
    select: { id: true, tenantId: true, body: true, variables: true },
  });
  for (const row of contracts) {
    const variablesText = typeof row.variables === 'string' ? row.variables : null;
    const stale =
      needsWork(row.body, ring) || variablesText === null || needsWork(variablesText, ring);
    if (!stale) continue;
    const body = encryptField(decryptField(row.body, ring, row.tenantId), ring, row.tenantId);
    const plainVariables =
      variablesText !== null
        ? decryptField(variablesText, ring, row.tenantId)
        : JSON.stringify(row.variables);
    // Contratos são imutáveis por gatilho; este é o único caminho de manutenção permitido, e só mexe no corpo e nas variáveis.
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('voltex.reencrypt', 'on', true)`;
      await tx.contract.update({
        where: { id: row.id },
        data: { body, variables: encryptField(plainVariables, ring, row.tenantId) },
      });
    });
    result.contracts += 1;
  }
  return result;
}
