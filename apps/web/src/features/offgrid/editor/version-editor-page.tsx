import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, FileDown, Save } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { offgridDesignSchema, type EquipmentDto, type OffgridDesign } from '@voltex/shared';
import { computeOffgridResults, type OffgridContext } from '@voltex/solar-engine';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Skeleton,
  Spinner,
  toast,
} from '@voltex/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage, isApiError } from '@/lib/api/errors';
import { queryKeys } from '../../admin/query-keys';
import { SiteStepView } from '../../engine/editor/site-step';
import { VERSION_STATUS_BADGE, VERSION_STATUS_LABELS } from '../../engine/labels';
import { RESULT_STATUS_BADGE, RESULT_STATUS_LABELS } from '../labels';
import { ArraysStep } from './arrays-step';
import { BankStep } from './bank-step';
import { ConversionStep } from './conversion-step';
import { DiagramStep } from './diagram-step';
import { VisualStep } from './visual-step';
import { GeneratorGridStep } from './generator-grid-step';
import { LoadsStep } from './loads-step';
import { OffgridEditorContext, useOffgrid, type OffgridEditorValue } from './offgrid-context';
import { PremisesStep } from './premises-step';
import { ScenariosStep } from './scenarios-step';
import { SimulationStep } from './simulation-step';
import { STEP_META, StepNav, stepForPending, stepStates, type StepId } from './step-nav';

function LocalStep() {
  const { design, update, readOnly } = useOffgrid();
  return (
    <SiteStepView
      site={design.site}
      readOnly={readOnly}
      set={(patch) => update((d) => ({ ...d, site: { ...d.site, ...patch } }))}
    />
  );
}

export const OFFGRID_STEPS = [
  { id: 'local', label: 'Local e clima', component: LocalStep },
  { id: 'cargas', label: 'Cargas', component: LoadsStep },
  { id: 'premissas', label: 'Premissas e dimensionamento', component: PremisesStep },
  { id: 'arranjo', label: 'Arranjo FV', component: ArraysStep },
  { id: 'banco', label: 'Baterias', component: BankStep },
  { id: 'conversao', label: 'Controlador e inversor', component: ConversionStep },
  { id: 'gerador', label: 'Gerador e rede', component: GeneratorGridStep },
  { id: 'diagrama', label: 'Diagrama do sistema', component: DiagramStep },
  { id: 'visual', label: 'Terreno 2D/3D', component: VisualStep },
  { id: 'simulacao', label: 'Simulação e estresse', component: SimulationStep },
  { id: 'cenarios', label: 'Cenários e custo', component: ScenariosStep },
] as const;

