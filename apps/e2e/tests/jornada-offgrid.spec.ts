import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { USERS, api, apiToken, loginUi } from './helpers';

/**
 * JORNADA DO OFF-GRID: pedido próprio → projeto → dimensionamento e simulação → revisão → aprovação do responsável técnico.
 *
 * O catálogo (módulo, bateria, controlador, inversor) e a regra `offgrid.design` são preparados pela API, como a
 * empresa já teria feito; a tela confere cada etapa. O desenho completo é gravado pela API (as etapas de edição têm
 * teste de componente), e a revisão e a aprovação acontecem pela interface, com dois usuários diferentes.
 */
async function snap(page: Page, info: TestInfo, nome: string, espera = 400) {
  await page.waitForTimeout(espera);
  await info.attach(nome, { body: await page.screenshot(), contentType: 'image/png' });
}

async function sairEEntrarComo(page: Page, email: string) {
  await page.getByRole('button', { name: /Menu do usuário/ }).click();
  await page.getByRole('menuitem', { name: 'Sair' }).click();
  await expect(page).toHaveURL(/\/login/);
  await loginUi(page, email);
  await expect(page.getByRole('heading', { name: /Olá/ })).toBeVisible();
}

const GHI = [5.6, 5.8, 5.4, 5.3, 4.9, 4.7, 5.0, 5.8, 5.6, 5.8, 5.4, 5.4];
const TEMP = [24, 24, 24, 23, 22, 20, 20, 22, 24, 25, 24, 24];

