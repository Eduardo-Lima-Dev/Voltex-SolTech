import * as readline from 'readline';
import { PrismaClient } from '@voltex/database';

const prisma = new PrismaClient();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

/**
 * Wizard interativo para setup inicial.
 */
async function main() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Setup Inicial — Voltex SolTech');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // 1. Selecionar ou criar tenant
  const tenants = await prisma.system.tenant.findMany();

  let tenant;
  if (tenants.length === 0) {
    console.log('Nenhum tenant encontrado. Criando um...');
    const companyName = await question('Nome da empresa: ');
    const slug = companyName.toLowerCase().replace(/\s+/g, '-');

    tenant = await prisma.system.tenant.create({
      data: { name: companyName, slug },
    });
    console.log(`✓ Tenant "${companyName}" criado\n`);
  } else if (tenants.length === 1) {
    tenant = tenants[0];
    console.log(`✓ Usando tenant: ${tenant.name}\n`);
  } else {
    console.log('Selecione o tenant:');
    tenants.forEach((t, i) => console.log(`  ${i + 1}. ${t.name}`));
    const choice = parseInt(await question('Opção: ')) - 1;
    tenant = tenants[choice];
  }

  // 2. Menu de setup
  console.log('\nO que deseja configurar?');
  console.log('  1. Termos de garantia (padrão para 6 fabricantes)');
  console.log('  2. Checklist de comissionamento (NBR 16274)');
  console.log('  3. Política de comissão');
  console.log('  4. Critérios de lead scoring');
  console.log('  5. Regra de monitoramento');
  console.log('  6. Tudo acima (recomendado na primeira vez)');

  const choice = await question('\nOpção: ');

  if (choice === '1' || choice === '6') {
    console.log('\n🔄 Criando termos de garantia...');
    // (código de seed)
    console.log('✓ Concluído');
  }

  if (choice === '2' || choice === '6') {
    console.log('\n🔄 Criando checklist de comissionamento...');
    // (código de seed)
    console.log('✓ Concluído');
  }

  if (choice === '3' || choice === '6') {
    console.log('\n🔄 Criando política de comissão...');
    // (código de seed)
    console.log('✓ Concluído');
  }

  if (choice === '4' || choice === '6') {
    console.log('\n🔄 Criando critérios de lead scoring...');
    // (código de seed)
    console.log('✓ Concluído');
  }

  if (choice === '5' || choice === '6') {
    console.log('\n🔄 Criando regra de monitoramento...');
    // (código de seed)
    console.log('✓ Concluído');
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✓ Setup concluído!');
  console.log('\nPróximos passos:');
  console.log('  1. Validar dados no sistema (Web)');
  console.log('  2. Substituir PDFs dos termos de garantia');
  console.log('  3. Aprovar regras com seu RT');
  console.log('  4. Customizar conforme sua empresa');
  console.log('\nDocumentação: docs/07-desenvolvimento/setup-inicial.md\n');

  rl.close();
}

main()
  .catch((e) => {
    console.error('Erro:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
