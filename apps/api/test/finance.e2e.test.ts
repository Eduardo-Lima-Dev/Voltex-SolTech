/**
 * Testes de financeiro (Fase 11G): recebíveis, custos, crédito.
 */
import { HttpStatus } from '@nestjs/common';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { ReceivableDto } from '@voltex/shared';
import {
  createTenantAndLogin,
  createProject,
  approveProject,
  deleteTenantsAndUsers,
} from './crm-delivery-flow';

describe('Financeiro (11G)', () => {
  let tenantId: string;
  let accessToken: string;
  let projectId: string;

  beforeAll(async () => {
    const auth = await createTenantAndLogin('finance-test');
    tenantId = auth.tenant.id;
    accessToken = auth.tokens.accessToken;

    const project = await createProject(accessToken, tenantId);
    projectId = (await approveProject(accessToken, project.id)).id;
  });

  afterAll(async () => {
    await deleteTenantsAndUsers([tenantId]);
  });

  describe('GET /projects/:projectId/finance/summary', () => {
    it('retorna resumo financeiro inicial vazio', async () => {
      const res = await fetch(`http://localhost:3000/projects/${projectId}/finance/summary`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      expect(res.status).toBe(HttpStatus.OK);
      const summary = await res.json();
      expect(summary.projectId).toBe(projectId);
      expect(summary.totalReceivedCents).toBe(0);
      expect(summary.receivables).toEqual([]);
    });
  });

  describe('POST /projects/:projectId/finance/receivables', () => {
    it('cria uma parcela', async () => {
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 30);

      const res = await fetch(`http://localhost:3000/projects/${projectId}/finance/receivables`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          referenceId: 'NF-001',
          order: 1,
          amountCents: 100000,
          dueAt: dueDate.toISOString(),
        }),
      });

      expect(res.status).toBe(HttpStatus.CREATED);
      const receivable = (await res.json()) as ReceivableDto;
      expect(receivable.referenceId).toBe('NF-001');
      expect(receivable.amountCents).toBe(100000);
      expect(receivable.status).toBe('OPEN');
    });
  });

  describe('GET /projects/:projectId/finance/receivables', () => {
    it('lista parcelas do projeto', async () => {
      const res = await fetch(`http://localhost:3000/projects/${projectId}/finance/receivables`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      expect(res.status).toBe(HttpStatus.OK);
      const receivables = (await res.json()) as ReceivableDto[];
      expect(Array.isArray(receivables)).toBe(true);
      expect(receivables.length).toBeGreaterThan(0);
    });
  });

  describe('POST /projects/:projectId/finance/credit-applications', () => {
    it('cria uma aplicação de crédito', async () => {
      const res = await fetch(
        `http://localhost:3000/projects/${projectId}/finance/credit-applications`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            institution: 'Itaú',
            amountCents: 50000,
            annualRatePct: 12.5,
            termMonths: 12,
          }),
        },
      );

      expect(res.status).toBe(HttpStatus.CREATED);
      const credit = await res.json();
      expect(credit.institution).toBe('Itaú');
      expect(credit.status).toBe('SIMULATED');
    });
  });
});
