import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from '@voltex/ui';
import {
  AccountType,
  CustomerGroup,
  CustomerSegment,
  PhaseSystem,
  RoofType,
  ShadingLevel,
  createAccountSchema,
  createConsumerUnitSchema,
  createContactSchema,
  createSiteSchema,
  type AccountDetailDto,
  type AccountDto,
  type ConsumerUnitDto,
  type ContactDto,
  type SiteDto,
  type SiteIntake,
} from '@voltex/shared';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  NativeSelect,
  Spinner,
  Switch,
  Textarea,
} from '@voltex/ui';
import { Field, fieldAria } from '@/components/field';
import { parseDecimal } from '@/features/calculator/form';
import { queryKeys } from '@/features/admin/query-keys';
import {
  ACCOUNT_TYPE_LABELS,
  BRAZILIAN_STATES,
  CUSTOMER_GROUP_LABELS,
  PHASE_SYSTEM_LABELS,
  ROOF_TYPE_LABELS,
  SEGMENT_LABELS,
  SHADING_LABELS,
} from '@/i18n/labels';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage, fieldErrors, isApiError } from '@/lib/api/errors';

interface DialogProps<T> {
  /** Registro em edição; `null` cria um novo. */
  item: T | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Mensagens por campo do schema compartilhado (as mesmas da API). */
function schemaErrors(issues: { path: PropertyKey[]; message: string }[]): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of issues) errors[String(issue.path[0])] ??= issue.message;
  return errors;
}

// ---------------------------------------------------------------------------------------------------------
// Conta
// ---------------------------------------------------------------------------------------------------------

interface AccountValues {
  type: AccountType;
  name: string;
  document: string;
  segment: '' | CustomerSegment;
  email: string;
  phone: string;
  notes: string;
}

