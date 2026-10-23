#!/usr/bin/env node
/**
 * Popula a empresa de demonstração (voltex-demo) com clientes em cada etapa da Fase 11, pela própria API:
 *
 *   1. Maria Aparecida Souza — jornada COMPLETA: planta ativa, monitoramento, garantia, chamados, parcelas e portal.
 *   2. João Batista Lima     — instalação AGENDADA para o instalador (testa o app de campo e o comissionamento).
 *   3. Padaria Pão Quente    — contrato recém-assinado (testa homologação, materiais e agendamento à mão).
 *   + 6 leads com origens e contas de luz diferentes (testam a pontuação).
 *
 * Pré-requisitos: API rodando (pnpm dev), `pnpm db:seed` e as regras de exemplo ativas:
 *   TENANT_SLUG=voltex-demo node apps/api/dist/cli/seed-internal-test-rules.js
 *
 * Uso: node scripts/seed-demo-execucao.mjs   (API_URL opcional; padrão http://localhost:3000/api/v1)
 * É seguro rodar de novo: o cliente que já existe é pulado.
 * Tudo aqui é DADO DE EXEMPLO. Nenhum valor é norma, preço de mercado ou tolerância técnica.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const API = process.env.API_URL ?? 'http://localhost:3000/api/v1';
const PASSWORD = process.env.SEED_PASSWORD ?? 'Voltex@2026';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BILL = readFileSync(path.join(ROOT, 'apps/e2e/fixtures/fatura.pdf'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const day = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const iso = (hours) => new Date(Date.now() + hours * 3_600_000).toISOString();

async function login(email) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`login ${email}: ${res.status} ${await res.text()}`);
  const body = await res.json();
  return { token: body.accessToken, id: body.user?.id };
}

async function call(token, method, url, body, form) {
  const res = await fetch(`${API}${url}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: form ?? (body ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}
const get = (t, u) => call(t, 'GET', u);
const post = (t, u, b = {}) => call(t, 'POST', u, b);
const patch = (t, u, b) => call(t, 'PATCH', u, b);
const put = (t, u, b) => call(t, 'PUT', u, b);

async function until(label, check, tries = 40) {
  for (let i = 0; i < tries; i++) {
    const value = await check();
    if (value) return value;
    await sleep(1500);
  }
  throw new Error(
    `Esperei por "${label}" e não aconteceu (a API publica os eventos a cada poucos segundos).`,
  );
}

/** Conta → imóvel → UC → oportunidade → fatura validada → cálculo → cotação → proposta → aceite → contrato assinado. */
async function sale(u, c) {
  const found = await get(u.seller, `/accounts?search=${encodeURIComponent(c.name)}&pageSize=5`);
  const already = (found.items ?? found.data ?? []).find((a) => a.name === c.name);
  if (already) {
    const projects = await get(u.owner, '/projects?pageSize=100');
    const project = (projects.items ?? projects.data ?? []).find((p) => p.accountName === c.name);
    return {
      existing: true,
      accountId: already.id,
      projectId: project?.id,
      projectCode: project?.projectCode,
    };
  }

  const known = await get(u.owner, '/distributors');
  const dist =
    (Array.isArray(known) ? known : (known.items ?? known.data ?? [])).find(
      (d) => d.name === c.distributor,
    ) ?? (await post(u.owner, '/distributors', { name: c.distributor }));
  const account = await post(u.seller, '/accounts', {
    type: c.type ?? 'PERSON',
    name: c.name,
    document: c.document,
  });
  await post(u.seller, `/accounts/${account.id}/contacts`, {
    name: c.contact,
    email: c.email,
    phone: c.phone,
    isPrimary: true,
  });
  const site = await post(u.seller, `/accounts/${account.id}/sites`, {
    name: c.siteName,
    street: c.street,
    number: c.number,
    district: c.district,
    city: c.city,
    state: 'CE',
    zip: c.zip,
    latitude: c.lat,
    longitude: c.lon,
    intake: {
      roofType: 'CERAMIC',
      roofAzimuthDegrees: 0,
      tiltDegrees: 15,
      shading: 'NONE',
      availableAreaM2: c.area,
      entryBreakerAmps: 63,
      groundingAdequate: true,
    },
  });
  const unit = await post(u.seller, `/accounts/${account.id}/consumer-units`, {
    number: c.uc,
    distributorId: dist.id,
    customerGroup: 'B',
    phaseSystem: 'TWO_PHASE',
  });
  const opp = await post(u.seller, '/opportunities', {
    accountId: account.id,
    siteId: site.id,
    consumerUnitId: unit.id,
  });
  for (const stage of ['FIRST_CONTACT', 'QUALIFICATION', 'BILL_PENDING'])
    await post(u.seller, `/opportunities/${opp.id}/stage`, { stage });

  const form = new FormData();
  form.append('opportunityId', opp.id);
  form.append('file', new Blob([BILL], { type: 'application/pdf' }), 'fatura.pdf');
  const bill = await call(u.seller, 'POST', '/energy-bills', null, form);
  await post(u.seller, `/energy-bills/${bill.id}/validate`, {
    fields: {
      ucNumber: c.uc,
      customerGroup: 'B',
      phaseSystem: 'TWO_PHASE',
      consumptionHistory: Array.from({ length: 12 }, (_, i) => ({
        month: `2026-${String(i + 1).padStart(2, '0')}`,
        kwh: c.kwh,
      })),
    },
  });
  const ctx = await get(u.seller, `/opportunities/${opp.id}/calculation-context`);
  await post(u.seller, `/opportunities/${opp.id}/calculations`, {
    title: 'Dimensionamento inicial',
    input: {
      consumptionMonthlyKwh: ctx.consumptionMonthlyKwh?.length
        ? ctx.consumptionMonthlyKwh
        : Array(12).fill(c.kwh),
      availabilityCostKwh: 50,
      hspMonthly: Array(12).fill(5),
      performanceRatio: 0.8,
      latitude: ctx.latitude ?? c.lat,
      roofAzimuthDegrees: 0,
      tiltDegrees: 15,
      availableAreaM2: c.area,
      customerGroup: 'B',
      modulePowerWp: 550,
      moduleAreaM2: 2.58,
      tariffCentsPerKwh: 95,
      costPerWpCents: 450,
    },
  });
  await post(u.seller, `/opportunities/${opp.id}/guard/evaluate`);
  await post(u.seller, `/opportunities/${opp.id}/stage`, { stage: 'QUOTING' });
  const quote = await post(u.seller, `/opportunities/${opp.id}/quotes`, {
    title: 'Proposta base',
    items: [
      {
        category: 'MODULE',
        description: 'Módulo fotovoltaico 550 Wp',
        quantity: c.modules,
        unitCostCents: 60_000,
      },
      {
        category: 'INVERTER',
        description: 'Inversor string 5 kW',
        quantity: 1,
        unitCostCents: 250_000,
      },
      {
        category: 'STRUCTURE',
        description: 'Estrutura para telhado cerâmico',
        quantity: 1,
        unitCostCents: 120_000,
      },
    ],
    costs: {
      freightCents: 40_000,
      installationCents: 200_000,
      travelCents: 20_000,
      otherCostsCents: 10_000,
      commissionRate: 0.05,
      taxRate: 0.06,
      financingRate: 0.02,
      contingencyRate: 0.03,
    },
    priceCents: c.priceCents,
  });
  const proposal = await post(u.seller, `/opportunities/${opp.id}/proposals`, {
    quoteIds: [quote.id],
    paymentTerms: '30% de entrada + saldo em 6 parcelas',
  });
  const sent = await post(u.seller, `/proposals/${proposal.id}/send`);
  const publicToken = String(sent.publicUrl).split('/p/')[1];
  const accepted = await fetch(`${API}/public/proposals/${publicToken}/accept`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: c.contact, acknowledge: true }),
  });
  if (!accepted.ok) throw new Error(`aceite da proposta: ${accepted.status}`);
  const contract = await post(u.manager, `/opportunities/${opp.id}/contracts`, {});
  const signForm = new FormData();
  signForm.append('file', new Blob([BILL], { type: 'application/pdf' }), 'contrato-assinado.pdf');
  const signed = await call(u.manager, 'POST', `/contracts/${contract.id}/sign`, null, signForm);
  return {
    accountId: account.id,
    opportunityId: opp.id,
    projectId: signed.projectId,
    projectCode: opp.projectCode,
  };
}

