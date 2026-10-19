import { API, bearer, type SeededTenant, type TestApp } from './helpers';
import { SAMPLE_BILL, textPdf } from './crm-support';

export interface Flow {
  t: TestApp;
  tenant: SeededTenant;
  /** Tokens dos perfis usados. */
  seller: string;
  admin: string;
}

const post = (f: Flow, path: string, token: string, body: unknown = {}) =>
  f.t.http
    .post(`${API}${path}`)
    .set(bearer(token))
    .send(body as object);
const get = (f: Flow, path: string, token: string) =>
  f.t.http.get(`${API}${path}`).set(bearer(token));

export interface Ready {
  accountId: string;
  siteId: string;
  unitId: string;
  opportunityId: string;
  projectCode: string;
  calculationId: string;
}

/** Entrada do cálculo coerente com o imóvel, a UC e a fatura de `buildOpportunity`. */
export const consistentCalcInput = (ctx: {
  consumptionMonthlyKwh: number[];
  latitude: number | null;
  roofAzimuthDegrees: number | null;
  tiltDegrees: number | null;
  availableAreaM2: number | null;
  customerGroup: string | null;
}) => ({
  consumptionMonthlyKwh: ctx.consumptionMonthlyKwh,
  availabilityCostKwh: 30,
  hspMonthly: Array<number>(12).fill(5),
  performanceRatio: 0.8,
  latitude: ctx.latitude ?? undefined,
  roofAzimuthDegrees: ctx.roofAzimuthDegrees ?? undefined,
  tiltDegrees: ctx.tiltDegrees ?? undefined,
  availableAreaM2: ctx.availableAreaM2 ?? undefined,
  customerGroup: ctx.customerGroup ?? 'B',
  modulePowerWp: 550,
  moduleAreaM2: 2.58,
  tariffCentsPerKwh: 95,
  costPerWpCents: 450,
});

export interface BuildOptions {
  /** Pula a fatura validada (a triagem fica amarela). */
  withBill?: boolean;
  /** Pula o cálculo (a triagem fica vermelha). */
  withCalculation?: boolean;
  intake?: Record<string, unknown>;
  name?: string;
}

/**
 * Monta uma oportunidade completa e COERENTE (conta, imóvel com levantamento, UC com concessionária e ligação,
 * fatura validada e cálculo verde), em Pré-dimensionamento. Cada teste muda só o que quer provar.
 */
export async function buildOpportunity(f: Flow, options: BuildOptions = {}): Promise<Ready> {
  const { withBill = true, withCalculation = true } = options;
  const dist = await post(f, '/distributors', f.admin, {
    name: `Dist Fluxo ${Math.random().toString(36).slice(2, 8)}`,
  });
  const acc = (
    await post(f, '/accounts', f.seller, {
      name: options.name ?? `Cliente Fluxo ${Math.random().toString(36).slice(2, 8)}`,
    })
  ).body;
  const site = (
    await post(f, `/accounts/${acc.id}/sites`, f.seller, {
      name: 'Residência',
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
        ...(options.intake ?? {}),
      },
    })
  ).body;
  const unit = (
    await post(f, `/accounts/${acc.id}/consumer-units`, f.seller, {
      number: `UC${Math.floor(Math.random() * 1e7)}`,
      distributorId: dist.body.id,
      customerGroup: 'B',
      phaseSystem: 'TWO_PHASE',
    })
  ).body;
  const opp = (
    await post(f, '/opportunities', f.seller, {
      accountId: acc.id,
      siteId: site.id,
      consumerUnitId: unit.id,
    })
  ).body;
  for (const stage of ['FIRST_CONTACT', 'QUALIFICATION', 'BILL_PENDING'])
    await post(f, `/opportunities/${opp.id}/stage`, f.seller, { stage });

  if (withBill) {
    const bill = await f.t.http
      .post(`${API}/energy-bills`)
      .set(bearer(f.seller))
      .field('opportunityId', opp.id)
      .attach('file', await textPdf(SAMPLE_BILL), {
        filename: 'fatura.pdf',
        contentType: 'application/pdf',
      });
    const months = Array.from({ length: 12 }, (_, i) => ({
      month: `2026-${String(i + 1).padStart(2, '0')}`,
      kwh: 500,
    }));
    await post(f, `/energy-bills/${bill.body.id}/validate`, f.seller, {
      fields: {
        ucNumber: '12345678-9',
        customerGroup: 'B',
        phaseSystem: 'TWO_PHASE',
        consumptionHistory: months,
      },
    });
  } else {
    await post(f, `/opportunities/${opp.id}/stage`, f.seller, { stage: 'PRE_SIZING' });
  }

  let calculationId = '';
  if (withCalculation) {
    const ctx = (await get(f, `/opportunities/${opp.id}/calculation-context`, f.seller)).body;
    const consumption =
      ctx.consumptionMonthlyKwh.length > 0
        ? ctx.consumptionMonthlyKwh
        : Array<number>(12).fill(500);
    const calc = await post(f, `/opportunities/${opp.id}/calculations`, f.seller, {
      title: 'Cálculo do fluxo',
      input: consistentCalcInput({ ...ctx, consumptionMonthlyKwh: consumption }),
    });
    calculationId = calc.body.id;
  }
  return {
    accountId: acc.id,
    siteId: site.id,
    unitId: unit.id,
    opportunityId: opp.id,
    projectCode: opp.projectCode,
    calculationId,
  };
}

/** Itens e custos de uma cotação de referência: materiais R$ 8.500,00; preço R$ 19.800,00. */
export const referenceQuote = (overrides: Record<string, unknown> = {}) => ({
  title: 'Cenário base',
  items: [
    { category: 'MODULE', description: 'Módulo 550 Wp', quantity: 8, unitCostCents: 60_000 },
    { category: 'INVERTER', description: 'Inversor 5 kW', quantity: 1, unitCostCents: 250_000 },
    {
      category: 'STRUCTURE',
      description: 'Estrutura cerâmica',
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
  priceCents: 1_980_000,
  ...overrides,
});
