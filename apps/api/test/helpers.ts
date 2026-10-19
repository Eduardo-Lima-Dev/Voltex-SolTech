import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { hash } from '@node-rs/argon2';
import { vi } from 'vitest';
import request, { type Response } from 'supertest';
import type TestAgent from 'supertest/lib/agent';
import { Role } from '@voltex/shared';
import type { MailMessage } from '../src/platform/mail/mail.service';
import type { PrismaService } from '../src/platform/prisma/prisma.service';

export const PASSWORD = 'Test@12345';
export const API = '/api/v1';

export class FakeMail {
  sent: MailMessage[] = [];
  fail = false;
  async send(message: MailMessage): Promise<void> {
    if (this.fail) throw new Error('smtp indisponível');
    this.sent.push(message);
  }
  last(): MailMessage {
    const message = this.sent.at(-1);
    if (!message) throw new Error('nenhum e-mail enviado');
    return message;
  }
}

export interface TestApp {
  app: INestApplication;
  http: TestAgent;
  prisma: PrismaService;
  mail: FakeMail;
  close: () => Promise<void>;
}

/**
 * Sobe a aplicação inteira (módulos reais, banco e S3 reais; só o e-mail é substituído).
 * O `ConfigModule` valida o ambiente quando `app.module` é importado, então reimportamos o módulo da
 * aplicação a cada chamada para que `envOverrides` valham para ESTA instância.
 */
export async function createTestApp(envOverrides: Record<string, string> = {}): Promise<TestApp> {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(envOverrides)) {
    previous[key] = process.env[key];
    process.env[key] = value;
  }
  const mail = new FakeMail();
  try {
    vi.resetModules();
    const [{ AppModule }, { MailService }, { PrismaService }, { configureApp, setupSwagger }] =
      await Promise.all([
        import('../src/app.module'),
        import('../src/platform/mail/mail.service'),
        import('../src/platform/prisma/prisma.service'),
        import('../src/setup'),
      ]);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailService)
      .useValue(mail)
      .compile();
    const app = moduleRef.createNestApplication();
    configureApp(app);
    setupSwagger(app);
    await app.init();
    return {
      app,
      http: request(app.getHttpServer()),
      prisma: app.get(PrismaService),
      mail,
      close: () => app.close(),
    };
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

export interface SeededUser {
  id: string;
  email: string;
  role: Role;
}

export interface SeededTenant {
  id: string;
  name: string;
  branchId: string;
  teamId: string;
  owner: SeededUser;
  admin: SeededUser;
  manager: SeededUser;
  salesperson: SeededUser;
  sdr: SeededUser;
}

/** Cria um tenant novo e independente (slug único) com um usuário de cada perfil usado nos testes. */
export async function seedTenant(prisma: PrismaService, label: string): Promise<SeededTenant> {
  const suffix = randomUUID().slice(0, 8);
  const passwordHash = await hash(PASSWORD);
  const tenant = await prisma.system.tenant.create({
    data: { name: `Empresa ${label}`, slug: `${label}-${suffix}` },
  });
  const branch = await prisma.system.branch.create({
    data: { tenantId: tenant.id, name: 'Matriz' },
  });
  const team = await prisma.system.team.create({
    data: { tenantId: tenant.id, branchId: branch.id, name: 'Comercial' },
  });

  const make = async (key: string, role: Role): Promise<SeededUser> => {
    const email = `${key}.${suffix}@${label}.test`;
    const user = await prisma.system.user.create({
      data: {
        tenantId: tenant.id,
        branchId: branch.id,
        teamId: team.id,
        name: `${key} ${label}`,
        email,
        passwordHash,
        role,
      },
    });
    return { id: user.id, email, role };
  };

  return {
    id: tenant.id,
    name: tenant.name,
    branchId: branch.id,
    teamId: team.id,
    owner: await make('owner', Role.OWNER),
    admin: await make('admin', Role.ADMIN),
    manager: await make('manager', Role.SALES_MANAGER),
    salesperson: await make('vendedor', Role.SALESPERSON),
    sdr: await make('sdr', Role.SDR),
  };
}

export async function login(
  http: TestAgent,
  email: string,
  password = PASSWORD,
): Promise<Response> {
  const res = await http.post(`${API}/auth/login`).send({ email, password });
  return res;
}

/** Faz login e devolve o access token (falha o teste se o login não funcionar). */
export async function tokenFor(http: TestAgent, user: SeededUser): Promise<string> {
  const res = await login(http, user.email);
  if (res.status !== 200)
    throw new Error(`login de ${user.email} falhou: ${res.status} ${JSON.stringify(res.body)}`);
  return (res.body as { accessToken: string }).accessToken;
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Extrai o valor do cookie de refresh de uma resposta. */
export function refreshCookie(res: { headers: Record<string, unknown> }): string | undefined {
  const cookies = (res.headers['set-cookie'] as string[] | undefined) ?? [];
  const raw = cookies.find((c) => c.startsWith('voltex_refresh='));
  return raw?.split(';')[0]?.slice('voltex_refresh='.length);
}

export const withRefresh = (value: string) => ({ Cookie: `voltex_refresh=${value}` });

/** PDF mínimo válido para os testes de upload. */
export const pdfBuffer = (extra = ''): Buffer =>
  Buffer.from(`%PDF-1.4\n1 0 obj<<>>endobj\n${extra}\n%%EOF`);
