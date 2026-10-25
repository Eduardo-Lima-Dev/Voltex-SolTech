import { describe, expect, it } from 'vitest';
import { TENANT_SCOPED_MODELS } from '@voltex/database';
import {
  SELLER_SCOPED_MODELS,
  applyOwnership,
  isOwnershipRestricted,
  ownershipWhere,
} from './ownership-scope';

const U = 'user-1';

describe('carteira por responsável', () => {
  it('só vendedor e SDR são restritos', () => {
    expect(isOwnershipRestricted('SALESPERSON')).toBe(true);
    expect(isOwnershipRestricted('SDR')).toBe(true);
    for (const role of ['OWNER', 'ADMIN', 'SALES_MANAGER', 'OPERATIONS', 'ENGINEERING', 'FINANCE'])
      expect(isOwnershipRestricted(role)).toBe(false);
    expect(isOwnershipRestricted(undefined)).toBe(false);
  });

  it('todo modelo da lista do vendedor tem filtro, e existe no escopo de tenant', () => {
    for (const model of SELLER_SCOPED_MODELS) {
      expect(ownershipWhere(model, 'SALESPERSON', U), model).not.toBeNull();
      expect((TENANT_SCOPED_MODELS as readonly string[]).includes(model), model).toBe(true);
    }
  });

  it('vendedor: lead e oportunidade só pelo responsável', () => {
    expect(ownershipWhere('Lead', 'SALESPERSON', U)).toEqual({ ownerId: U });
    expect(ownershipWhere('Opportunity', 'SALESPERSON', U)).toEqual({ ownerId: U });
  });

  it('vendedor: conta é a dele ou a de oportunidade dele; filhos seguem a conta', () => {
    const account = ownershipWhere('Account', 'SALESPERSON', U);
    expect(account).toEqual({
      OR: [{ ownerId: U }, { opportunities: { some: { ownerId: U } } }],
    });
    for (const model of ['Contact', 'Site', 'ConsumerUnit', 'PortalAccess'])
      expect(ownershipWhere(model, 'SALESPERSON', U)).toEqual({ account });
  });

  it('vendedor: cotação, proposta, contrato e linha do tempo seguem a oportunidade', () => {
    for (const model of ['Quote', 'Proposal', 'Contract', 'TimelineEvent', 'TriageSnapshot'])
      expect(ownershipWhere(model, 'SALESPERSON', U)).toEqual({ opportunity: { ownerId: U } });
  });

  it('vendedor: financeiro do projeto segue o projeto; comissão só a própria', () => {
    const project = ownershipWhere('Project', 'SALESPERSON', U);
    expect(ownershipWhere('Receivable', 'SALESPERSON', U)).toEqual({ project });
    expect(ownershipWhere('Commission', 'SALESPERSON', U)).toEqual({ userId: U });
  });

  it('vendedor: cálculo é o que ele fez ou o ligado a oportunidade dele', () => {
    const session = {
      OR: [{ createdById: U }, { opportunity: { ownerId: U } }],
    };
    expect(ownershipWhere('CalculationSession', 'SALESPERSON', U)).toEqual(session);
    expect(ownershipWhere('QuickCalculationSnapshot', 'SALESPERSON', U)).toEqual({ session });
  });

  it('SDR: leads e contas dele e sem responsável; nada de oportunidade ou cotação', () => {
    expect(ownershipWhere('Lead', 'SDR', U)).toEqual({ OR: [{ ownerId: U }, { ownerId: null }] });
    expect(ownershipWhere('Account', 'SDR', U)).toEqual({
      OR: [{ ownerId: U }, { ownerId: null }],
    });
    expect(ownershipWhere('Opportunity', 'SDR', U)).toBeNull();
    expect(ownershipWhere('Quote', 'SDR', U)).toBeNull();
  });

  it('modelos fora da carteira (catálogo, regras, operação) não são filtrados', () => {
    for (const model of ['EquipmentItem', 'RuleSet', 'WorkOrder', 'Plant', 'MarginPolicy'])
      expect(ownershipWhere(model, 'SALESPERSON', U)).toBeNull();
  });

  it('perfis de gestão passam sem filtro', () => {
    const args = { where: { id: 'x' } };
    for (const role of ['OWNER', 'ADMIN', 'SALES_MANAGER'])
      expect(applyOwnership('Lead', 'findMany', args, { role, userId: U })).toBe(args);
  });

  it('sem usuário no contexto (filas e eventos) não restringe', () => {
    const args = { where: {} };
    expect(applyOwnership('Lead', 'findMany', args, { role: undefined, userId: undefined })).toBe(
      args,
    );
  });

  it('junta o filtro com AND, preservando o filtro original', () => {
    const out = applyOwnership(
      'Lead',
      'findMany',
      { where: { status: 'NEW' } },
      { role: 'SALESPERSON', userId: U },
    );
    expect(out).toEqual({ where: { status: 'NEW', AND: [{ ownerId: U }] } });
  });

  it('preserva AND que já existia (lista ou objeto)', () => {
    const subject = { role: 'SALESPERSON', userId: U };
    expect(applyOwnership('Lead', 'count', { where: { AND: [{ a: 1 }] } }, subject)?.where).toEqual(
      { AND: [{ a: 1 }, { ownerId: U }] },
    );
    expect(applyOwnership('Lead', 'count', { where: { AND: { a: 1 } } }, subject)?.where).toEqual({
      AND: [{ a: 1 }, { ownerId: U }],
    });
  });

  it('cobre leitura, alteração e exclusão; não mexe em criação', () => {
    const subject = { role: 'SALESPERSON', userId: U };
    for (const op of [
      'findUnique',
      'findFirst',
      'update',
      'updateMany',
      'delete',
      'deleteMany',
      'groupBy',
      'aggregate',
    ])
      expect(applyOwnership('Lead', op, { where: { id: 'x' } }, subject)?.where).toHaveProperty(
        'AND',
      );
    const create = { data: { name: 'x' } };
    expect(applyOwnership('Lead', 'create', create, subject)).toBe(create);
    expect(applyOwnership('Lead', 'upsert', create, subject)).toBe(create);
  });
});
