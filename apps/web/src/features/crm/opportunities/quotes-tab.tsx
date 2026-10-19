import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Skeleton, toast } from '@voltex/ui';
import type { QuoteDto } from '@voltex/shared';
import { Can } from '@/app/guards';
import { queryKeys } from '@/features/admin/query-keys';
import { ConfirmDialog } from '@/features/admin/company/confirm-delete';
import { JustificationDialog } from '@/features/crm/justification-dialog';
import { APPROVAL_STATUS_LABELS, MARGIN_STATUS_LABELS } from '@/i18n/labels';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api/errors';
import { formatCents, formatDateTime, formatPercent } from '@/lib/format';
import { QuoteDialog } from './quote-dialog';

const MARGIN_BADGE = {
  WITHIN_POLICY: 'green',
  BELOW_POLICY: 'red',
  NO_POLICY: 'secondary',
} as const;

export function QuotesTab({ opportunityId, open }: { opportunityId: string; open: boolean }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<QuoteDto | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<QuoteDto | null>(null);
  const [asking, setAsking] = useState<QuoteDto | null>(null);
  const quotes = useQuery({
    queryKey: queryKeys.opportunityQuotes(opportunityId),
    queryFn: () => endpoints.opportunities.quotes(opportunityId),
  });

  const refresh = async () => {
    for (const key of [
      queryKeys.opportunityQuotes(opportunityId),
      queryKeys.opportunityTimeline(opportunityId),
      queryKeys.approvals(),
    ])
      await queryClient.invalidateQueries({ queryKey: key });
  };
  const remove = useMutation({
    mutationFn: (quote: QuoteDto) => endpoints.quotes.remove(quote.id),
    onSuccess: async () => {
      toast.success('Cotação excluída');
      setDeleting(null);
      await refresh();
    },
    onError: (e) => toast.error(errorMessage(e, 'Não foi possível excluir a cotação.')),
  });
  const requestApproval = useMutation({
    mutationFn: ({ quote, justification }: { quote: QuoteDto; justification: string }) =>
      endpoints.quotes.requestApproval(quote.id, { justification }),
    onSuccess: async () => {
      toast.success('Aprovação solicitada ao gestor');
      setAsking(null);
      await refresh();
    },
    onError: (e) => toast.error(errorMessage(e, 'Não foi possível pedir a aprovação.')),
  });

  if (quotes.isPending) return <Skeleton className="h-24 w-full" />;
  if (quotes.isError)
    return <p className="text-sm text-destructive">Não foi possível carregar as cotações.</p>;

  const referenceMinRate = quotes.data.find((q) => q.minMarginRate !== null)?.minMarginRate ?? null;
  const noPolicy = quotes.data.some((q) => q.marginStatus === 'NO_POLICY');

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Cada cotação reúne materiais, custos e preço. A margem precisa estar dentro da política da
        empresa — ou aprovada por um gestor — para entrar numa proposta.
      </p>
      {noPolicy ? (
        <p role="status" className="rounded-md border border-warning/60 bg-warning/15 p-3 text-sm">
          A empresa ainda não definiu a margem mínima. Peça a quem administra para cadastrar em
          Administração → Margens; sem isso, nenhuma cotação é liberada.
        </p>
      ) : null}
      <Can permission="crm.quote.write">
        {open ? (
          <div>
            <Button size="sm" onClick={() => setEditing(null)}>
              <Plus /> Nova cotação
            </Button>
          </div>
        ) : null}
      </Can>

      {quotes.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma cotação ainda.</p>
      ) : (
        <ul className="space-y-3">
          {quotes.data.map((quote) => {
            const canAsk =
              open &&
              quote.marginStatus === 'BELOW_POLICY' &&
              !quote.locked &&
              (quote.approvalStatus === 'NONE' || quote.approvalStatus === 'REJECTED');
            return (
              <li key={quote.id} className="space-y-3 rounded-lg border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="font-medium">
                        v{quote.version}
                        {quote.title ? ` · ${quote.title}` : ''}
                      </h4>
                      <Badge variant={MARGIN_BADGE[quote.marginStatus]}>
                        {MARGIN_STATUS_LABELS[quote.marginStatus]}
                      </Badge>
                      {quote.approvalStatus !== 'NONE' ? (
                        <Badge variant="outline">
                          {APPROVAL_STATUS_LABELS[quote.approvalStatus]}
                        </Badge>
                      ) : null}
                      {quote.locked ? (
                        <Badge variant="secondary">
                          <Lock aria-hidden /> Em proposta
                        </Badge>
                      ) : null}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Criada em {formatDateTime(quote.createdAt)}
                    </p>
                  </div>
                  <dl className="grid grid-cols-3 gap-x-6 text-right text-sm">
                    <div>
                      <dt className="text-xs text-muted-foreground">Preço</dt>
                      <dd className="font-semibold">{formatCents(quote.priceCents)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Margem</dt>
                      <dd className="font-semibold">{formatPercent(quote.margin.marginRate, 1)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Mínimo</dt>
                      <dd>
                        {quote.minMarginRate === null ? '—' : formatPercent(quote.minMarginRate, 1)}
                      </dd>
                    </div>
                  </dl>
                </div>
                {quote.marginStatus === 'BELOW_POLICY' && quote.minPriceCents !== null ? (
                  <p className="text-sm text-muted-foreground">
                    Para atingir a margem mínima, o preço precisa ser de pelo menos{' '}
                    <strong>{formatCents(quote.minPriceCents)}</strong>.
                  </p>
                ) : null}
                <Can permission="crm.quote.write">
                  {open && !quote.locked ? (
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => setEditing(quote)}>
                        <Pencil /> Editar
                      </Button>
                      {canAsk ? (
                        <Button size="sm" variant="outline" onClick={() => setAsking(quote)}>
                          Pedir aprovação
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Excluir cotação v${quote.version}`}
                        onClick={() => setDeleting(quote)}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  ) : null}
                </Can>
              </li>
            );
          })}
        </ul>
      )}

      <QuoteDialog
        opportunityId={opportunityId}
        quote={editing ?? undefined}
        referenceMinRate={referenceMinRate}
        open={editing !== undefined}
        onOpenChange={(o) => !o && setEditing(undefined)}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Excluir cotação?"
        description={`A cotação v${deleting?.version ?? ''} será removida. Pedidos de aprovação pendentes dela são encerrados.`}
        onConfirm={() => deleting && remove.mutate(deleting)}
      />
      <JustificationDialog
        open={asking !== null}
        onOpenChange={(o) => !o && setAsking(null)}
        title="Pedir aprovação de margem"
        description="Explique por que vale vender abaixo da margem mínima. O gestor decide e a decisão fica registrada."
        confirmLabel="Enviar pedido"
        minLength={10}
        pending={requestApproval.isPending}
        onConfirm={(justification) =>
          asking && requestApproval.mutate({ quote: asking, justification })
        }
      />
    </div>
  );
}
