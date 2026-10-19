import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from '@voltex/ui';
import type { OpportunityDto } from '@voltex/shared';
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
} from '@voltex/ui';
import { Field } from '@/components/field';
import { queryKeys } from '@/features/admin/query-keys';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api/errors';

export function EditOpportunityDialog({
  opportunity,
  open,
  onOpenChange,
}: {
  opportunity: OpportunityDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [siteId, setSiteId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [closeDate, setCloseDate] = useState('');

  const account = useQuery({
    queryKey: queryKeys.account(opportunity.accountId),
    queryFn: () => endpoints.accounts.get(opportunity.accountId),
    enabled: open,
  });

  useEffect(() => {
    if (open) {
      setTitle(opportunity.title);
      setSiteId(opportunity.siteId ?? '');
      setUnitId(opportunity.consumerUnitId ?? '');
      setCloseDate(opportunity.expectedCloseDate?.slice(0, 10) ?? '');
    }
  }, [open, opportunity]);

  const save = useMutation({
    mutationFn: () =>
      endpoints.opportunities.update(opportunity.id, {
        title: title.trim() || undefined,
        siteId: siteId || null,
        consumerUnitId: unitId || null,
        expectedCloseDate: closeDate || null,
      }),
    onSuccess: async () => {
      toast.success('Oportunidade atualizada');
      onOpenChange(false);
      await queryClient.invalidateQueries({ queryKey: queryKeys.opportunity(opportunity.id) });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.calculationContext(opportunity.id),
      });
      await queryClient.invalidateQueries({ queryKey: queryKeys.opportunities() });
      await queryClient.invalidateQueries({ queryKey: ['opportunity-board'] });
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível salvar.')),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar oportunidade</DialogTitle>
          <DialogDescription>
            Trocar o imóvel ou a unidade consumidora muda as premissas do negócio.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Field id="edit-title" label="Título">
            <Input id="edit-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="edit-site" label="Imóvel">
              <NativeSelect
                id="edit-site"
                value={siteId}
                onChange={(e) => setSiteId(e.target.value)}
              >
                <option value="">Não definido</option>
                {account.data?.sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="edit-unit" label="Unidade consumidora">
              <NativeSelect
                id="edit-unit"
                value={unitId}
                onChange={(e) => setUnitId(e.target.value)}
              >
                <option value="">Não definida</option>
                {account.data?.consumerUnits.map((u) => (
                  <option key={u.id} value={u.id}>
                    UC {u.number}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <Field id="edit-close" label="Previsão de fechamento">
            <Input
              id="edit-close"
              type="date"
              value={closeDate}
              onChange={(e) => setCloseDate(e.target.value)}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={save.isPending || title.trim().length < 2}
            onClick={() => save.mutate()}
          >
            {save.isPending ? <Spinner /> : null}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
