import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Calculator, Link2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from '@voltex/ui';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  NativeSelect,
  Skeleton,
  Spinner,
} from '@voltex/ui';
import { Can } from '@/app/guards';
import { Field } from '@/components/field';
import { TrafficLightBadge } from '@/features/calculator/result-view';
import { queryKeys } from '@/features/admin/query-keys';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api/errors';
import { formatCents, formatDateTime, formatKwp } from '@/lib/format';

function LinkExistingDialog({
  opportunityId,
  open,
  onOpenChange,
}: {
  opportunityId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [chosen, setChosen] = useState('');
  const recent = useQuery({
    queryKey: queryKeys.calculations({ picker: true }),
    queryFn: () => endpoints.calculator.list({ pageSize: 50 }),
    enabled: open,
  });
  const link = useMutation({
    mutationFn: () => endpoints.opportunities.linkCalculation(opportunityId, chosen),
    onSuccess: async () => {
      toast.success('Cálculo vinculado');
      setChosen('');
      onOpenChange(false);
      for (const key of [
        queryKeys.opportunityCalculations(opportunityId),
        queryKeys.opportunityTimeline(opportunityId),
        queryKeys.opportunityEngineering(opportunityId),
        queryKeys.opportunity(opportunityId),
      ])
        await queryClient.invalidateQueries({ queryKey: key });
      await queryClient.invalidateQueries({ queryKey: ['opportunity-board'] });
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível vincular o cálculo.')),
  });
  const available = recent.data?.data.filter((c) => !c.opportunityId) ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Vincular cálculo existente</DialogTitle>
          <DialogDescription>
            Só aparecem cálculos que ainda não estão em nenhuma oportunidade.
          </DialogDescription>
        </DialogHeader>
        <Field id="link-calc" label="Cálculo">
          <NativeSelect id="link-calc" value={chosen} onChange={(e) => setChosen(e.target.value)}>
            <option value="">Selecione</option>
            {available.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title || c.customerName || 'Sem título'} ·{' '}
                {formatKwp(c.result.installedPowerKwp)} · {formatDateTime(c.createdAt)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" disabled={!chosen || link.isPending} onClick={() => link.mutate()}>
            {link.isPending ? <Spinner /> : null}
            Vincular
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CalculationsTab({ opportunityId }: { opportunityId: string }) {
  const [linking, setLinking] = useState(false);
  const calculations = useQuery({
    queryKey: queryKeys.opportunityCalculations(opportunityId),
    queryFn: () => endpoints.opportunities.calculations(opportunityId),
  });
  return (
    <div className="space-y-3">
      <Can permission={['crm.opportunity.write', 'calculator.session.create']}>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm">
            <Link to={`/calculator/new?opportunityId=${opportunityId}`}>
              <Calculator /> Novo cálculo
            </Link>
          </Button>
          <Button size="sm" variant="outline" onClick={() => setLinking(true)}>
            <Link2 /> Vincular existente
          </Button>
        </div>
      </Can>
      {calculations.isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : calculations.isError ? (
        <p className="text-sm text-destructive">Não foi possível carregar os cálculos.</p>
      ) : calculations.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhum cálculo ainda. “Novo cálculo” já vem preenchido com a fatura validada e os dados do
          imóvel.
        </p>
      ) : (
        <ul className="divide-y">
          {calculations.data.map((c) => (
            <li
              key={c.id}
              className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
            >
              <div>
                <Link to={`/calculator/${c.id}`} className="font-medium hover:underline">
                  {c.title || c.customerName || 'Cálculo sem título'}
                </Link>
                <div className="text-xs text-muted-foreground">
                  {formatKwp(c.result.installedPowerKwp)} · {formatCents(c.result.investmentCents)}{' '}
                  · {formatDateTime(c.createdAt)} · regra {c.ruleSetRef}
                </div>
              </div>
              <TrafficLightBadge light={c.trafficLight} />
            </li>
          ))}
        </ul>
      )}
      <LinkExistingDialog opportunityId={opportunityId} open={linking} onOpenChange={setLinking} />
    </div>
  );
}
