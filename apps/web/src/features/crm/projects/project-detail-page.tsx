import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  NativeSelect,
  Skeleton,
  Spinner,
  toast,
} from '@voltex/ui';
import type { ProjectChecklistItemDto, ProjectDto, ProjectStatus } from '@voltex/shared';
import { Can } from '@/app/guards';
import { Field } from '@/components/field';
import { queryKeys } from '@/features/admin/query-keys';
import { useAuth } from '@/features/auth/auth-provider';
import { JustificationDialog } from '@/features/crm/justification-dialog';
import {
  CHECKLIST_STATUS_LABELS,
  DEADLINE_LABELS,
  PROJECT_STATUS_LABELS,
  roleLabel,
} from '@/i18n/labels';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage, isApiError } from '@/lib/api/errors';
import { formatCents, formatDate, formatDateTime } from '@/lib/format';
import { PROJECT_STATUS_BADGE } from './projects-page';

/** Próximos passos da homologação (espelha as transições do servidor). */
const NEXT: Record<
  ProjectStatus,
  { to: ProjectStatus; label: string; variant?: 'outline' | 'ghost' }[]
> = {
  DOCUMENTATION: [
    { to: 'SUBMITTED', label: 'Protocolar na distribuidora' },
    { to: 'CANCELLED', label: 'Cancelar projeto', variant: 'ghost' },
  ],
  SUBMITTED: [
    { to: 'INSPECTION', label: 'Vistoria solicitada' },
    { to: 'DOCUMENTATION', label: 'Distribuidora pediu pendências', variant: 'outline' },
    { to: 'CANCELLED', label: 'Cancelar projeto', variant: 'ghost' },
  ],
  INSPECTION: [
    { to: 'APPROVED', label: 'Marcar como homologado' },
    { to: 'DOCUMENTATION', label: 'Voltar para adequações', variant: 'outline' },
    { to: 'CANCELLED', label: 'Cancelar projeto', variant: 'ghost' },
  ],
  APPROVED: [],
  CANCELLED: [],
};

