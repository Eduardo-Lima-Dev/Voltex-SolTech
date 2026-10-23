import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
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
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from '@voltex/ui';
import type { PortalProjectDto } from '@voltex/shared';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api';
import { formatCents, formatDate, formatDateTime, formatKwh } from '@/lib/format';
import { DailyChart } from '../operations/plant-monitoring';
import { Milestones } from './portal-home-page';

const RECEIVABLE: Record<string, { label: string; variant: 'secondary' | 'green' | 'red' }> = {
  OPEN: { label: 'A vencer', variant: 'secondary' },
  PAID: { label: 'Paga', variant: 'green' },
  OVERDUE: { label: 'Vencida', variant: 'red' },
};
const TICKET_STATUS: Record<string, string> = {
  OPEN: 'Aberto',
  IN_PROGRESS: 'Em atendimento',
  WAITING_CUSTOMER: 'Aguardando você',
  RESOLVED: 'Resolvido',
  CLOSED: 'Encerrado',
};
const UPLOAD_STATUS = { PENDING: 'Em análise', ACCEPTED: 'Aceito', REJECTED: 'Recusado' } as const;
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function useRefresh(projectId: string) {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['portal', 'project', projectId] });
}

function AcceptanceCard({ project }: { project: PortalProjectDto }) {
  const refresh = useRefresh(project.id);
  const [name, setName] = useState('');
  const [open, setOpen] = useState(false);
  const accept = useMutation({
    mutationFn: () => endpoints.portal.accept(project.id, { acceptedByName: name.trim() }),
    onSuccess: async () => {
      toast.success('Aceite registrado. Obrigado!');
      setOpen(false);
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível registrar o aceite.')),
  });
  const { acceptance } = project;
  if (acceptance.status === 'NOT_YET') return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Aceite do sistema</CardTitle>
        <CardDescription>
          {acceptance.status === 'DONE'
            ? `Aceito por ${acceptance.acceptedByName} em ${formatDate(acceptance.acceptedAt ?? '')}.`
            : 'Os testes finais foram aprovados. Confirme o recebimento do sistema funcionando.'}
        </CardDescription>
      </CardHeader>
      {acceptance.status === 'PENDING' ? (
        <CardContent>
          <Button onClick={() => setOpen(true)}>Registrar o meu aceite</Button>
          {open ? (
            <Dialog open onOpenChange={(o) => (o ? undefined : setOpen(false))}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Aceite do sistema</DialogTitle>
                  <DialogDescription>
                    Ao confirmar, ficam registrados o seu nome, a data e o dispositivo. Isso não é
                    uma assinatura eletrônica.
                  </DialogDescription>
                </DialogHeader>
                <form
                  className="grid gap-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    accept.mutate();
                  }}
                >
                  <div className="grid gap-1.5">
                    <Label htmlFor="accept-name">Seu nome completo</Label>
                    <Input
                      id="accept-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </div>
                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                      Cancelar
                    </Button>
                    <Button type="submit" disabled={accept.isPending || name.trim().length < 2}>
                      Confirmar aceite
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          ) : null}
        </CardContent>
      ) : null}
    </Card>
  );
}

