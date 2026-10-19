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

/** Pede o motivo da perda (obrigatório) antes de mover a oportunidade para "Perdido". */
export function LostDialog({
  title,
  open,
  pending,
  onOpenChange,
  onConfirm,
}: {
  title: string;
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
          <DialogTitle>Marcar como perdida</DialogTitle>
          <DialogDescription>
            Por que <strong>{title}</strong> foi perdida? O motivo é obrigatório e fica registrado.
          </DialogDescription>
        </DialogHeader>
        <Field
          id="lost-reason"
          label="Motivo da perda"
          hint="Ex.: preço, concorrência, desistiu, sem crédito."
        >
          <Textarea
            id="lost-reason"
            rows={3}
            maxLength={500}
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
            Marcar como perdida
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