export function AccountFormDialog({ item, open, onOpenChange }: DialogProps<AccountDto>) {
  const queryClient = useQueryClient();
  const form = useForm<AccountValues>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [duplicate, setDuplicate] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    form.reset({
      type: item?.type ?? 'PERSON',
      name: item?.name ?? '',
      document: item?.document ?? '',
      segment: item?.segment ?? '',
      email: item?.email ?? '',
      phone: item?.phone ?? '',
      notes: item?.notes ?? '',
    });
    setErrors({});
    setDuplicate(null);
  }, [open, item, form]);

  const save = useMutation({
    mutationFn: (v: AccountValues) => {
      const body = {
        type: v.type,
        name: v.name,
        document: v.document || undefined,
        segment: v.segment || undefined,
        email: v.email || undefined,
        phone: v.phone || undefined,
        notes: v.notes || undefined,
      };
      return item ? endpoints.accounts.update(item.id, body) : endpoints.accounts.create(body);
    },
    onSuccess: async () => {
      toast.success(item ? 'Conta atualizada' : 'Conta criada');
      onOpenChange(false);
      await queryClient.invalidateQueries({ queryKey: queryKeys.accounts() });
      if (item) await queryClient.invalidateQueries({ queryKey: queryKeys.account(item.id) });
    },
    onError: (error) => {
      if (isApiError(error) && error.code === 'DUPLICATE_ACCOUNT') setDuplicate(error.message);
      else if (isApiError(error) && error.status === 422) setErrors(fieldErrors(error));
      else toast.error(errorMessage(error, 'Não foi possível salvar a conta.'));
    },
  });

  const submit = form.handleSubmit((v) => {
    setDuplicate(null);
    const parsed = createAccountSchema.safeParse({
      type: v.type,
      name: v.name,
      email: v.email || undefined,
      phone: v.phone || undefined,
    });
    if (!parsed.success) return setErrors(schemaErrors(parsed.error.issues));
    setErrors({});
    save.mutate(v);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{item ? 'Editar conta' : 'Nova conta'}</DialogTitle>
          <DialogDescription>Cliente que compra (pessoa ou empresa).</DialogDescription>
        </DialogHeader>
        {duplicate ? (
          <Alert variant="warning">
            <AlertTitle>Conta duplicada</AlertTitle>
            <AlertDescription>{duplicate}</AlertDescription>
          </Alert>
        ) : null}
        <form noValidate className="grid gap-4" onSubmit={submit}>
          <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
            <Field id="acc-type" label="Tipo">
              <NativeSelect id="acc-type" {...form.register('type')}>
                {Object.values(AccountType).map((t) => (
                  <option key={t} value={t}>
                    {ACCOUNT_TYPE_LABELS[t]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="acc-name" label="Nome" error={errors.name}>
              <Input {...fieldAria('acc-name', errors.name)} autoFocus {...form.register('name')} />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="acc-document" label="CPF/CNPJ">
              <Input id="acc-document" {...form.register('document')} />
            </Field>
            <Field id="acc-segment" label="Segmento">
              <NativeSelect id="acc-segment" {...form.register('segment')}>
                <option value="">Não informado</option>
                {Object.values(CustomerSegment).map((s) => (
                  <option key={s} value={s}>
                    {SEGMENT_LABELS[s]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="acc-email" label="E-mail" error={errors.email}>
              <Input
                {...fieldAria('acc-email', errors.email)}
                type="email"
                {...form.register('email')}
              />
            </Field>
            <Field id="acc-phone" label="Telefone" error={errors.phone}>
              <Input
                {...fieldAria('acc-phone', errors.phone)}
                inputMode="tel"
                {...form.register('phone')}
              />
            </Field>
          </div>
          <Field id="acc-notes" label="Observações">
            <Textarea id="acc-notes" rows={3} maxLength={2000} {...form.register('notes')} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? <Spinner /> : null}
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------------------------------
// Contato
// ---------------------------------------------------------------------------------------------------------

interface ContactValues {
  name: string;
  roleTitle: string;
  email: string;
  phone: string;
  isPrimary: boolean;
}

export function ContactDialog({
  accountId,
  item,
  open,
  onOpenChange,
}: DialogProps<ContactDto> & { accountId: string }) {
  const queryClient = useQueryClient();
  const form = useForm<ContactValues>();
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    form.reset({
      name: item?.name ?? '',
      roleTitle: item?.roleTitle ?? '',
      email: item?.email ?? '',
      phone: item?.phone ?? '',
      isPrimary: item?.isPrimary ?? false,
    });
    setErrors({});
  }, [open, item, form]);

  const save = useMutation({
    mutationFn: (v: ContactValues) => {
      const body = {
        name: v.name,
        roleTitle: v.roleTitle || undefined,
        email: v.email || undefined,
        phone: v.phone || undefined,
        isPrimary: v.isPrimary,
      };
      return item
        ? endpoints.accounts.updateContact(item.id, body)
        : endpoints.accounts.addContact(accountId, body);
    },
    onSuccess: async () => {
      toast.success(item ? 'Contato atualizado' : 'Contato adicionado');
      onOpenChange(false);
      await queryClient.invalidateQueries({ queryKey: queryKeys.account(accountId) });
    },
    onError: (error) => {
      if (isApiError(error) && error.status === 422) setErrors(fieldErrors(error));
      else toast.error(errorMessage(error, 'Não foi possível salvar o contato.'));
    },
  });

  const submit = form.handleSubmit((v) => {
    const parsed = createContactSchema.safeParse({
      name: v.name,
      email: v.email || undefined,
      phone: v.phone || undefined,
    });
    if (!parsed.success) return setErrors(schemaErrors(parsed.error.issues));
    setErrors({});
    save.mutate(v);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{item ? 'Editar contato' : 'Novo contato'}</DialogTitle>
          <DialogDescription>
            Pessoa para falar com a conta. Só um contato é o principal.
          </DialogDescription>
        </DialogHeader>
        <form noValidate className="grid gap-4" onSubmit={submit}>
          <Field id="ct-name" label="Nome" error={errors.name}>
            <Input {...fieldAria('ct-name', errors.name)} autoFocus {...form.register('name')} />
          </Field>
          <Field id="ct-role" label="Cargo (opcional)">
            <Input id="ct-role" {...form.register('roleTitle')} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="ct-email" label="E-mail" error={errors.email}>
              <Input
                {...fieldAria('ct-email', errors.email)}
                type="email"
                {...form.register('email')}
              />
            </Field>
            <Field id="ct-phone" label="Telefone" error={errors.phone}>
              <Input
                {...fieldAria('ct-phone', errors.phone)}
                inputMode="tel"
                {...form.register('phone')}
              />
            </Field>
          </div>
          <label className="flex items-center justify-between gap-4 text-sm">
            Contato principal
            <Switch
              checked={form.watch('isPrimary')}
              onCheckedChange={(checked) => form.setValue('isPrimary', checked)}
              aria-label="Contato principal"
            />
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? <Spinner /> : null}
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------------------------------
// Imóvel + intake técnico
// ---------------------------------------------------------------------------------------------------------

interface SiteValues {
  name: string;
  street: string;
  number: string;
  district: string;
  city: string;
  state: string;
  zip: string;
  latitude: string;
  longitude: string;
  roofType: '' | RoofType;
  roofAzimuthDegrees: string;
  tiltDegrees: string;
  shading: '' | ShadingLevel;
  availableAreaM2: string;
  entryBreakerAmps: string;
  groundingAdequate: '' | 'yes' | 'no';
  technicalVisitRequired: boolean;
  technicalVisitDone: boolean;
  intakeNotes: string;
}

const num = (raw: string) => parseDecimal(raw);

/** Converte os campos do formulário no intake (só o que foi preenchido). */
export function buildIntake(v: SiteValues): SiteIntake {
  const intake: SiteIntake = {};
  if (v.roofType) intake.roofType = v.roofType;
  const azimuth = num(v.roofAzimuthDegrees);
  if (azimuth !== undefined) intake.roofAzimuthDegrees = azimuth;
  const tilt = num(v.tiltDegrees);
  if (tilt !== undefined) intake.tiltDegrees = tilt;
  if (v.shading) intake.shading = v.shading;
  const area = num(v.availableAreaM2);
  if (area !== undefined) intake.availableAreaM2 = area;
  const breaker = num(v.entryBreakerAmps);
  if (breaker !== undefined) intake.entryBreakerAmps = breaker;
  if (v.groundingAdequate) intake.groundingAdequate = v.groundingAdequate === 'yes';
  if (v.technicalVisitRequired) intake.technicalVisitRequired = true;
  if (v.technicalVisitDone) intake.technicalVisitDone = true;
  if (v.intakeNotes.trim()) intake.notes = v.intakeNotes.trim();
  return intake;
}

const siteDefaults = (site: SiteDto | null): SiteValues => {
  const i = site?.intake ?? {};
  const text = (n: number | undefined) => (n === undefined ? '' : String(n).replace('.', ','));
  return {
    name: site?.name ?? '',
    street: site?.street ?? '',
    number: site?.number ?? '',
    district: site?.district ?? '',
    city: site?.city ?? '',
    state: site?.state ?? '',
    zip: site?.zip ?? '',
    latitude: text(site?.latitude ?? undefined),
    longitude: text(site?.longitude ?? undefined),
    roofType: i.roofType ?? '',
    roofAzimuthDegrees: text(i.roofAzimuthDegrees),
    tiltDegrees: text(i.tiltDegrees),
    shading: i.shading ?? '',
    availableAreaM2: text(i.availableAreaM2),
    entryBreakerAmps: text(i.entryBreakerAmps),
    groundingAdequate: i.groundingAdequate === undefined ? '' : i.groundingAdequate ? 'yes' : 'no',
    technicalVisitRequired: i.technicalVisitRequired ?? false,
    technicalVisitDone: i.technicalVisitDone ?? false,
    intakeNotes: i.notes ?? '',
  };
};

export function SiteDialog({
  accountId,
  item,
  open,
  onOpenChange,
}: DialogProps<SiteDto> & { accountId: string }) {
  const queryClient = useQueryClient();
  const form = useForm<SiteValues>();
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    form.reset(siteDefaults(item));
    setErrors({});
  }, [open, item, form]);

  const save = useMutation({
    mutationFn: (v: SiteValues) => {
      const body = {
        name: v.name,
        street: v.street || undefined,
        number: v.number || undefined,
        district: v.district || undefined,
        city: v.city,
        state: v.state,
        zip: v.zip || undefined,
        latitude: num(v.latitude),
        longitude: num(v.longitude),
        intake: buildIntake(v),
      };
      return item
        ? endpoints.accounts.updateSite(item.id, body)
        : endpoints.accounts.addSite(accountId, body);
    },
    onSuccess: async () => {
      toast.success(item ? 'Imóvel atualizado' : 'Imóvel adicionado');
      onOpenChange(false);
      await queryClient.invalidateQueries({ queryKey: queryKeys.account(accountId) });
    },
    onError: (error) => {
      if (isApiError(error) && error.status === 422) setErrors(fieldErrors(error));
      else toast.error(errorMessage(error, 'Não foi possível salvar o imóvel.'));
    },
  });

  const submit = form.handleSubmit((v) => {
    const latitude = num(v.latitude);
    const longitude = num(v.longitude);
    const parsed = createSiteSchema.safeParse({
      name: v.name,
      city: v.city,
      state: v.state,
      latitude,
      longitude,
      intake: buildIntake(v),
    });
    if (!parsed.success) {
      const next = schemaErrors(parsed.error.issues);
      // Erros do intake chegam como `intake.campo`: mostramos no campo correspondente.
      for (const issue of parsed.error.issues)
        if (issue.path[0] === 'intake' && issue.path[1])
          next[`intake.${String(issue.path[1])}`] = issue.message;
      return setErrors(next);
    }
    setErrors({});
    save.mutate(v);
  });

  const e = (key: string) => errors[key];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{item ? 'Editar imóvel' : 'Novo imóvel'}</DialogTitle>
          <DialogDescription>
            Endereço e levantamento técnico do local. Mudar orientação, inclinação, sombreamento ou
            área avisa as oportunidades abertas que as premissas mudaram.
          </DialogDescription>
        </DialogHeader>
        <form noValidate className="grid gap-4" onSubmit={submit}>
          <Field id="site-name" label="Nome do imóvel" error={e('name')}>
            <Input
              {...fieldAria('site-name', e('name'))}
              autoFocus
              placeholder="Ex.: Residência"
              {...form.register('name')}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-[1fr_6rem_1fr]">
            <Field id="site-street" label="Rua">
              <Input id="site-street" {...form.register('street')} />
            </Field>
            <Field id="site-number" label="Número">
              <Input id="site-number" {...form.register('number')} />
            </Field>
            <Field id="site-district" label="Bairro">
              <Input id="site-district" {...form.register('district')} />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-[1fr_8rem_8rem]">
            <Field id="site-city" label="Cidade" error={e('city')}>
              <Input {...fieldAria('site-city', e('city'))} {...form.register('city')} />
            </Field>
            <Field id="site-state" label="UF" error={e('state')}>
              <NativeSelect {...fieldAria('site-state', e('state'))} {...form.register('state')}>
                <option value="">—</option>
                {BRAZILIAN_STATES.map((uf) => (
                  <option key={uf} value={uf}>
                    {uf}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="site-zip" label="CEP">
              <Input id="site-zip" {...form.register('zip')} />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="site-latitude"
              label="Latitude (°)"
              error={e('latitude')}
              hint="Negativa no hemisfério sul."
            >
              <Input
                {...fieldAria('site-latitude', e('latitude'), true)}
                inputMode="decimal"
                {...form.register('latitude')}
              />
            </Field>
            <Field id="site-longitude" label="Longitude (°)" error={e('longitude')}>
              <Input
                {...fieldAria('site-longitude', e('longitude'))}
                inputMode="decimal"
                {...form.register('longitude')}
              />
            </Field>
          </div>

          <fieldset className="grid gap-4 rounded-lg border p-4">
            <legend className="px-1 text-sm font-medium">Levantamento técnico</legend>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field id="in-roof" label="Tipo de telhado">
                <NativeSelect id="in-roof" {...form.register('roofType')}>
                  <option value="">Não informado</option>
                  {Object.values(RoofType).map((r) => (
                    <option key={r} value={r}>
                      {ROOF_TYPE_LABELS[r]}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field
                id="in-azimuth"
                label="Azimute (°)"
                error={e('intake.roofAzimuthDegrees')}
                hint="0° Norte · 90° Leste · 180° Sul · 270° Oeste"
              >
                <Input
                  {...fieldAria('in-azimuth', e('intake.roofAzimuthDegrees'), true)}
                  inputMode="decimal"
                  {...form.register('roofAzimuthDegrees')}
                />
              </Field>
              <Field id="in-tilt" label="Inclinação (°)" error={e('intake.tiltDegrees')}>
                <Input
                  {...fieldAria('in-tilt', e('intake.tiltDegrees'))}
                  inputMode="decimal"
                  {...form.register('tiltDegrees')}
                />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field id="in-shading" label="Sombreamento">
                <NativeSelect id="in-shading" {...form.register('shading')}>
                  <option value="">Não informado</option>
                  {Object.values(ShadingLevel).map((s) => (
                    <option key={s} value={s}>
                      {SHADING_LABELS[s]}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id="in-area" label="Área disponível (m²)" error={e('intake.availableAreaM2')}>
                <Input
                  {...fieldAria('in-area', e('intake.availableAreaM2'))}
                  inputMode="decimal"
                  {...form.register('availableAreaM2')}
                />
              </Field>
              <Field
                id="in-breaker"
                label="Disjuntor de entrada (A)"
                error={e('intake.entryBreakerAmps')}
              >
                <Input
                  {...fieldAria('in-breaker', e('intake.entryBreakerAmps'))}
                  inputMode="decimal"
                  {...form.register('entryBreakerAmps')}
                />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field id="in-grounding" label="Aterramento adequado?">
                <NativeSelect id="in-grounding" {...form.register('groundingAdequate')}>
                  <option value="">Não verificado</option>
                  <option value="yes">Sim</option>
                  <option value="no">Não</option>
                </NativeSelect>
              </Field>
              <label className="flex items-center justify-between gap-3 self-end rounded-md border px-3 py-2 text-sm">
                Visita técnica necessária
                <Switch
                  checked={form.watch('technicalVisitRequired')}
                  onCheckedChange={(c) => form.setValue('technicalVisitRequired', c)}
                  aria-label="Visita técnica necessária"
                />
              </label>
              <label className="flex items-center justify-between gap-3 self-end rounded-md border px-3 py-2 text-sm">
                Visita técnica feita
                <Switch
                  checked={form.watch('technicalVisitDone')}
                  onCheckedChange={(c) => form.setValue('technicalVisitDone', c)}
                  aria-label="Visita técnica feita"
                />
              </label>
            </div>
            <Field id="in-notes" label="Observações do levantamento">
              <Textarea id="in-notes" rows={2} maxLength={1000} {...form.register('intakeNotes')} />
            </Field>
          </fieldset>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? <Spinner /> : null}
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------------------------------
// Unidade consumidora
// ---------------------------------------------------------------------------------------------------------

interface UnitValues {
  number: string;
  distributorId: string;
  siteId: string;
  customerGroup: CustomerGroup;
  phaseSystem: '' | PhaseSystem;
  consumerClass: string;
}

export function ConsumerUnitDialog({
  account,
  item,
  open,
  onOpenChange,
}: DialogProps<ConsumerUnitDto> & { account: AccountDetailDto }) {
  const queryClient = useQueryClient();
  const form = useForm<UnitValues>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const distributors = useQuery({
    queryKey: queryKeys.distributors,
    queryFn: endpoints.distributors.list,
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    form.reset({
      number: item?.number ?? '',
      distributorId: item?.distributorId ?? '',
      siteId: item?.siteId ?? '',
      customerGroup: item?.customerGroup ?? 'B',
      phaseSystem: item?.phaseSystem ?? '',
      consumerClass: item?.consumerClass ?? '',
    });
    setErrors({});
  }, [open, item, form]);

  const save = useMutation({
    mutationFn: (v: UnitValues) => {
      const body = {
        number: v.number,
        distributorId: v.distributorId || undefined,
        siteId: v.siteId || undefined,
        customerGroup: v.customerGroup,
        phaseSystem: v.phaseSystem || undefined,
        consumerClass: v.consumerClass || undefined,
      };
      return item
        ? endpoints.accounts.updateConsumerUnit(item.id, body)
        : endpoints.accounts.addConsumerUnit(account.id, body);
    },
    onSuccess: async () => {
      toast.success(item ? 'Unidade atualizada' : 'Unidade adicionada');
      onOpenChange(false);
      await queryClient.invalidateQueries({ queryKey: queryKeys.account(account.id) });
    },
    onError: (error) => {
      if (isApiError(error) && error.status === 422) setErrors(fieldErrors(error));
      else toast.error(errorMessage(error, 'Não foi possível salvar a unidade consumidora.'));
    },
  });

  const submit = form.handleSubmit((v) => {
    const parsed = createConsumerUnitSchema.safeParse({
      number: v.number,
      customerGroup: v.customerGroup,
    });
    if (!parsed.success) return setErrors(schemaErrors(parsed.error.issues));
    setErrors({});
    save.mutate(v);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {item ? 'Editar unidade consumidora' : 'Nova unidade consumidora'}
          </DialogTitle>
          <DialogDescription>A UC como aparece na fatura de energia.</DialogDescription>
        </DialogHeader>
        <form noValidate className="grid gap-4" onSubmit={submit}>
          <Field id="uc-number" label="Número da UC" error={errors.number}>
            <Input
              {...fieldAria('uc-number', errors.number)}
              autoFocus
              {...form.register('number')}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="uc-distributor"
              label="Concessionária"
              hint="Cadastre em Administração → Tarifas."
            >
              <NativeSelect id="uc-distributor" {...form.register('distributorId')}>
                <option value="">Não informada</option>
                {distributors.data?.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="uc-site" label="Imóvel">
              <NativeSelect id="uc-site" {...form.register('siteId')}>
                <option value="">Não vinculado</option>
                {account.sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field id="uc-group" label="Grupo tarifário">
              <NativeSelect id="uc-group" {...form.register('customerGroup')}>
                {Object.values(CustomerGroup).map((g) => (
                  <option key={g} value={g}>
                    {CUSTOMER_GROUP_LABELS[g]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="uc-phase" label="Tipo de ligação">
              <NativeSelect id="uc-phase" {...form.register('phaseSystem')}>
                <option value="">Não informado</option>
                {Object.values(PhaseSystem).map((p) => (
                  <option key={p} value={p}>
                    {PHASE_SYSTEM_LABELS[p]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="uc-class" label="Classe">
              <Input id="uc-class" placeholder="Residencial" {...form.register('consumerClass')} />
            </Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? <Spinner /> : null}
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
