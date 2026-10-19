import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Info, OctagonAlert, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Skeleton,
  Spinner,
  Textarea,
  toast,
} from '@voltex/ui';
import type { GuardEvaluationDto } from '@voltex/shared';
import { Can } from '@/app/guards';
import { Field } from '@/components/field';
import { queryKeys } from '@/features/admin/query-keys';
import { GUARD_SOURCE_LABELS, GUARD_STATUS_DESCRIPTIONS, GUARD_STATUS_LABELS } from '@/i18n/labels';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api/errors';
import { formatDateTime } from '@/lib/format';

const STATUS_BADGE = { GREEN: 'green', YELLOW: 'yellow', RED: 'red' } as const;
const SEVERITY_ORDER = { BLOCKING: 0, WARNING: 1, INFO: 2 } as const;
const SEVERITY_ICON = { BLOCKING: OctagonAlert, WARNING: AlertTriangle, INFO: Info } as const;
const SEVERITY_VARIANT = { BLOCKING: 'destructive', WARNING: 'warning', INFO: 'info' } as const;

export function GuardStatusBadge({ status }: { status: GuardEvaluationDto['status'] }) {
  return (
    <Badge variant={STATUS_BADGE[status]}>
      Triagem {GUARD_STATUS_LABELS[status].toLowerCase()}
    </Badge>
  );
}

function useInvalidateGuard(opportunityId: string) {
  const queryClient = useQueryClient();
  return async () => {
    for (const key of [
      queryKeys.opportunityGuard(opportunityId),
      queryKeys.opportunityTimeline(opportunityId),
      queryKeys.opportunity(opportunityId),
    ])
      await queryClient.invalidateQueries({ queryKey: key });
    await queryClient.invalidateQueries({ queryKey: ['opportunity-board'] });
  };
}

