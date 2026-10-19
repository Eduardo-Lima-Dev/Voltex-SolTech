import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from '@voltex/ui';
import {
  CustomerGroup,
  CustomerSegment,
  LeadSource,
  createLeadSchema,
  type LeadDto,
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
  Textarea,
} from '@voltex/ui';
import { Field, fieldAria } from '@/components/field';
import { queryKeys } from '@/features/admin/query-keys';
import {
  BRAZILIAN_STATES,
  CUSTOMER_GROUP_LABELS,
  LEAD_SOURCE_LABELS,
  SEGMENT_LABELS,
} from '@/i18n/labels';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage, fieldErrors, isApiError } from '@/lib/api/errors';

interface Values {
  name: string;
  phone: string;
  email: string;
  document: string;
  source: LeadSource;
  segment: '' | CustomerSegment;
  preliminaryGroup: '' | CustomerGroup;
  city: string;
  state: string;
  notes: string;
}

const empty: Values = {
  name: '',
  phone: '',
  email: '',
  document: '',
  source: LeadSource.MANUAL,
  segment: '',
  preliminaryGroup: '',
  city: '',
  state: '',
  notes: '',
};

const fromLead = (lead: LeadDto): Values => ({
  name: lead.name,
  phone: lead.phone ?? '',
  email: lead.email ?? '',
  document: lead.document ?? '',
  source: lead.source,
  segment: lead.segment ?? '',
  preliminaryGroup: lead.preliminaryGroup ?? '',
  city: lead.city ?? '',
  state: lead.state ?? '',
  notes: lead.notes ?? '',
});

interface LeadFormDialogProps {
  /** Lead em edição; `null` cria um novo. */
  lead: LeadDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Abre outro lead (usado quando o servidor aponta um duplicado). */
  onOpenExisting?: (leadId: string) => void;
}

export function LeadFormDialog({ lead, open, onOpenChange, onOpenExisting }: LeadFormDialogProps) {
  const queryClient = useQueryClient();
  const form = useForm<Values>({ defaultValues: empty });
  const [duplicate, setDuplicate] = useState<{ message: string; leadId: string } | null>(null);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) {
      form.reset(lead ? fromLead(lead) : empty);
      setDuplicate(null);
      setServerErrors({});
    }
  }, [open, lead, form]);

  const save = useMutation({
    mutationFn: (values: Values) => {
      const body = {
        name: values.name,
        phone: values.phone || undefined,
        email: values.email || undefined,
        document: values.document || undefined,
        segment: values.segment || undefined,
        preliminaryGroup: values.preliminaryGroup || undefined,
        city: values.city || undefined,
        state: values.state || undefined,
        notes: values.notes || undefined,
      };
      return lead
        ? endpoints.leads.update(lead.id, body)
        : endpoints.leads.create({ ...body, source: values.source });
    },
    onSuccess: async () => {
      toast.success(lead ? 'Lead atualizado' : 'Lead cadastrado');
      onOpenChange(false);
      await queryClient.invalidateQueries({ queryKey: queryKeys.leads() });
    },
    onError: (error) => {
      if (isApiError(error) && error.code === 'DUPLICATE_LEAD') {
        setDuplicate({ message: error.message, leadId: String(error.data?.matchedLeadId ?? '') });
      } else if (isApiError(error) && error.status === 422) {
        setServerErrors(fieldErrors(error));
      } else toast.error(errorMessage(error, 'Não foi possível salvar o lead.'));
    },
  });

  const submit = form.handleSubmit((values) => {
    setDuplicate(null);
    setServerErrors({});
    // O mesmo schema da API valida no navegador: mensagens iguais, sem ida e volta.
    const parsed = createLeadSchema.safeParse({
      name: values.name,
      phone: values.phone || undefined,
      email: values.email || undefined,
      state: values.state || undefined,
    });
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) errors[String(issue.path[0])] ??= issue.message;
      setServerErrors(errors);
      return;
    }
    save.mutate(values);
  });

  const err = (key: string) => serverErrors[key];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{lead ? 'Editar lead' : 'Novo lead'}</DialogTitle>
          <DialogDescription>
            Leads com o mesmo telefone, e-mail ou documento não são cadastrados duas vezes.
          </DialogDescription>
        </DialogHeader>

        {duplicate ? (
          <Alert variant="warning">
            <AlertTitle>Lead duplicado</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>{duplicate.message}</p>
              {duplicate.leadId && onOpenExisting ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onOpenExisting(duplicate.leadId)}
                >
                  Abrir o lead existente
                </Button>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}

        <form noValidate className="grid gap-4" onSubmit={submit}>
          <Field id="lead-name" label="Nome" error={err('name')}>
            <Input {...fieldAria('lead-name', err('name'))} autoFocus {...form.register('name')} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="lead-phone" label="Telefone" error={err('phone')}>
              <Input
                {...fieldAria('lead-phone', err('phone'))}
                inputMode="tel"
                placeholder="(85) 98888-7777"
                {...form.register('phone')}
              />
            </Field>
            <Field id="lead-email" label="E-mail" error={err('email')}>
              <Input
                {...fieldAria('lead-email', err('email'))}
                type="email"
                inputMode="email"
                {...form.register('email')}
              />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="lead-document" label="CPF/CNPJ (opcional)">
              <Input id="lead-document" {...form.register('document')} />
            </Field>
            {lead ? null : (
              <Field id="lead-source" label="Origem">
                <NativeSelect id="lead-source" {...form.register('source')}>
                  {Object.values(LeadSource).map((s) => (
                    <option key={s} value={s}>
                      {LEAD_SOURCE_LABELS[s]}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="lead-segment" label="Segmento">
              <NativeSelect id="lead-segment" {...form.register('segment')}>
                <option value="">Não informado</option>
                {Object.values(CustomerSegment).map((s) => (
                  <option key={s} value={s}>
                    {SEGMENT_LABELS[s]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="lead-group" label="Grupo tarifário (preliminar)">
              <NativeSelect id="lead-group" {...form.register('preliminaryGroup')}>
                <option value="">Não informado</option>
                {Object.values(CustomerGroup).map((g) => (
                  <option key={g} value={g}>
                    {CUSTOMER_GROUP_LABELS[g]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
            <Field id="lead-city" label="Cidade">
              <Input id="lead-city" {...form.register('city')} />
            </Field>
            <Field id="lead-state" label="UF" error={err('state')}>
              <NativeSelect id="lead-state" {...form.register('state')}>
                <option value="">—</option>
                {BRAZILIAN_STATES.map((uf) => (
                  <option key={uf} value={uf}>
                    {uf}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <Field id="lead-notes" label="Observações">
            <Textarea id="lead-notes" rows={3} maxLength={2000} {...form.register('notes')} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? <Spinner /> : null}
              {lead ? 'Salvar' : 'Cadastrar lead'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
