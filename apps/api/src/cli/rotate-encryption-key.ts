/**
 * Protege os dados pessoais em texto e faz o RODÍZIO da chave de criptografia.
 *
 * Rodízio, passo a passo (sem parar o sistema):
 *   1. Gere a chave nova:  openssl rand -base64 32
 *   2. Configure:  DATA_ENCRYPTION_KEY=<nova>  e  DATA_ENCRYPTION_KEY_PREVIOUS=<a que estava em uso>
 *      (várias anteriores, separadas por vírgula). Reinicie a API: ela já grava com a nova e lê as duas.
 *   3. Rode:  docker compose -f docker/compose.prod.yml run --rm api node dist/cli/rotate-encryption-key.js
 *   4. Quando disser "0" em tudo na segunda execução, nenhum dado usa a chave antiga: ela pode sair de
 *      DATA_ENCRYPTION_KEY_PREVIOUS. Guarde a antiga em cofre por mais um tempo, junto dos backups que dependem dela.
 *
 * Serve também para proteger dados antigos que estejam em texto (primeira execução depois de ligar a criptografia).
 * Idempotente. Faça backup do banco antes.
 */
import { createPrismaClient } from '@voltex/database';
import { DEV_DATA_ENCRYPTION_KEY } from '../config/env';
import { createKeyring } from '../platform/crypto/field-crypto';
import { reprotectAll } from './reprotect';

async function main(): Promise<void> {
  const ring = createKeyring(
    process.env.DATA_ENCRYPTION_KEY ?? DEV_DATA_ENCRYPTION_KEY,
    process.env.DATA_ENCRYPTION_KEY_PREVIOUS ?? '',
  );
  const prisma = createPrismaClient();
  try {
    console.log(`Chave atual: ${ring.current.id} (conhecidas: ${[...ring.all.keys()].join(', ')})`);
    const r = await reprotectAll(prisma, ring);
    console.log(
      `Atualizados com a chave atual: ${r.accounts} conta(s), ${r.leads} lead(s), ${r.proposals} aceite(s), ${r.contracts} contrato(s).`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
