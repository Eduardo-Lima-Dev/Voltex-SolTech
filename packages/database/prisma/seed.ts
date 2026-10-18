import { hash } from '@node-rs/argon2';
import dotenv from 'dotenv';
import path from 'node:path';
import { createPrismaClient } from '../src/client';
import { Role } from '../src/generated/enums';

dotenv.config({ path: path.resolve(process.cwd(), '../../.env'), quiet: true });

if (process.env.NODE_ENV === 'production' && process.env.SEED_ALLOW_PRODUCTION !== 'true') {
  console.error(
    '[seed] Recusado em produção. Defina SEED_ALLOW_PRODUCTION=true se for intencional.',
  );
  process.exit(1);
}

const prisma = createPrismaClient();
const password = process.env.SEED_PASSWORD ?? 'Voltex@2026';

interface SeedUser {
  name: string;
  email: string;
  role: Role;
}

const demoUsers: SeedUser[] = [
  { name: 'Eduardo Owner', email: 'owner@voltex.demo', role: Role.OWNER },
  { name: 'Ana Admin', email: 'admin@voltex.demo', role: Role.ADMIN },
  { name: 'Marcos Gestor Comercial', email: 'gestor@voltex.demo', role: Role.SALES_MANAGER },
  { name: 'Sofia SDR', email: 'sdr@voltex.demo', role: Role.SDR },
  { name: 'Victor Vendedor', email: 'vendedor@voltex.demo', role: Role.SALESPERSON },
  { name: 'Elisa Engenharia', email: 'engenharia@voltex.demo', role: Role.ENGINEERING },
  { name: 'Rafael Responsável Técnico', email: 'rt@voltex.demo', role: Role.TECHNICAL_LEAD },
  { name: 'Olivia Operações', email: 'operacao@voltex.demo', role: Role.OPERATIONS },
  { name: 'Fábio Financeiro', email: 'financeiro@voltex.demo', role: Role.FINANCE },
];

/** Segundo tenant, usado para testar manualmente o isolamento entre empresas. */
const rivalUsers: SeedUser[] = [
  { name: 'Rita Rival', email: 'owner@rival.demo', role: Role.OWNER },
];

async function seedTenant(config: {
  name: string;
  slug: string;
  branch: { name: string; city: string; state: string };
  team: string;
  users: SeedUser[];
}) {
  const passwordHash = await hash(password);

  const tenant = await prisma.tenant.upsert({
    where: { slug: config.slug },
    update: { name: config.name },
    create: { name: config.name, slug: config.slug },
  });
  const branch = await prisma.branch.upsert({
    where: { tenantId_name: { tenantId: tenant.id, name: config.branch.name } },
    update: {},
    create: { tenantId: tenant.id, ...config.branch },
  });
  const team = await prisma.team.upsert({
    where: { tenantId_name: { tenantId: tenant.id, name: config.team } },
    update: {},
    create: { tenantId: tenant.id, branchId: branch.id, name: config.team },
  });

  for (const user of config.users) {
    await prisma.user.upsert({
      where: { email: user.email },
      update: { name: user.name, role: user.role },
      create: { ...user, passwordHash, tenantId: tenant.id, branchId: branch.id, teamId: team.id },
    });
  }
  console.log(`[seed] ${config.name}: ${config.users.length} usuários`);
}

async function main() {
  await seedTenant({
    name: 'Voltex Demo',
    slug: 'voltex-demo',
    branch: { name: 'Matriz', city: 'Fortaleza', state: 'CE' },
    team: 'Comercial',
    users: demoUsers,
  });
  await seedTenant({
    name: 'Rival Energia Solar',
    slug: 'rival-energia',
    branch: { name: 'Matriz', city: 'Recife', state: 'PE' },
    team: 'Comercial',
    users: rivalUsers,
  });
  console.log(`[seed] Concluído. Senha de todos os usuários de demonstração: ${password}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
