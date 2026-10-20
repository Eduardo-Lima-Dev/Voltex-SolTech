import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { EngineeringEventDto, EngineeringRequestDetailDto } from '@voltex/shared';
import { REQUEST_PRIORITIES } from '@voltex/shared';
import {
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
  Label,
  NativeSelect,
  Skeleton,
  Spinner,
  toast,
} from '@voltex/ui';
import { Can } from '@/app/guards';
import { ENGINEERING_STATUS_LABELS, ROOF_TYPE_LABELS, SHADING_LABELS } from '@/i18n/labels';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api/errors';
import { formatDateTime, formatNumber } from '@/lib/format';
import { queryKeys } from '../admin/query-keys';
import { EVENT_LABELS, PRIORITY_BADGE, PRIORITY_LABELS, REQUEST_STATUS_BADGE } from './request-ui';

const NEEDS_NOTE = new Set(['WAITING_VISIT', 'WAITING_INFO', 'CANCELLED', 'DONE']);
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const Fact = ({ label, value }: { label: string; value: string | number | null | undefined }) => (
  <div className="border-t pt-2">
    <dt className="text-xs text-muted-foreground">{label}</dt>
    <dd className="text-sm font-medium">
      {value === null || value === undefined || value === '' ? '—' : value}
    </dd>
  </div>
);

function eventText(event: EngineeringEventDto): string {
  const data = event.data as { from?: string; to?: string };
  if (event.type === 'STATUS' && data.to)
    return `${data.from ? `${(ENGINEERING_STATUS_LABELS as Record<string, string>)[data.from] ?? data.from} → ` : ''}${(ENGINEERING_STATUS_LABELS as Record<string, string>)[data.to] ?? data.to}${event.text ? `: ${event.text}` : ''}`;
  if (event.type === 'PRIORITY') {
    const d = event.data as { priority?: keyof typeof PRIORITY_LABELS; dueAt?: string | null };
    return `Prioridade ${d.priority ? PRIORITY_LABELS[d.priority].toLowerCase() : ''}${d.dueAt ? `, prazo ${formatDateTime(d.dueAt)}` : ', sem prazo'}`;
  }
  return event.text ?? '';
}