function OverrideDialog({
  opportunityId,
  evaluation,
  open,
  onOpenChange,
}: {
  opportunityId: string;
  evaluation: GuardEvaluationDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const refresh = useInvalidateGuard(opportunityId);
  const [justification, setJustification] = useState('');
  const [error, setError] = useState<string>();
  const release = useMutation({
    mutationFn: () =>
      endpoints.opportunities.overrideGuard(opportunityId, {
        evaluationId: evaluation.id,
        justification: justification.trim(),
      }),
    onSuccess: async () => {
      toast.success('Triagem liberada para a cotação');
      setJustification('');
      onOpenChange(false);
      await refresh();
    },
    onError: (e) => toast.error(errorMessage(e, 'Não foi possível liberar a triagem.')),
  });
  const submit = () => {
    if (justification.trim().length < 10) {
      setError('Justifique a liberação (mínimo de 10 caracteres)');
      return;
    }
    setError(undefined);
    release.mutate();
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Liberar triagem {GUARD_STATUS_LABELS[evaluation.status].toLowerCase()}
          </DialogTitle>
          <DialogDescription>
            A liberação vale só para esta avaliação (v{evaluation.version}). Se as premissas
            mudarem, será preciso avaliar de novo. Fica registrada com o seu nome na auditoria.
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Field id="guard-justification" label="Justificativa" error={error}>
            <Textarea
              id="guard-justification"
              rows={4}
              aria-invalid={error ? true : undefined}
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={release.isPending}>
              {release.isPending ? <Spinner /> : null}
              Liberar para a cotação
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ChecksList({ checks }: { checks: GuardEvaluationDto['checks'] }) {
  if (checks.length === 0)
    return <p className="text-sm text-muted-foreground">Nenhum ponto de atenção.</p>;
  const sorted = [...checks].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );
  return (
    <ul className="space-y-2">
      {sorted.map((check) => {
        const Icon = SEVERITY_ICON[check.severity];
        return (
          <li key={check.code}>
            <Alert variant={SEVERITY_VARIANT[check.severity]}>
              <Icon aria-hidden />
              <div className="space-y-0.5">
                <p>{check.message}</p>
                <p className="text-xs text-muted-foreground">{GUARD_SOURCE_LABELS[check.source]}</p>
              </div>
            </Alert>
          </li>
        );
      })}
    </ul>
  );
}

export function GuardTab({ opportunityId, open }: { opportunityId: string; open: boolean }) {
  const refresh = useInvalidateGuard(opportunityId);
  const [releasing, setReleasing] = useState(false);
  const overview = useQuery({
    queryKey: queryKeys.opportunityGuard(opportunityId),
    queryFn: () => endpoints.opportunities.guard(opportunityId),
  });
  const evaluate = useMutation({
    mutationFn: () => endpoints.opportunities.evaluateGuard(opportunityId),
    onSuccess: async () => {
      toast.success('Triagem avaliada');
      await refresh();
    },
    onError: (e) => toast.error(errorMessage(e, 'Não foi possível avaliar a triagem.')),
  });

  if (overview.isPending) return <Skeleton className="h-24 w-full" />;
  if (overview.isError)
    return <p className="text-sm text-destructive">Não foi possível carregar a triagem.</p>;

  const { current, history } = overview.data;
  const canRelease =
    current && current.status !== 'GREEN' && !current.releasedForQuote && !current.stale;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        A triagem confere se os dados e o cálculo permitem seguir para a cotação. Não substitui a
        análise regulatória nem a de engenharia.
      </p>
      <Can permission="crm.guard.evaluate">
        {open ? (
          <div>
            <Button size="sm" onClick={() => evaluate.mutate()} disabled={evaluate.isPending}>
              {evaluate.isPending ? <Spinner /> : <ShieldCheck />}
              {current ? 'Reavaliar' : 'Avaliar triagem'}
            </Button>
          </div>
        ) : null}
      </Can>

      {!current ? (
        <p className="text-sm text-muted-foreground">Esta oportunidade ainda não foi avaliada.</p>
      ) : (
        <section className="space-y-3 rounded-lg border p-4" aria-label="Avaliação vigente">
          <div className="flex flex-wrap items-center gap-3">
            <GuardStatusBadge status={current.status} />
            <span className="text-sm text-muted-foreground">v{current.version}</span>
            {current.stale ? <Badge variant="yellow">Desatualizada</Badge> : null}
            {current.releasedForQuote ? (
              <Badge variant="outline">Liberada para a cotação</Badge>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">
            {GUARD_STATUS_DESCRIPTIONS[current.status]}
          </p>
          {current.stale ? (
            <Alert variant="warning">
              <AlertTriangle aria-hidden />
              <p>
                As premissas mudaram depois desta avaliação
                {current.invalidatedReason ? ` (${current.invalidatedReason})` : ''}. Avalie de novo
                antes de seguir.
              </p>
            </Alert>
          ) : null}
          {current.needsEngineeringReview ? (
            <p className="text-sm font-medium">Requer revisão de engenharia.</p>
          ) : null}
          <ChecksList checks={current.checks} />
          {current.missingFields.length > 0 ? (
            <div className="text-sm">
              <p className="font-medium">Dados que faltam</p>
              <ul className="list-inside list-disc text-muted-foreground">
                {current.missingFields.map((field) => (
                  <li key={field}>{field}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {current.override ? (
            <div className="rounded-md bg-muted p-3 text-sm">
              <p className="font-medium">
                Liberada por {current.override.decidedByName ?? 'responsável'} em{' '}
                {formatDateTime(current.override.decidedAt)}
              </p>
              <p className="text-muted-foreground">{current.override.justification}</p>
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Avaliada em {formatDateTime(current.createdAt)}
            {current.createdByName ? ` por ${current.createdByName}` : ''} ·{' '}
            {current.algorithmVersion} · regras {current.ruleSetRef}
          </p>
          {open && canRelease ? (
            <Can permission="crm.guard.review">
              <Button size="sm" variant="outline" onClick={() => setReleasing(true)}>
                Liberar mesmo assim…
              </Button>
              <OverrideDialog
                opportunityId={opportunityId}
                evaluation={current}
                open={releasing}
                onOpenChange={setReleasing}
              />
            </Can>
          ) : null}
        </section>
      )}

      {history.length > 0 ? (
        <section className="space-y-2" aria-label="Avaliações anteriores">
          <h4 className="text-sm font-medium">Avaliações anteriores</h4>
          <ul className="divide-y text-sm">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  v{h.version} · {GUARD_STATUS_LABELS[h.status]}
                  {h.invalidatedReason ? ` · ${h.invalidatedReason}` : ''}
                </span>
                <span className="text-xs text-muted-foreground">{formatDateTime(h.createdAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
