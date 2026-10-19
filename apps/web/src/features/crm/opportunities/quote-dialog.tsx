import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
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
  toast,
} from '@voltex/ui';
import type { QuoteDto } from '@voltex/shared';
import { Field } from '@/components/field';
import { queryKeys } from '@/features/admin/query-keys';
import { QUOTE_CATEGORY_LABELS } from '@/i18n/labels';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api/errors';
import { formatCents, formatPercent } from '@/lib/format';
import {
  QUOTE_ITEM_CATEGORIES,
  emptyItem,
  emptyQuoteForm,
  parseQuoteForm,
  previewMargin,
  quoteToForm,
  type QuoteFormErrors,
  type QuoteFormState,
} from './quote-form';

interface QuoteDialogProps {
  opportunityId: string;
  /** Cotação em edição; vazio cria uma nova versão. */
  quote?: QuoteDto;
  /** Margem mínima conhecida (de outra cotação), só para a prévia. */
  referenceMinRate: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const COST_FIELDS = [
  ['freight', 'Frete (R$)'],
  ['installation', 'Instalação (R$)'],
  ['travel', 'Deslocamento (R$)'],
  ['other', 'Outros custos (R$)'],
] as const;
const RATE_FIELDS = [
  ['contingency', 'Contingência (%)', 'Sobre o custo direto'],
  ['commission', 'Comissão (%)', 'Sobre o preço de venda'],
  ['tax', 'Impostos (%)', 'Alíquota efetiva da sua empresa'],
  ['financing', 'Custo financeiro (%)', 'Sobre o preço de venda'],
] as const;

export function QuoteDialog({
  opportunityId,
  quote,
  referenceMinRate,
  open,
  onOpenChange,
}: QuoteDialogProps) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<QuoteFormState>(emptyQuoteForm);
  const [errors, setErrors] = useState<QuoteFormErrors>();

  useEffect(() => {
    if (open) {
      setForm(quote ? quoteToForm(quote) : emptyQuoteForm());
      setErrors(undefined);
    }
  }, [open, quote]);