export function Timeline({ events }: { events: EngineeringEventDto[] }) {
  if (events.length === 0)
    return <p className="text-sm text-muted-foreground">Ainda não há registros.</p>;
  return (
    <ol className="space-y-3" aria-label="Linha do tempo">
      {events.map((event) => (
        <li key={event.id} className="flex gap-3 text-sm">
          <Badge variant={event.type === 'INFO_REQUEST' ? 'yellow' : 'outline'} className="h-fit">
            {EVENT_LABELS[event.type] ?? event.type}
          </Badge>
          <div>
            <p>{eventText(event)}</p>
            <p className="text-xs text-muted-foreground">
              {event.actorName ?? 'Sistema'} · {formatDateTime(event.createdAt)}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function ConsumptionBars({ history }: { history: { month: string; kwh: number }[] }) {
  const max = Math.max(1, ...history.map((h) => h.kwh));
  return (
    <svg
      role="img"
      aria-label={`Consumo dos últimos ${history.length} meses`}
      viewBox={`0 0 ${Math.max(history.length, 1) * 20} 70`}
      className="h-32 w-full rounded border bg-card"
    >
      {history.map((h, i) => (
        <g key={h.month}>
          <rect
            x={i * 20 + 3}
            y={58 - (h.kwh / max) * 52}
            width={14}
            height={(h.kwh / max) * 52}
            className="fill-primary/70"
          >
            <title>{`${h.month}: ${formatNumber(h.kwh, 0)} kWh`}</title>
          </rect>
          <text
            x={i * 20 + 10}
            y={67}
            fontSize={5}
            textAnchor="middle"
            className="fill-muted-foreground"
          >
            {MONTHS[Number(h.month.slice(5, 7)) - 1] ?? h.month.slice(5)}
          </text>
        </g>
      ))}
    </svg>
  );
}

/** Pedido de engenharia: contexto do CRM, andamento e histórico para a engenharia trabalhar sem sair daqui. */
export function RequestPage() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [target, setTarget] = useState<EngineeringRequestDetailDto['status'] | null>(null);
  const [note, setNote] = useState('');
  const [asking, setAsking] = useState(false);
  const [question, setQuestion] = useState('');
  const [comment, setComment] = useState('');
  const [planning, setPlanning] = useState(false);
  const [priority, setPriority] = useState<(typeof REQUEST_PRIORITIES)[number]>('NORMAL');
  const [due, setDue] = useState('');

  const detail = useQuery({
    queryKey: queryKeys.engineeringRequest(id),
    queryFn: () => endpoints.engineering.requestDetail(id),
  });
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.engineeringRequest(id) });
    await queryClient.invalidateQueries({ queryKey: queryKeys.engineeringRequests() });
  };
  const fail = (message: string) => (error: unknown) => toast.error(errorMessage(error, message));

  const changeStatus = useMutation({
    mutationFn: () =>
      endpoints.engineering.changeRequestStatus(id, {
        status: target as NonNullable<typeof target>,
        ...(note.trim() ? { note: note.trim() } : {}),
      }),
    onSuccess: async () => {
      setTarget(null);
      setNote('');
      await refresh();
    },
    onError: fail('Não foi possível mudar o estado.'),
  });
  const addComment = useMutation({
    mutationFn: () => endpoints.engineering.commentRequest(id, comment.trim()),
    onSuccess: async () => {
      setComment('');
      await refresh();
    },
    onError: fail('Não foi possível comentar.'),
  });
  const ask = useMutation({
    mutationFn: () => endpoints.engineering.requestInfo(id, question.trim()),
    onSuccess: async () => {
      toast.success('Pergunta enviada: o vendedor recebeu uma tarefa no CRM.');
      setAsking(false);
      setQuestion('');
      await refresh();
    },
    onError: fail('Não foi possível enviar a pergunta.'),
  });
  const plan = useMutation({
    mutationFn: () =>
      endpoints.engineering.updateRequestPlan(id, {
        priority,
        dueAt: due ? new Date(`${due}T23:59:00`).toISOString() : null,
      }),
    onSuccess: async () => {
      setPlanning(false);
      await refresh();
    },
    onError: fail('Não foi possível salvar.'),
  });
  const open = useMutation({
    mutationFn: () => endpoints.engineering.fromRequest(id),
    onSuccess: async (project) => {
      await refresh();
      void navigate(`/engine/projetos/${project.id}`);
    },
    onError: fail('Não foi possível abrir o projeto (o imóvel precisa ter latitude e longitude).'),
  });

  if (detail.isPending) return <Skeleton className="h-64 w-full" />;
  if (detail.isError)
    return <p className="text-sm text-destructive">Não foi possível carregar o pedido.</p>;
  const r = detail.data;
  const c = r.context;
  const intake = (c.site?.intake ?? {}) as Record<string, unknown>;
  const closed = r.status === 'DONE' || r.status === 'CANCELLED';

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-3">
        <Link to="/engine/pedidos">
          <ArrowLeft /> Pedidos
        </Link>
      </Button>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle>{r.customerName ?? r.opportunityTitle}</CardTitle>
            <CardDescription>
              <Link className="underline" to={`/crm/oportunidades/${r.opportunityId}`}>
                {r.projectCode}
              </Link>
              {' · '}aberto em {formatDateTime(r.createdAt)}
              {r.assigneeName ? ` · responsável: ${r.assigneeName}` : ' · sem responsável'}
            </CardDescription>
            <p className="text-sm">{r.reason}</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex gap-2">
              <Badge variant={REQUEST_STATUS_BADGE[r.status]}>
                {ENGINEERING_STATUS_LABELS[r.status]}
              </Badge>
              <Badge variant={PRIORITY_BADGE[r.priority]}>{PRIORITY_LABELS[r.priority]}</Badge>
            </div>
            {r.dueAt ? (
              <span
                className={r.overdue ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}
              >
                {r.overdue ? 'Atrasado: ' : 'Prazo: '}
                {formatDateTime(r.dueAt)}
              </span>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Can permission="engine.project.write">
            {r.projectId ? (
              <Button asChild>
                <Link to={`/engine/projetos/${r.projectId}`}>Abrir o projeto</Link>
              </Button>
            ) : !closed ? (
              <Button disabled={open.isPending} onClick={() => open.mutate()}>
                {open.isPending ? <Spinner /> : null} Abrir o projeto
              </Button>
            ) : null}
            {r.allowedTransitions
              .filter((s) => s !== 'CANCELLED')
              .map((s) => (
                <Button key={s} variant="outline" onClick={() => setTarget(s)}>
                  {s === 'IN_PROGRESS' && r.status !== 'PENDING'
                    ? 'Retomar'
                    : `Marcar: ${ENGINEERING_STATUS_LABELS[s].toLowerCase()}`}
                </Button>
              ))}
            {!closed ? (
              <Button variant="outline" onClick={() => setAsking(true)}>
                Pedir informação ao vendedor
              </Button>
            ) : null}
            {r.allowedTransitions.includes('CANCELLED') ? (
              <Button variant="ghost" onClick={() => setTarget('CANCELLED')}>
                Cancelar pedido
              </Button>
            ) : null}
          </Can>
          <Can permission="engine.request.manage">
            {!closed ? (
              <Button
                variant="outline"
                onClick={() => {
                  setPriority(r.priority);
                  setDue(r.dueAt ? r.dueAt.slice(0, 10) : '');
                  setPlanning(true);
                }}
              >
                Prioridade e prazo
              </Button>
            ) : null}
          </Can>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cliente e imóvel (CRM)</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-3 sm:grid-cols-2">
              <Fact label="Cliente" value={c.account?.name} />
              <Fact label="Vendedor" value={c.seller?.name} />
              <Fact
                label="Imóvel"
                value={c.site ? `${c.site.name} · ${c.site.city}/${c.site.state}` : null}
              />
              <Fact
                label="Coordenadas"
                value={
                  c.site?.latitude != null && c.site.longitude != null
                    ? `${c.site.latitude}, ${c.site.longitude}`
                    : 'não informadas'
                }
              />
              <Fact label="Unidade consumidora" value={c.consumerUnit?.number} />
              <Fact label="Distribuidora" value={c.consumerUnit?.distributorName} />
              <Fact
                label="Grupo / ligação"
                value={
                  c.consumerUnit
                    ? `${c.consumerUnit.customerGroup}${c.consumerUnit.phaseSystem ? ` · ${c.consumerUnit.phaseSystem}` : ''}`
                    : null
                }
              />
              <Fact
                label="Telhado"
                value={
                  intake.roofType
                    ? ((ROOF_TYPE_LABELS as Record<string, string>)[String(intake.roofType)] ??
                      String(intake.roofType))
                    : null
                }
              />
              <Fact
                label="Azimute / inclinação"
                value={
                  intake.roofAzimuthDegrees != null || intake.tiltDegrees != null
                    ? `${intake.roofAzimuthDegrees ?? '—'}° / ${intake.tiltDegrees ?? '—'}°`
                    : null
                }
              />
              <Fact
                label="Sombreamento"
                value={
                  intake.shading
                    ? ((SHADING_LABELS as Record<string, string>)[String(intake.shading)] ??
                      String(intake.shading))
                    : null
                }
              />
              <Fact
                label="Área disponível"
                value={intake.availableAreaM2 != null ? `${intake.availableAreaM2} m²` : null}
              />
              <Fact
                label="Disjuntor de entrada"
                value={intake.entryBreakerAmps != null ? `${intake.entryBreakerAmps} A` : null}
              />
              <Fact
                label="Aterramento adequado"
                value={
                  intake.groundingAdequate === true
                    ? 'sim'
                    : intake.groundingAdequate === false
                      ? 'não'
                      : null
                }
              />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cálculo preliminar e consumo</CardTitle>
            <CardDescription>
              O cálculo do CRM é indicativo (EnergIF EF-R02): o projeto técnico o substitui.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {c.calculation ? (
              <>
                <p className="text-sm">
                  {c.calculation.systemKwp != null
                    ? `${formatNumber(c.calculation.systemKwp, 2)} kWp`
                    : 'potência não informada'}
                  {c.calculation.generationKwhYear != null
                    ? ` · ${formatNumber(c.calculation.generationKwhYear, 0)} kWh/ano`
                    : ''}
                  {' · '}calculado em {formatDateTime(c.calculation.createdAt)}
                </p>
                {c.calculation.alerts.length > 0 ? (
                  <ul className="space-y-1 text-sm">
                    {c.calculation.alerts.map((a) => (
                      <li
                        key={a.message}
                        className="rounded border border-warning/50 bg-warning/10 p-2"
                      >
                        {a.message}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Sem cálculo preliminar.</p>
            )}
            {c.consumptionHistory.length > 0 ? (
              <ConsumptionBars history={c.consumptionHistory} />
            ) : (
              <p className="text-sm text-muted-foreground">
                Sem fatura validada: peça ao vendedor.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Andamento</CardTitle>
          <CardDescription>Estados, comentários, perguntas ao vendedor e prazos.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Can permission="engine.project.write">
            <div className="flex flex-wrap items-end gap-2">
              <div className="grid min-w-72 flex-1 gap-1">
                <Label htmlFor="rq-comment">Comentário</Label>
                <Input
                  id="rq-comment"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                />
              </div>
              <Button
                variant="outline"
                disabled={comment.trim().length < 2 || addComment.isPending}
                onClick={() => addComment.mutate()}
              >
                Comentar
              </Button>
            </div>
          </Can>
          <Timeline events={r.events} />
        </CardContent>
      </Card>

      <Dialog open={target !== null} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{target ? ENGINEERING_STATUS_LABELS[target] : ''}</DialogTitle>
            <DialogDescription>
              {target && NEEDS_NOTE.has(target)
                ? 'Explique o motivo: fica no histórico do pedido.'
                : 'A mudança fica no histórico do pedido.'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="rq-note">Observação</Label>
            <Input id="rq-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)}>
              Voltar
            </Button>
            <Button
              disabled={
                changeStatus.isPending ||
                (target !== null && NEEDS_NOTE.has(target) && note.trim().length < 3)
              }
              onClick={() => changeStatus.mutate()}
            >
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={asking} onOpenChange={setAsking}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pedir informação ao vendedor</DialogTitle>
            <DialogDescription>
              Vira uma tarefa no CRM para o responsável pela oportunidade, e o pedido fica
              aguardando a resposta.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="rq-question">Pergunta</Label>
            <Input
              id="rq-question"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAsking(false)}>
              Voltar
            </Button>
            <Button
              disabled={question.trim().length < 5 || ask.isPending}
              onClick={() => ask.mutate()}
            >
              Enviar pergunta
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={planning} onOpenChange={setPlanning}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Prioridade e prazo</DialogTitle>
            <DialogDescription>
              Quem coordena a engenharia define a ordem de atendimento.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="rq-priority">Prioridade</Label>
              <NativeSelect
                id="rq-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as typeof priority)}
              >
                {REQUEST_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABELS[p]}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="rq-due">Prazo</Label>
              <Input id="rq-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPlanning(false)}>
              Voltar
            </Button>
            <Button disabled={plan.isPending} onClick={() => plan.mutate()}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
