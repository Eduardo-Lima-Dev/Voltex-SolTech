/**
 * Testes de integração do monitoramento de inversores (Fase 11F).
 */
import { HttpStatus } from '@nestjs/common';
import { describe, it, expect, beforeAll } from 'vitest';
import type { PlantMonitoringPageDto } from '@voltex/shared';
import {
  createTenantAndLogin,
  createProject,
  approveProject,
  createInstallation,
  createPlant,
  deleteTenantsAndUsers,
} from './crm-delivery-flow';

describe('Monitoramento (11F)', () => {
  let tenantId: string;
  let accessToken: string;
  let plantId: string;

  beforeAll(async () => {
    const auth = await createTenantAndLogin('monitoring-test');
    tenantId = auth.tenant.id;
    accessToken = auth.tokens.accessToken;

    const project = await createProject(accessToken, tenantId);
    await approveProject(accessToken, project.id);

    const installation = await createInstallation(accessToken, project.id);
    plantId = (await createPlant(accessToken, installation, project)).id;
  });

  afterAll(async () => {
    await deleteTenantsAndUsers([tenantId]);
  });

  describe('GET /plants/:plantId/monitoring', () => {
    it('retorna página de monitoramento vazia para planta nova', async () => {
      const res = await fetch(`http://localhost:3000/plants/${plantId}/monitoring`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      expect(res.status).toBe(HttpStatus.OK);
      const page = (await res.json()) as PlantMonitoringPageDto;
      expect(page.links).toHaveLength(0);
      expect(page.dailyData).toEqual([]);
      expect(page.snapshot).toBeNull();
    });
  });

  describe('POST /plants/:plantId/monitoring/link', () => {
    it('rejeita sem conexão válida', async () => {
      const res = await fetch(`http://localhost:3000/plants/${plantId}/monitoring/link`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          connectionId: '00000000-0000-0000-0000-000000000000',
          externalPlantId: 'fake-plant-id',
        }),
      });

      expect(res.status).toBe(HttpStatus.NOT_FOUND);
    });
  });

  describe('GET /plants/:plantId/monitoring/links', () => {
    it('retorna lista vazia para planta sem links', async () => {
      const res = await fetch(`http://localhost:3000/plants/${plantId}/monitoring/links`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      expect(res.status).toBe(HttpStatus.OK);
      const links = await res.json();
      expect(Array.isArray(links)).toBe(true);
      expect(links).toHaveLength(0);
    });
  });
});
