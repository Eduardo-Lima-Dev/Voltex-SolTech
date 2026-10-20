import { useEffect, useState } from 'react';
import { Input, Label } from '@voltex/ui';
import { parseDecimal } from '@/features/calculator/form';

interface Props {
  id: string;
  label: string;
  unit?: string;
  value: number | undefined | null;
  onChange: (value: number | undefined) => void;
  min?: number;
  max?: number;
  /** Campo opcional: vazio vira `undefined`. */
  optional?: boolean;
  disabled?: boolean;
  hint?: string;
  integer?: boolean;
}

const show = (value: number | undefined | null): string =>
  value === undefined || value === null ? '' : String(value).replace('.', ',');

/** Campo numérico com vírgula decimal: guarda o texto enquanto se digita e só entrega o número quando é válido. */
export function NumberField({
  id,
  label,
  unit,
  value,
  onChange,
  min,
  max,
  optional,
  disabled,
  hint,
  integer,
}: Props) {
  const [text, setText] = useState(show(value));
  const [error, setError] = useState<string | null>(null);

  // Quando o valor muda de fora (outra superfície selecionada, desfazer), o texto acompanha.
  useEffect(() => {
    const parsed = parseDecimal(text);
    if (parsed !== value && !(parsed === undefined && (value === undefined || value === null))) {
      setText(show(value));
      setError(null);
    }
    // O texto não entra: só reage a mudança externa do valor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const handle = (raw: string) => {
    setText(raw);
    const parsed = parseDecimal(raw);
    if (parsed === undefined) {
      if (optional) {
        setError(null);
        onChange(undefined);
      } else setError('Obrigatório.');
      return;
    }
    if (Number.isNaN(parsed)) return setError('Use um número.');
    if (integer && !Number.isInteger(parsed)) return setError('Use um número inteiro.');
    if (min !== undefined && parsed < min)
      return setError(`Mínimo ${String(min).replace('.', ',')}.`);
    if (max !== undefined && parsed > max)
      return setError(`Máximo ${String(max).replace('.', ',')}.`);
    setError(null);
    onChange(parsed);
  };

  return (
    <div className="grid gap-1">
      <Label htmlFor={id}>
        {label}
        {unit ? ` (${unit})` : ''}
      </Label>
      <Input
        id={id}
        inputMode="decimal"
        value={text}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        onChange={(e) => handle(e.target.value)}
        onBlur={() => {
          if (!error) setText(show(value));
        }}
      />
      {hint && !error ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
