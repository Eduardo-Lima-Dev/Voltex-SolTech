import {
  validateEnergyBillSchema,
  type EnergyBillDto,
  type EnergyBillFields,
  type EnergyBillSnapshotDto,
  type ValidateEnergyBillInput,
} from '@voltex/shared';
import { parseDecimal } from '@/features/calculator/form';

/** Campos abaixo disto (ou não lidos) são destacados na revisão. */
export const LOW_CONFIDENCE = 0.75;

export interface BillFormValues {
  ucNumber: string;
  distributorName: string;
  customerName: string;
  referenceMonth: string;
  customerGroup: '' | 'A' | 'B';
  phaseSystem: '' | 'SINGLE_PHASE' | 'TWO_PHASE' | 'THREE_PHASE';
  /** Tarifa praticada em R$/kWh (com impostos). */
  tariffReais: string;
  totalReais: string;
  dueDate: string;
  consumption: { month: string; kwh: string }[];
}

const text = (n: number | undefined, digits = 4) =>
  n === undefined ? '' : String(Number(n.toFixed(digits))).replace('.', ',');

/** Valores iniciais: o último snapshot validado (se houver) ou o que a leitura automática encontrou. */
export function initialValues(
  bill: EnergyBillDto,
  latest: EnergyBillSnapshotDto | undefined,
): BillFormValues {
  const e = bill.extracted;
  const s = latest?.fields;
  const history = s?.consumptionHistory ?? e.consumptionHistory?.value ?? [];
  const tariff = s?.tariffCentsPerKwh ?? e.tariffCentsPerKwh?.value;
  const total = s?.totalAmountCents ?? e.totalAmountCents?.value;
  return {
    ucNumber: s?.ucNumber ?? e.ucNumber?.value ?? '',
    distributorName: s?.distributorName ?? e.distributorName?.value ?? '',
    customerName: s?.customerName ?? e.customerName?.value ?? '',
    referenceMonth: s?.referenceMonth ?? e.referenceMonth?.value ?? '',
    customerGroup: s?.customerGroup ?? e.customerGroup?.value ?? '',
    phaseSystem: s?.phaseSystem ?? e.phaseSystem?.value ?? '',
    tariffReais: tariff === undefined ? '' : text(tariff / 100),
    totalReais: total === undefined ? '' : text(total / 100, 2),
    dueDate: s?.dueDate ?? e.dueDate?.value ?? '',
    consumption:
      history.length > 0
        ? history.map((p) => ({ month: p.month, kwh: text(p.kwh, 2) }))
        : [{ month: '', kwh: '' }],
  };
}

/** Converte o formulário nos campos validados (só o que foi preenchido). */
export function toFields(values: BillFormValues): EnergyBillFields {
  const fields: Record<string, unknown> = {};
  if (values.ucNumber.trim()) fields.ucNumber = values.ucNumber.trim();
  if (values.distributorName.trim()) fields.distributorName = values.distributorName.trim();
  if (values.customerName.trim()) fields.customerName = values.customerName.trim();
  if (values.referenceMonth) fields.referenceMonth = values.referenceMonth;
  if (values.customerGroup) fields.customerGroup = values.customerGroup;
  if (values.phaseSystem) fields.phaseSystem = values.phaseSystem;
  const tariff = parseDecimal(values.tariffReais);
  if (tariff !== undefined) fields.tariffCentsPerKwh = Number((tariff * 100).toFixed(3));
  const total = parseDecimal(values.totalReais);
  if (total !== undefined) fields.totalAmountCents = Math.round(total * 100);
  if (values.dueDate) fields.dueDate = values.dueDate;
  const history = values.consumption
    .filter((row) => row.month || row.kwh.trim())
    .map((row) => ({ month: row.month, kwh: parseDecimal(row.kwh) ?? Number.NaN }))
    .sort((a, b) => a.month.localeCompare(b.month));
  fields.consumptionHistory = history;
  return fields as EnergyBillFields;
}

export type BillErrors = Record<string, string>;

/** Valida com o mesmo schema da API; devolve as mensagens por campo (`consumption.2.kwh`, `ucNumber`...). */
export function validateBill(values: BillFormValues):
  | {
      ok: true;
      input: ValidateEnergyBillInput;
    }
  | { ok: false; errors: BillErrors } {
  const fields = toFields(values);
  const parsed = validateEnergyBillSchema.safeParse({ fields });
  if (parsed.success) return { ok: true, input: { fields } as ValidateEnergyBillInput };
  const errors: BillErrors = {};
  for (const issue of parsed.error.issues) {
    // caminhos: fields.ucNumber · fields.consumptionHistory · fields.consumptionHistory.1.kwh
    const [, key, index, sub] = issue.path.map(String);
    if (key === 'consumptionHistory' && index !== undefined)
      errors[`consumption.${index}.${sub ?? 'month'}`] ??= issue.message;
    else if (key === 'consumptionHistory') errors.consumption ??= issue.message;
    else if (key === 'tariffCentsPerKwh') errors.tariffReais ??= issue.message;
    else if (key === 'totalAmountCents') errors.totalReais ??= issue.message;
    else if (key) errors[key] ??= issue.message;
  }
  // Mensagens por linha (mais claras que as do schema): têm prioridade sobre as dele.
  values.consumption.forEach((row, i) => {
    const hasMonth = !!row.month;
    const hasValue = !!row.kwh.trim();
    if (hasMonth && !hasValue) errors[`consumption.${i}.kwh`] = 'Informe o consumo (kWh)';
    else if (hasValue && Number.isNaN(parseDecimal(row.kwh)))
      errors[`consumption.${i}.kwh`] = 'Digite um número válido';
    if (!hasMonth && hasValue) errors[`consumption.${i}.month`] = 'Informe o mês';
  });
  return { ok: false, errors };
}
