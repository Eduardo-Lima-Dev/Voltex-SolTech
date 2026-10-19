import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { Badge, Button, Skeleton, toast } from '@voltex/ui';
import type { ApprovalDto } from '@voltex/shared';
import { Pagination } from '@/components/pagination';
import { queryKeys } from '@/features/admin/query-keys';
import { JustificationDialog } from '@/features/crm/justification-dialog';
import { APPROVAL_STATUS_LABELS } from '@/i18n/labels';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api/errors';
import { formatCents, formatDateTime, formatPercent } from '@/lib/format';

const FILTERS = [
  { value: 'PENDING', label: 'Pendentes' },
  { value: 'APPROVED', label: 'Aprovadas' },
  { value: 'REJECTED', label: 'Recusadas' },
] as const;
type Filter = (typeof FILTERS)[number]['value'];

const STATUS_BADGE = { PENDING: 'yellow', APPROVED: 'green', REJECTED: 'red' } as const;

export function ApprovalsPage() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<Filter>('PENDING');
  const [page, setPage] = useState(1);
  const [deciding, setDeciding] = useState<{ approval: ApprovalDto; approve: boolean } | null>(
    null,
  );
  const filters = { status, page };
  const approvals = useQuery({
    queryKey: queryKeys.approvals(filters),
    queryFn: () => endpoints.approvals.list({ status, page, pageSize: 20 }),
  });

  const decide = useMutation({
    mutationFn: ({
      approval,
      approve,
      justification,
    }: {
      approval: ApprovalDto;
      approve: boolean;
      justification: string;
    }) => endpoints.approvals.decide(approval.id, { approve, justification }),
    onSuccess: async (_, { approve, approval }) => {
      toast.success(approve ? 'Margem aprovada' : 'Margem recusada');
      setDeciding(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.approvals() });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.opportunityQuotes(approval.opportunityId),
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.opportunityTimeline(approval.opportunityId),
      });
    },
    onError: (e) => toast.error(errorMessage(e, 'Não foi possível registrar a decisão.')),
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Cotações com margem abaixo do mínimo esperam aqui a sua decisão. Quem pediu não pode decidir
        o próprio pedido.
      </p>
      <div role="group" aria-label="Situação" className="flex gap-2">
        {FILTERS.map((f) => (
          <Button
            key={f.value}
            size="sm"
            variant={status === f.value ? 'default' : 'outline'}
            aria-pressed={status === f.value}
            onClick={() => {
              setStatus(f.value);
              setPage(1);
            }}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {approvals.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : approvals.isError ? (
        <p className="text-sm text-destructive">Não foi possível carregar os pedidos.</p>
      ) : approvals.data.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum pedido nesta situação.</p>
      ) : (
        <>
          <ul className="space-y-3">
            {approvals.data.data.map((a) => (
              <li key={a.id} className="space-y-3 rounded-lg border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        className="font-medium hover:underline"
                        to={`/crm/oportunidades/${a.opportunityId}`}
                      >
                        {a.opportunityTitle}
                      </Link>
                      <Badge variant={STATUS_BADGE[a.status]}>
                        {APPROVAL_STATUS_LABELS[a.status]}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {a.accountName} · <span className="font-mono">{a.projectCode}</span> · cotação
                      v{a.quoteVersion}
                    </p>
                  </div>
                  <dl className="grid grid-cols-3 gap-x-6 text-right text-sm">
                    <div>
                      <dt className="text-xs text-muted-foreground">Preço</dt>
                      <dd className="font-semibold">{formatCents(a.priceCents)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Margem</dt>
                      <dd className="font-semibold text-destructive">
                        {formatPercent(a.marginRate, 1)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Mínimo</dt>
                      <dd>{formatPercent(a.minMarginRate, 1)}</dd>
                    </div>
                  </dl>
                </div>
                <p className="rounded-md bg-muted p-3 text-sm">
                  <span className="font-medium">{a.requestedByName ?? 'Alguém'} pediu:</span>{' '}
                  {a.justification}
                </p>
                {a.status !== 'PENDING' ? (
                  <p className="text-sm text-muted-foreground">
                    {a.decidedByName ?? 'Responsável'} decidiu em{' '}
                    {a.decidedAt ? formatDateTime(a.decidedAt) : '—'}: {a.decisionJustification}
                  </p>
                ) : (
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => setDeciding({ approval: a, approve: true })}>
                      Aprovar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setDeciding({ approval: a, approve: false })}
                    >
                      Recusar
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <Pagination
            page={approvals.data.meta.page}
            pageSize={approvals.data.meta.pageSize}
            total={approvals.data.meta.total}
            onPageChange={setPage}
          />
        </>
      )}

      <JustificationDialog
        open={deciding !== null}
        onOpenChange={(o) => !o && setDeciding(null)}
        title={deciding?.approve ? 'Aprovar margem' : 'Recusar margem'}
        description="A decisão e o motivo ficam registrados na linha do tempo e na auditoria."
        label="Motivo da decisão"
        confirmLabel={deciding?.approve ? 'Aprovar' : 'Recusar'}
        minLength={5}
        pending={decide.isPending}
        onConfirm={(justification) => deciding && decide.mutate({ ...deciding, justification })}
      />
    </div>
  );
}
