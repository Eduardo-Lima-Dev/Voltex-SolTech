import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Camera, ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { toast } from '@voltex/ui';
import type {
  CalculationReferencesSummary,
  CalculationSessionDto,
  QuickCalculationSnapshotDto,
} from '@voltex/solar-engine';
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
  Label,
  Skeleton,
  Spinner,
  Textarea,
} from '@voltex/ui';
import { Can } from '@/app/guards';
import { queryKeys } from '@/features/admin/query-keys';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage, isApiError } from '@/lib/api/errors';
import { formatCents, formatDate, formatDateTime } from '@/lib/format';
import { ResultView, TrafficLightBadge } from './result-view';

function Header({
  title,
  subtitle,
  light,
  children,
}: {
  title: string;
  subtitle?: string;
  light: 'GREEN' | 'YELLOW' | 'RED';
  children?: React.ReactNode;
}) {
  return (
    <header className="space-y-3">
      <Link
        to="/calculator"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> Cálculos
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            <TrafficLightBadge light={light} />
          </div>
          {subtitle ? <p className="text-muted-foreground">{subtitle}</p> : null}
        </div>
        {children}
      </div>
    </header>
  );
}

function References({ references }: { references: CalculationReferencesSummary }) {
  const { solarResource, tariff } = references;
  if (!solarResource && !tariff) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Origem dos dados</CardTitle>
        <CardDescription>
          O que foi escolhido nos cadastros e se o valor foi alterado depois.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm md:grid-cols-2">
        {solarResource ? (
          <div className="space-y-1">
            <p className="font-medium">
              Irradiação: {solarResource.name}
              {solarResource.state ? ` — ${solarResource.state}` : ''}{' '}
              {solarResource.overridden ? <Badge variant="yellow">Alterado</Badge> : null}
            </p>
            <p className="text-muted-foreground">
              Fonte: {solarResource.source} · {solarResource.plane}
            </p>
          </div>
        ) : null}
        {tariff ? (
          <div className="space-y-1">
            <p className="font-medium">
              Tarifa: {tariff.distributorName} · Grupo {tariff.customerGroup}{' '}
              {tariff.overridden ? <Badge variant="yellow">Alterada</Badge> : null}
            </p>
            <p className="text-muted-foreground">
              {formatCents(tariff.energyCentsPerKwh)}/kWh desde {formatDate(tariff.validFrom)} ·
              Fonte: {tariff.source}
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function SnapshotDialog({
  session,
  open,
  onOpenChange,
}: {
  session: CalculationSessionDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const create = useMutation({
    mutationFn: () =>
      endpoints.calculator.createSnapshot(session.id, { note: note.trim() || undefined }),
    onSuccess: async () => {
      toast.success('Snapshot salvo');
      setNote('');
      onOpenChange(false);
      await queryClient.invalidateQueries({ queryKey: queryKeys.calculationSnapshots(session.id) });
    },
    onError: (error) =>
      toast.error(
        isApiError(error) && error.status === 403
          ? 'Seu perfil não pode salvar snapshots.'
          : errorMessage(error, 'Não foi possível salvar o snapshot.'),
      ),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Salvar snapshot</DialogTitle>
          <DialogDescription>
            Congela este resultado com a entrada, a regra ({session.ruleSetRef}) e a versão do
            algoritmo ({session.algorithmVersion}). Um snapshot nunca muda, mesmo que tarifas e
            regras mudem depois.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="snapshot-note">Observação (opcional)</Label>
          <Textarea
            id="snapshot-note"
            rows={3}
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Ex.: versão enviada ao cliente em reunião"
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" onClick={() => create.mutate()} disabled={create.isPending}>
            {create.isPending ? <Spinner /> : <Camera />}
            Salvar snapshot
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SnapshotsCard({ id }: { id: string }) {
  const snapshots = useQuery({
    queryKey: queryKeys.calculationSnapshots(id),
    queryFn: () => endpoints.calculator.listSnapshots(id),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Snapshots</CardTitle>
        <CardDescription>Versões congeladas deste cálculo.</CardDescription>
      </CardHeader>
      <CardContent>
        {snapshots.isPending ? (
          <Skeleton className="h-10 w-full" />
        ) : snapshots.isError ? (
          <p className="text-sm text-destructive">Não foi possível carregar os snapshots.</p>
        ) : snapshots.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum snapshot salvo ainda.</p>
        ) : (
          <ul className="divide-y">
            {snapshots.data.map((s: QuickCalculationSnapshotDto) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
              >
                <div>
                  <p className="font-medium">{formatDateTime(s.createdAt)}</p>
                  <p className="text-muted-foreground">{s.note ?? 'Sem observação'}</p>
                </div>
                <Button asChild variant="ghost" size="sm">
                  <Link to={`/calculator/snapshots/${s.id}`}>
                    Abrir <ExternalLink />
                  </Link>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function CalculationDetailPage() {
  const { id = '' } = useParams();
  const [snapshotOpen, setSnapshotOpen] = useState(false);
  const session = useQuery({
    queryKey: queryKeys.calculation(id),
    queryFn: () => endpoints.calculator.get(id),
  });

  if (session.isPending) return <Skeleton className="h-96 w-full" />;
  if (session.isError)
    return (
      <div className="space-y-3">
        <p className="text-sm text-destructive">
          {isApiError(session.error) && session.error.status === 404
            ? 'Cálculo não encontrado.'
            : 'Não foi possível carregar o cálculo.'}
        </p>
        <Button asChild variant="outline">
          <Link to="/calculator">Voltar aos cálculos</Link>
        </Button>
      </div>
    );

  const data = session.data;
  return (
    <div className="space-y-6">
      <Header
        title={data.title || data.customerName || 'Cálculo sem título'}
        subtitle={`${data.title && data.customerName ? `${data.customerName} · ` : ''}Criado em ${formatDateTime(data.createdAt)} · regra ${data.ruleSetRef} · algoritmo ${data.algorithmVersion}`}
        light={data.trafficLight}
      >
        <Can permission="calculator.snapshot.create">
          <Button onClick={() => setSnapshotOpen(true)}>
            <Camera /> Salvar snapshot
          </Button>
        </Can>
      </Header>
      <References references={data.references} />
      <ResultView result={data.result} input={data.input} />
      <SnapshotsCard id={data.id} />
      <SnapshotDialog session={data} open={snapshotOpen} onOpenChange={setSnapshotOpen} />
    </div>
  );
}

export function SnapshotPage() {
  const { snapshotId = '' } = useParams();
  const snapshot = useQuery({
    queryKey: ['calculation-snapshot', snapshotId],
    queryFn: () => endpoints.calculator.getSnapshot(snapshotId),
  });

  if (snapshot.isPending) return <Skeleton className="h-96 w-full" />;
  if (snapshot.isError)
    return (
      <div className="space-y-3">
        <p className="text-sm text-destructive">
          {isApiError(snapshot.error) && snapshot.error.status === 404
            ? 'Snapshot não encontrado.'
            : 'Não foi possível carregar o snapshot.'}
        </p>
        <Button asChild variant="outline">
          <Link to="/calculator">Voltar aos cálculos</Link>
        </Button>
      </div>
    );

  const data = snapshot.data;
  return (
    <div className="space-y-6">
      <Header
        title={`Snapshot — ${data.customerName || 'cálculo'}`}
        subtitle={`Congelado em ${formatDateTime(data.createdAt)} · regra ${data.ruleSetRef} · algoritmo ${data.algorithmVersion}`}
        light={data.trafficLight}
      >
        <Button asChild variant="outline">
          <Link to={`/calculator/${data.sessionId}`}>Ver cálculo original</Link>
        </Button>
      </Header>
      {data.note ? (
        <p className="rounded-md border bg-muted px-4 py-3 text-sm">{data.note}</p>
      ) : null}
      <p className="text-sm text-muted-foreground">
        Este registro é imutável: mostra exatamente o que foi calculado naquele momento.
      </p>
      <References references={data.references} />
      <ResultView result={data.result} input={data.input} />
    </div>
  );
}
