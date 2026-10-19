import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import * as Shared from '@voltex/shared';
import { Role as SharedRole } from '@voltex/shared';
import { describe, expect, it } from 'vitest';
import * as Db from './index';
import { Role, TENANT_SCOPED_MODELS, isTenantScopedModel } from './index';

const schemaDir = path.resolve(__dirname, '../prisma/schema');

interface ParsedModel {
  name: string;
  body: string;
}

/** Lê os modelos direto dos arquivos .prisma (o Prisma 7 não expõe mais `Prisma.dmmf`). */
function readModels(): ParsedModel[] {
  const models: ParsedModel[] = [];
  for (const file of readdirSync(schemaDir).filter((f) => f.endsWith('.prisma'))) {
    const content = readFileSync(path.join(schemaDir, file), 'utf8');
    for (const match of content.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
      models.push({ name: match[1] as string, body: match[2] as string });
    }
  }
  return models;
}

describe('paridade com @voltex/shared', () => {
  it('o enum Role do Prisma tem os mesmos valores do Role compartilhado', () => {
    expect(Object.values(Role).sort()).toEqual(Object.values(SharedRole).sort());
  });

  it.each([
    'LeadSource',
    'CustomerSegment',
    'LeadStatus',
    'AccountType',
    'PhaseSystem',
    'ProjectType',
    'OpportunityStage',
    'OpportunityStatus',
    'TaskStatus',
    'EnergyBillStatus',
    'MarginStatus',
    'ApprovalStatus',
    'ProposalStatus',
    'ContractStatus',
    'ProjectStatus',
    'ChecklistItemStatus',
    'CustomerGroup',
    'TrafficLight',
  ])('o enum %s do Prisma tem os mesmos valores do compartilhado', (name) => {
    const prisma = (Db as unknown as Record<string, Record<string, string>>)[name];
    const shared = (Shared as unknown as Record<string, Record<string, string>>)[name];
    expect(prisma, `${name} no Prisma`).toBeDefined();
    expect(shared, `${name} no shared`).toBeDefined();
    expect(Object.values(prisma!).sort()).toEqual(Object.values(shared!).sort());
  });
});

describe('escopo de tenant', () => {
  const models = readModels();
  const withTenantId = models.filter((m) => /^\s*tenantId\s+String\s/m.test(m.body));

  it('encontra os modelos do schema', () => {
    expect(models.map((m) => m.name)).toContain('Tenant');
    expect(models.length).toBeGreaterThanOrEqual(7);
  });

  it('todo modelo com tenantId está em TENANT_SCOPED_MODELS (e só eles)', () => {
    expect([...TENANT_SCOPED_MODELS].sort()).toEqual(withTenantId.map((m) => m.name).sort());
  });

  it('tenantId é obrigatório e uuid, e há índice cobrindo o tenant', () => {
    for (const model of withTenantId) {
      expect(model.body, `${model.name}.tenantId`).toMatch(
        /tenantId\s+String\s+@map\("tenant_id"\)\s+@db\.Uuid/,
      );
      expect(model.body, `${model.name} índice`).toMatch(/@@(index|unique)\(\[tenantId/);
    }
  });

  it('Tenant não é escopado por tenant', () => {
    expect(isTenantScopedModel('Tenant')).toBe(false);
    expect(isTenantScopedModel('User')).toBe(true);
  });
});
