/**
 * Protege os CPF/CNPJ que ainda estão em texto (dados anteriores à criptografia): cifra `document` e troca
 * `documentNormalized` pelo índice cego. Idempotente (o que já está protegido é ignorado) e seguro para repetir.
 *
 *   docker compose -f docker/compose.prod.yml run --rm api node dist/cli/encrypt-documents.js
 *
 * Use a MESMA `DATA_ENCRYPTION_KEY` da API. Faça backup do banco antes.
 */
import { createPrismaClient } from '@voltex/database';
import { DEV_DATA_ENCRYPTION_KEY } from '../config/env';
import {
  blindIndex,
  deriveTenantKeys,
  encryptField,
  isBlindIndex,
  isEncrypted,
  parseMasterKey,
} from '../platform/crypto/field-crypto';

async function main(): Promise<void> {
  const master = parseMasterKey(process.env.DATA_ENCRYPTION_KEY ?? DEV_DATA_ENCRYPTION_KEY);
  const prisma = createPrismaClient();
  const counts = { accounts: 0, leads: 0, proposals: 0 };
  try {
    const keysOf = new Map<string, ReturnType<typeof deriveTenantKeys>>();
    const keys = (tenantId: string) => {
      let k = keysOf.get(tenantId);
      if (!k) keysOf.set(tenantId, (k = deriveTenantKeys(master, tenantId)));
      return k;
    };
    const protect = (tenantId: string, document: string | null, normalized: string | null) => ({
      document:
        document && !isEncrypted(document) ? encryptField(document, keys(tenantId)) : document,
      // O normalizado sempre sai do documento em claro: dígitos.
      documentNormalized:
        normalized && !isBlindIndex(normalized)
          ? blindIndex(normalized, keys(tenantId))
          : normalized,
    });

    for (const model of ['account', 'lead'] as const) {
      const rows = await (prisma[model] as typeof prisma.account).findMany({
        where: { OR: [{ document: { not: null } }, { documentNormalized: { not: null } }] },
        select: { id: true, tenantId: true, document: true, documentNormalized: true },
      });
      for (const row of rows) {
        const next = protect(row.tenantId, row.document, row.documentNormalized);
        if (next.document === row.document && next.documentNormalized === row.documentNormalized)
          continue;
        await (prisma[model] as typeof prisma.account).update({
          where: { id: row.id },
          data: next,
        });
        counts[model === 'account' ? 'accounts' : 'leads'] += 1;
      }
    }
    const proposals = await prisma.proposal.findMany({
      where: { acceptedByDocument: { not: null } },
      select: { id: true, tenantId: true, acceptedByDocument: true },
    });
    for (const row of proposals) {
      if (!row.acceptedByDocument || isEncrypted(row.acceptedByDocument)) continue;
      await prisma.proposal.update({
        where: { id: row.id },
        data: { acceptedByDocument: encryptField(row.acceptedByDocument, keys(row.tenantId)) },
      });
      counts.proposals += 1;
    }
    console.log(
      `Protegidos: ${counts.accounts} conta(s), ${counts.leads} lead(s), ${counts.proposals} aceite(s) de proposta.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
