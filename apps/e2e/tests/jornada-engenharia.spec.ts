import { gzipSync } from 'node:zlib';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import pg from 'pg';
import { E2E_DATABASE_URL, WEB_PORT } from '../env';
import { USERS, api, apiToken, ensureMarginPolicy, loginUi, prepareOpportunity } from './helpers';

/**
 * JORNADA DA ENGENHARIA: pedido amarelo → projeto técnico aprovado → relatório do cliente → cotação.
 *
 * Quem faz o quê: o engenheiro (administrador da empresa de demonstração) abre o pedido, revisa o projeto e envia;
 * o responsável técnico (dono) comenta, resolve e aprova. O DESENHO (strings, cabos, premissas) é gravado pela API,
 * como o engenheiro já teria feito nas etapas de edição; a tela confere o resultado de cada etapa. A série horária
 * da Central é uma "resposta gravada" colocada no cache (nenhum conector externo é ligado nos testes).
 */
const APP = `http://localhost:${WEB_PORT}`;
const LAT = -15.78;
const LON = -47.93;

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

/** Série de 2025 em céu claro simplificado (forma de sino por hora solar), gravada no cache global da Central. */
async function gravarSerie() {
  const ghi: number[] = [];
  const dhi: number[] = [];
  const temp: number[] = [];
  for (let i = 0; i < 8760; i++) {
    const hora = (i % 24) - 3 + LON / 15; // hora solar aproximada do local (UTC → LST)
    const altura = Math.max(0, Math.sin(((hora - 6) / 12) * Math.PI));
    const g = Math.round(850 * altura ** 1.1);
    ghi.push(g);
    dhi.push(Math.round(g * 0.16));
    temp.push(24);
  }
  const serie = {
    startAt: '2025-01-01T00:00:00Z',
    timeStandard: 'UTC',
    ghiWhM2: ghi,
    dhiWhM2: dhi,
    tempC: temp,
    missingHours: 0,
  };
  const client = new pg.Client({ connectionString: E2E_DATABASE_URL() });
  await client.connect();
  try {
    const source = (await client.query(`SELECT id FROM data_sources WHERE key = 'nasa-power'`))
      .rows[0];
    const collection = (
      await client.query(
        `INSERT INTO data_collections (id, source_id, status, summary) VALUES (gen_random_uuid(), $1, 'SUCCEEDED', '{"recorded":true}') RETURNING id`,
        [source.id],
      )
    ).rows[0];
    await client.query(
      `INSERT INTO weather_series (id, source_id, kind, latitude, longitude, period, summary, payload, collection_id)
       VALUES (gen_random_uuid(), $1, 'HOURLY', $2, $3, '2025', $4, $5, $6)
       ON CONFLICT DO NOTHING`,
      [
        source.id,
        LAT,
        LON,
        JSON.stringify({
          ghiKwhM2Day: Array(12).fill(5.4),
          tempMeanC: Array(12).fill(24),
          tempMinC: Array(12).fill(15),
          tempMaxC: Array(12).fill(32),
        }),
        gzipSync(Buffer.from(JSON.stringify(serie))),
        collection.id,
      ],
    );
  } finally {
    await client.end();
  }
}

async function pedidoAmarelo(opportunityId: string, tenantSlugQuery: string) {
  const client = new pg.Client({ connectionString: E2E_DATABASE_URL() });
  await client.connect();
  try {
    const tenant = (await client.query(tenantSlugQuery)).rows[0];
    await client.query(
      `INSERT INTO engineering_requests (id, tenant_id, opportunity_id, reason, updated_at)
       VALUES (gen_random_uuid(), $1, $2, 'Semáforo amarelo: sombreamento relevante', now())`,
      [tenant.id, opportunityId],
    );
  } finally {
    await client.end();
  }
}

