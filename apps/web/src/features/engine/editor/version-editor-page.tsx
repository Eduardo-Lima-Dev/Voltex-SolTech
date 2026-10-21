import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Save } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { INTERNAL_TEST_RULE_WARNING } from '@voltex/shared';
import type {
  CableSpec,
  EngineeringDesign,
  InverterSpec,
  ModuleSpec,
  ProtectionSpec,
} from '@voltex/shared';
import { computeEngineeringResults } from '@voltex/solar-engine';
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
  NativeSelect,
  Skeleton,
  Spinner,
  toast,
} from '@voltex/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage, isApiError } from '@/lib/api/errors';
import { queryKeys } from '../../admin/query-keys';
import { VERSION_STATUS_BADGE, VERSION_STATUS_LABELS } from '../labels';
import { EditorContext, type EditorContextValue } from './editor-context';
import { SiteStep } from './site-step';
import { StringsStep } from './strings-step';
import { SurfacesStep } from './surfaces-step';
import { VisualizationStep } from './visualization-step';
import { ComparePanel, DeliverablesPanel, ShareLinksPanel } from './version-extras';
import { ProtectionsCablesStep } from './protections-cables-step';
import { SimulationStep } from './simulation-step';
import { ConnectionStep } from './connection-step';
import { EconomicsStep } from './economics-step';

/** Etapas do editor. Cada fase do Engine acrescenta as suas. */
export const EDITOR_STEPS = [
  { id: 'local', label: 'Local e clima', component: SiteStep },
  { id: 'superficies', label: 'Superfícies, layout e sombra', component: SurfacesStep },
  { id: 'visao', label: 'Visualização 2D/3D', component: VisualizationStep },
  { id: 'strings', label: 'Equipamentos e strings', component: StringsStep },
  { id: 'protecoes', label: 'Proteções, cabos e materiais', component: ProtectionsCablesStep },
  { id: 'simulacao', label: 'Simulação horária', component: SimulationStep },
  { id: 'conexao', label: 'Conexão', component: ConnectionStep },
  { id: 'economia', label: 'Economia', component: EconomicsStep },
] as const;

