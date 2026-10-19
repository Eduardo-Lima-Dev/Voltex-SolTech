import type { ReactNode } from 'react';
import { Label } from '@voltex/ui';

interface FieldProps {
  id: string;
  label: string;
  error?: string;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}

/** Rótulo + controle + dica + erro, ligados por `aria-describedby`/`aria-invalid` nos controles. */
export function Field({ id, label, error, hint, className, children }: FieldProps) {
  return (
    <div className={`grid gap-1.5 ${className ?? ''}`}>
      <Label htmlFor={id} data-error={!!error} className="data-[error=true]:text-destructive">
        {label}
      </Label>
      {children}
      {hint && !error ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Atributos de acessibilidade do controle de um `Field`. */
export const fieldAria = (id: string, error?: string, hasHint = false) => ({
  id,
  'aria-invalid': error ? true : undefined,
  'aria-describedby': error ? `${id}-error` : hasHint ? `${id}-hint` : undefined,
});