async function installationOf(u, projectId) {
  return until('instalação criada', async () => {
    const list = await get(u.ops, `/operations/installations?pageSize=100`);
    return (list.items ?? list.data ?? []).find((i) => i.projectId === projectId);
  });
}

/** Aprova a homologação (checklist, protocolo, vistoria, aprovação). */
async function approveHomologation(u, projectId) {
  const project = await get(u.owner, `/projects/${projectId}`);
  for (const item of project.checklist.filter((i) => i.required && i.status === 'PENDING'))
    await patch(u.ops, `/projects/${projectId}/checklist/${item.id}`, { status: 'DONE' });
  await post(u.ops, `/projects/${projectId}/status`, {
    status: 'SUBMITTED',
    protocolNumber: `PROTO-${projectId.slice(0, 6).toUpperCase()}`,
  });
  await post(u.ops, `/projects/${projectId}/status`, { status: 'INSPECTION' });
  await post(u.ops, `/projects/${projectId}/status`, { status: 'APPROVED' });
}

async function receiveMaterials(u, installationId, modules) {
  await until('instalação aguardando material', async () => {
    const inst = await get(u.ops, `/operations/installations/${installationId}`);
    return inst.status === 'AWAITING_MATERIAL' && inst;
  });
  const items = [
    {
      category: 'MODULE',
      description: 'Módulo fotovoltaico 550 Wp',
      quantity: modules,
      unit: 'un',
    },
    { category: 'INVERTER', description: 'Inversor string 5 kW', quantity: 1, unit: 'un' },
    {
      category: 'STRUCTURE',
      description: 'Estrutura para telhado cerâmico',
      quantity: 1,
      unit: 'cj',
    },
  ];
  for (const item of items) {
    const created = await post(
      u.ops,
      `/operations/installations/${installationId}/materials`,
      item,
    );
    await post(u.ops, `/operations/materials/${created.id}/order`, {
      supplier: 'Distribuidora Solar Nordeste',
      purchaseOrder: `PC-${Math.floor(Math.random() * 9000 + 1000)}`,
    });
    await post(u.ops, `/operations/materials/${created.id}/receive`);
  }
  await until('materiais prontos', async () => {
    const inst = await get(u.ops, `/operations/installations/${installationId}`);
    return inst.status === 'MATERIAL_READY';
  });
}

