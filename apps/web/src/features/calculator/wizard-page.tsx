import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Calculator, Check } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { toast } from '@voltex/ui';
import { CustomerGroup, PhaseSystem, ProjectType, type SolarResourceDto } from '@voltex/shared';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  NativeSelect,
  Skeleton,
  Spinner,
  Switch,
  cn,
} from '@voltex/ui';
import { queryKeys } from '@/features/admin/query-keys';
import {
  CUSTOMER_GROUP_LABELS,
  MONTH_LABELS,
  PHASE_SYSTEM_LABELS,
  PROJECT_TYPE_LABELS,
} from '@/i18n/labels';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api/errors';
import { formatDate, formatNumber } from '@/lib/format';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { Field, fieldAria } from '@/components/field';
import {
  WIZARD_STEPS,
  defaultWizardValues,
  evaluate,
  validateStep,
  valuesFromContext,
  type WizardValues,
} from './form';
import { ResultView } from './result-view';

const LAST_STEP = WIZARD_STEPS.length - 1;

function Stepper({ current, onGo }: { current: number; onGo: (step: number) => void }) {
  return (
    <nav aria-label="Etapas do cálculo">
      <ol className="flex flex-wrap gap-2">
        {WIZARD_STEPS.map((step, index) => {
          const done = index < current;
          return (
            <li key={step.id}>
              <button
                type="button"
                disabled={index > current}
                aria-current={index === current ? 'step' : undefined}
                onClick={() => onGo(index)}
                className={cn(
                  'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed',
                  index === current
                    ? 'border-primary bg-primary text-primary-foreground'
                    : done
                      ? 'border-input bg-card hover:bg-accent'
                      : 'border-input text-muted-foreground',
                )}
              >
                <span
                  aria-hidden
                  className="flex size-5 items-center justify-center rounded-full bg-background/20 text-xs"
                >
                  {done ? <Check className="size-3" /> : index + 1}
                </span>
                {step.label}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

const decimalProps = { type: 'text', inputMode: 'decimal', autoComplete: 'off' } as const;

export function CalculatorWizardPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const [showErrors, setShowErrors] = useState(false);
  const [resource, setResource] = useState<SolarResourceDto | null>(null);
  const [resourceSearch, setResourceSearch] = useState('');
  const [params] = useSearchParams();
  const opportunityId = params.get('opportunityId');
  const debouncedSearch = useDebouncedValue(resourceSearch.trim());

  const form = useForm<WizardValues>({ defaultValues: defaultWizardValues() });
  const { register, watch, setValue, getValues } = form;
  const values = watch();

  const context = useQuery({
    queryKey: queryKeys.calculationContext(opportunityId ?? ''),
    queryFn: () => endpoints.opportunities.calculationContext(opportunityId as string),
    enabled: !!opportunityId,
  });
  const config = useQuery({
    queryKey: queryKeys.calculatorConfig,
    queryFn: endpoints.calculator.config,
  });
  const resources = useQuery({
    queryKey: queryKeys.solarResources({ search: debouncedSearch, picker: true }),
    queryFn: () =>
      endpoints.solarResources.list({ pageSize: 50, search: debouncedSearch || undefined }),
  });
  const tariffs = useQuery({
    queryKey: queryKeys.tariffs(),
    queryFn: () => endpoints.tariffs.list(),
  });
  const distributors = useQuery({
    queryKey: queryKeys.distributors,
    queryFn: endpoints.distributors.list,
  });

  const distributorName = useMemo(
    () => new Map(distributors.data?.map((d) => [d.id, d.name]) ?? []),
    [distributors.data],
  );
  const currentTariffs = useMemo(() => {
    const now = Date.now();
    return (tariffs.data ?? []).filter((t) => !t.validTo || new Date(t.validTo).getTime() > now);
  }, [tariffs.data]);

  const errors = showErrors ? validateStep(step, values) : {};
  const evaluation = useMemo(
    () => (config.data ? evaluate(values, resource, config.data.thresholds) : null),
    // `values` é um objeto novo a cada render; a string serializada mantém o cálculo estável.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(values), resource, config.data],
  );

  // Aberto a partir da oportunidade: preenche com a fatura validada, o imóvel e a tarifa (uma vez só).
  const prefilled = useRef(false);
  useEffect(() => {
    if (!context.data || !config.data || prefilled.current) return;
    prefilled.current = true;
    form.reset({
      ...defaultWizardValues(),
      ...valuesFromContext(context.data, config.data.availabilityCostKwh),
    });
  }, [context.data, config.data, form]);

  const save = useMutation({
    mutationFn: () => {
      if (!evaluation) throw new Error('Cálculo indisponível');
      const body = {
        title: values.title.trim() || undefined,
        customerName: values.customerName.trim() || undefined,
        references: {
          solarResourceId: resource?.id,
          tariffId: values.tariffId || undefined,
        },
        input: evaluation.input,
      };
      return opportunityId
        ? endpoints.opportunities.createCalculation(opportunityId, body)
        : endpoints.calculator.create(body);
    },
    onSuccess: async (session) => {
      toast.success(opportunityId ? 'Cálculo salvo e vinculado à oportunidade' : 'Cálculo salvo');
      await queryClient.invalidateQueries({ queryKey: queryKeys.calculations() });
      if (opportunityId) {
        for (const key of [
          queryKeys.opportunityCalculations(opportunityId),
          queryKeys.opportunityTimeline(opportunityId),
          queryKeys.opportunityEngineering(opportunityId),
          queryKeys.opportunity(opportunityId),
        ])
          await queryClient.invalidateQueries({ queryKey: key });
        await queryClient.invalidateQueries({ queryKey: ['opportunity-board'] });
        void navigate(`/crm/oportunidades/${opportunityId}`);
      } else void navigate(`/calculator/${session.id}`);
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível salvar o cálculo.')),
  });

  const next = () => {
    if (Object.keys(validateStep(step, getValues())).length > 0) {
      setShowErrors(true);
      return;
    }
    setShowErrors(false);
    setStep((s) => Math.min(s + 1, LAST_STEP));
  };
  const back = () => {
    setShowErrors(false);
    setStep((s) => Math.max(s - 1, 0));
  };
  const submit = () => {
    for (let i = 0; i <= LAST_STEP; i += 1) {
      if (Object.keys(validateStep(i, getValues())).length > 0) {
        setStep(i);
        setShowErrors(true);
        return;
      }
    }
    if (evaluation?.ok) save.mutate();
    else toast.error('Revise os dados: o cálculo não pôde ser concluído.');
  };

  const onResourceChange = (id: string) => {
    setResource(resources.data?.data.find((r) => r.id === id) ?? null);
  };
  const onPhaseChange = (phase: string) => {
    const cost = phase ? config.data?.availabilityCostKwh[phase as PhaseSystem] : undefined;
    if (cost !== undefined) setValue('availabilityCostKwh', String(cost).replace('.', ','));
  };
  const onTariffChange = (id: string) => {
    const tariff = tariffs.data?.find((t) => t.id === id);
    if (!tariff) return;
    setValue('tariffReais', String(tariff.energyCentsPerKwh / 100).replace('.', ','));
    setValue('customerGroup', tariff.customerGroup);
  };
  const repeatFirstMonth = () => {
    const first = getValues('consumption.0');
    for (let i = 1; i < 12; i += 1) setValue(`consumption.${i}`, first);
  };

  const err = (key: keyof WizardValues | 'consumption') => errors[key];
  const aria = (key: keyof WizardValues, hasHint = false) =>
    fieldAria(`wz-${key}`, err(key), hasHint);

  if (config.isPending) return <Skeleton className="h-96 w-full" />;
  if (config.isError)
    return (
      <p className="text-sm text-destructive">
        Não foi possível carregar a configuração do cálculo.
      </p>
    );

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <Link
          to="/calculator"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden /> Cálculos
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Novo cálculo</h1>
        <p className="text-muted-foreground">
          O resultado ao lado se atualiza enquanto você preenche. Ao salvar, o sistema confere tudo
          de novo com as regras da sua empresa.
        </p>
      </header>

      {opportunityId ? (
        <Alert variant="info">
          <AlertTitle>
            Cálculo da oportunidade {context.data ? `“${context.data.title}”` : ''}
          </AlertTitle>
          <AlertDescription>
            {context.isPending
              ? 'Carregando os dados da oportunidade…'
              : context.isError
                ? 'Não foi possível carregar os dados da oportunidade: preencha manualmente.'
                : context.data.billSnapshotId
                  ? 'Preenchido com a fatura validada, o imóvel e a tarifa. Confira antes de salvar; o cálculo ficará vinculado à oportunidade.'
                  : 'Ainda não há fatura validada: o consumo precisa ser informado à mão. O cálculo ficará vinculado à oportunidade.'}
          </AlertDescription>
        </Alert>
      ) : null}

      <Stepper
        current={step}
        onGo={(i) => (i <= step ? (setShowErrors(false), setStep(i)) : undefined)}
      />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader>
            <CardTitle>{WIZARD_STEPS[step]!.label}</CardTitle>
            <CardDescription>
              Etapa {step + 1} de {WIZARD_STEPS.length}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              noValidate
              className="grid gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (step === LAST_STEP) submit();
                else next();
              }}
            >
              {step === 0 ? (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field id="wz-title" label="Título (opcional)">
                      <Input
                        id="wz-title"
                        placeholder="Ex.: Residência Silva"
                        {...register('title')}
                      />
                    </Field>
                    <Field id="wz-customerName" label="Cliente (opcional)">
                      <Input id="wz-customerName" {...register('customerName')} />
                    </Field>
                  </div>

                  <fieldset className="grid gap-3 rounded-lg border p-4">
                    <legend className="px-1 text-sm font-medium">Irradiação solar (HSP)</legend>
                    <Field
                      id="wz-resourceSearch"
                      label="Buscar local cadastrado"
                      hint="Cadastre ou importe locais em Administração → Irradiação."
                    >
                      <Input
                        id="wz-resourceSearch"
                        type="search"
                        placeholder="Nome do local"
                        value={resourceSearch}
                        onChange={(e) => setResourceSearch(e.target.value)}
                      />
                    </Field>
                    <Field id="wz-solarResourceId" label="Local">
                      <NativeSelect
                        {...register('solarResourceId', {
                          onChange: (e) => onResourceChange(e.target.value),
                        })}
                        id="wz-solarResourceId"
                      >
                        <option value="">Informar o HSP manualmente</option>
                        {resource && !resources.data?.data.some((r) => r.id === resource.id) ? (
                          <option value={resource.id}>{resource.name}</option>
                        ) : null}
                        {resources.data?.data.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                            {r.state ? ` — ${r.state}` : ''}
                          </option>
                        ))}
                      </NativeSelect>
                    </Field>
                    {resource ? (
                      <p className="text-sm text-muted-foreground">
                        Fonte: <strong>{resource.source}</strong> · {resource.plane} · média{' '}
                        {formatNumber(resource.hspMonthly.reduce((s, v) => s + v, 0) / 12, 2)}{' '}
                        kWh/m²·dia
                      </p>
                    ) : (
                      <Field
                        id="wz-hspManual"
                        label="HSP médio (kWh/m²·dia)"
                        error={err('hspManual')}
                        hint="Usado nos 12 meses. Prefira um local cadastrado, com fonte conhecida."
                      >
                        <Input
                          {...decimalProps}
                          {...aria('hspManual', true)}
                          {...register('hspManual')}
                        />
                      </Field>
                    )}
                  </fieldset>

                  <div className="grid gap-4 sm:grid-cols-3 sm:items-end">
                    <Field
                      id="wz-latitude"
                      label="Latitude (°)"
                      error={err('latitude')}
                      hint="Negativa no hemisfério sul. Habilita a inclinação recomendada."
                    >
                      <Input
                        {...decimalProps}
                        placeholder="-3,73"
                        {...aria('latitude', true)}
                        {...register('latitude')}
                      />
                    </Field>
                    <Field
                      id="wz-roofAzimuthDegrees"
                      label="Azimute do telhado (°)"
                      error={err('roofAzimuthDegrees')}
                      hint="0° = Norte, 90° = Leste, 180° = Sul, 270° = Oeste."
                    >
                      <Input
                        {...decimalProps}
                        {...aria('roofAzimuthDegrees', true)}
                        {...register('roofAzimuthDegrees')}
                      />
                    </Field>
                    <Field id="wz-tiltDegrees" label="Inclinação (°)" error={err('tiltDegrees')}>
                      <Input
                        {...decimalProps}
                        {...aria('tiltDegrees')}
                        {...register('tiltDegrees')}
                      />
                    </Field>
                  </div>
                </>
              ) : null}

              {step === 1 ? (
                <>
                  <fieldset className="grid gap-3">
                    <legend className="mb-1 text-sm font-medium">Consumo mensal (kWh)</legend>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                      {MONTH_LABELS.map((month, i) => (
                        <Field key={month} id={`wz-consumption-${i}`} label={month}>
                          <Input
                            {...decimalProps}
                            id={`wz-consumption-${i}`}
                            aria-invalid={err('consumption') ? true : undefined}
                            {...register(`consumption.${i}` as const)}
                          />
                        </Field>
                      ))}
                    </div>
                    {err('consumption') ? (
                      <p role="alert" className="text-xs text-destructive">
                        {err('consumption')}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Informe de 1 a 12 meses; os meses em branco são ignorados.
                      </p>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-fit"
                      onClick={repeatFirstMonth}
                    >
                      Repetir janeiro nos demais meses
                    </Button>
                  </fieldset>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field id="wz-phaseSystem" label="Tipo de ligação">
                      <NativeSelect
                        {...register('phaseSystem', {
                          onChange: (e) => onPhaseChange(e.target.value),
                        })}
                        id="wz-phaseSystem"
                      >
                        <option value="">Não informado</option>
                        {Object.values(PhaseSystem).map((p) => (
                          <option key={p} value={p}>
                            {PHASE_SYSTEM_LABELS[p]}
                          </option>
                        ))}
                      </NativeSelect>
                    </Field>
                    <Field
                      id="wz-availabilityCostKwh"
                      label="Custo de disponibilidade (kWh/mês)"
                      error={err('availabilityCostKwh')}
                      hint={
                        Object.keys(config.data.availabilityCostKwh).length > 0
                          ? 'Preenchido pela regra da empresa conforme o tipo de ligação.'
                          : 'A regra da empresa ainda não define estes valores: informe o da fatura.'
                      }
                    >
                      <Input
                        {...decimalProps}
                        {...aria('availabilityCostKwh', true)}
                        {...register('availabilityCostKwh')}
                      />
                    </Field>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field id="wz-customerGroup" label="Grupo do cliente">
                      <NativeSelect {...register('customerGroup')} id="wz-customerGroup">
                        {Object.values(CustomerGroup).map((g) => (
                          <option key={g} value={g}>
                            {CUSTOMER_GROUP_LABELS[g]}
                          </option>
                        ))}
                      </NativeSelect>
                    </Field>
                    <Field id="wz-projectType" label="Tipo de sistema">
                      <NativeSelect {...register('projectType')} id="wz-projectType">
                        {Object.values(ProjectType).map((p) => (
                          <option key={p} value={p}>
                            {PROJECT_TYPE_LABELS[p]}
                          </option>
                        ))}
                      </NativeSelect>
                    </Field>
                  </div>

                  <div className="grid gap-3 rounded-lg border p-4">
                    {(
                      [
                        ['shadingRelevant', 'Há sombreamento relevante no local'],
                        ['contractedDemandRelevant', 'A demanda contratada é relevante'],
                        ['possibleGridZero', 'Pode haver Grid Zero (limitação de injeção)'],
                      ] as const
                    ).map(([key, label]) => (
                      <label key={key} className="flex items-center justify-between gap-4 text-sm">
                        {label}
                        <Switch
                          checked={values[key]}
                          onCheckedChange={(checked) => setValue(key, checked)}
                          aria-label={label}
                        />
                      </label>
                    ))}
                  </div>
                </>
              ) : null}

              {step === 2 ? (
                <>
                  <Field
                    id="wz-tariffId"
                    label="Tarifa cadastrada"
                    hint="Escolher uma tarifa preenche o valor e fica registrada no cálculo."
                  >
                    <NativeSelect
                      {...register('tariffId', { onChange: (e) => onTariffChange(e.target.value) })}
                      id="wz-tariffId"
                    >
                      <option value="">Informar a tarifa manualmente</option>
                      {currentTariffs.map((t) => (
                        <option key={t.id} value={t.id}>
                          {distributorName.get(t.distributorId) ?? 'Concessionária'} · Grupo{' '}
                          {t.customerGroup} · R$ {formatNumber(t.energyCentsPerKwh / 100, 4)}/kWh
                          (desde {formatDate(t.validFrom)})
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field
                      id="wz-tariffReais"
                      label="Tarifa de energia (R$/kWh)"
                      error={err('tariffReais')}
                      hint="Com impostos, como na fatura. Ex.: 0,95"
                    >
                      <Input
                        {...decimalProps}
                        {...aria('tariffReais', true)}
                        {...register('tariffReais')}
                      />
                    </Field>
                    <Field
                      id="wz-tariffEscalationPercent"
                      label="Reajuste tarifário anual (%)"
                      error={err('tariffEscalationPercent')}
                    >
                      <Input
                        {...decimalProps}
                        {...aria('tariffEscalationPercent')}
                        {...register('tariffEscalationPercent')}
                      />
                    </Field>
                  </div>
                </>
              ) : null}

              {step === 3 ? (
                <>
                  <div className="grid gap-4 sm:grid-cols-3 sm:items-end">
                    <Field
                      id="wz-modulePowerWp"
                      label="Potência do módulo (Wp)"
                      error={err('modulePowerWp')}
                    >
                      <Input
                        {...decimalProps}
                        placeholder="550"
                        {...aria('modulePowerWp')}
                        {...register('modulePowerWp')}
                      />
                    </Field>
                    <Field
                      id="wz-moduleAreaM2"
                      label="Área do módulo (m²)"
                      error={err('moduleAreaM2')}
                    >
                      <Input
                        {...decimalProps}
                        placeholder="2,58"
                        {...aria('moduleAreaM2')}
                        {...register('moduleAreaM2')}
                      />
                    </Field>
                    <Field
                      id="wz-costPerWpReais"
                      label="Custo do sistema (R$/Wp)"
                      error={err('costPerWpReais')}
                    >
                      <Input
                        {...decimalProps}
                        placeholder="4,50"
                        {...aria('costPerWpReais')}
                        {...register('costPerWpReais')}
                      />
                    </Field>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field
                      id="wz-availableAreaM2"
                      label="Área disponível (m²)"
                      error={err('availableAreaM2')}
                      hint="Opcional. Se informada, alerta quando não couber o sistema."
                    >
                      <Input
                        {...decimalProps}
                        {...aria('availableAreaM2', true)}
                        {...register('availableAreaM2')}
                      />
                    </Field>
                    <Field
                      id="wz-performanceRatio"
                      label="Performance Ratio (PR)"
                      error={err('performanceRatio')}
                      hint={`Opcional. Em branco, usa o padrão da regra (${formatNumber(config.data.thresholds.defaultPerformanceRatio, 2)}), que é uma hipótese a validar.`}
                    >
                      <Input
                        {...decimalProps}
                        placeholder="0,80"
                        {...aria('performanceRatio', true)}
                        {...register('performanceRatio')}
                      />
                    </Field>
                    <Field
                      id="wz-degradationPercent"
                      label="Degradação anual dos módulos (%)"
                      error={err('degradationPercent')}
                    >
                      <Input
                        {...decimalProps}
                        {...aria('degradationPercent')}
                        {...register('degradationPercent')}
                      />
                    </Field>
                    <Field
                      id="wz-horizonYears"
                      label="Horizonte de análise (anos)"
                      error={err('horizonYears')}
                    >
                      <Input
                        {...decimalProps}
                        {...aria('horizonYears')}
                        {...register('horizonYears')}
                      />
                    </Field>
                  </div>
                </>
              ) : null}

              <div className="flex items-center justify-between gap-3 pt-2">
                <Button type="button" variant="outline" onClick={back} disabled={step === 0}>
                  <ArrowLeft /> Voltar
                </Button>
                {step < LAST_STEP ? (
                  <Button type="submit">
                    Próximo <ArrowRight />
                  </Button>
                ) : (
                  <Button type="submit" disabled={save.isPending || !evaluation?.ok}>
                    {save.isPending ? <Spinner /> : <Calculator />}
                    Calcular e salvar
                  </Button>
                )}
              </div>
            </form>
          </CardContent>
        </Card>

        <aside aria-label="Resultado parcial" className="space-y-3 lg:sticky lg:top-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Resultado em tempo real</CardTitle>
              <CardDescription>
                Calculado na hora, com as mesmas regras usadas ao salvar.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {evaluation?.ok ? (
                <ResultView result={evaluation.result} input={evaluation.input} compact />
              ) : (
                <p className="text-sm text-muted-foreground">
                  Preencha o consumo, a tarifa e os dados do sistema para ver o resultado aqui.
                </p>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
