import { randomUUID } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import type { Role } from '@voltex/shared';
import { PASSWORD, tokenFor, type SeededTenant, type TestApp } from './helpers';

/** Cria um usuário extra com o perfil escolhido no tenant e devolve o token de acesso. */
export async function tokenWithRole(
  t: TestApp,
  tenant: SeededTenant,
  role: Role,
): Promise<{ token: string; id: string }> {
  const suffix = randomUUID().slice(0, 8);
  const email = `${role.toLowerCase()}.${suffix}@crm.test`;
  const user = await t.prisma.system.user.create({
    data: {
      tenantId: tenant.id,
      name: `${role} ${suffix}`,
      email,
      passwordHash: await hash(PASSWORD),
      role,
    },
  });
  return { token: await tokenFor(t.http, { id: user.id, email, role }), id: user.id };
}

/** Eventos do outbox de um tipo, do mais antigo ao mais novo. */
export const outboxOf = (t: TestApp, tenantId: string, type: string) =>
  t.prisma.system.outboxEvent.findMany({
    where: { tenantId, type },
    orderBy: { occurredAt: 'asc' },
  });

export const auditOf = (t: TestApp, tenantId: string, action: string) =>
  t.prisma.system.auditLog.findMany({ where: { tenantId, action }, orderBy: { createdAt: 'asc' } });

import PDFDocument from 'pdfkit';

/** PDF com camada de texto, gerado na hora (fatura SINTÉTICA para os testes). */
export const textPdf = (text: string): Promise<Buffer> =>
  new Promise((resolve) => {
    const doc = new PDFDocument();
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.fontSize(10).text(text);
    doc.end();
  });

export const SAMPLE_BILL = `
ENERGIA ELÉTRICA DO NORTE S.A.
Nome: JOAO DA SILVA
Unidade Consumidora: 12345678-9
Grupo B   Classe: RESIDENCIAL   Fornecimento: BIFÁSICO
Mês de referência: 08/2026
Vencimento: 15/09/2026
Total a pagar R$ 1.234,56

HISTÓRICO DE CONSUMO
SET/25 410
OUT/25 395
NOV/25 380
DEZ/25 520
JAN/26 610
FEV/26 590
MAR/26 480
ABR/26 450
MAI/26 430
JUN/26 400
JUL/26 405
AGO/26 1.020
`;

/** PNG mínimo com a assinatura correta (basta para o upload; não tem texto). */
export const pngBuffer = (): Buffer =>
  Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    Buffer.from('0000000d49484452', 'hex'),
    Buffer.alloc(32),
  ]);