function StatusDialog({
  project,
  target,
  onClose,
}: {
  project: ProjectDto;
  target: { to: ProjectStatus; label: string } | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [protocol, setProtocol] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const needsReason = target?.to === 'CANCELLED' || target?.to === 'DOCUMENTATION';
  const suggestion = project.deadlineSuggestions[0];

  const change = useMutation({
    mutationFn: () =>
      endpoints.projects.changeStatus(project.id, {
        status: (target as { to: ProjectStatus }).to,
        protocolNumber: protocol.trim() || undefined,
        dueAt: dueAt ? new Date(`${dueAt}T12:00:00`).toISOString() : undefined,
        reason: reason.trim() || undefined,
      }),
    onSuccess: async (data) => {
      toast.success(`Situação: ${PROJECT_STATUS_LABELS[data.status]}`);
      onClose();
      await queryClient.invalidateQueries({ queryKey: queryKeys.project(project.id) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.projects() });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.opportunityTimeline(project.opportunityId),
      });
    },
    onError: (e) => setError(errorMessage(e, 'Não foi possível mudar a situação.')),
  });

  const submit = () => {
    if (target?.to === 'SUBMITTED' && protocol.trim().length < 2)
      return setError('Informe o número do protocolo');
    if (needsReason && reason.trim().length < 5)
      return setError('Escreva o motivo (mínimo de 5 caracteres)');
    setError(undefined);
    change.mutate();
  };

  return (
    <Dialog open={target !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{target?.label}</DialogTitle>
          <DialogDescription>Fica registrado na linha do tempo e na auditoria.</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {target?.to === 'SUBMITTED' ? (
            <Field id="status-protocol" label="Número do protocolo">
              <Input
                id="status-protocol"
                value={protocol}
                onChange={(e) => setProtocol(e.target.value)}
              />
            </Field>
          ) : null}
          {target?.to === 'SUBMITTED' || target?.to === 'INSPECTION' ? (
            <Field
              id="status-due"
              label="Prazo de resposta (opcional)"
              hint={
                suggestion
                  ? `Sem data, usamos a sugestão da regra: ${suggestion.days} dias (${suggestion.source}). Confirme na regulação vigente.`
                  : 'Sem regra de prazo cadastrada: informe a data se quiser acompanhar.'
              }
            >
              <Input
                id="status-due"
                type="date"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
              />
            </Field>
          ) : null}
          {needsReason ? (
            <Field
              id="status-reason"
              label={
                target?.to === 'CANCELLED'
                  ? 'Motivo do cancelamento'
                  : 'O que a distribuidora pediu'
              }
            >
              <Input
                id="status-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Voltar
            </Button>
            <Button type="submit" disabled={change.isPending}>
              {change.isPending ? <Spinner /> : null}
              Confirmar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ChecklistRow({
  project,
  item,
  editable,
}: {
  project: ProjectDto;
  item: ProjectChecklistItemDto;
  editable: boolean;
}) {
  const queryClient = useQueryClient();
  const [needsNote, setNeedsNote] = useState<'WAIVED' | 'NOT_APPLICABLE' | null>(null);
  const update = useMutation({
    mutationFn: (input: { status: ProjectChecklistItemDto['status']; note?: string }) =>
      endpoints.projects.updateItem(project.id, item.id, input),
    onSuccess: async () => {
      setNeedsNote(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.project(project.id) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.projects() });
    },
    onError: (e) => toast.error(errorMessage(e, 'Não foi possível atualizar o item.')),
  });
  const choose = (status: string) => {
    if (status === 'WAIVED' || status === 'NOT_APPLICABLE') setNeedsNote(status);
    else update.mutate({ status: status as ProjectChecklistItemDto['status'] });
  };
  const variant =
    item.status === 'DONE'
      ? 'green'
      : item.status === 'PENDING' && item.required
        ? 'yellow'
        : 'secondary';

  return (
    <li className="space-y-1 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-0.5">
          <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
            {item.title}
            {item.required ? null : <Badge variant="outline">Opcional</Badge>}
          </div>
          <p className="text-xs text-muted-foreground">{item.source}</p>
          {item.description ? (
            <p className="text-xs text-muted-foreground">{item.description}</p>
          ) : null}
          {item.note ? <p className="text-xs">Obs.: {item.note}</p> : null}
          {item.completedAt ? (
            <p className="text-xs text-muted-foreground">
              {formatDateTime(item.completedAt)}
              {item.completedByName ? ` · ${item.completedByName}` : ''}
            </p>
          ) : null}
        </div>
        {editable ? (
          <NativeSelect
            aria-label={`Situação de ${item.title}`}
            className="h-8 w-40"
            value={item.status}
            disabled={update.isPending}
            onChange={(e) => choose(e.target.value)}
          >
            {Object.entries(CHECKLIST_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </NativeSelect>
        ) : (
          <Badge variant={variant}>{CHECKLIST_STATUS_LABELS[item.status]}</Badge>
        )}
      </div>
      <JustificationDialog
        open={needsNote !== null}
        onOpenChange={(o) => !o && setNeedsNote(null)}
        title={needsNote === 'WAIVED' ? 'Dispensar o item' : 'Item não se aplica'}
        description={`Explique por que "${item.title}" ${needsNote === 'WAIVED' ? 'foi dispensado' : 'não se aplica'}.`}
        label="Observação"
        confirmLabel="Salvar"
        minLength={3}
        pending={update.isPending}
        onConfirm={(note) => needsNote && update.mutate({ status: needsNote, note })}
      />
    </li>
  );
}

function PeopleCard({ project }: { project: ProjectDto }) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const editable = project.status !== 'CANCELLED' && can('crm.project.write');
  const users = useQuery({
    queryKey: queryKeys.users({ technical: true }),
    queryFn: () => endpoints.users.list({ pageSize: 100, isActive: true }),
    enabled: editable && can('platform.user.read'),
  });
  const distributors = useQuery({
    queryKey: queryKeys.distributors,
    queryFn: endpoints.distributors.list,
    enabled: editable && project.status === 'DOCUMENTATION' && can('platform.rule.read'),
  });
  const update = useMutation({
    mutationFn: (input: { responsibleId?: string | null; distributorId?: string | null }) =>
      endpoints.projects.update(project.id, input),
    onSuccess: async () => {
      toast.success('Projeto atualizado');
      await queryClient.invalidateQueries({ queryKey: queryKeys.project(project.id) });
    },
    onError: (e) => toast.error(errorMessage(e, 'Não foi possível atualizar o projeto.')),
  });
  const technical =
    users.data?.data.filter((u) => u.role === 'TECHNICAL_LEAD' || u.role === 'ENGINEERING') ?? [];

  return (
    <dl className="grid gap-4 sm:grid-cols-2">
      <div>
        <dt className="text-xs text-muted-foreground">Responsável técnico</dt>
        <dd>
          {editable && users.data ? (
            <NativeSelect
              aria-label="Responsável técnico"
              value={project.responsibleId ?? ''}
              onChange={(e) => update.mutate({ responsibleId: e.target.value || null })}
            >
              <option value="">Sem responsável</option>
              {technical.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} · {roleLabel(u.role)}
                </option>
              ))}
            </NativeSelect>
          ) : (
            (project.responsibleName ?? 'Sem responsável')
          )}
        </dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">Concessionária</dt>
        <dd>
          {editable && distributors.data ? (
            <NativeSelect
              aria-label="Concessionária"
              value={project.distributorId ?? ''}
              onChange={(e) => update.mutate({ distributorId: e.target.value || null })}
            >
              <option value="">Não informada</option>
              {distributors.data.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </NativeSelect>
          ) : (
            (project.distributorName ?? 'Não informada')
          )}
        </dd>
      </div>
    </dl>
  );
}

export function ProjectDetailPage() {
  const { id = '' } = useParams();
  const [target, setTarget] = useState<{ to: ProjectStatus; label: string } | null>(null);
  const project = useQuery({
    queryKey: queryKeys.project(id),
    queryFn: () => endpoints.projects.get(id),
  });

  if (project.isPending) return <Skeleton className="h-64 w-full" />;
  if (project.isError)
    return (
      <div className="space-y-3">
        <p className="text-sm text-destructive">
          {isApiError(project.error) && project.error.status === 404
            ? 'Projeto não encontrado.'
            : 'Não foi possível carregar o projeto.'}
        </p>
        <Button asChild variant="outline">
          <Link to="/crm/projetos">Voltar aos projetos</Link>
        </Button>
      </div>
    );

  const p = project.data;
  const editable = p.status !== 'CANCELLED';

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <Link
          to="/crm/projetos"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden /> Projetos
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-2xl font-semibold tracking-tight">{p.title}</h2>
          <Badge variant={PROJECT_STATUS_BADGE[p.status]}>{PROJECT_STATUS_LABELS[p.status]}</Badge>
          {p.overdue ? <Badge variant="red">Prazo vencido</Badge> : null}
        </div>
        <p className="text-muted-foreground">
          {p.accountName} · <span className="font-mono">{p.projectCode}</span> ·{' '}
          {formatCents(p.valueCents)} ·{' '}
          <Link className="hover:underline" to={`/crm/oportunidades/${p.opportunityId}`}>
            ver oportunidade
          </Link>
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Andamento</CardTitle>
          <CardDescription>
            Solicitação de acesso → parecer → vistoria → ponto de conexão aprovado (EnergIF 2023).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <PeopleCard project={p} />
          <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Protocolo</dt>
              <dd>{p.protocolNumber ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Protocolado em</dt>
              <dd>{p.submittedAt ? formatDate(p.submittedAt) : '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Prazo do parecer</dt>
              <dd>
                {p.accessOpinionDueAt ? formatDate(p.accessOpinionDueAt) : '—'}
                {p.accessOpinionDueSource ? (
                  <span className="block text-xs text-muted-foreground">
                    {p.accessOpinionDueSource}
                  </span>
                ) : null}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Prazo da vistoria</dt>
              <dd>{p.inspectionDueAt ? formatDate(p.inspectionDueAt) : '—'}</dd>
            </div>
          </dl>
          {p.deadlineSuggestions.length > 0 ? (
            <Alert variant="info">
              <ul className="space-y-1 text-sm">
                {p.deadlineSuggestions.map((d) => (
                  <li key={d.code}>
                    <strong>{DEADLINE_LABELS[d.code]}:</strong> sugestão de {d.days} dias (até{' '}
                    {formatDate(d.suggestedDueAt)}). Fonte: {d.source}. Confirme na regulação
                    vigente.
                  </li>
                ))}
              </ul>
            </Alert>
          ) : null}
          <Can permission="crm.project.write">
            <div className="flex flex-wrap gap-2">
              {NEXT[p.status].map((n) => (
                <Button
                  key={n.to}
                  size="sm"
                  variant={n.variant ?? 'default'}
                  onClick={() => setTarget(n)}
                >
                  {n.label}
                </Button>
              ))}
            </div>
          </Can>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Checklist de documentos</CardTitle>
          <CardDescription>
            Regra usada: <span className="font-mono">{p.rules.ref}</span> · {p.rules.source}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {p.rules.reviewedBy ? (
            <p className="text-sm text-muted-foreground">Revisada por {p.rules.reviewedBy}.</p>
          ) : (
            <Alert variant="warning">
              <p>
                Esta regra <strong>não foi revisada</strong> por um responsável técnico.
                {p.rules.notes ? ` ${p.rules.notes}` : ''}
              </p>
            </Alert>
          )}
          <p className="text-sm font-medium">
            {p.pendingRequired === 0
              ? 'Todos os documentos obrigatórios estão resolvidos.'
              : `${p.pendingRequired} documento(s) obrigatório(s) pendente(s).`}
          </p>
          <ul className="divide-y">
            {p.checklist.map((item) => (
              <Can
                key={item.id}
                permission="crm.project.write"
                fallback={<ChecklistRow project={p} item={item} editable={false} />}
              >
                <ChecklistRow project={p} item={item} editable={editable} />
              </Can>
            ))}
          </ul>
        </CardContent>
      </Card>

      <StatusDialog project={p} target={target} onClose={() => setTarget(null)} />
    </div>
  );
}
