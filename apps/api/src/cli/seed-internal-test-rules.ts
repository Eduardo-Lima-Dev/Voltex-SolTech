/**
 * Cria e ATIVA, para uma empresa, as regras do Engine como TESTE INTERNO (valores de exemplo).
 *
 *   TENANT_SLUG=sol-do-nordeste node dist/cli/seed-internal-test-rules.js
 *
 * Serve para testar e demonstrar o fluxo. As regras levam a marca "TESTE INTERNO" nas fontes, no revisor e no
 * registro; o sistema avisa na tela, no memorial, no relatório do cliente e no snapshot. Não são norma e não foram
 * revisadas por engenheiro. NUNCA sobrescreve uma regra já ativa (própria ou de teste): se a chave já tem regra
 * ativa, pula. Para trocar por uma regra revisada, importe e ative a nova versão pela tela de Regras.
 */
import { createPrismaClient } from '@voltex/database';
import { seedInternalTestRules } from './internal-test-rules.js';

async function main(): Promise<void> {
  const slug = process.env.TENANT_SLUG?.trim();
  if (!slug) throw new Error('Defina TENANT_SLUG (identificador da empresa).');
  const prisma = createPrismaClient();
  try {
    const tenant = await prisma.tenant.findUnique({ where: { slug } });
    if (!tenant) throw new Error(`Empresa "${slug}" não encontrada.`);
    for (const line of await seedInternalTestRules(prisma, tenant.id)) console.log(line);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