const CLIENTS = {
  helena: {
    name: 'Helena Duarte Campos',
    document: '390.533.447-05',
    contact: 'Helena Duarte Campos',
    email: 'helena.campos@example.com',
    phone: '(85) 98877-4004',
    siteName: 'Residência',
    street: 'Rua Padre Valdevino',
    number: '510',
    district: 'Joaquim Távora',
    city: 'Fortaleza',
    zip: '60135-040',
    lat: -3.7392,
    lon: -38.5104,
    uc: '61543210-9',
    distributor: 'Enel Ceará (exemplo)',
    kwh: 480,
    area: 70,
    modules: 8,
    priceCents: 1_980_000,
  },
  maria: {
    name: 'Maria Aparecida Souza',
    document: '529.982.247-25',
    contact: 'Maria Aparecida Souza',
    email: 'maria.souza@example.com',
    phone: '(85) 98877-1001',
    siteName: 'Residência',
    street: 'Rua das Orquídeas',
    number: '245',
    district: 'Aldeota',
    city: 'Fortaleza',
    zip: '60150-160',
    lat: -3.7319,
    lon: -38.5267,
    uc: '31245678-1',
    distributor: 'Enel Ceará (exemplo)',
    kwh: 520,
    area: 70,
    modules: 8,
    priceCents: 1_980_000,
  },
  joao: {
    name: 'João Batista Lima',
    document: '111.444.777-35',
    contact: 'João Batista Lima',
    email: 'joao.lima@example.com',
    phone: '(85) 98877-2002',
    siteName: 'Casa de praia',
    street: 'Avenida Beira Mar',
    number: '1200',
    district: 'Meireles',
    city: 'Fortaleza',
    zip: '60165-121',
    lat: -3.7246,
    lon: -38.4938,
    uc: '41987654-3',
    distributor: 'Enel Ceará (exemplo)',
    kwh: 640,
    area: 90,
    modules: 10,
    priceCents: 2_450_000,
  },
  padaria: {
    type: 'COMPANY',
    name: 'Padaria Pão Quente Ltda',
    document: '11.222.333/0001-81',
    contact: 'Carlos Eduardo Pinheiro',
    email: 'carlos@paoquente.example.com',
    phone: '(85) 3222-3003',
    siteName: 'Loja matriz',
    street: 'Rua Major Facundo',
    number: '88',
    district: 'Centro',
    city: 'Fortaleza',
    zip: '60025-100',
    lat: -3.7275,
    lon: -38.5243,
    uc: '51765432-7',
    distributor: 'Enel Ceará (exemplo)',
    kwh: 900,
    area: 120,
    modules: 12,
    priceCents: 3_200_000,
  },
};

