import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Download, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from '@voltex/ui';
import { CustomerGroup, PhaseSystem, type EnergyBillField } from '@voltex/shared';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  NativeSelect,
  Skeleton,
  Spinner,
  Textarea,
  cn,
} from '@voltex/ui';
import { Field, fieldAria } from '@/components/field';
import { queryKeys } from '@/features/admin/query-keys';
import {
  BILL_FIELD_LABELS,
  BILL_STATUS_LABELS,
  CUSTOMER_GROUP_LABELS,
  PHASE_SYSTEM_LABELS,
} from '@/i18n/labels';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage, fieldErrors, isApiError } from '@/lib/api/errors';
import { formatPercent } from '@/lib/format';
import {
  LOW_CONFIDENCE,
  initialValues,
  validateBill,
  type BillErrors,
  type BillFormValues,
} from './bill-form';

function RejectDialog({
  open,
  pending,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (open) setReason('');
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Recusar fatura</DialogTitle>
          <DialogDescription>
            Use quando o arquivo não serve (ilegível, de outro cliente, incompleto). Peça um novo
            envio.
          </DialogDescription>
        </DialogHeader>
        <Field id="reject-reason" label="Motivo">
          <Textarea
            id="reject-reason"
            rows={3}
            maxLength={300}
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={reason.trim().length < 3 || pending}
            onClick={() => onConfirm(reason.trim())}
          >
            {pending ? <Spinner /> : null}
            Recusar fatura
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function BillReviewPage() {
  const { id: opportunityId = '', billId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const bill = useQuery({
    queryKey: queryKeys.energyBill(billId),
    queryFn: () => endpoints.energyBills.get(billId),
  });
  const snapshots = useQuery({
    queryKey: [...queryKeys.energyBill(billId), 'snapshots'],
    queryFn: () => endpoints.energyBills.snapshots(billId),
    enabled: bill.isSuccess,
  });
  const distributors = useQuery({
    queryKey: queryKeys.distributors,
    queryFn: endpoints.distributors.list,
  });

  const [values, setValues] = useState<BillFormValues | null>(null);
  const [errors, setErrors] = useState<BillErrors>({});
  const [rejecting, setRejecting] = useState(false);

  useEffect(() => {
    if (bill.data && snapshots.data && values === null)
      setValues(initialValues(bill.data, snapshots.data[0]));
  }, [bill.data, snapshots.data, values]);

  const done = async () => {
    for (const key of [
      queryKeys.opportunityBills(opportunityId),
      queryKeys.opportunityTimeline(opportunityId),
      queryKeys.opportunity(opportunityId),
      queryKeys.calculationContext(opportunityId),
      queryKeys.energyBill(billId),
    ])
      await queryClient.invalidateQueries({ queryKey: key });
    await queryClient.invalidateQueries({ queryKey: ['opportunity-board'] });
    void navigate(`/crm/oportunidades/${opportunityId}`);
  };

  const validate = useMutation({
    mutationFn: (input: Parameters<typeof endpoints.energyBills.validate>[1]) =>
      endpoints.energyBills.validate(billId, input),
    onSuccess: async () => {
      toast.success('Fatura validada');
      await done();
    },
    onError: (error) => {
      if (isApiError(error) && error.status === 422) setErrors(fieldErrors(error));
      else toast.error(errorMessage(error, 'Não foi possível validar a fatura.'));
    },
  });
  const reject = useMutation({
    mutationFn: (reason: string) => endpoints.energyBills.reject(billId, { reason }),
    onSuccess: async () => {
      toast.success('Fatura recusada');
      setRejecting(false);
      await done();
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível recusar a fatura.')),
  });

  const download = async () => {
    try {
      const { url } = await endpoints.energyBills.downloadUrl(billId);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      toast.error(errorMessage(error, 'Não foi possível gerar o link do arquivo.'));
    }
  };

  if (bill.isPending || (bill.isSuccess && (snapshots.isPending || values === null)))
    return <Skeleton className="h-96 w-full" />;
  if (bill.isError || !values)
    return (
      <div className="space-y-3">
        <p className="text-sm text-destructive">
          {isApiError(bill.error) && bill.error.status === 404
            ? 'Fatura não encontrada.'
            : 'Não foi possível carregar a fatura.'}
        </p>
        <Button asChild variant="outline">
          <Link to={`/crm/oportunidades/${opportunityId}`}>Voltar à oportunidade</Link>
        </Button>
      </div>
    );

  const extracted = bill.data.extracted;
  const set = (patch: Partial<BillFormValues>) => setValues({ ...values, ...patch });
  const err = (key: string) => errors[key];

  /** Selo de confiança do campo lido: destaca o que precisa de atenção (RF-CRM-032). */
  const Confidence = ({ field, value }: { field: EnergyBillField; value: string }) => {
    const read = extracted[field] as { confidence: number } | undefined;
    if (!read)
      return (
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          Não lido automaticamente{value ? '' : ': preencha'}
        </p>
      );
    const low = read.confidence < LOW_CONFIDENCE;
    return (
      <p
        className={cn(
          'flex items-center gap-1 text-xs',
          low ? 'font-medium text-warning-foreground' : 'text-muted-foreground',
        )}
      >
        {low ? <AlertTriangle className="size-3.5" aria-hidden /> : null}
        {low
          ? `Confirme: leitura com ${formatPercent(read.confidence)} de confiança`
          : `Lido com ${formatPercent(read.confidence)} de confiança`}
      </p>
    );
  };
  const cls = (field: EnergyBillField) => {
    const read = extracted[field] as { confidence: number } | undefined;
    return read && read.confidence < LOW_CONFIDENCE
      ? 'rounded-md border border-warning/60 bg-warning/10 p-2'
      : read
        ? ''
        : 'rounded-md border border-dashed p-2';
  };

  const submit = () => {
    const result = validateBill(values);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    validate.mutate(result.input);
  };

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <Link
          to={`/crm/oportunidades/${opportunityId}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden /> Oportunidade
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-2xl font-semibold tracking-tight">Revisar fatura</h2>
            <p className="text-muted-foreground">
              {bill.data.filename} ·{' '}
              <Badge variant="secondary">{BILL_STATUS_LABELS[bill.data.status]}</Badge>
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void download()}>
            <Download /> Abrir arquivo
          </Button>
        </div>
      </header>

      <Alert variant="info">
        <AlertTitle>Confira com o arquivo ao lado</AlertTitle>
        <AlertDescription>
          A leitura automática pode errar. Campos <strong>destacados</strong> têm baixa confiança e
          os
          <strong> tracejados</strong> não foram lidos. Nada vai para o cálculo antes da sua
          confirmação.
        </AlertDescription>
      </Alert>

      <form
        noValidate
        className="grid gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Identificação</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className={cls('ucNumber')}>
              <Field id="bill-uc" label={BILL_FIELD_LABELS.ucNumber} error={err('ucNumber')}>
                <Input
                  {...fieldAria('bill-uc', err('ucNumber'))}
                  value={values.ucNumber}
                  onChange={(e) => set({ ucNumber: e.target.value })}
                />
              </Field>
              <Confidence field="ucNumber" value={values.ucNumber} />
            </div>
            <div className={cls('distributorName')}>
              <Field id="bill-dist" label={BILL_FIELD_LABELS.distributorName}>
                <Input
                  id="bill-dist"
                  list="bill-distributors"
                  value={values.distributorName}
                  onChange={(e) => set({ distributorName: e.target.value })}
                />
                <datalist id="bill-distributors">
                  {distributors.data?.map((d) => (
                    <option key={d.id} value={d.name} />
                  ))}
                </datalist>
              </Field>
              <Confidence field="distributorName" value={values.distributorName} />
            </div>
            <div className={cls('customerName')}>
              <Field id="bill-customer" label={BILL_FIELD_LABELS.customerName}>
                <Input
                  id="bill-customer"
                  value={values.customerName}
                  onChange={(e) => set({ customerName: e.target.value })}
                />
              </Field>
              <Confidence field="customerName" value={values.customerName} />
            </div>
            <div className={cls('referenceMonth')}>
              <Field id="bill-ref" label={BILL_FIELD_LABELS.referenceMonth}>
                <Input
                  id="bill-ref"
                  type="month"
                  value={values.referenceMonth}
                  onChange={(e) => set({ referenceMonth: e.target.value })}
                />
              </Field>
              <Confidence field="referenceMonth" value={values.referenceMonth} />
            </div>
            <div className={cls('customerGroup')}>
              <Field id="bill-group" label={BILL_FIELD_LABELS.customerGroup}>
                <NativeSelect
                  id="bill-group"
                  value={values.customerGroup}
                  onChange={(e) =>
                    set({ customerGroup: e.target.value as BillFormValues['customerGroup'] })
                  }
                >
                  <option value="">Não informado</option>
                  {Object.values(CustomerGroup).map((g) => (
                    <option key={g} value={g}>
                      {CUSTOMER_GROUP_LABELS[g]}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Confidence field="customerGroup" value={values.customerGroup} />
            </div>
            <div className={cls('phaseSystem')}>
              <Field id="bill-phase" label={BILL_FIELD_LABELS.phaseSystem}>
                <NativeSelect
                  id="bill-phase"
                  value={values.phaseSystem}
                  onChange={(e) =>
                    set({ phaseSystem: e.target.value as BillFormValues['phaseSystem'] })
                  }
                >
                  <option value="">Não informado</option>
                  {Object.values(PhaseSystem).map((p) => (
                    <option key={p} value={p}>
                      {PHASE_SYSTEM_LABELS[p]}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Confidence field="phaseSystem" value={values.phaseSystem} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Valores</CardTitle>
            <CardDescription>
              A tarifa da fatura (com impostos) é a que o cliente de fato paga e tem prioridade no
              cálculo.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <div className={cls('tariffCentsPerKwh')}>
              <Field
                id="bill-tariff"
                label="Tarifa (R$/kWh, com impostos)"
                error={err('tariffReais')}
              >
                <Input
                  {...fieldAria('bill-tariff', err('tariffReais'))}
                  inputMode="decimal"
                  placeholder="0,95"
                  value={values.tariffReais}
                  onChange={(e) => set({ tariffReais: e.target.value })}
                />
              </Field>
              <Confidence field="tariffCentsPerKwh" value={values.tariffReais} />
            </div>
            <div className={cls('totalAmountCents')}>
              <Field id="bill-total" label="Total da fatura (R$)" error={err('totalReais')}>
                <Input
                  {...fieldAria('bill-total', err('totalReais'))}
                  inputMode="decimal"
                  value={values.totalReais}
                  onChange={(e) => set({ totalReais: e.target.value })}
                />
              </Field>
              <Confidence field="totalAmountCents" value={values.totalReais} />
            </div>
            <div className={cls('dueDate')}>
              <Field id="bill-due" label={BILL_FIELD_LABELS.dueDate}>
                <Input
                  id="bill-due"
                  type="date"
                  value={values.dueDate}
                  onChange={(e) => set({ dueDate: e.target.value })}
                />
              </Field>
              <Confidence field="dueDate" value={values.dueDate} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Histórico de consumo (kWh)</CardTitle>
            <CardDescription>De 1 a 24 meses. O cálculo usa os 12 mais recentes.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className={cls('consumptionHistory')}>
              <Confidence
                field="consumptionHistory"
                value={values.consumption.some((r) => r.kwh) ? 'x' : ''}
              />
              <ul className="mt-2 grid gap-2">
                {values.consumption.map((row, i) => (
                  <li key={i} className="grid grid-cols-[1fr_1fr_auto] items-start gap-2">
                    <Field
                      id={`bill-m-${i}`}
                      label={`Mês ${i + 1}`}
                      error={err(`consumption.${i}.month`)}
                    >
                      <Input
                        {...fieldAria(`bill-m-${i}`, err(`consumption.${i}.month`))}
                        type="month"
                        value={row.month}
                        onChange={(e) =>
                          set({
                            consumption: values.consumption.map((r, j) =>
                              j === i ? { ...r, month: e.target.value } : r,
                            ),
                          })
                        }
                      />
                    </Field>
                    <Field
                      id={`bill-k-${i}`}
                      label={`Consumo ${i + 1} (kWh)`}
                      error={err(`consumption.${i}.kwh`)}
                    >
                      <Input
                        {...fieldAria(`bill-k-${i}`, err(`consumption.${i}.kwh`))}
                        inputMode="decimal"
                        value={row.kwh}
                        onChange={(e) =>
                          set({
                            consumption: values.consumption.map((r, j) =>
                              j === i ? { ...r, kwh: e.target.value } : r,
                            ),
                          })
                        }
                      />
                    </Field>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="mt-6"
                      aria-label={`Remover mês ${i + 1}`}
                      disabled={values.consumption.length === 1}
                      onClick={() =>
                        set({ consumption: values.consumption.filter((_, j) => j !== i) })
                      }
                    >
                      <Trash2 />
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
            {err('consumption') ? (
              <p role="alert" className="text-xs text-destructive">
                {err('consumption')}
              </p>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={values.consumption.length >= 24}
              onClick={() => set({ consumption: [...values.consumption, { month: '', kwh: '' }] })}
            >
              <Plus /> Adicionar mês
            </Button>
          </CardContent>
        </Card>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button type="button" variant="outline" onClick={() => setRejecting(true)}>
            Recusar fatura
          </Button>
          <Button type="submit" disabled={validate.isPending}>
            {validate.isPending ? <Spinner /> : null}
            Confirmar dados da fatura
          </Button>
        </div>
      </form>

      <RejectDialog
        open={rejecting}
        pending={reject.isPending}
        onOpenChange={setRejecting}
        onConfirm={(reason) => reject.mutate(reason)}
      />
    </div>
  );
}
