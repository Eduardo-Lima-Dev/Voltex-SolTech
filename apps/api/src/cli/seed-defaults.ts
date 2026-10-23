import { PrismaClient } from '@voltex/database';

const prisma = new PrismaClient();

/**
 * Seed de configurações padrão (exemplo).
 * Cria: termos de garantia, regra de comissionamento, política de comissão, lead scoring.
 */

async function main() {
  // Pega tenant de teste (criar um se não existir)
  let tenant = await prisma.system.tenant.findFirst();

  if (!tenant) {
    tenant = await prisma.system.tenant.create({
      data: {
        name: 'Empresa Exemplo',
        slug: 'empresa-exemplo',
      },
    });
    console.log(`✓ Tenant criado: ${tenant.id}`);
  }

  // 1. Termos de garantia por fabricante
  const manufacturers = [
    { name: 'SMA', productYears: 10, performanceYears: 25, performanceEndPct: 80 },
    { name: 'Fronius', productYears: 12, performanceYears: 25, performanceEndPct: 80 },
    { name: 'Huawei', productYears: 10, performanceYears: 25, performanceEndPct: 80 },
    { name: 'Growatt', productYears: 10, performanceYears: 25, performanceEndPct: 80 },
    { name: 'Sungrow', productYears: 10, performanceYears: 25, performanceEndPct: 80 },
    { name: 'JinkoSolar', productYears: 10, performanceYears: 30, performanceEndPct: 82 },
  ];

  for (const mfg of manufacturers) {
    const existing = await prisma.operations.manufacturerWarrantyTerm.findFirst({
      where: { tenantId: tenant.id, manufacturer: mfg.name },
    });

    if (!existing) {
      await prisma.operations.manufacturerWarrantyTerm.create({
        data: {
          tenantId: tenant.id,
          manufacturer: mfg.name,
          equipmentType: 'INVERTER',
          productWarrantyYears: mfg.productYears,
          performanceWarrantyYears: mfg.performanceYears,
          performanceEndPct: mfg.performanceEndPct,
          conditions: `Termo padrão ${mfg.name} (exemplo). Substituir por PDF oficial.`,
          source: 'SEED_EXAMPLE',
          reviewedBy: 'ADMIN',
          validFrom: new Date(),
        },
      });
      console.log(`✓ Termo ${mfg.name} criado`);
    }
  }

  // 2. Regra de comissionamento (NBR 16274)
  const commissioningRuleset = await prisma.rules.ruleSet.create({
    data: {
      tenantId: tenant.id,
      name: 'Comissionamento Padrão (NBR 16274)',
      modelId: 'ops.commissioning',
      version: 1,
      status: 'DRAFT',
      rules: {
        tests: [
          { id: 'continuity', name: 'Continuidade', min: 0, max: 0.5, unit: 'Ω' },
          { id: 'polaridade', name: 'Polaridade', result: 'PASS', unit: 'visual' },
          { id: 'isolamento', name: 'Isolamento', min: 1000, unit: 'Ω/V' },
          { id: 'aterramento', name: 'Aterramento', max: 10, unit: 'Ω' },
          { id: 'voc', name: 'Voc (string)', min: 35, max: 45, unit: 'V' },
          { id: 'isc', name: 'Isc (string)', min: 8, max: 12, unit: 'A' },
          { id: 'termografia', name: 'Termografia', max: 3, unit: '°C (delta)', required: false },
        ],
      },
      notes: 'Baseado em NBR 16274 e Resolução ANEEL 414/2010. Exemplo — confirmar com RT.',
      reviewedBy: 'PENDING',
    },
  });
  console.log(`✓ Regra comissionamento criada: ${commissioningRuleset.id}`);

  // 3. Política de comissão
  const commissionPolicy = await prisma.crm.commissionPolicy.findFirst({
    where: { tenantId: tenant.id },
  });

  if (!commissionPolicy) {
    await prisma.crm.commissionPolicy.create({
      data: {
        tenantId: tenant.id,
        name: 'Comissão Padrão (Exemplo)',
        base: 'RECEBIDO',
        percentageByRole: {
          SALESPERSON: 5,
          SALES_MANAGER: 2,
          SDR: 1,
        },
        notes: 'Base: % do valor recebido. Ajustar conforme política da empresa.',
      },
    });
    console.log(`✓ Política de comissão criada`);
  }

  // 4. Regra de monitoramento (limiar desvio, periodicidade manutenção)
  const monitoringRuleset = await prisma.rules.ruleSet.create({
    data: {
      tenantId: tenant.id,
      name: 'Monitoramento Padrão',
      modelId: 'ops.monitoring',
      version: 1,
      status: 'DRAFT',
      rules: {
        deviationThreshold: 15, // % de desvio antes de alerta
        consecutiveDays: 3, // dias consecutivos com desvio
        maintenancePeriodicity: 'ANNUAL', // manutenção anual
        cleaningInterval: 6, // meses
      },
      notes: 'Limiar 15%, manutenção anual. RT define conforme local/clima.',
      reviewedBy: 'PENDING',
    },
  });
  console.log(`✓ Regra monitoramento criada: ${monitoringRuleset.id}`);

  // 5. Critérios de lead scoring
  const scoringCriteria = [
    {
      name: 'Origem',
      weight: 20,
      type: 'origin',
      values: { organic: 100, paid: 70, referral: 80 },
    },
    {
      name: 'Consumo',
      weight: 30,
      type: 'consumption',
      values: { high: 100, medium: 50, low: 10 },
    },
    {
      name: 'Região',
      weight: 10,
      type: 'region',
      values: { SP: 90, RJ: 85, MG: 80 },
    },
  ];

  for (const criteria of scoringCriteria) {
    const existing = await prisma.crm.leadScoringCriteria.findFirst({
      where: { tenantId: tenant.id, name: criteria.name },
    });

    if (!existing) {
      await prisma.crm.leadScoringCriteria.create({
        data: {
          tenantId: tenant.id,
          ...criteria,
          active: true,
        },
      });
      console.log(`✓ Critério scoring "${criteria.name}" criado`);
    }
  }

  // 6. Política de roteamento de leads
  const routingPolicy = await prisma.crm.leadRoutingPolicy.findFirst({
    where: { tenantId: tenant.id },
  });

  if (!routingPolicy) {
    await prisma.crm.leadRoutingPolicy.create({
      data: {
        tenantId: tenant.id,
        name: 'Roteamento Padrão',
        method: 'roundRobin',
        config: {},
        active: true,
      },
    });
    console.log(`✓ Política roteamento criada (roundRobin)`);
  }

  console.log('\n✓ Setup padrão concluído!');
  console.log(
    'Próximos passos:\n' +
      '1. Validar termos de garantia (substituir PDFs) com RT\n' +
      '2. Atualizar checklist comissionamento (regra ' +
      commissioningRuleset.id +
      ')\n' +
      '3. Ajustar política de comissão e lead scoring conforme empresa\n' +
      '4. Aprovar regras (status ACTIVE) quando validadas',
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
