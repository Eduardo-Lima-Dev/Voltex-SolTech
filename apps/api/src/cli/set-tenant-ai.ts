/**
 * Configura a IA de uma empresa (Fase 12, ADR-0029): marca como demonstração, liga/desliga e define as cotas diárias.
 *
 *   TENANT_SLUG=voltex-demo DEMO=true ENABLED=true node dist/cli/set-tenant-ai.js
 *   TENANT_SLUG=sol-do-nordeste AI_DAILY=1500 AI_PER_USER=300 AI_INSIGHTS=150 node dist/cli/set-tenant-ai.js
 *
 * - `DEMO=true`: empresa de dados fictícios, que pode usar a IA antes do parecer jurídico (`AI_LEGAL_REVIEWED_AT`).
 * - `ENABLED=true|false`: liga ou desliga a IA (registra "CLI" como quem aceitou os termos). Pela tela, quem liga é o
 *   administrador da empresa, que aceita os termos.
 * - Cotas em *neurons* por dia. A soma das cotas das empresas com IA ligada não pode passar do teto da plataforma
 *   (`AI_DAILY_NEURONS_GLOBAL`, padrão 9.000): a cota grátis do provedor é de toda a conta, não de cada empresa.
 */
import { createPrismaClient } from '@voltex/database';
import { tenantPlanSchema } from '@voltex/shared';

const bool = (v: string | undefined): boolean | undefined =>
  v === undefined || v === '' ? undefined : v.toLowerCase() === 'true';
const int = (name: string): number | undefined => {
  const raw = process.env[name]?.trim();
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0)
    throw new Error(`${name} deve ser um inteiro maior ou igual a zero.`);
  return n;
};

async function main(): Promise<void> {
  const slug = process.env.TENANT_SLUG?.trim();
  if (!slug) throw new Error('Defina TENANT_SLUG (identificador da empresa).');
  const demo = bool(process.env.DEMO);
  const enabled = bool(process.env.ENABLED);
  const daily = int('AI_DAILY');
  const perUser = int('AI_PER_USER');
  const insights = int('AI_INSIGHTS');
  const global = Number(process.env.AI_DAILY_NEURONS_GLOBAL ?? 9000);
  const defaultTenant = Number(process.env.AI_DEFAULT_TENANT_DAILY_NEURONS ?? 1500);

  const prisma = createPrismaClient();
  try {
    const tenant = await prisma.tenant.findUnique({ where: { slug } });
    if (!tenant) throw new Error(`Empresa "${slug}" não encontrada.`);
    const settings = { ...((tenant.settings as Record<string, unknown> | null) ?? {}) };
    if (demo !== undefined) settings.demo = demo;
    if (enabled !== undefined) {
      const previous = (settings.ai as Record<string, unknown> | undefined) ?? {};
      settings.ai = enabled
        ? {
            enabled: true,
            termsAcceptedBy: 'CLI (operador da plataforma)',
            termsAcceptedAt: new Date().toISOString(),
          }
        : { ...previous, enabled: false };
    }
    if (daily !== undefined || perUser !== undefined || insights !== undefined) {
      const current = tenantPlanSchema.safeParse(settings.plan);
      const plan = current.success ? current.data : { name: 'Padrão', features: {}, limits: {} };
      settings.plan = {
        ...plan,
        limits: {
          ...plan.limits,
          ...(daily !== undefined ? { aiDailyNeurons: daily } : {}),
          ...(perUser !== undefined ? { aiDailyNeuronsPerUser: perUser } : {}),
          ...(insights !== undefined ? { aiInsightsDailyNeurons: insights } : {}),
        },
      };
    }

    // A soma das cotas das empresas com IA ligada precisa caber no teto da plataforma.
    const others = await prisma.tenant.findMany({ where: { id: { not: tenant.id } } });
    const quotaOf = (s: unknown): number => {
      const st = (s ?? {}) as Record<string, unknown>;
      if ((st.ai as { enabled?: boolean } | undefined)?.enabled !== true) return 0;
      const plan = tenantPlanSchema.safeParse(st.plan);
      return plan.success ? (plan.data.limits.aiDailyNeurons ?? defaultTenant) : defaultTenant;
    };
    const total = others.reduce((acc, o) => acc + quotaOf(o.settings), 0) + quotaOf(settings);
    if (total > global)
      throw new Error(
        `A soma das cotas diárias das empresas com IA (${total} neurons) passa do teto da plataforma (${global}). ` +
          `Diminua alguma cota ou desligue uma empresa. Nada foi alterado.`,
      );

    await prisma.tenant.update({
      where: { id: tenant.id },
      data: { settings: settings as object },
    });
    console.log(
      `IA de "${slug}": demonstração=${settings.demo === true}, ligada=${(settings.ai as { enabled?: boolean } | undefined)?.enabled === true}. ` +
        `Soma das cotas das empresas ligadas: ${total}/${global} neurons por dia.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
