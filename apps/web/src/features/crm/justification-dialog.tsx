import { useEffect, useState } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Spinner,
  Textarea,
} from '@voltex/ui';
import { Field } from '@/components/field';

interface JustificationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  label?: string;
  confirmLabel: string;
  minLength: number;
  pending?: boolean;
  onConfirm: (justification: string) => void;
}

/** Pede uma justificativa por escrito antes de uma ação que fica registrada (aprovações, liberações). */
export function JustificationDialog({
  open,
  onOpenChange,
  title,
  description,
  label = 'Justificativa',
  confirmLabel,
  minLength,
  pending,
  onConfirm,
}: JustificationDialogProps) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (open) {
      setText('');
      setError(undefined);
    }
  }, [open]);

  const submit = () => {
    if (text.trim().length < minLength) {
      setError(`Escreva pelo menos ${minLength} caracteres`);
      return;
    }
    setError(undefined);
    onConfirm(text.trim());
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Field id="justification" label={label} error={error}>
            <Textarea
              id="justification"
              rows={4}
              autoFocus
              aria-invalid={error ? true : undefined}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner /> : null}
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
