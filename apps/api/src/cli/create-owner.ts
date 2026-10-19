/**
 * Cria a PRIMEIRA empresa e o seu proprietário em um banco novo (produção não tem o seed de demonstração).
 *
 *   docker compose -f docker/compose.prod.yml run --rm \
 *     -e TENANT_NAME="Sol do Nordeste" -e OWNER_NAME="Maria Souza" \
 *     -e OWNER_EMAIL=maria@empresa.com.br -e OWNER_PASSWORD='uma senha longa e única' \
 *     api node dist/cli/create-owner.js
 *
 * A senha vem só do ambiente (nunca de argumento de linha de comando, que fica no histórico do shell) e não é
 * escrita em lugar nenhum. Recusa e-mail já usado; a troca da senha é feita depois, no próprio sistema.
 */
import { hash } from '@node-rs/argon2';
import { createPrismaClient, Role } from '@voltex/database';

const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Defina ${name}.`);
  return value;
};

const slugify = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

async function main(): Promise<void> {
  const tenantName = required('TENANT_NAME');
  const ownerName = required('OWNER_NAME');
  const email = required('OWNER_EMAIL').toLowerCase();
  const password = required('OWNER_PASSWORD');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('OWNER_EMAIL inválido.');
  if (password.length < 12 || !/[a-zA-Z]/.test(password) || !/[0-9]/.test(password))
    throw new Error('OWNER_PASSWORD deve ter 12 ou mais caracteres, com letras e números.');
  const slug = slugify(tenantName);
  if (slug.length < 2) throw new Error('TENANT_NAME gera um identificador inválido.');

  const prisma = createPrismaClient();
  try {
    if (await prisma.user.findUnique({ where: { email } }))
      throw new Error('Já existe um usuário com este e-mail.');
    if (await prisma.tenant.findUnique({ where: { slug } }))
      throw new Error(`Já existe uma empresa com o identificador "${slug}".`);
    const tenant = await prisma.tenant.create({ data: { name: tenantName, slug } });
    const branch = await prisma.branch.create({ data: { tenantId: tenant.id, name: 'Matriz' } });
    const team = await prisma.team.create({
      data: { tenantId: tenant.id, branchId: branch.id, name: 'Comercial' },
    });
    await prisma.user.create({
      data: {
        tenantId: tenant.id,
        branchId: branch.id,
        teamId: team.id,
        name: ownerName,
        email,
        role: Role.OWNER,
        passwordHash: await hash(password),
      },
    });
    console.log(`Empresa "${tenantName}" (${slug}) criada. Proprietário: ${email}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