const KINDS = ['MODULE', 'BATTERY', 'CHARGE_CONTROLLER', 'OFFGRID_INVERTER', 'GENERATOR'] as const;

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** Editor da versão do projeto off-grid: etapas, prévia ao vivo, revisão e aprovação. */
export function OffgridVersionEditorPage() {
  const { id: projectId = '', versionId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const [stepId, setStepId] = useState<StepId>('local');
  const [design, setDesign] = useState<OffgridDesign | null>(null);
  const [dirty, setDirty] = useState(false);
  const [decision, setDecision] = useState<'approve' | 'reject' | null>(null);
  const [decisionNote, setDecisionNote] = useState('');
  const [commentSection, setCommentSection] = useState('geral');
  const [commentText, setCommentText] = useState('');

  const version = useQuery({
    queryKey: queryKeys.offgridVersion(versionId),
    queryFn: () => endpoints.offgrid.version(versionId),
  });
  const approvedQueries = useQueries({
    queries: KINDS.map((kind) => ({
      queryKey: queryKeys.catalog({ kind, status: 'APPROVED', editor: true }),
      queryFn: () => endpoints.catalog.list({ kind, status: 'APPROVED', pageSize: 100 }),
    })),
  });
  const comments = useQuery({
    queryKey: [...queryKeys.offgridVersion(versionId), 'comments'],
    queryFn: () => endpoints.offgrid.comments(versionId),
    enabled: version.data?.status === 'SUBMITTED',
  });

  useEffect(() => {
    if (version.data && (!design || !dirty)) {
      // Versões antigas ganham o valor padrão dos campos novos (ex.: o terreno).
      setDesign(offgridDesignSchema.parse(version.data.design));
      setDirty(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version.data]);

  const readOnly = version.data?.status !== 'DRAFT' || !can('offgrid.project.write');
  const approvedStamp = approvedQueries.map((q) => q.dataUpdatedAt).join(',');
  const approved = useMemo(() => {
    const out: Record<string, EquipmentDto[]> = {};
    KINDS.forEach((kind, i) => {
      out[kind] = approvedQueries[i]?.data?.data ?? [];
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approvedStamp]);

  const labels = useMemo(() => {
    const map: Record<string, string> = {};
    for (const e of Object.values(approved).flat()) map[e.id] = `${e.manufacturer} ${e.model}`;
    for (const e of version.data?.catalog.items ?? []) map[e.id] = e.label;
    return map;
  }, [approved, version.data]);

  const preview = useMemo(() => {
    if (!design || !version.data) return null;
    const context: OffgridContext = {
      modules: {},
      batteries: {},
      controllers: {},
      inverters: {},
      generators: {},
      status: {},
      prices: {},
      labels,
      parameters: version.data.catalog.parameters,
    };
    const put = (e: {
      id: string;
      kind: string;
      status: string;
      spec: unknown;
      price: number | null;
    }) => {
      context.status = { ...context.status, [e.id]: e.status as 'DRAFT' | 'APPROVED' | 'RETIRED' };
      if (e.price !== null)
        context.prices = { ...context.prices, [e.id]: { unitCostCents: e.price } };
      const spec = e.spec as never;
      if (e.kind === 'MODULE') context.modules[e.id] = spec;
      else if (e.kind === 'BATTERY') context.batteries[e.id] = spec;
      else if (e.kind === 'CHARGE_CONTROLLER') context.controllers[e.id] = spec;
      else if (e.kind === 'OFFGRID_INVERTER') context.inverters[e.id] = spec;
      else if (e.kind === 'GENERATOR') context.generators[e.id] = spec;
    };
    for (const e of Object.values(approved).flat())
      put({ id: e.id, kind: e.kind, status: e.status, spec: e.spec, price: e.referenceCostCents });
    for (const e of version.data.catalog.items)
      put({ id: e.id, kind: e.kind, status: e.status, spec: e.spec, price: e.priceCents });
    return computeOffgridResults(design, context);
  }, [design, version.data, approved, labels]);

  const refreshAll = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.offgridVersion(versionId) });
    await queryClient.invalidateQueries({ queryKey: queryKeys.offgridProject(projectId) });
    await queryClient.invalidateQueries({ queryKey: queryKeys.offgridRequests() });
  };
  const save = useMutation({
    mutationFn: () => endpoints.offgrid.saveDesign(versionId, design as OffgridDesign),
    onSuccess: async (saved) => {
      queryClient.setQueryData(queryKeys.offgridVersion(versionId), saved);
      setDirty(false);
      toast.success('Versão salva e recalculada.');
      await queryClient.invalidateQueries({ queryKey: queryKeys.offgridProject(projectId) });
    },
    onError: (error) => {
      if (isApiError(error) && error.code === 'EQUIPMENT_NOT_AVAILABLE')
        toast.error(
          ((error.data?.problems ?? []) as { message: string }[]).map((p) => p.message).join(' '),
        );
      else if (isApiError(error) && error.details?.length)
        toast.error(
          `Desenho inválido: ${error.details.map((d) => `${d.path}: ${d.message}`).join('; ')}`,
        );
      else toast.error(errorMessage(error, 'Não foi possível salvar.'));
    },
  });
  const newVersion = useMutation({
    mutationFn: () => endpoints.offgrid.newVersion(versionId),
    onSuccess: async (created) => {
      toast.success(`Versão ${created.number} criada em rascunho.`);
      await queryClient.invalidateQueries({ queryKey: queryKeys.offgridProject(projectId) });
      void navigate(`/offgrid/projetos/${projectId}/versoes/${created.id}`);
    },
    onError: (e) => toast.error(errorMessage(e, 'Não foi possível criar a versão.')),
  });
  const submit = useMutation({
    mutationFn: () => endpoints.offgrid.submit(versionId),
    onSuccess: async () => {
      toast.success('Versão enviada para revisão técnica.');
      await refreshAll();
    },
    onError: (e) => toast.error(errorMessage(e, 'A versão ainda não está pronta para revisão.')),
  });
  const decide = useMutation({
    mutationFn: () =>
      decision === 'approve'
        ? endpoints.offgrid.approve(versionId, { note: decisionNote })
        : endpoints.offgrid.reject(versionId, { note: decisionNote }),
    onSuccess: async () => {
      toast.success(decision === 'approve' ? 'Versão aprovada e congelada.' : 'Versão recusada.');
      setDecision(null);
      setDecisionNote('');
      await refreshAll();
    },
    onError: (e) => toast.error(errorMessage(e, 'Não foi possível registrar a decisão.')),
  });
  const addComment = useMutation({
    mutationFn: () =>
      endpoints.offgrid.addComment(versionId, { section: commentSection, text: commentText }),
    onSuccess: async () => {
      setCommentText('');
      await queryClient.invalidateQueries({
        queryKey: [...queryKeys.offgridVersion(versionId), 'comments'],
      });
    },
    onError: (e) => toast.error(errorMessage(e, 'Não foi possível adicionar o comentário.')),
  });
  const resolveComment = useMutation({
    mutationFn: (commentId: string) => endpoints.offgrid.resolveComment(versionId, commentId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: [...queryKeys.offgridVersion(versionId), 'comments'],
      });
    },
    onError: (e) => toast.error(errorMessage(e, 'Não foi possível resolver o comentário.')),
  });
  const report = useMutation({
    mutationFn: async () =>
      saveBlob(
        await endpoints.offgrid.report(versionId),
        `memorial-offgrid-v${version.data?.number ?? 1}.pdf`,
      ),
    onError: (e) => toast.error(errorMessage(e, 'Não foi possível gerar o memorial.')),
  });

  if (version.isError)
    return <p className="text-sm text-destructive">Não foi possível carregar a versão.</p>;
  if (version.isPending || !design || !preview) return <Skeleton className="h-64 w-full" />;
  const v = version.data;
  // Versões gravadas antes do projeto visual não têm `layout`: usam a prévia calculada agora.
  const results = dirty
    ? preview
    : v.results && v.results.layout !== undefined
      ? v.results
      : preview;
  const ctx: OffgridEditorValue = {
    version: v,
    design,
    update: (fn) => {
      setDesign((current) => (current ? fn(current) : current));
      setDirty(true);
    },
    readOnly,
    results,
    labelOf: (id) => (id ? (labels[id] ?? 'Equipamento do catálogo') : 'Nenhum'),
    approved,
    goToStep: (target) => {
      if (OFFGRID_STEPS.some((s) => s.id === target)) setStepId(target as StepId);
    },
  };
  const states = stepStates(design, results);
  const stepIndex = OFFGRID_STEPS.findIndex((s) => s.id === stepId);
  const Step = OFFGRID_STEPS.find((s) => s.id === stepId)?.component ?? LocalStep;

  return (
    <OffgridEditorContext.Provider value={ctx}>
      <div className="space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <Button asChild variant="ghost" size="sm" className="-ml-3">
              <Link to={`/offgrid/projetos/${projectId}`}>
                <ArrowLeft /> {v.project.name}
              </Link>
            </Button>
            <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold">
              Versão {v.number}
              <Badge variant={VERSION_STATUS_BADGE[v.status]}>
                {VERSION_STATUS_LABELS[v.status]}
              </Badge>
              <Badge variant={RESULT_STATUS_BADGE[results.status]}>
                {RESULT_STATUS_LABELS[results.status]}
              </Badge>
              {v.stale ? <Badge variant="yellow">desatualizada</Badge> : null}
              {dirty ? <Badge variant="outline">alterações não salvas</Badge> : null}
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              disabled={report.isPending || dirty}
              onClick={() => report.mutate()}
            >
              <FileDown /> Memorial (PDF)
            </Button>
            {v.status !== 'DRAFT' && can('offgrid.project.write') && v.project ? (
              <Button
                variant="outline"
                disabled={newVersion.isPending}
                onClick={() => newVersion.mutate()}
              >
                Criar nova versão a partir desta
              </Button>
            ) : null}
            {!readOnly ? (
              <Button disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
                {save.isPending ? <Spinner /> : <Save />} Salvar e calcular
              </Button>
            ) : null}
            {v.status === 'DRAFT' && !dirty && can('offgrid.project.write') ? (
              <Button variant="outline" disabled={submit.isPending} onClick={() => submit.mutate()}>
                {submit.isPending ? <Spinner /> : null} Enviar para revisão
              </Button>
            ) : null}
            {v.status === 'SUBMITTED' && can('offgrid.scenario.approve') ? (
              <>
                <Button variant="outline" onClick={() => setDecision('reject')}>
                  Recusar
                </Button>
                <Button onClick={() => setDecision('approve')}>Aprovar</Button>
              </>
            ) : null}
          </div>
        </header>

        {readOnly && v.status !== 'DRAFT' ? (
          <p className="rounded border bg-muted p-3 text-sm">
            Esta versão está {VERSION_STATUS_LABELS[v.status].toLowerCase()} e não pode mais ser
            editada. Para mudar algo, crie uma nova versão.
          </p>
        ) : null}
        {results.pending.length > 0 ? (
          <details
            className="rounded border border-warning/50 bg-warning/10 p-3 text-sm"
            open={stepId === 'local'}
          >
            <summary className="cursor-pointer font-medium">
              {results.pending.length} pendência(s) para concluir o projeto
            </summary>
            <ul className="mt-2 space-y-1" aria-label="Pendências do projeto">
              {results.pending.map((p) => {
                const target = stepForPending(p.code);
                return (
                  <li key={p.code} className="flex flex-wrap items-baseline gap-2">
                    <span>{p.message}</span>
                    {target ? (
                      <Button
                        size="sm"
                        variant="link"
                        className="h-auto p-0"
                        onClick={() => setStepId(target)}
                      >
                        Ir para {STEP_META.find((m) => m.id === target)?.label}
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </details>
        ) : null}

        <StepNav current={stepId} states={states} onSelect={(id) => setStepId(id)} />

        <Step />

        <div className="flex items-center justify-between gap-2 border-t pt-4">
          <Button
            variant="outline"
            disabled={stepIndex <= 0}
            onClick={() => setStepId(OFFGRID_STEPS[stepIndex - 1]?.id ?? stepId)}
          >
            <ArrowLeft /> Etapa anterior
          </Button>
          <span className="text-xs text-muted-foreground">
            Etapa {stepIndex + 1} de {OFFGRID_STEPS.length}
            {STEP_META[stepIndex]?.required ? '' : ' · opcional'}
          </span>
          <Button
            disabled={stepIndex >= OFFGRID_STEPS.length - 1}
            onClick={() => setStepId(OFFGRID_STEPS[stepIndex + 1]?.id ?? stepId)}
          >
            Próxima etapa <ArrowRight />
          </Button>
        </div>

        {v.status === 'SUBMITTED' ? (
          <section className="space-y-3 rounded border p-4" aria-label="Revisão técnica">
            <div>
              <h3 className="font-medium">Revisão técnica</h3>
              <p className="text-sm text-muted-foreground">
                Comentários abertos bloqueiam a aprovação da versão.
              </p>
            </div>
            {can('offgrid.scenario.approve') ? (
              <div className="grid gap-2 sm:grid-cols-[10rem_1fr_auto]">
                <Input
                  aria-label="Seção do comentário"
                  value={commentSection}
                  onChange={(e) => setCommentSection(e.target.value)}
                />
                <Input
                  aria-label="Comentário de revisão"
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                />
                <Button
                  variant="outline"
                  disabled={commentText.trim().length < 3 || addComment.isPending}
                  onClick={() => addComment.mutate()}
                >
                  Adicionar comentário
                </Button>
              </div>
            ) : null}
            <div className="space-y-2 text-sm">
              {comments.data?.length ? (
                comments.data.map((comment) => (
                  <div
                    key={comment.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded border p-2"
                  >
                    <p>
                      <strong>{comment.section}</strong>: {comment.text}
                    </p>
                    <div className="flex items-center gap-2">
                      <Badge variant={comment.status === 'OPEN' ? 'yellow' : 'green'}>
                        {comment.status === 'OPEN' ? 'aberto' : 'resolvido'}
                      </Badge>
                      {comment.status === 'OPEN' && can('offgrid.project.write') ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={resolveComment.isPending}
                          onClick={() => resolveComment.mutate(comment.id)}
                        >
                          Resolver
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-muted-foreground">Nenhum comentário de revisão.</p>
              )}
            </div>
          </section>
        ) : null}

        <Dialog open={decision !== null} onOpenChange={(open) => !open && setDecision(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {decision === 'approve' ? 'Aprovar versão' : 'Recusar versão'}
              </DialogTitle>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor="offgrid-decision-note">Justificativa</Label>
              <Input
                id="offgrid-decision-note"
                value={decisionNote}
                onChange={(e) => setDecisionNote(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDecision(null)}>
                Cancelar
              </Button>
              <Button
                disabled={decisionNote.trim().length < 3 || decide.isPending}
                onClick={() => decide.mutate()}
              >
                {decide.isPending ? <Spinner /> : null} Confirmar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </OffgridEditorContext.Provider>
  );
}
