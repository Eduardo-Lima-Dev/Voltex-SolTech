/**
 * Popula dados de teste para a Fase 11E (pós-venda).
 *
 *   TENANT_SLUG=sol-do-nordeste node dist/cli/seed-aftersales-test-data.js
 *
 * Cria:
 * - Termos de garantia de exemplo por fabricante
 * - Configurações de O&M (prazos, SLA, gatilhos)
 * - Marca tudo como TESTE INTERNO; dados reais vêm do usuário
 */
import { createPrismaClient } from '@voltex/database';

export const INTERNAL_TEST_MARK = 'TESTE INTERNO (dados de exemplo)';

interface WarrantyTermData {
  manufacturer: string;
  category: 'INVERTER' | 'BATTERY' | 'COMBINER' | 'BREAKER' | 'SENSOR' | 'STRUCTURE';
  productYears: number;
  performanceYears: number;
  performanceEndPct: number;
  conditions: string;
}

const WARRANTY_TERMS: WarrantyTermData[] = [
  {
    manufacturer: 'SMA',
    category: 'INVERTER',
    productYears: 5,
    performanceYears: 25,
    performanceEndPct: 80,
    conditions:
      'Coberta operação normal conforme manual. Não cobre danos por sobretensão ou força maior.',
  },
  {
    manufacturer: 'Fronius',
    category: 'INVERTER',
    productYears: 10,
    performanceYears: 25,
    performanceEndPct: 80,
    conditions: 'Cobertura de materiais e mão de obra. Peças de desgaste excluídas.',
  },
  {
    manufacturer: 'Huawei',
    category: 'INVERTER',
    productYears: 5,
    performanceYears: 25,
    performanceEndPct: 80,
    conditions: 'Garantia de fábrica com suporte técnico incluído.',
  },
  {
    manufacturer: 'Growatt',
    category: 'INVERTER',
    productYears: 5,
    performanceYears: 25,
    performanceEndPct: 85,
    conditions: 'Válida com registro em 30 dias da instalação.',
  },
  {
    manufacturer: 'Sungrow',
    category: 'INVERTER',
    productYears: 10,
    performanceYears: 25,
    performanceEndPct: 80,
    conditions: 'Cobertura internacional com suporte via iSolarCloud.',
  },
  {
    manufacturer: 'JinkoSolar',
    category: 'STRUCTURE',
    productYears: 12,
    performanceYears: 30,
    performanceEndPct: 80,
    conditions: 'Cobertura de degradação anormal. Defeitos de manufatura inclusos.',
  },
];

async function seedWarrantyTerms(prisma: any, tenantId: string): Promise<string[]> {
  const report: string[] = [];
  const now = new Date();

  for (const termData of WARRANTY_TERMS) {
    const key = `${termData.manufacturer}-${termData.category}`;

    const existing = await prisma.manufacturerWarrantyTerm.findFirst({
      where: {
        tenantId,
        manufacturer: { equals: termData.manufacturer, mode: 'insensitive' },
        category: termData.category,
        supersededAt: null,
      },
    });

    if (existing) {
      report.push(`${key}: termo já existe (v${existing.version}); nada foi alterado.`);
      continue;
    }

    const created = await prisma.$transaction(async (tx: any) => {
      // Aposentar anteriores do mesmo fabricante e categoria
      await tx.manufacturerWarrantyTerm.updateMany({
        where: {
          tenantId,
          manufacturer: { equals: termData.manufacturer, mode: 'insensitive' },
          category: termData.category,
          supersededAt: null,
        },
        data: { supersededAt: now },
      });

      return tx.manufacturerWarrantyTerm.create({
        data: {
          tenantId,
          manufacturer: termData.manufacturer,
          category: termData.category,
          productYears: termData.productYears,
          performanceYears: termData.performanceYears,
          performanceEndPct: termData.performanceEndPct,
          conditions: termData.conditions,
          documentId: null,
          source: `${INTERNAL_TEST_MARK}; ajuste com PDF do fabricante`,
          reviewedBy: `${INTERNAL_TEST_MARK}: dados de exemplo, sem validação`,
          validFrom: now,
        },
      });
    });

    report.push(`${key}: criado como TESTE INTERNO.`);
  }

  return report;
}

async function seedOperationsSettings(prisma: any, tenantId: string): Promise<string[]> {
  const report: string[] = [];

  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { settings: true },
  });

  const settings = {
    ...((tenant.settings as Record<string, unknown> | null) ?? {}),
    operations: {
      warrantyAlertDays: 90,
      renewalNoticeDays: 30,
      maintenanceLeadDays: 7,
      slaHours: {
        URGENT: 4,
        HIGH: 8,
        NORMAL: 48,
        LOW: 120,
      },
      upsellGridKwh: 50,
      upsellMinBills: 3,
    },
  };

  await prisma.tenant.update({
    where: { id: tenantId },
    data: { settings: settings as object },
  });

  report.push('Configurações de O&M: prazos, SLA e gatilhos de exemplo criados.');

  return report;
}

async function main(): Promise<void> {
  const slug = process.env.TENANT_SLUG?.trim();
  if (!slug) throw new Error('Defina TENANT_SLUG (identificador da empresa).');

  const prisma = createPrismaClient();
  try {
    const tenant = await prisma.tenant.findUnique({ where: { slug } });
    if (!tenant) throw new Error(`Empresa "${slug}" não encontrada.`);

    const lines: string[] = [];

    console.log('Populando dados de teste da Fase 11E (pós-venda)...\n');

    const warrantyLines = await seedWarrantyTerms(prisma, tenant.id);
    lines.push(...warrantyLines);

    const settingsLines = await seedOperationsSettings(prisma, tenant.id);
    lines.push(...settingsLines);

    for (const line of lines) console.log(`  ${line}`);

    console.log('\n✓ Dados de teste populados.');
    console.log('\nPróximas pendências:');
    console.log('  1. Substituir termos de exemplo pelos PDFs reais dos fabricantes');
    console.log('  2. Ajustar prazos (warrantyAlertDays, renewalNoticeDays, maintenanceLeadDays)');
    console.log('  3. Revisar SLA por prioridade (slaHours)');
    console.log('  4. Validar gatilho de expansão (upsellGridKwh, upsellMinBills)');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
