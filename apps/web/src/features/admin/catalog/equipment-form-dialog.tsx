import { useEffect, useState } from 'react';
import type { EquipmentKind, FieldConfidence } from '@voltex/shared';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  NativeSelect,
  Spinner,
} from '@voltex/ui';
import { parseDecimal } from '@/features/calculator/form';
import { CATALOG_FIELDS, CONFIDENCE_LABELS, type CatalogField } from './catalog-fields';

export interface EquipmentFormValues {
  manufacturer: string;
  model: string;
  spec: Record<string, unknown>;
}

interface Initial {
  manufacturer?: string;
  model?: string;
  spec?: Record<string, unknown>;
  fieldConfidence?: Record<string, FieldConfidence>;
  /** Campos que o arquivo não trouxe: destacados para a pessoa preencher. */
  missing?: string[];
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: EquipmentKind;
  title: string;
  description?: string;
  initial?: Initial;
  /** Fabricante e modelo não mudam (ex.: adoção de referência). */
  lockIdentity?: boolean;
  submitLabel?: string;
  pending?: boolean;
  /** Erros do servidor por campo (`spec.pmaxWp`, `manufacturer`...). */
  serverErrors?: Record<string, string>;
  onSubmit: (values: EquipmentFormValues) => void;
}

const toText = (field: CatalogField, value: unknown): string => {
  if (value === undefined || value === null) return '';
  if (field.type === 'bool') return value === true ? 'true' : 'false';
  return String(value).replace('.', ',');
};

/**
 * Formulário único de ficha técnica (cadastro manual, edição de rascunho, conferência de importação e adoção de
 * referência). Mostra a confiança de cada campo lido de arquivo e destaca o que ainda falta.
 */
export function EquipmentFormDialog({
  open,
  onOpenChange,
  kind,
  title,
  description,
  initial,
  lockIdentity,
  submitLabel = 'Salvar rascunho',
  pending,
  serverErrors = {},
  onSubmit,
}: Props) {
  const fields = CATALOG_FIELDS[kind];
  const [manufacturer, setManufacturer] = useState('');
  const [model, setModel] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setManufacturer(initial?.manufacturer ?? '');
    setModel(initial?.model ?? '');
    setValues(Object.fromEntries(fields.map((f) => [f.key, toText(f, initial?.spec?.[f.key])])));
    setErrors({});
    // O formulário reinicia só quando abre ou muda o registro de origem.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial]);

  const submit = () => {
    const next: Record<string, string> = {};
    if (!manufacturer.trim()) next.manufacturer = 'Informe o fabricante.';
    if (!model.trim()) next.model = 'Informe o modelo.';
    const spec: Record<string, unknown> = {};
    for (const field of fields) {
      const raw = (values[field.key] ?? '').trim();
      if (raw === '') {
        if (field.required) next[field.key] = 'Obrigatório.';
        continue;
      }
      if (field.type === 'number' || field.type === 'int') {
        const n = parseDecimal(raw);
        if (n === undefined || Number.isNaN(n) || (field.type === 'int' && !Number.isInteger(n)))
          next[field.key] = field.type === 'int' ? 'Use um número inteiro.' : 'Use um número.';
        else spec[field.key] = n;
      } else if (field.type === 'bool') spec[field.key] = raw === 'true';
      else if (field.type === 'select')
        spec[field.key] = field.options?.find((o) => String(o.value) === raw)?.value ?? raw;
      else spec[field.key] = raw;
    }
    setErrors(next);
    if (Object.keys(next).length === 0)
      onSubmit({ manufacturer: manufacturer.trim(), model: model.trim(), spec });
  };

  const errorOf = (key: string) => errors[key] ?? serverErrors[`spec.${key}`] ?? serverErrors[key];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="eq-manufacturer">Fabricante</Label>
              <Input
                id="eq-manufacturer"
                value={manufacturer}
                disabled={lockIdentity}
                onChange={(e) => setManufacturer(e.target.value)}
              />
              {errorOf('manufacturer') ? (
                <p className="text-xs text-destructive">{errorOf('manufacturer')}</p>
              ) : null}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="eq-model">Modelo</Label>
              <Input
                id="eq-model"
                value={model}
                disabled={lockIdentity}
                onChange={(e) => setModel(e.target.value)}
              />
              {errorOf('model') ? (
                <p className="text-xs text-destructive">{errorOf('model')}</p>
              ) : null}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {fields.map((field) => {
              const id = `eq-${field.key}`;
              const confidence = initial?.fieldConfidence?.[field.key];
              const missing = initial?.missing?.includes(field.key) && !(values[field.key] ?? '');
              return (
                <div key={field.key} className="grid gap-1.5">
                  <Label htmlFor={id} className="flex flex-wrap items-center gap-2">
                    <span>
                      {field.label}
                      {field.unit ? ` (${field.unit})` : ''}
                      {field.required ? ' *' : ''}
                    </span>
                    {confidence && confidence !== 'HIGH' ? (
                      <Badge variant="yellow">{CONFIDENCE_LABELS[confidence]}</Badge>
                    ) : null}
                    {missing ? <Badge variant="red">falta preencher</Badge> : null}
                  </Label>
                  {field.type === 'select' || field.type === 'bool' ? (
                    <NativeSelect
                      id={id}
                      value={values[field.key] ?? ''}
                      onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                    >
                      <option value="">{field.required ? 'Selecione' : 'Não informado'}</option>
                      {field.type === 'bool' ? (
                        <>
                          <option value="true">Sim</option>
                          <option value="false">Não</option>
                        </>
                      ) : (
                        field.options?.map((o) => (
                          <option key={String(o.value)} value={String(o.value)}>
                            {o.label}
                          </option>
                        ))
                      )}
                    </NativeSelect>
                  ) : (
                    <Input
                      id={id}
                      inputMode={field.type === 'text' ? 'text' : 'decimal'}
                      value={values[field.key] ?? ''}
                      onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                    />
                  )}
                  {field.hint ? (
                    <p className="text-xs text-muted-foreground">{field.hint}</p>
                  ) : null}
                  {errorOf(field.key) ? (
                    <p className="text-xs text-destructive">{errorOf(field.key)}</p>
                  ) : null}
                </div>
              );
            })}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner /> : null}
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
