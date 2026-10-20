import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Save } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { EngineeringDesign } from '@voltex/shared';
import { computeEngineeringResults } from '@voltex/solar-engine';
import { Badge, Button, Skeleton, Spinner, toast } from '@voltex/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage, isApiError } from '@/lib/api/errors';
import { queryKeys } from '../../admin/query-keys';
import { VERSION_STATUS_BADGE, VERSION_STATUS_LABELS } from '../labels';
import { EditorContext, type EditorContextValue } from './editor-context';
import { SiteStep } from './site-step';
import { SurfacesStep } from './surfaces-step';

/** Etapas do editor. Cada fase do Engine acrescenta as suas. */
export const EDITOR_STEPS = [
  { id: 'local', label: 'Local e clima', component: SiteStep },
  { id: 'superficies', label: 'Superfícies, layout e sombra', component: SurfacesStep },
] as const;

export function VersionEditorPage() {
  const { id: projectId = '', versionId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const [stepId, setStepId] = useState<(typeof EDITOR_STEPS)[number]['id']>('local');
  const [design, setDesign] = useState<EngineeringDesign | null>(null);
  const [dirty, setDirty] = useState(false);

  const version = useQuery({
    queryKey: queryKeys.engineeringVersion(versionId),
    queryFn: () => endpoints.engineering.version(versionId),
  });
  const approvedModules = useQuery({
    queryKey: queryKeys.catalog({ kind: 'MODULE', status: 'APPROVED', editor: true }),
    queryFn: () => endpoints.catalog.list({ kind: 'MODULE', status: 'APPROVED', pageSize: 100 }),
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

  const modules = useMemo(() => approvedModules.data?.data ?? [], [approvedModules.data]);
  const results = useMemo(() => {
    if (!design) return null;
    const map: Record<string, { lengthMm: number; widthMm: number; pmaxWp: number } | undefined> =
      {};
    for (const m of [...modules, ...(version.data?.equipment ?? [])]) {
      const spec = m.spec as { lengthMm?: number; widthMm?: number; pmaxWp?: number };
      if (spec.lengthMm && spec.widthMm && spec.pmaxWp)
        map[m.id] = { lengthMm: spec.lengthMm, widthMm: spec.widthMm, pmaxWp: spec.pmaxWp };
    }
    return computeEngineeringResults(design, { modules: map });
  }, [design, modules, version.data]);

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

  if (version.isPending || !design || !results) return <Skeleton className="h-64 w-full" />;
  if (version.isError)
    return <p className="text-sm text-destructive">Não foi possível carregar a versão.</p>;
  const v = version.data;
  const ctx: EditorContextValue = {
    version: v,
    design,
    update: (fn) => {
      setDesign((current) => (current ? fn(current) : current));
      setDirty(true);
    },
    readOnly,
    results,
    modules,
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
      </div>
    </EditorContext.Provider>
  );
}