const LEADS = [
  {
    name: 'Ricardo Menezes',
    email: 'ricardo.menezes@example.com',
    phone: '(85) 99111-0001',
    source: 'REFERRAL',
    segment: 'RESIDENTIAL',
    city: 'Fortaleza',
    state: 'CE',
    monthlyBillCents: 85_000,
    notes: 'Indicação do cliente Maria. Conta alta no verão.',
  },
  {
    name: 'Fazenda Boa Vista',
    phone: '(88) 99111-0002',
    source: 'WHATSAPP',
    segment: 'RURAL',
    city: 'Sobral',
    state: 'CE',
    monthlyBillCents: 240_000,
    notes: 'Irrigação. Quer proposta com bombeamento.',
  },
  {
    name: 'Clínica Vida Plena',
    email: 'contato@vidaplena.example.com',
    phone: '(85) 99111-0003',
    source: 'LANDING_PAGE',
    segment: 'COMMERCIAL',
    city: 'Fortaleza',
    state: 'CE',
    monthlyBillCents: 410_000,
    notes: 'Pediu orçamento pelo site.',
  },
  {
    name: 'Indústria Metalúrgica Norte',
    email: 'compras@metalnorte.example.com',
    phone: '(85) 99111-0004',
    source: 'FORM',
    segment: 'INDUSTRIAL',
    city: 'Maracanaú',
    state: 'CE',
    monthlyBillCents: 1_800_000,
  },
  {
    name: 'Ana Paula Ferreira',
    phone: '(85) 99111-0005',
    source: 'CAMPAIGN',
    segment: 'RESIDENTIAL',
    city: 'Caucaia',
    state: 'CE',
    monthlyBillCents: 32_000,
    notes: 'Veio do anúncio; conta baixa.',
  },
  {
    name: 'Sítio Recanto Verde',
    phone: '(85) 99111-0006',
    source: 'MANUAL',
    segment: 'RURAL',
    city: 'Pacatuba',
    state: 'CE',
  },
];

const REVIEWER = 'TESTE INTERNO (valores de exemplo, sem revisão de engenheiro)';
const REGISTRATION = 'SEM REGISTRO (teste interno)';