  const set = <K extends keyof QuoteFormState>(key: K, value: QuoteFormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  const setItem = (index: number, patch: Partial<QuoteFormState['items'][number]>) =>
    set(
      'items',
      form.items.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );

  const margin = useMemo(() => previewMargin(form), [form]);
  const minRate = quote?.minMarginRate ?? referenceMinRate;

  const save = useMutation({
    mutationFn: (input: NonNullable<ReturnType<typeof buildInput>>) =>
      quote
        ? endpoints.quotes.update(quote.id, input)
        : endpoints.opportunities.createQuote(opportunityId, input),
    onSuccess: async () => {
      toast.success(quote ? 'Cotação atualizada' : 'Cotação criada');
      onOpenChange(false);
      for (const key of [
        queryKeys.opportunityQuotes(opportunityId),
        queryKeys.opportunityTimeline(opportunityId),
        queryKeys.approvals(),
      ])
        await queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível salvar a cotação.')),
  });

  function buildInput() {
    const parsed = parseQuoteForm(form);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return null;
    }
    setErrors(undefined);
    return parsed.value;
  }

  const submit = () => {
    const input = buildInput();
    if (input) save.mutate(input);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{quote ? `Editar cotação v${quote.version}` : 'Nova cotação'}</DialogTitle>
          <DialogDescription>
            Custos internos: o cliente nunca vê esta tela. A margem é conferida contra a política da
            empresa.
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="grid gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Field id="quote-title" label="Nome do cenário (opcional)">
            <Input
              id="quote-title"
              placeholder="Ex.: Essencial"
              value={form.title}
              onChange={(e) => set('title', e.target.value)}
            />
          </Field>

          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Lista de materiais</legend>
            {form.items.map((row, index) => (
              <div key={index} className="grid gap-2 sm:grid-cols-[9rem_1fr_5rem_8rem_auto]">
                <NativeSelect
                  aria-label={`Categoria do item ${index + 1}`}
                  value={row.category}
                  onChange={(e) =>
                    setItem(index, { category: e.target.value as typeof row.category })
                  }
                >
                  {QUOTE_ITEM_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {QUOTE_CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </NativeSelect>
                <Input
                  aria-label={`Descrição do item ${index + 1}`}
                  placeholder="Descrição"
                  value={row.description}
                  onChange={(e) => setItem(index, { description: e.target.value })}
                />
                <Input
                  aria-label={`Quantidade do item ${index + 1}`}
                  inputMode="decimal"
                  value={row.quantity}
                  onChange={(e) => setItem(index, { quantity: e.target.value })}
                />
                <Input
                  aria-label={`Custo unitário do item ${index + 1} (R$)`}
                  inputMode="decimal"
                  placeholder="0,00"
                  value={row.unitCost}
                  onChange={(e) => setItem(index, { unitCost: e.target.value })}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remover item ${index + 1}`}
                  disabled={form.items.length === 1}
                  onClick={() =>
                    set(
                      'items',
                      form.items.filter((_, i) => i !== index),
                    )
                  }
                >
                  <Trash2 />
                </Button>
                {errors?.itemRows[index] ? (
                  <p role="alert" className="text-xs text-destructive sm:col-span-5">
                    {errors.itemRows[index]}
                  </p>
                ) : null}
              </div>
            ))}
            {errors?.items ? (
              <p role="alert" className="text-xs text-destructive">
                {errors.items}
              </p>
            ) : null}
            <div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => set('items', [...form.items, emptyItem('OTHER_MATERIAL')])}
              >
                <Plus /> Adicionar item
              </Button>
            </div>
          </fieldset>

          <div className="grid gap-3 sm:grid-cols-4">
            {COST_FIELDS.map(([key, label]) => (
              <Field key={key} id={`quote-${key}`} label={label} error={errors?.fields[key]}>
                <Input
                  id={`quote-${key}`}
                  inputMode="decimal"
                  placeholder="0,00"
                  value={form[key]}
                  onChange={(e) => set(key, e.target.value)}
                />
              </Field>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            {RATE_FIELDS.map(([key, label, hint]) => (
              <Field
                key={key}
                id={`quote-${key}`}
                label={label}
                hint={hint}
                error={errors?.fields[key]}
              >
                <Input
                  id={`quote-${key}`}
                  inputMode="decimal"
                  placeholder="0"
                  value={form[key]}
                  onChange={(e) => set(key, e.target.value)}
                />
              </Field>
            ))}
          </div>

          <Field id="quote-price" label="Preço de venda (R$)" error={errors?.fields.price}>
            <Input
              id="quote-price"
              inputMode="decimal"
              placeholder="0,00"
              aria-invalid={errors?.fields.price ? true : undefined}
              value={form.price}
              onChange={(e) => set('price', e.target.value)}
            />
          </Field>

          <section
            aria-label="Prévia da margem"
            aria-live="polite"
            className="rounded-lg border bg-muted/40 p-3 text-sm"
          >
            {margin ? (
              <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-3">
                <div>
                  <dt className="text-xs text-muted-foreground">Custos totais</dt>
                  <dd>{formatCents(margin.totalCostsCents)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Margem de contribuição</dt>
                  <dd>{formatCents(margin.contributionMarginCents)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Margem</dt>
                  <dd className="font-semibold">
                    {formatPercent(margin.marginRate, 1)}
                    {minRate !== null ? (
                      <span
                        className={
                          margin.marginRate + 1e-9 < minRate
                            ? ' text-destructive'
                            : ' text-muted-foreground'
                        }
                      >
                        {' '}
                        (mínimo {formatPercent(minRate, 1)})
                      </span>
                    ) : null}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="text-muted-foreground">Preencha materiais e preço para ver a margem.</p>
            )}
          </section>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? <Spinner /> : null}
              Salvar cotação
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
