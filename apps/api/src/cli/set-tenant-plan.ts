/**
 * Define (ou remove) o plano de uma empresa: recursos ligados/desligados e limites (RF-PLAT-013).
 *
 *   TENANT_SLUG=sol-do-nordeste PLAN='{"name":"Básico","features":{"monitoring":false},"limits":{"users":10}}' \
 *     node dist/cli/set-tenant-plan.js
 *   TENANT_SLUG=sol-do-nordeste PLAN=none node dist/cli/set-tenant-plan.js   # sem plano: tudo liberado
 *
 * O plano é do operador da plataforma: a empresa não o altera pela API (o PATCH da empresa preserva `settings.plan`).
 */
import { createPrismaClient } from '@voltex/database';
import { tenantPlanSchema } from '@voltex/shared';

async function main(): Promise<void> {
  const slug = process.env.TENANT_SLUG?.trim();
  const rawPlan = process.env.PLAN?.trim();
  if (!slug) throw new Error('Defina TENANT_SLUG (identificador da empresa).');
  if (!rawPlan) throw new Error('Defina PLAN (JSON do plano) ou PLAN=none para remover.');
  const prisma = createPrismaClient();
  try {
    const tenant = await prisma.tenant.findUnique({ where: { slug } });
    if (!tenant) throw new Error(`Empresa "${slug}" não encontrada.`);
    const settings = { ...((tenant.settings as Record<string, unknown> | null) ?? {}) };
    if (rawPlan === 'none') {
      delete settings.plan;
      console.log(`Plano de "${slug}" removido: tudo liberado e sem limites.`);
    } else {
      const parsed = tenantPlanSchema.safeParse(JSON.parse(rawPlan));
      if (!parsed.success)
        throw new Error(`Plano inválido: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
      settings.plan = parsed.data;
      console.log(`Plano "${parsed.data.name}" definido para "${slug}".`);
    }
    await prisma.tenant.update({
      where: { id: tenant.id },
      data: { settings: settings as object },
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