/** Cria e ativa uma nova versão da regra (a anterior é aposentada). */
async function swapRule(u, key, definition, reference) {
  const created = await post(u.owner, '/rules', {
    key,
    definition,
    sources: [{ type: 'INTERNAL_POLICY', reference: `TESTE INTERNO: ${reference}` }],
  });
  await post(u.owner, `/rules/${created.id}/activate`, {
    reviewedBy: REVIEWER,
    reviewedByRegistration: REGISTRATION,
  });
}

/** Homologação aprovada → materiais → ordem de instalação executada em campo → ordem de comissionamento iniciada. */
async function reachCommissioning(u, sold, c, crew) {
  const inst = await installationOf(u, sold.projectId);
  await approveHomologation(u, sold.projectId);
  await receiveMaterials(u, inst.id, c.modules);
  const order = await post(u.ops, '/operations/work-orders', {
    installationId: inst.id,
    type: 'INSTALLATION',
    title: 'Instalar o sistema fotovoltaico',
    crewId: crew.id,
    scheduledStart: iso(-30),
    scheduledEnd: iso(-22),
    checklist: ['Fixar a estrutura', 'Instalar módulos e inversor', 'Conferir o aterramento'],
  });
  const act = (extra) => ({
    clientActionId: crypto.randomUUID(),
    workOrderId: order.id,
    capturedAt: new Date().toISOString(),
    ...extra,
  });
  await post(u.installer, '/operations/field/sync', {
    actions: [
      act({ type: 'START', geo: { latitude: c.lat, longitude: c.lon, accuracy: 9 } }),
      act({ type: 'NOTE', text: 'Telhado liberado; cliente acompanhou a instalação.' }),
      act({ type: 'COMPLETE', geo: { latitude: c.lat, longitude: c.lon, accuracy: 7 } }),
    ],
  });
  const commissioningOrder = await until('ordem de comissionamento', async () => {
    const dto = await get(u.ops, `/operations/installations/${inst.id}`);
    return dto.workOrders.find((o) => o.type === 'COMMISSIONING');
  });
  await patch(u.ops, `/operations/work-orders/${commissioningOrder.id}`, {
    crewId: crew.id,
    scheduledStart: iso(-20),
    scheduledEnd: iso(-16),
  });
  await post(u.installer, `/operations/work-orders/${commissioningOrder.id}/start`);
  return { ...inst, commissioningOrderId: commissioningOrder.id };
}