function DocumentsCard({ project }: { project: PortalProjectDto }) {
  const refresh = useRefresh(project.id);
  const [note, setNote] = useState('');
  const open = useMutation({
    mutationFn: (documentId: string) => endpoints.portal.downloadUrl(project.id, documentId),
    onSuccess: ({ url }) => window.open(url, '_blank', 'noopener'),
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível abrir o documento.')),
  });
  const send = useMutation({
    mutationFn: (file: File) => endpoints.portal.upload(project.id, file, note.trim() || undefined),
    onSuccess: async () => {
      toast.success('Arquivo enviado. Ele será analisado pela equipe.');
      setNote('');
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível enviar o arquivo.')),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Documentos</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {project.documents.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum documento liberado ainda.</p>
        ) : (
          <ul className="divide-y text-sm" aria-label="Documentos do projeto">
            {project.documents.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2 py-2">
                <span>
                  {d.label} <span className="text-xs text-muted-foreground">({d.filename})</span>
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={open.isPending}
                  onClick={() => open.mutate(d.id)}
                >
                  Abrir
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="space-y-2 border-t pt-4">
          <h3 className="text-sm font-medium">Enviar um documento</h3>
          <p className="text-xs text-muted-foreground">
            PDF ou imagem. A equipe analisa o arquivo antes de incluí-lo no projeto.
          </p>
          <Input
            aria-label="Observação do envio"
            placeholder="Observação (opcional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <input
            type="file"
            aria-label="Arquivo para enviar"
            accept="application/pdf,image/png,image/jpeg"
            className="text-sm"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) send.mutate(file);
              e.target.value = '';
            }}
          />
          {project.uploads.length > 0 ? (
            <ul className="space-y-1 text-sm" aria-label="Arquivos enviados">
              {project.uploads.map((u) => (
                <li key={u.id}>
                  {u.filename} · <Badge variant="secondary">{UPLOAD_STATUS[u.status]}</Badge>
                  {u.reviewNote ? (
                    <span className="text-xs text-muted-foreground"> — {u.reviewNote}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function NewTicketDialog({ project, onClose }: { project: PortalProjectDto; onClose: () => void }) {
  const refresh = useRefresh(project.id);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const create = useMutation({
    mutationFn: () =>
      endpoints.portal.createTicket({
        plantId: project.plant!.id,
        title: title.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
      }),
    onSuccess: async () => {
      toast.success('Chamado aberto. Avisaremos pelo portal.');
      await refresh();
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível abrir o chamado.')),
  });
  return (
    <Dialog open onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Abrir um chamado</DialogTitle>
          <DialogDescription>Conte o que está acontecendo com o seu sistema.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="tk-title">Resumo</Label>
            <Input id="tk-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="tk-desc">Detalhes (opcional)</Label>
            <textarea
              id="tk-desc"
              className="min-h-24 rounded-md border bg-background p-2 text-sm"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={create.isPending || title.trim().length < 3}>
              Abrir chamado
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function PortalProjectPage() {
  const { id = '' } = useParams();
  const [ticketing, setTicketing] = useState(false);
  const query = useQuery({
    queryKey: ['portal', 'project', id],
    queryFn: () => endpoints.portal.project(id),
  });
  if (query.isPending) return <Skeleton className="h-64 w-full" />;
  if (query.isError)
    return (
      <p role="alert" className="text-sm text-destructive">
        Não foi possível carregar este projeto.
      </p>
    );
  const p = query.data;
  const current = p.monitoring?.months.at(-1);
  return (
    <>
      <header className="space-y-1">
        <Link to="/portal" className="text-sm text-muted-foreground hover:text-foreground">
          ← Meus projetos
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{p.title}</h1>
        <p className="text-sm text-muted-foreground">
          <span className="font-mono">{p.projectCode}</span> ·{' '}
          <Badge variant="secondary">{p.statusLabel}</Badge>
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Etapas</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Milestones items={p.milestones} />
          {p.schedule.length > 0 ? (
            <div className="border-t pt-3">
              <h3 className="mb-1 text-sm font-medium">Agenda</h3>
              <ul className="space-y-1 text-sm" aria-label="Agenda">
                {p.schedule.map((v, i) => (
                  <li key={`${v.type}-${i}`}>
                    {v.title}
                    {v.start ? ` · ${formatDateTime(v.start)}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <AcceptanceCard project={p} />
      <DocumentsCard project={p} />

      {p.monitoring && p.plant ? (
        <Card>
          <CardHeader>
            <CardTitle>Geração do seu sistema</CardTitle>
            <CardDescription>
              {p.plant.name}
              {p.plant.powerKwp ? ` · ${p.plant.powerKwp.toLocaleString('pt-BR')} kWp` : ''}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {p.monitoring.daily.length === 0 ? (
              <p className="text-sm text-muted-foreground">Ainda não recebemos dados de geração.</p>
            ) : (
              <DailyChart daily={p.monitoring.daily} months={p.monitoring.months} />
            )}
            {current ? (
              <p className="text-sm">
                {MONTHS[Number(current.month.slice(5, 7)) - 1]}/{current.month.slice(2, 4)}:{' '}
                <strong>{formatKwh(current.actualKwh)}</strong> gerados
                {p.monitoring.hasExpected && current.expectedToDateKwh
                  ? ` (esperado até agora: ${formatKwh(current.expectedToDateKwh)})`
                  : ''}
                .
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {p.warranties.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Garantias</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm" aria-label="Garantias">
              {p.warranties.map((w) => (
                <li key={w.id}>
                  {w.assetLabel} · até {formatDate(w.endsOn)}
                  {w.daysLeft < 0 ? ' (vencida)' : ''}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {p.receivables.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Parcelas</CardTitle>
            <CardDescription>
              Só para consulta. O pagamento é combinado diretamente com a empresa.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Parcela</TableHead>
                  <TableHead>Vencimento</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Situação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {p.receivables.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.order}</TableCell>
                    <TableCell>{formatDate(r.dueOn)}</TableCell>
                    <TableCell className="text-right">{formatCents(r.amountCents)}</TableCell>
                    <TableCell>
                      <Badge variant={RECEIVABLE[r.status]?.variant ?? 'secondary'}>
                        {RECEIVABLE[r.status]?.label ?? r.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      {p.plant ? (
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
            <CardTitle>Chamados</CardTitle>
            <Button size="sm" onClick={() => setTicketing(true)}>
              Abrir chamado
            </Button>
          </CardHeader>
          <CardContent>
            {p.tickets.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum chamado aberto.</p>
            ) : (
              <ul className="divide-y text-sm" aria-label="Chamados">
                {p.tickets.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-2 py-2">
                    <Link to={`/portal/chamados/${t.id}`} className="hover:underline">
                      {t.code} · {t.title}
                    </Link>
                    <Badge variant="secondary">{TICKET_STATUS[t.status] ?? t.status}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : null}
      {ticketing ? <NewTicketDialog project={p} onClose={() => setTicketing(false)} /> : null}
    </>
  );
}
