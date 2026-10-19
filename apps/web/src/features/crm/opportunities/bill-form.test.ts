import { describe, expect, it } from 'vitest';
import { makeBill, makeBillSnapshot } from '@/test/fixtures';
import { initialValues, toFields, validateBill, type BillFormValues } from './bill-form';

const base = (): BillFormValues => ({
  ucNumber: '12345678-9',
  distributorName: '',
  customerName: '',
  referenceMonth: '',
  customerGroup: '',
  phaseSystem: '',
  tariffReais: '',
  totalReais: '',
  dueDate: '',
  consumption: [{ month: '2026-08', kwh: '480' }],
});

describe('initialValues', () => {
  it('parte do que a leitura automática encontrou', () => {
    const v = initialValues(makeBill(), undefined);
    expect(v.ucNumber).toBe('12345678-9');
    expect(v.distributorName).toBe('Enel Ceará');
    expect(v.phaseSystem).toBe('TWO_PHASE');
    expect(v.consumption).toEqual([
      { month: '2026-06', kwh: '400' },
      { month: '2026-07', kwh: '405' },
      { month: '2026-08', kwh: '1020' },
    ]);
  });

  it('prefere o último snapshot validado e começa com uma linha vazia quando não há consumo', () => {
    const snap = makeBillSnapshot({
      fields: {
        ucNumber: '999',
        tariffCentsPerKwh: 102.5,
        totalAmountCents: 123_456,
        consumptionHistory: [{ month: '2026-08', kwh: 480.5 }],
      },
    });
    const v = initialValues(makeBill(), snap);
    expect(v).toMatchObject({ ucNumber: '999', tariffReais: '1,025', totalReais: '1234,56' });
    expect(v.consumption).toEqual([{ month: '2026-08', kwh: '480,5' }]);
    expect(initialValues(makeBill({ extracted: {} }), undefined).consumption).toEqual([
      { month: '', kwh: '' },
    ]);
  });
});

describe('toFields', () => {
  it('converte reais em centavos, ordena os meses e ignora o que ficou vazio', () => {
    const fields = toFields({
      ...base(),
      tariffReais: '1,025',
      totalReais: '1.234,56',
      customerGroup: 'B',
      consumption: [
        { month: '2026-08', kwh: '480' },
        { month: '2026-06', kwh: '400,5' },
        { month: '', kwh: '' },
      ],
    });
    expect(fields).toMatchObject({
      ucNumber: '12345678-9',
      tariffCentsPerKwh: 102.5,
      totalAmountCents: 123_456,
      customerGroup: 'B',
    });
    expect(fields.consumptionHistory).toEqual([
      { month: '2026-06', kwh: 400.5 },
      { month: '2026-08', kwh: 480 },
    ]);
    expect(fields.customerName).toBeUndefined();
    expect(fields.dueDate).toBeUndefined();
  });
});

describe('validateBill', () => {
  it('aceita UC e ao menos um mês de consumo', () => {
    const result = validateBill(base());
    expect(result.ok).toBe(true);
  });

  it('exige a UC e o consumo, com a mensagem no campo certo', () => {
    const result = validateBill({ ...base(), ucNumber: '', consumption: [{ month: '', kwh: '' }] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.ucNumber).toBe('Informe o número da UC');
    expect(result.errors.consumption).toMatch(/pelo menos um mês/);
  });

  it('aponta a linha do consumo com mês sem valor, valor sem mês ou texto inválido', () => {
    const result = validateBill({
      ...base(),
      consumption: [
        { month: '2026-06', kwh: '' },
        { month: '', kwh: '300' },
        { month: '2026-07', kwh: 'abc' },
        { month: '2026-08', kwh: '480' },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors['consumption.0.kwh']).toBeTruthy();
    expect(result.errors['consumption.1.month']).toBeTruthy();
    expect(result.errors['consumption.2.kwh']).toBeTruthy();
    expect(result.errors['consumption.3.kwh']).toBeUndefined();
  });

  it('recusa tarifa não positiva e consumo negativo', () => {
    const tariff = validateBill({ ...base(), tariffReais: '0' });
    expect(tariff.ok === false && tariff.errors.tariffReais).toBeTruthy();
    const negative = validateBill({ ...base(), consumption: [{ month: '2026-08', kwh: '-5' }] });
    expect(negative.ok).toBe(false);
  });
});