/** Ensaios → aprovação do RT → aceite → planta → monitoramento por planilha → financeiro → portal. */
async function finishJourney(u, sold, c, inst, crew) {
  const rec = (await get(u.ops, `/operations/installations/${inst.id}/commissioning`)).current;
  await patch(u.ops, `/operations/commissioning/${rec.id}`, {
    conditions: { irradianceWm2: 800, moduleTempC: 45, ambientC: 31 },
  });
  for (const test of rec.tests)
    await patch(u.ops, `/operations/commissioning/tests/${test.id}`, { passed: true });
  await post(u.installer, `/operations/work-orders/${inst.commissioningOrderId}/complete`);
  await post(u.rt, `/operations/commissioning/${rec.id}/decision`, { decision: 'APPROVE' });
  await until('aceite do cliente pendente', async () => {
    const i = await get(u.ops, `/operations/installations/${inst.id}`);
    return i.status === 'CUSTOMER_ACCEPTANCE';
  });
  await post(u.ops, `/operations/installations/${inst.id}/acceptance`, {
    acceptedByName: c.contact,
    channel: 'OFFICE',
    note: 'Aceite registrado no escritório (dado de exemplo).',
  });
  const plant = await until('planta criada', async () => {
    const list = await get(u.om, '/operations/plants?pageSize=100');
    return (list.items ?? list.data ?? []).find((p) => JSON.stringify(p).includes(c.name));
  });
  // A geração esperada vem do projeto técnico (Engine); a venda de demonstração não tem um. Para o gráfico real ×
  // esperado e a regra de desvio funcionarem, grava-se um esperado de EXEMPLO direto no banco de desenvolvimento
  // (8 módulos de 550 Wp × 5 HSP × PR 0,8 ≈ 528 kWh/mês). Sem o Docker local, o passo é pulado com aviso.
  try {
    const monthly = JSON.stringify(Array(12).fill(528));
    execFileSync(
      'docker',
      [
        'exec',
        process.env.DB_CONTAINER ?? 'voltex-dev-postgres-1',
        'psql',
        '-U',
        'voltex',
        '-d',
        'voltex',
        '-c',
        `update plants set expected_monthly_kwh='${monthly}', expected_annual_kwh=6336, expected_source='EXEMPLO DE DEMONSTRAÇÃO: 8 × 550 Wp, 5 HSP, PR 0,8' where id='${plant.id}'`,
      ],
      { stdio: 'ignore' },
    );
  } catch {
    console.warn(
      '! Não consegui gravar a geração esperada de exemplo (Docker/psql); o gráfico real × esperado ficará sem referência.',
    );
  }
  // 30 dias de geração em planilha; os 6 últimos bem abaixo, para o gráfico real × esperado mostrar a diferença.
  const rows = ['data;kwh'];
  for (let i = 30; i >= 1; i--) rows.push(`${day(-i)};${i <= 6 ? '9,5' : '17,8'}`);
  await post(u.om, `/operations/plants/${plant.id}/monitoring/import`, { csv: rows.join('\n') });
  const fin = `/projects/${sold.projectId}/finance`;
  const entrada = await post(u.finance, `${fin}/receivables`, {
    referenceId: 'CT-0001',
    order: 1,
    amountCents: 594_000,
    dueOn: day(-25),
  });
  await post(u.finance, `${fin}/receivables/${entrada.id}/pay`, {
    paymentMethod: 'PIX',
    paidOn: day(-25),
  });
  await post(u.finance, `${fin}/receivables`, {
    referenceId: 'CT-0001',
    order: 2,
    amountCents: 231_000,
    dueOn: day(-3),
  });
  await post(u.finance, `${fin}/receivables`, {
    referenceId: 'CT-0001',
    order: 3,
    amountCents: 231_000,
    dueOn: day(27),
  });
  await post(u.finance, `${fin}/costs`, {
    category: 'MATERIAL',
    description: 'Módulos e inversor',
    estimatedCents: 730_000,
    actualCents: 705_000,
    supplier: 'Distribuidora Solar Nordeste',
  });
  await post(u.manager, '/portal-access', { accountId: sold.accountId, email: c.email });
}