test('do pedido amarelo ao projeto técnico aprovado e à cotação', async ({ page }, info) => {
  const stamp = `${Date.now()}`.slice(-6);
  let admin = '';
  const ids: Record<string, string> = {};
  let oportunidade = { id: '', projectCode: '', accountName: '' };

  await test.step('Preparação (API): catálogo aprovado, regras revisadas, série gravada e pedido amarelo', async () => {
    admin = await apiToken(USERS.admin);
    const owner = await apiToken(USERS.owner);
    await ensureMarginPolicy(owner);
    await gravarSerie();
    oportunidade = await prepareOpportunity(admin, 'Cliente Engenharia');
    await pedidoAmarelo(oportunidade.id, `SELECT id FROM tenants ORDER BY created_at LIMIT 1`);

    const item = async (key: string, kind: string, model: string, spec: object, cost: number) => {
      const created = await api('/catalog/items', admin, {
        body: { kind, manufacturer: `Jornada ${stamp}`, model, spec, referenceCostCents: cost },
      });
      await api(`/catalog/items/${created.id}/approve`, owner, { method: 'POST' });
      ids[key] = created.id;
    };
    await item(
      'module',
      'MODULE',
      'M550',
      {
        technology: 'MONO_SI',
        pmaxWp: 550,
        vmppV: 41.7,
        imppA: 13.19,
        vocV: 49.7,
        iscA: 13.98,
        betaVocPctPerC: -0.27,
        alphaIscPctPerC: 0.05,
        gammaPmaxPctPerC: -0.34,
        noctC: 45,
        maxSeriesFuseA: 25,
        lengthMm: 2278,
        widthMm: 1134,
      },
      60000,
    );
    await item(
      'inverter',
      'INVERTER',
      'INV5K',
      {
        topology: 'STRING',
        pAcNomW: 5000,
        pAcMaxW: 5500,
        pDcMaxW: 7500,
        vDcMaxV: 1100,
        vStartV: 180,
        mpptMinV: 140,
        mpptMaxV: 1000,
        mpptCount: 2,
        inputsPerMppt: 3,
        iMaxPerMpptA: 60,
        iscMaxPerMpptA: 80,
        vAcV: 220,
        phases: 1,
        iAcMaxA: 25,
      },
      400000,
    );
    await item(
      'fuse',
      'PROTECTION',
      'F20',
      { protectionKind: 'FUSE_DC', ratedCurrentA: 20, ratedVoltageV: 1000 },
      600,
    );
    await item(
      'disc',
      'PROTECTION',
      'S63',
      { protectionKind: 'DISCONNECTOR_DC', ratedCurrentA: 63, ratedVoltageV: 1000 },
      15000,
    );
    await item(
      'surge',
      'PROTECTION',
      'DPS',
      { protectionKind: 'SURGE_DC', ratedVoltageV: 600 },
      8000,
    );
    await item(
      'breaker',
      'PROTECTION',
      'D32',
      { protectionKind: 'BREAKER_AC', ratedCurrentA: 32, ratedVoltageV: 230, poles: 2 },
      4000,
    );
    await item(
      'rcd',
      'PROTECTION',
      'DR40',
      { protectionKind: 'RCD', ratedCurrentA: 40, sensitivityMa: 30 },
      3500,
    );
    await item(
      'dc6',
      'CABLE',
      'DC6',
      { cableKind: 'DC_SOLAR', crossSectionMm2: 6, voltageRatingV: 1800 },
      1000,
    );
    await item(
      'ac6',
      'CABLE',
      'AC6',
      { cableKind: 'AC', crossSectionMm2: 6, voltageRatingV: 750 },
      800,
    );
    const rule = async (key: string, definition: object) => {
      const created = await api('/rules', owner, {
        body: {
          key,
          definition,
          sources: [{ type: 'INTERNAL_POLICY', reference: 'Regra de teste da jornada' }],
        },
      });
      await api(`/rules/${created.id}/activate`, owner, {
        body: {
          reviewedBy: 'Eng. Responsável (teste)',
          reviewedByRegistration: 'CREA-SP 123456',
        },
      });
    };
    // Valores de TESTE (não são regra de nenhuma norma).
    await rule('engine.design', {
      parameters: {
        hotCellIrradianceWm2: 1000,
        dcAcRatioMin: 0.8,
        dcAcRatioMax: 1.5,
        maxParallelStringsWithoutFuse: 2,
        fuseMinFactor: 1.25,
        dcSwitchCurrentFactor: 1.25,
        acBreakerFactor: 1.25,
        rcdSensitivityMa: 30,
      },
    });
    await rule('engine.cables', {
      parameters: {
        conductorTempC: 70,
        maxVoltageDropDcPct: 1,
        maxVoltageDropAcPct: 3,
        cableCurrentFactorDc: 1.25,
        cableCurrentFactorAc: 1,
      },
      tables: {
        ampacity: [
          { crossSectionMm2: 6, method: 'A', ampacityA: 52 },
          { crossSectionMm2: 10, method: 'A', ampacityA: 72 },
        ],
      },
    });
    await rule('engine.connection', {
      rules: [
        {
          id: 'potencia-acima-da-disponibilizada',
          when: { field: 'plant.acKw', op: '>', valueFrom: 'connection.availableKw' },
          then: {
            severity: 'BLOCKING',
            code: 'CONN_POWER_ABOVE_AVAILABLE',
            message: 'A potência CA excede a disponibilizada.',
            source: 'Regra de teste da jornada',
          },
        },
      ],
    });
    await rule('engine.economics', { parameters: { compensationFactor: 1 } });
  });

  await test.step('1. O engenheiro abre o pedido amarelo e cria o projeto técnico', async () => {
    await loginUi(page, USERS.admin);
    await expect(page.getByRole('heading', { name: /Olá/ })).toBeVisible();
    await page.goto(`${APP}/engine/pedidos`);
    const linha = page.getByRole('row').filter({ hasText: oportunidade.projectCode });
    await expect(linha).toBeVisible();
    await snap(page, info, 'Fila de pedidos de engenharia');
    await linha.getByRole('button', { name: 'Abrir projeto' }).click();
    const dialog = page.getByRole('dialog');
    // A oportunidade só tem a latitude: o sistema pede o local completo antes de abrir o projeto.
    await expect(dialog.getByLabel('Latitude')).toBeVisible();
    await dialog.getByLabel('Latitude').fill(String(LAT).replace('.', ','));
    await dialog.getByLabel('Longitude').fill(String(LON).replace('.', ','));
    await snap(page, info, 'Local do projeto');
    await dialog.getByRole('button', { name: 'Abrir o projeto' }).click();
    await expect(page.getByRole('heading', { name: /Versão 1/ })).toBeVisible();
  });

  let versionUrl = '';
  await test.step('2. O desenho é gravado e cada etapa mostra o resultado oficial do servidor', async () => {
    versionUrl = page.url();
    const versionId = versionUrl.split('/versoes/')[1] ?? '';
    const desenho = {
      schemaVersion: 1,
      site: {
        latitude: LAT,
        longitude: LON,
        city: 'Brasília',
        state: 'DF',
        designTminC: 5,
        designTmaxAmbientC: 35,
        designTemperatureSource: 'Jornada de teste',
      },
      defaultModuleId: ids.module,
      surfaces: [
        {
          id: 's1',
          name: 'Água norte',
          azimuthDegrees: 0,
          tiltDegrees: 20,
          widthM: 20,
          depthM: 10,
        },
      ],
      inverters: [
        {
          id: 'e1',
          inverterId: ids.inverter,
          mppts: [
            { strings: [{ id: 'g1', surfaceId: 's1', modulesInSeries: 6, parallel: 2 }] },
            { strings: [] },
          ],
        },
      ],
      cables: [
        {
          id: 'c1',
          label: 'String',
          kind: 'DC_STRING',
          inverterEntryId: 'e1',
          mpptIndex: 0,
          lengthM: 20,
          count: 2,
          installMethod: 'A',
        },
        {
          id: 'c2',
          label: 'Saída CA',
          kind: 'AC',
          inverterEntryId: 'e1',
          lengthM: 10,
          installMethod: 'A',
        },
      ],
      simulation: {
        source: 'nasa-power',
        year: 2025,
        lossPct: 14,
        inverterEfficiencyPct: 96,
        albedo: 0.2,
        comparisonWarningPct: 15,
      },
      connection: { availablePowerKw: 10, phases: 1, gridZero: false },
      economics: {
        monthlyConsumptionKwh: 900,
        tariffCentsPerKwh: 90,
        tariffSource: 'Fatura da jornada',
        horizonYears: 25,
        financing: { downPaymentPct: 30, annualRatePct: 18, termMonths: 36, system: 'PRICE' },
        scenarios: [{ name: 'Geração -10%', generationFactor: 0.9 }],
      },
    };
    const salvo = await api(`/engineering/versions/${versionId}/design`, admin, {
      method: 'PUT',
      body: { design: desenho },
    });
    expect(salvo.results.pending).toEqual([]);
    await page.reload();
    await expect(page.getByRole('heading', { name: /Versão 1/ })).toBeVisible();

    await page.getByRole('button', { name: /Equipamentos e strings/ }).click();
    await snap(page, info, 'Equipamentos, strings e compatibilidade');
    await page.getByRole('button', { name: /Proteções, cabos e materiais/ }).click();
    await snap(page, info, 'Proteções, cabos e lista de materiais');
    await page.getByRole('button', { name: /Simulação horária/ }).click();
    await expect(page.getByRole('img', { name: /Geração mensal/ })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Diagrama de perdas' })).toBeVisible();
    await snap(page, info, 'Simulação horária: mensal, dia típico e perdas', 800);
    await page.getByRole('button', { name: /Conexão/ }).click();
    await snap(page, info, 'Conexão');
    await page.getByRole('button', { name: /Economia/ }).click();
    await expect(page.getByRole('list', { name: 'Tornado de sensibilidade' })).toBeVisible();
    await expect(page.getByText(/Financiamento PRICE/)).toBeVisible();
    await snap(page, info, 'Economia: financiamento, cenários e sensibilidade', 800);
  });

  await test.step('3. O engenheiro envia a versão para revisão', async () => {
    await page.getByRole('button', { name: 'Enviar para revisão' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Enviar', exact: true }).click();
    await expect(page.getByText('Enviada', { exact: false }).first()).toBeVisible();
    await snap(page, info, 'Versão enviada');
  });

  await test.step('4. O responsável técnico comenta; o comentário aberto bloqueia a aprovação; resolvido, aprova', async () => {
    await sairEEntrarComo(page, USERS.owner);
    await page.goto(versionUrl);
    await page
      .getByLabel('Comentário de revisão')
      .fill('Confirmar a distância dos módulos ao inversor.');
    await page.getByRole('button', { name: 'Adicionar comentário' }).click();
    await expect(page.getByText('Confirmar a distância dos módulos ao inversor.')).toBeVisible();
    await page.getByRole('button', { name: 'Aprovar' }).click();
    await page.getByLabel('Justificativa').fill('Aprovado após conferência do desenho.');
    await page.getByRole('dialog').getByRole('button', { name: 'Confirmar' }).click();
    await expect(
      page.getByText(/comentário\(s\) de revisão em aberto|em aberto/).first(),
    ).toBeVisible();
    await snap(page, info, 'Aprovação bloqueada por comentário aberto');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Resolver' }).click();
    await expect(page.getByText('resolvido')).toBeVisible();
    // Quem assina é o engenheiro do local: sem os dados dele na ficha, a aprovação é recusada.
    const owner = await apiToken(USERS.owner);
    const approvedVersionId = versionUrl.split('/versoes/')[1] ?? '';
    const versao = await api<{ projectId: string }>(
      `/engineering/versions/${approvedVersionId}`,
      owner,
    );
    await api(`/engineering/projects/${versao.projectId}`, owner, {
      method: 'PATCH',
      body: {
        signatoryName: 'Maria Souza Engenheira',
        councilType: 'CREA',
        councilRegistration: 'SP-123456',
        councilState: 'SP',
        artType: 'ART',
        artNumber: '2026123456789',
        artIssuedAt: '2026-10-20',
      },
    });
    await page.getByRole('button', { name: 'Aprovar' }).click();
    await page.getByLabel('Justificativa').fill('Aprovado após conferência do desenho.');
    await page.getByRole('dialog').getByRole('button', { name: 'Confirmar' }).click();
    await expect(page.getByText('Aprovada').first()).toBeVisible();
    await snap(page, info, 'Versão aprovada e congelada');
  });

  await test.step('5. O relatório para o cliente: link único, página pública sem custos', async () => {
    await page.getByRole('button', { name: /Gerar link/ }).click();
    const texto = await page.getByText(/Copie agora/).innerText();
    const url = /https?:\/\/\S+\/r\/\S+/.exec(texto)?.[0];
    expect(url).toBeTruthy();
    await snap(page, info, 'Link do relatório do cliente');
    await page.goto(url as string);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('img', { name: /Geração mensal estimada/ })).toBeVisible();
    await expect(page.getByText(/CAPEX|margem|custo/i)).toHaveCount(0);
    await snap(page, info, 'Relatório técnico do cliente (página pública)', 800);
  });

  await test.step('6. O vendedor importa a lista de materiais aprovada na cotação da oportunidade', async () => {
    const seller = await apiToken(USERS.seller);
    const owner = await apiToken(USERS.owner);
    const projeto = await api<{ id: string }>(`/engineering/projects?pageSize=50`, owner).then(
      (r) => (r as unknown as { data: { id: string; code: string }[] }).data[0],
    );
    const snapshot = await api(`/engineering/projects/${projeto!.id}/snapshot`, owner);
    await ensureMarginPolicy(owner);
    const quote = await api(`/opportunities/${oportunidade.id}/quotes/from-engineering`, seller, {
      body: { engineeringSnapshotId: snapshot.id, priceCents: 4_500_000 },
    });
    expect(quote.engineeringSnapshotId).toBe(snapshot.id);
  });
});