export function VersionEditorPage() {
  const { id: projectId = '', versionId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can, user } = useAuth();
  const [reviewerId, setReviewerId] = useState('');
  const [submitOpen, setSubmitOpen] = useState(false);
  const [stepId, setStepId] = useState<(typeof EDITOR_STEPS)[number]['id']>('local');
  const [design, setDesign] = useState<EngineeringDesign | null>(null);
  const [dirty, setDirty] = useState(false);
  const [decision, setDecision] = useState<'approve' | 'reject' | null>(null);
  const [decisionNote, setDecisionNote] = useState('');
  const [commentSection, setCommentSection] = useState('geral');
  const [commentText, setCommentText] = useState('');

  const version = useQuery({
    queryKey: queryKeys.engineeringVersion(versionId),
    queryFn: () => endpoints.engineering.version(versionId),
  });
  const approvedModules = useQuery({
    queryKey: queryKeys.catalog({ kind: 'MODULE', status: 'APPROVED', editor: true }),
    queryFn: () => endpoints.catalog.list({ kind: 'MODULE', status: 'APPROVED', pageSize: 100 }),
  });
  const comments = useQuery({
    queryKey: [...queryKeys.engineeringVersion(versionId), 'comments'],
    queryFn: () => endpoints.engineering.comments(versionId),
    enabled: version.data?.status === 'SUBMITTED',
  });

  // O desenho local nasce da versão carregada e só é refeito quando outra versão (ou um salvamento) chega.
  useEffect(() => {
    if (version.data && (!design || version.data.id !== versionId || !dirty)) {
      setDesign(version.data.design);
      setDirty(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version.data]);

  const readOnly = version.data?.status !== 'DRAFT' || !can('engine.project.write');

  const approvedInverters = useQuery({
    queryKey: queryKeys.catalog({ kind: 'INVERTER', status: 'APPROVED', editor: true }),
    queryFn: () => endpoints.catalog.list({ kind: 'INVERTER', status: 'APPROVED', pageSize: 100 }),
  });
  const modules = useMemo(() => approvedModules.data?.data ?? [], [approvedModules.data]);
  const inverters = useMemo(() => approvedInverters.data?.data ?? [], [approvedInverters.data]);
  const designParameters = version.data?.rules.engineDesign.parameters;
  const results = useMemo(() => {
    if (!design) return null;
    const moduleMap: Record<string, ModuleSpec> = {};
    const inverterMap: Record<string, InverterSpec> = {};
    const status: Record<string, 'DRAFT' | 'APPROVED' | 'RETIRED'> = {};
    // A versão traz as fichas usadas (mesmo se já aposentadas); o catálogo aprovado traz as opções de escolha.
    for (const e of [...modules, ...inverters, ...(version.data?.equipment ?? [])]) {
      status[e.id] = e.status as 'DRAFT' | 'APPROVED' | 'RETIRED';
      if (e.kind === 'MODULE') moduleMap[e.id] = e.spec as unknown as ModuleSpec;
      if (e.kind === 'INVERTER') inverterMap[e.id] = e.spec as unknown as InverterSpec;
    }
    const candidates = version.data?.candidates ?? [];
    return computeEngineeringResults(design, {
      modules: moduleMap,
      inverters: inverterMap,
      status,
      parameters: designParameters ?? {},
      protections: candidates
        .filter((candidate) => candidate.kind === 'PROTECTION')
        .map((candidate) => ({
          id: candidate.id,
          label: candidate.label,
          costCents: candidate.costCents,
          spec: candidate.spec as unknown as ProtectionSpec,
        })),
      cableCatalog: candidates
        .filter((candidate) => candidate.kind === 'CABLE')
        .map((candidate) => ({
          id: candidate.id,
          label: candidate.label,
          costCents: candidate.costCents,
          spec: candidate.spec as unknown as CableSpec,
        })),
      cableRules: version.data
        ? {
            parameters: version.data.rules.engineCables.parameters,
            tables: version.data.rules.engineCables.tables,
          }
        : undefined,
      labels: version.data?.labels ?? {},
      prices: version.data?.prices ?? {},
    });
  }, [design, modules, inverters, version.data, designParameters]);

  const save = useMutation({
    mutationFn: () => endpoints.engineering.saveDesign(versionId, design as EngineeringDesign),
    onSuccess: async (saved) => {
      queryClient.setQueryData(queryKeys.engineeringVersion(versionId), saved);
      setDirty(false);
      toast.success('Versão salva e recalculada.');
      await queryClient.invalidateQueries({ queryKey: queryKeys.engineeringProject(projectId) });
    },
    onError: (error) => {
      if (isApiError(error) && error.code === 'EQUIPMENT_NOT_AVAILABLE') {
        const problems = (error.data?.problems ?? []) as { message: string }[];
        toast.error(problems.map((p) => p.message).join(' '));
      } else if (isApiError(error) && error.details?.length)
        toast.error(
          `Desenho inválido: ${error.details.map((d) => `${d.path}: ${d.message}`).join('; ')}`,
        );
      else toast.error(errorMessage(error, 'Não foi possível salvar.'));
    },
  });
  const newVersion = useMutation({
    mutationFn: () => endpoints.engineering.newVersion(versionId),
    onSuccess: async (created) => {
      toast.success(`Versão ${created.number} criada em rascunho.`);
      await queryClient.invalidateQueries({ queryKey: queryKeys.engineeringProject(projectId) });
      void navigate(`/engine/projetos/${projectId}/versoes/${created.id}`);
    },
    onError: (e) => toast.error(errorMessage(e, 'Não foi possível criar a versão.')),
  });
  const refreshVersion = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.engineeringVersion(versionId) });
    await queryClient.invalidateQueries({ queryKey: queryKeys.engineeringProject(projectId) });
  };
  const reviewers = useQuery({
    queryKey: ['engineering', 'reviewers'],
    queryFn: () => endpoints.engineering.reviewers(),
    enabled: submitOpen,
  });
  const submit = useMutation({
    mutationFn: () => endpoints.engineering.submit(versionId, { reviewerId: reviewerId || null }),
    onSuccess: async () => {
      toast.success('Versão enviada para revisão técnica.');
      setSubmitOpen(false);
      await refreshVersion();
    },
    onError: (error) =>
      toast.error(errorMessage(error, 'A versão ainda não está pronta para revisão.')),
  });
  const decide = useMutation({
    mutationFn: () =>
      decision === 'approve'
        ? endpoints.engineering.approve(versionId, { note: decisionNote })
        : endpoints.engineering.reject(versionId, { note: decisionNote }),
    onSuccess: async () => {
      toast.success(decision === 'approve' ? 'Versão aprovada e congelada.' : 'Versão recusada.');
      setDecision(null);
      setDecisionNote('');
      await refreshVersion();
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível registrar a decisão.')),
  });
  const addComment = useMutation({
    mutationFn: () =>
      endpoints.engineering.addComment(versionId, {
        section: commentSection,
        text: commentText,
      }),
    onSuccess: async () => {
      setCommentText('');
      await queryClient.invalidateQueries({
        queryKey: [...queryKeys.engineeringVersion(versionId), 'comments'],
      });
    },
    onError: (error) =>
      toast.error(errorMessage(error, 'Não foi possível adicionar o comentário.')),
  });
  const resolveComment = useMutation({
    mutationFn: (commentId: string) => endpoints.engineering.resolveComment(versionId, commentId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: [...queryKeys.engineeringVersion(versionId), 'comments'],
      });
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível resolver o comentário.')),
  });

  if (version.isPending || !design || !results) return <Skeleton className="h-64 w-full" />;
  if (version.isError)
    return <p className="text-sm text-destructive">Não foi possível carregar a versão.</p>;
  const v = version.data;
  const selfApprovalBlocked =
    !!v && v.review.requireSecondReview && v.review.submittedById === user?.id;
  // A série compactada só é lida pelo servidor. Após salvar, mostra o resultado oficial; durante edição,
  // a prévia local continua útil para layout, strings e materiais.
  const effectiveResults = dirty ? results : (v.results ?? results);
  const ctx: EditorContextValue = {
    version: v,
    design,
    update: (fn) => {
      setDesign((current) => (current ? fn(current) : current));
      setDirty(true);
    },
    readOnly,
    results: effectiveResults,
    modules,
    inverters,
    designParameters: designParameters ?? {},
    goToStep: (target) => {
      if (EDITOR_STEPS.some((s) => s.id === target))
        setStepId(target as (typeof EDITOR_STEPS)[number]['id']);
    },
  };
  const Step = EDITOR_STEPS.find((s) => s.id === stepId)?.component ?? SiteStep;

  return (
    <EditorContext.Provider value={ctx}>
      <div className="space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <Button asChild variant="ghost" size="sm" className="-ml-3">
              <Link to={`/engine/projetos/${projectId}`}>
                <ArrowLeft /> {v.project.name}
              </Link>
            </Button>
            <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold">
              Versão {v.number}
              <Badge variant={VERSION_STATUS_BADGE[v.status]}>
                {VERSION_STATUS_LABELS[v.status]}
              </Badge>
              {v.stale ? <Badge variant="yellow">desatualizada</Badge> : null}
              {dirty ? <Badge variant="outline">alterações não salvas</Badge> : null}
            </h2>
            {v.status === 'SUBMITTED' ? (
              <p className="text-sm text-muted-foreground">
                Enviada por {v.review.submittedByName ?? 'usuário'}
                {v.review.reviewerName ? ` · revisão pedida a ${v.review.reviewerName}` : ''}
                {v.review.requireSecondReview ? ' · segunda revisão obrigatória' : ''}
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {v.status !== 'DRAFT' &&
            can('engine.project.write') &&
            v.project.status === 'IN_PROGRESS' ? (
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
            {v.status === 'DRAFT' && !dirty && can('engine.project.write') ? (
              <Button variant="outline" onClick={() => setSubmitOpen(true)}>
                Enviar para revisão
              </Button>
            ) : null}
            {v.status === 'SUBMITTED' && can('engine.version.approve') ? (
              <>
                <Button variant="outline" onClick={() => setDecision('reject')}>
                  Recusar
                </Button>
                <Button
                  disabled={selfApprovalBlocked}
                  title={
                    selfApprovalBlocked
                      ? 'Este projeto exige segunda revisão: outro engenheiro precisa aprovar.'
                      : undefined
                  }
                  onClick={() => setDecision('approve')}
                >
                  Aprovar
                </Button>
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
          <ul
            className="space-y-1 rounded border border-warning/50 bg-warning/10 p-3 text-sm"
            aria-label="Pendências do projeto"
          >
            {results.pending.map((p) => (
              <li key={p.code}>{p.message}</li>
            ))}
          </ul>
        ) : null}

        {v.internalTestRules ? (
          <div
            role="alert"
            className="rounded-md border border-amber-500/60 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
          >
            <strong>Teste interno.</strong> {INTERNAL_TEST_RULE_WARNING}
          </div>
        ) : null}

        <nav aria-label="Etapas do projeto" className="flex flex-wrap gap-2">
          {EDITOR_STEPS.map((step, index) => (
            <Button
              key={step.id}
              variant={step.id === stepId ? 'default' : 'outline'}
              size="sm"
              aria-current={step.id === stepId ? 'step' : undefined}
              onClick={() => setStepId(step.id)}
            >
              {index + 1}. {step.label}
            </Button>
          ))}
        </nav>

        <Step />

        <DeliverablesPanel versionId={versionId} approved={v.status === 'APPROVED'} />
        <ComparePanel versionId={versionId} projectId={projectId} />
        {v.status === 'APPROVED' ? <ShareLinksPanel versionId={versionId} /> : null}

        {v.status === 'SUBMITTED' ? (
          <section className="space-y-3 rounded border p-4" aria-label="Revisão técnica">
            <div>
              <h3 className="font-medium">Revisão técnica</h3>
              <p className="text-sm text-muted-foreground">
                Comentários abertos bloqueiam a aprovação da versão.
              </p>
            </div>
            {can('engine.version.approve') ? (
              <div className="grid gap-2 sm:grid-cols-[10rem_1fr_auto]">
                <Input
                  aria-label="Seção do comentário"
                  value={commentSection}
                  onChange={(event) => setCommentSection(event.target.value)}
                />
                <Input
                  aria-label="Comentário de revisão"
                  value={commentText}
                  onChange={(event) => setCommentText(event.target.value)}
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
                      {comment.status === 'OPEN' && can('engine.project.write') ? (
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

        <Dialog open={submitOpen} onOpenChange={setSubmitOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Enviar para revisão</DialogTitle>
            </DialogHeader>
            <div className="grid gap-1">
              <Label htmlFor="reviewer">Pedir revisão a</Label>
              <NativeSelect
                id="reviewer"
                value={reviewerId}
                onChange={(e) => setReviewerId(e.target.value)}
              >
                <option value="">Qualquer engenheiro</option>
                {(reviewers.data ?? [])
                  .filter((r) => !v.review.requireSecondReview || r.id !== user?.id)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
              </NativeSelect>
              <p className="text-sm text-muted-foreground">
                {v.review.requireSecondReview
                  ? 'Este projeto exige segunda revisão: outro engenheiro precisa aprovar.'
                  : 'Você pode aprovar o seu próprio trabalho ou pedir a revisão de outro engenheiro.'}
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSubmitOpen(false)}>
                Cancelar
              </Button>
              <Button disabled={submit.isPending} onClick={() => submit.mutate()}>
                {submit.isPending ? <Spinner /> : null} Enviar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={decision !== null} onOpenChange={(open) => !open && setDecision(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {decision === 'approve' ? 'Aprovar versão' : 'Recusar versão'}
              </DialogTitle>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor="engineering-decision-note">Justificativa</Label>
              <Input
                id="engineering-decision-note"
                value={decisionNote}
                onChange={(event) => setDecisionNote(event.target.value)}
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
    </EditorContext.Provider>
  );
}