async function main() {
  // O login limita 5 tentativas por minuto: entra em lotes de 4, esperando a janela virar.
  const emails = [
    'owner',
    'vendedor',
    'gestor',
    'operacao',
    'rt',
    'financeiro',
    'instalador',
    'posvenda',
  ];
  const sessions = [];
  for (const [i, name] of emails.entries()) {
    if (i > 0 && i % 4 === 0) {
      console.log('… esperando 65 s pelo limite de logins');
      await sleep(65_000);
    }
    sessions.push(await login(`${name}@voltex.demo`));
  }
  const [owner, seller, manager, ops, rt, finance, installer, om] = sessions;
  const u = {
    owner: owner.token,
    seller: seller.token,
    manager: manager.token,
    ops: ops.token,
    rt: rt.token,
    finance: finance.token,
    installer: installer.token,
    om: om.token,
  };

  const policies = await get(u.manager, '/margin-policies');
  if (policies.length === 0)
    await post(u.manager, '/margin-policies', { name: 'Mínimo geral', minMarginRate: 0.2 });

  const crews = await get(u.ops, '/operations/crews');
  let crew = crews.find((c) => c.name === 'Equipe Alfa');
  if (!crew)
    crew = await post(u.ops, '/operations/crews', {
      name: 'Equipe Alfa',
      memberIds: [installer.id],
    });

  // ---- 3. Padaria: só o contrato assinado ----
  const padaria = await sale(u, CLIENTS.padaria);
  console.log(
    padaria && !padaria.existing
      ? `✔ Padaria Pão Quente: projeto ${padaria.projectCode}`
      : '• Padaria Pão Quente já existe',
  );

  // ---- 2. João: instalação agendada para o instalador ----
  const joao = await sale(u, CLIENTS.joao);
  if (joao && !joao.existing) {
    const inst = await installationOf(u, joao.projectId);
    await approveHomologation(u, joao.projectId);
    await receiveMaterials(u, inst.id, CLIENTS.joao.modules);
    await post(u.ops, '/operations/work-orders', {
      installationId: inst.id,
      type: 'INSTALLATION',
      title: 'Instalar o sistema fotovoltaico',
      crewId: crew.id,
      scheduledStart: iso(18),
      scheduledEnd: iso(26),
      checklist: [
        'Conferir os módulos recebidos (quantidade e avarias)',
        'Fixar a estrutura no telhado',
        'Instalar os módulos e conectar as strings',
        'Instalar o inversor e o quadro de proteção',
        'Conferir o aterramento',
      ],
    });
    console.log(
      `✔ João Batista Lima: projeto ${joao.projectCode}, ordem de instalação agendada para o instalador`,
    );
  } else console.log('• João Batista Lima já existe');

  // ---- 1. Maria: parada no comissionamento (com o modelo completo de ensaios) ----
  const maria = await sale(u, CLIENTS.maria);
  if (maria && !maria.existing) {
    await reachCommissioning(u, maria, CLIENTS.maria, crew);
    console.log(
      `✔ Maria Aparecida Souza: projeto ${maria.projectCode}, comissionamento EM ANDAMENTO (modelo completo de ensaios)`,
    );
  } else console.log('• Maria Aparecida Souza já existe');

  // ---- 0. Helena: jornada COMPLETA, até planta, monitoramento, parcelas e portal ----
  // O modelo completo de ensaios de strings só pode ser julgado com os dados elétricos do projeto técnico (Engine).
  // Para a jornada completa de demonstração, a regra ativa vira um roteiro só de conferências (CHECK) enquanto a
  // Helena é comissionada; depois o modelo completo volta a ser a regra ativa.
  const helena = await sale(u, CLIENTS.helena);
  const helenaPlants = await get(u.om, '/operations/plants?pageSize=100');
  const helenaDone = (helenaPlants.items ?? helenaPlants.data ?? []).some((p) =>
    JSON.stringify(p).includes(CLIENTS.helena.name),
  );
  if (helena && !helenaDone) {
    const rules = await get(u.owner, '/rules?key=ops.commissioning');
    const active = rules.find((r) => r.status === 'ACTIVE');
    const fullDefinition = active.definition;
    const simple = {
      tests: fullDefinition.tests.filter((t) => t.kind === 'CHECK').slice(0, 6),
    };
    await swapRule(u, 'ops.commissioning', simple, 'Roteiro só de conferências (demonstração)');
    try {
      const inst = await reachCommissioning(u, helena, CLIENTS.helena, crew);
      await finishJourney(u, helena, CLIENTS.helena, inst, crew);
    } finally {
      await swapRule(
        u,
        'ops.commissioning',
        fullDefinition,
        'Modelo completo de ensaios (exemplo)',
      );
    }
    console.log(
      `✔ Helena Duarte Campos: projeto ${helena.projectCode} com planta ativa, monitoramento, parcelas e portal liberado`,
    );
  } else console.log('• Helena Duarte Campos já existe');

  // ---- Leads ----
  const existing = await get(u.seller, '/leads?pageSize=100');
  const have = new Set((existing.items ?? existing.data ?? []).map((l) => l.name));
  let created = 0;
  for (const lead of LEADS) {
    if (have.has(lead.name)) continue;
    await post(u.seller, '/leads', lead);
    created++;
  }
  console.log(`✔ Leads: ${created} criado(s)`);
  console.log('\nPronto. Roteiro: docs/07-desenvolvimento/verificacao-manual.md (Fase 11).');
}

main().catch((e) => {
  console.error('\n✘', e.message);
  process.exit(1);
});