test('do pedido off-grid ao projeto aprovado pelo responsável técnico', async ({ page }, info) => {
  const stamp = `${Date.now()}`.slice(-6);
  const ids: Record<string, string> = {};
  let admin = '';

  await test.step('Preparação (API): catálogo aprovado e regra revisada', async () => {
    admin = await apiToken(USERS.admin);
    const owner = await apiToken(USERS.owner);
    const item = async (key: string, kind: string, spec: object, cost: number) => {
      const created = await api('/catalog/items', admin, {
        body: {
          kind,
          manufacturer: `Off ${stamp}`,
          model: `${kind}-${stamp}`,
          spec,
          referenceCostCents: cost,
        },
      });
      await api(`/catalog/items/${created.id}/approve`, owner, { method: 'POST' });
      ids[key] = created.id;
    };
    await item(
      'module',
      'MODULE',
      {
        technology: 'MONO_SI',
        pmaxWp: 550,
        vmppV: 41.5,
        imppA: 13.25,
        vocV: 49.5,
        iscA: 14,
        betaVocPctPerC: -0.27,
        alphaIscPctPerC: 0.05,
        gammaPmaxPctPerC: -0.35,
        noctC: 45,
        lengthMm: 2278,
        widthMm: 1134,
      },
      60000,
    );
    await item(
      'battery',
      'BATTERY',
      {
        chemistry: 'LFP',
        nominalVoltageV: 51.2,
        capacityAh: 100,
        capacityHours: 5,
        maxDodPct: 90,
        roundTripEfficiencyPct: 95,
        cycleLife: 6000,
        cycleDodPct: 80,
        calendarLifeYears: 15,
        maxChargeCurrentA: 50,
        maxDischargeCurrentA: 100,
        maxParallel: 8,
      },
      1200000,
    );
    await item(
      'controller',
      'CHARGE_CONTROLLER',
      {
        technology: 'MPPT',
        batteryVoltageV: 48,
        autoVoltage: true,
        ratedChargeCurrentA: 60,
        pvVocMaxV: 250,
        mpptMinV: 60,
        mpptMaxV: 230,
        pvPowerMaxW: 3200,
        efficiencyPct: 98,
      },
      250000,
    );
    await item(
      'inverter',
      'OFFGRID_INVERTER',
      {
        topology: 'OFFGRID',
        batteryVoltageV: 48,
        pContinuousW: 3000,
        pSurgeW: 6000,
        efficiencyPct: 93,
        standbyW: 25,
        vAcV: 220,
        phases: 1,
        sineWave: true,
        generatorInput: true,
        chargerCurrentA: 40,
      },
      600000,
    );
    const rule = await api('/rules', owner, {
      body: {
        key: 'offgrid.design',
        definition: {
          parameters: {
            red1Default: 0.75,
            red2Default: 0.9,
            batteryEfficiencyDefault: 0.86,
            inverterEfficiencyMin: 0.85,
            autonomyMinDays: 2,
            dodMaxLeadFlooded: 50,
            dodMaxLeadVrla: 50,
            dodMaxStationary: 80,
            dodMaxLithium: 80,
            controllerCurrentFactor: 1.25,
            vocColdFactor: 1,
            inverterSurgeMargin: 0.25,
            maxBatteriesParallel: 4,
            maxChargeCRate: 0.2,
            lolpMaxPct: 5,
            chargeVoltageFactor: 1.2,
            pvOtherLossFactor: 0.95,
          },
        },
        sources: [{ type: 'INTERNAL_POLICY', reference: 'Regra da jornada off-grid' }],
      },
    });
    await api(`/rules/${rule.id}/activate`, owner, { body: { reviewedBy: 'Eng. Jornada' } });
  });

  await test.step('Engenheiro abre um pedido off-grid na fila própria', async () => {
    await loginUi(page, USERS.admin);
    await expect(page.getByRole('heading', { name: /Olá/ })).toBeVisible();
    await page.goto('/offgrid/pedidos');
    await page.getByRole('button', { name: /Novo pedido/ }).click();
    await page.getByLabel('Título').fill(`Chalé isolado ${stamp}`);
    await page.getByRole('button', { name: 'Criar pedido' }).click();
    await expect(page.getByRole('heading', { name: `Chalé isolado ${stamp}` })).toBeVisible();
    await snap(page, info, '1-pedido-offgrid');
    await page.getByRole('button', { name: 'Em andamento' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirmar' }).click();
    await expect(page.getByRole('button', { name: 'Criar projeto' })).toBeVisible();
  });

  await test.step('Cria o projeto a partir do pedido', async () => {
    await page.getByRole('button', { name: 'Criar projeto' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Latitude').fill('-15,8');
    await dialog.getByLabel('Longitude').fill('-47,9');
    await dialog.getByRole('button', { name: 'Criar projeto' }).click();
    await expect(page.getByRole('navigation', { name: 'Etapas do projeto' })).toBeVisible();
    await snap(page, info, '2-editor-novo');
  });

  let versionUrl = '';
  await test.step('Desenho completo gravado pela API e conferido nas etapas', async () => {
    versionUrl = page.url();
    const versionId = versionUrl.split('/').pop() as string;
    await api(`/offgrid/versions/${versionId}/design`, admin, {
      method: 'PUT',
      body: {
        design: {
          schemaVersion: 1,
          systemType: 'OFFGRID',
          site: {
            latitude: -15.8,
            longitude: -47.9,
            state: 'DF',
            designTminC: 5,
            designTmaxAmbientC: 35,
            climate: {
              source: 'nasa-power',
              period: '2001-2020',
              fetchedAt: '2026-01-01',
              ghiKwhM2Day: GHI,
              tempMeanC: TEMP,
              tempMinC: TEMP.map((v) => v - 6),
              tempMaxC: TEMP.map((v) => v + 6),
            },
          },
          systemVoltageV: 48,
          loads: [
            {
              id: 'l1',
              name: 'Geladeira',
              powerW: 120,
              hoursPerDay: 12,
              surgeFactor: 4,
              critical: true,
            },
            {
              id: 'l2',
              name: 'Iluminação',
              powerW: 10,
              quantity: 10,
              hoursPerDay: 5,
              windowStartHour: 18,
              windowEndHour: 24,
            },
            {
              id: 'l3',
              name: 'TV',
              powerW: 120,
              hoursPerDay: 5,
              windowStartHour: 18,
              windowEndHour: 23,
            },
          ],
          arrays: [
            {
              id: 'a1',
              name: 'Telhado',
              moduleId: ids.module,
              modulesInSeries: 4,
              parallelStrings: 1,
              azimuthDegrees: 0,
              tiltDegrees: 16,
            },
          ],
          bank: { batteryId: ids.battery, seriesCount: 1, parallelCount: 2 },
          controllerId: ids.controller,
          inverterId: ids.inverter,
          stress: { enabled: false },
        },
      },
    });
    await page.reload();
    await expect(page.getByRole('navigation', { name: 'Etapas do projeto' })).toBeVisible();
    await page.getByRole('button', { name: /Cargas/ }).click();
    await expect(page.getByText('Perfil de consumo')).toBeVisible();
    await snap(page, info, '3-cargas');
    await page.getByRole('button', { name: /Premissas/ }).click();
    await expect(page.getByText('Energia do banco por dia')).toBeVisible();
    await snap(page, info, '4-dimensionamento');
    await page.getByRole('button', { name: /Arranjo FV/ }).click();
    await expect(page.getByRole('list', { name: 'Verificações do arranjo' })).toBeVisible();
    await page.getByRole('button', { name: /Simulação/ }).click();
    await expect(page.getByText('Perda de carga', { exact: true })).toBeVisible();
    await expect(page.getByRole('img', { name: /Dia típico/ })).toBeVisible();
    await snap(page, info, '5-simulacao');
  });

  await test.step('Engenheiro envia para revisão', async () => {
    await page.getByRole('button', { name: 'Enviar para revisão' }).click();
    await expect(page.getByText(/não pode mais ser editada/)).toBeVisible();
    await snap(page, info, '6-enviada');
  });

  await test.step('Responsável técnico comenta, o engenheiro resolve e a versão é aprovada', async () => {
    await sairEEntrarComo(page, USERS.owner);
    await page.goto(versionUrl.replace(/^https?:\/\/[^/]+/, ''));
    await expect(page.getByRole('region', { name: 'Revisão técnica' })).toBeVisible();
    await page.getByLabel('Comentário de revisão').fill('Conferir a autonomia no inverno');
    await page.getByRole('button', { name: 'Adicionar comentário' }).click();
    await expect(page.getByText('Conferir a autonomia no inverno')).toBeVisible();
    await page.getByRole('button', { name: 'Aprovar' }).click();
    await page.getByLabel('Justificativa').fill('Aprovado com comentário aberto');
    await page.getByRole('dialog').getByRole('button', { name: 'Confirmar' }).click();
    await expect(
      page.getByText(/comentário\(s\) de revisão em aberto|em aberto/).first(),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Resolver' }).click();
    await expect(page.getByText('resolvido')).toBeVisible();
    await page.getByRole('button', { name: 'Aprovar' }).click();
    await page.getByLabel('Justificativa').fill('Aprovado pelo responsável técnico');
    await page.getByRole('dialog').getByRole('button', { name: 'Confirmar' }).click();
    await expect(page.getByText('Aprovada').first()).toBeVisible();
    await snap(page, info, '7-aprovada');
  });

  await test.step('O pedido foi concluído e o painel conta o projeto aprovado', async () => {
    await page.goto('/offgrid/pedidos');
    await expect(page.getByRole('cell', { name: 'Concluído' }).first()).toBeVisible();
    await page.goto('/offgrid/painel');
    await expect(page.getByText(/Aprovado: \d+/)).toBeVisible();
    await snap(page, info, '8-painel');
  });
});
