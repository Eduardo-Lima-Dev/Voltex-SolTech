import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, type Page } from '@playwright/test';
import { API_PORT, PASSWORD } from '../env';

const API = `http://localhost:${API_PORT}/api/v1`;

export const USERS = {
  owner: 'owner@voltex.demo',
  admin: 'admin@voltex.demo',
  manager: 'gestor@voltex.demo',
  seller: 'vendedor@voltex.demo',
} as const;

export async function loginUi(page: Page, email: string, password = PASSWORD): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

export async function loginAs(page: Page, email: string): Promise<void> {
  await loginUi(page, email);
  await expect(page.getByRole('heading', { name: /Olá/ })).toBeVisible();
}

// ---- Preparação pela API (o que os testes de tela não precisam repetir) ----

export async function apiToken(email: string): Promise<string> {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`login ${email}: ${res.status}`);
  return ((await res.json()) as { accessToken: string }).accessToken;
}

// As respostas da API só são lidas em campos conhecidos: tipo solto de propósito nos testes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function api<T = Record<string, any>>(
  path: string,
  token: string,
  init: { method?: string; body?: unknown; form?: FormData } = {},
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: init.method ?? (init.body || init.form ? 'POST' : 'GET'),
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
    body: init.form ?? (init.body ? JSON.stringify(init.body) : undefined),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status} ${text}`);
  return (text ? JSON.parse(text) : null) as T;
}

export const fixture = (name: string): string => path.resolve(__dirname, '../fixtures', name);

export interface PreparedOpportunity {
  id: string;
  projectCode: string;
  accountName: string;
}

/** Oportunidade completa e coerente em Pré-dimensionamento: conta, imóvel, UC, fatura validada e cálculo. */
export async function prepareOpportunity(
  token: string,
  label: string,
): Promise<PreparedOpportunity> {
  const stamp = `${Date.now()}`.slice(-6);
  const accountName = `${label} ${stamp}`;
  const dist = await api('/distributors', token, { body: { name: `Distribuidora ${stamp}` } });
  const acc = await api('/accounts', token, { body: { name: accountName } });
  const site = await api(`/accounts/${acc.id}/sites`, token, {
    body: {
      name: 'Residência',
      street: 'Rua das Flores',
      number: '10',
      city: 'Fortaleza',
      state: 'CE',
      latitude: -3.73,
      intake: {
        roofType: 'CERAMIC',
        roofAzimuthDegrees: 0,
        tiltDegrees: 15,
        shading: 'NONE',
        availableAreaM2: 80,
        entryBreakerAmps: 63,
        groundingAdequate: true,
      },
    },
  });
  const unit = await api(`/accounts/${acc.id}/consumer-units`, token, {
    body: {
      number: `UC${stamp}`,
      distributorId: dist.id,
      customerGroup: 'B',
      phaseSystem: 'TWO_PHASE',
    },
  });
  const opp = await api('/opportunities', token, {
    body: { accountId: acc.id, siteId: site.id, consumerUnitId: unit.id },
  });
  for (const stage of ['FIRST_CONTACT', 'QUALIFICATION', 'BILL_PENDING'])
    await api(`/opportunities/${opp.id}/stage`, token, { body: { stage } });
  const form = new FormData();
  form.append('opportunityId', opp.id);
  form.append(
    'file',
    new Blob([readFileSync(fixture('fatura.pdf'))], { type: 'application/pdf' }),
    'fatura.pdf',
  );
  const bill = await api('/energy-bills', token, { form });
  const months = Array.from({ length: 12 }, (_, i) => ({
    month: `2026-${String(i + 1).padStart(2, '0')}`,
    kwh: 500,
  }));
  await api(`/energy-bills/${bill.id}/validate`, token, {
    body: {
      fields: {
        ucNumber: '12345678-9',
        customerGroup: 'B',
        phaseSystem: 'TWO_PHASE',
        consumptionHistory: months,
      },
    },
  });
  const ctx = await api(`/opportunities/${opp.id}/calculation-context`, token);
  await api(`/opportunities/${opp.id}/calculations`, token, {
    body: {
      title: 'Cálculo do teste',
      input: {
        consumptionMonthlyKwh: ctx.consumptionMonthlyKwh?.length
          ? ctx.consumptionMonthlyKwh
          : Array(12).fill(500),
        availabilityCostKwh: 50,
        hspMonthly: Array(12).fill(5),
        performanceRatio: 0.8,
        latitude: ctx.latitude ?? undefined,
        roofAzimuthDegrees: 0,
        tiltDegrees: 15,
        availableAreaM2: 80,
        customerGroup: 'B',
        modulePowerWp: 550,
        moduleAreaM2: 2.58,
        tariffCentsPerKwh: 95,
        costPerWpCents: 450,
      },
    },
  });
  return { id: opp.id, projectCode: opp.projectCode, accountName };
}

/** Política de margem (20%) se a empresa ainda não tiver nenhuma. */
export async function ensureMarginPolicy(token: string): Promise<void> {
  const policies = await api<unknown[]>('/margin-policies', token);
  if (policies.length === 0)
    await api('/margin-policies', token, { body: { name: 'Mínimo geral', minMarginRate: 0.2 } });
}

/** Leva a oportunidade até a proposta enviada (devolve o token do link público). */
export async function sendProposal(
  token: string,
  opportunityId: string,
): Promise<{ proposalId: string; publicToken: string }> {
  await api(`/opportunities/${opportunityId}/guard/evaluate`, token, { method: 'POST' });
  await api(`/opportunities/${opportunityId}/stage`, token, { body: { stage: 'QUOTING' } });
  const quote = await api(`/opportunities/${opportunityId}/quotes`, token, {
    body: {
      items: [
        { category: 'MODULE', description: 'Módulo 550 Wp', quantity: 8, unitCostCents: 60000 },
        { category: 'INVERTER', description: 'Inversor', quantity: 1, unitCostCents: 250000 },
      ],
      costs: { installationCents: 200000, commissionRate: 0.05, taxRate: 0.06 },
      priceCents: 1980000,
    },
  });
  const proposal = await api(`/opportunities/${opportunityId}/proposals`, token, {
    body: { quoteIds: [quote.id], paymentTerms: '30% de entrada + 6x' },
  });
  const sent = await api(`/proposals/${proposal.id}/send`, token, { method: 'POST' });
  return { proposalId: proposal.id, publicToken: String(sent.publicUrl).split('/p/')[1] as string };
}

export async function acceptProposal(publicToken: string): Promise<void> {
  const res = await fetch(`${API}/public/proposals/${publicToken}/accept`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Maria da Silva', acknowledge: true }),
  });
  if (!res.ok) throw new Error(`aceite: ${res.status}`);
}
