import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from '@voltex/ui';
import { Can } from '@/app/guards';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api/errors';
import { formatDate, formatNumber } from '@/lib/format';
import { queryKeys } from '../admin/query-keys';
import { DocumentsPanel } from './project/documents-panel';
import { LoadPanel } from './project/load-panel';
import { ProfilePanel } from './project/profile-panel';
import { SurveyPanel } from './project/survey-panel';
import { Timeline } from './request-page';
import {
  PROJECT_STATUS_BADGE,
  PROJECT_STATUS_LABELS,
  VERSION_STATUS_BADGE,
  VERSION_STATUS_LABELS,
} from './labels';

export function ProjectPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const project = useQuery({
    queryKey: queryKeys.engineeringProject(id),
    queryFn: () => endpoints.engineering.project(id),
  });
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.engineeringProject(id) });

  const newVersion = useMutation({
    mutationFn: (fromId: string) => endpoints.engineering.newVersion(fromId),
    onSuccess: async (version) => {
      toast.success(`Versão ${version.number} criada em rascunho.`);
      await refresh();
      void navigate(`/engine/projetos/${id}/versoes/${version.id}`);
    },
    onError: (e) => toast.error(errorMessage(e, 'Não foi possível criar a versão.')),
  });
  const cancel = useMutation({
    mutationFn: () => endpoints.engineering.cancelProject(id, reason.trim()),
    onSuccess: async () => {
      toast.success('Projeto cancelado.');
      setCancelling(false);
      await refresh();
    },
    onError: (e) => toast.error(errorMessage(e, 'Não foi possível cancelar o projeto.')),
  });

  if (project.isPending) return <Skeleton className="h-48 w-full" />;
  if (project.isError)
    return <p className="text-sm text-destructive">Não foi possível carregar o projeto.</p>;
  const p = project.data;
  const latest = p.versions[0];
  const hasDraft = p.versions.some((v) => v.status === 'DRAFT');

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle>{p.name}</CardTitle>
            <CardDescription>
              {p.code}
              {p.responsibleName ? ` · responsável: ${p.responsibleName}` : ''}
              {p.opportunity ? (
                <>
                  {' · oportunidade '}
                  <Link className="underline" to={`/crm/oportunidades/${p.opportunity.id}`}>
                    {p.opportunity.projectCode}
                  </Link>
                  {p.opportunity.customerName ? ` (${p.opportunity.customerName})` : ''}
                </>
              ) : null}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={PROJECT_STATUS_BADGE[p.status]}>
              {PROJECT_STATUS_LABELS[p.status]}
            </Badge>
            <Can permission="engine.project.write">
              {p.status === 'IN_PROGRESS' ? (
                <Button size="sm" variant="outline" onClick={() => setCancelling(true)}>
                  Cancelar projeto
                </Button>
              ) : null}
            </Can>
          </div>
        </CardHeader>
        {p.calculation ? (
          <CardContent className="text-sm text-muted-foreground">
            Pré-cálculo do CRM ({formatDate(p.calculation.createdAt)}):{' '}
            {p.calculation.systemKwp !== null
              ? `${formatNumber(p.calculation.systemKwp, 2)} kWp`
              : 'potência não informada'}
            {p.calculation.generationKwhYear !== null
              ? ` · ${formatNumber(p.calculation.generationKwhYear, 0)} kWh/ano`
              : ''}
            . O projeto técnico substitui essa estimativa.
          </CardContent>
        ) : null}
      </Card>

      <Tabs defaultValue="ficha">
        <TabsList>
          <TabsTrigger value="ficha">Ficha</TabsTrigger>
          <TabsTrigger value="levantamento">Levantamento</TabsTrigger>
          <TabsTrigger value="carga">Carga</TabsTrigger>
          <TabsTrigger value="documentos">Documentos</TabsTrigger>
          <TabsTrigger value="versoes">Versões</TabsTrigger>
          <TabsTrigger value="historico">Histórico</TabsTrigger>
        </TabsList>
        <TabsContent value="ficha">
          <ProfilePanel project={p} />
        </TabsContent>
        <TabsContent value="levantamento">
          <SurveyPanel projectId={p.id} canEdit={p.status === 'IN_PROGRESS'} />
        </TabsContent>
        <TabsContent value="carga">
          <LoadPanel projectId={p.id} />
        </TabsContent>
        <TabsContent value="documentos">
          <DocumentsPanel projectId={p.id} canEdit={p.status !== 'CANCELLED'} />
        </TabsContent>
        <TabsContent value="versoes">
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
              <div className="space-y-1.5">
                <CardTitle>Versões</CardTitle>
                <CardDescription>
                  Versão enviada ou decidida é congelada. Para mudar, crie uma nova versão: ela
                  copia o desenho da anterior.
                </CardDescription>
              </div>
              <Can permission="engine.project.write">
                {p.status === 'IN_PROGRESS' && latest && !hasDraft ? (
                  <Button
                    size="sm"
                    disabled={newVersion.isPending}
                    onClick={() => newVersion.mutate(latest.id)}
                  >
                    Nova versão
                  </Button>
                ) : null}
              </Can>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {p.versions.map((v) => (
                  <li
                    key={v.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-medium">Versão {v.number}</span>
                      <Badge variant={VERSION_STATUS_BADGE[v.status]}>
                        {VERSION_STATUS_LABELS[v.status]}
                      </Badge>
                      {v.stale ? <Badge variant="yellow">desatualizada</Badge> : null}
                      <span className="text-muted-foreground">
                        criada em {formatDate(v.createdAt)}
                      </span>
                    </div>
                    <Button asChild size="sm" variant="outline">
                      <Link to={`/engine/projetos/${p.id}/versoes/${v.id}`}>
                        {v.status === 'DRAFT' ? 'Editar' : 'Ver'}
                      </Link>
                    </Button>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="historico">
          <HistoryPanel projectId={p.id} />
        </TabsContent>
      </Tabs>

      <Dialog open={cancelling} onOpenChange={setCancelling}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancelar o projeto?</DialogTitle>
            <DialogDescription>
              O pedido do CRM ligado a ele também é cancelado. O motivo fica registrado.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="pj-reason">Motivo</Label>
            <Input id="pj-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelling(false)}>
              Voltar
            </Button>
            <Button
              variant="destructive"
              disabled={reason.trim().length < 3 || cancel.isPending}
              onClick={() => cancel.mutate()}
            >
              Cancelar projeto
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function HistoryPanel({ projectId }: { projectId: string }) {
  const timeline = useQuery({
    queryKey: ['engineering', 'timeline', projectId],
    queryFn: () => endpoints.engineering.projectTimeline(projectId),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Histórico do projeto</CardTitle>
        <CardDescription>Inclui o que aconteceu no pedido que originou o projeto.</CardDescription>
      </CardHeader>
      <CardContent>
        {timeline.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <Timeline events={timeline.data ?? []} />
        )}
      </CardContent>
    </Card>
  );
}
