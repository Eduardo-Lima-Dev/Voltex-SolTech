import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { EngineeringProjectStatus } from '@voltex/shared';
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from '@voltex/ui';
import { Can } from '@/app/guards';
import { BRAZILIAN_STATES } from '@/i18n/labels';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api/errors';
import { formatDate } from '@/lib/format';
import { queryKeys } from '../admin/query-keys';
import {
  PROJECT_STATUS_BADGE,
  PROJECT_STATUS_LABELS,
  VERSION_STATUS_BADGE,
  VERSION_STATUS_LABELS,
} from './labels';

const PAGE_SIZE = 20;

function NewProjectDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [kwp, setKwp] = useState('');
  const [distributorId, setDistributorId] = useState('');
  const distributors = useQuery({
    queryKey: ['distributors'],
    queryFn: () => endpoints.distributors.list(),
    enabled: open,
  });
  const [error, setError] = useState<string | null>(null);
  const num = (raw: string) => Number(raw.trim().replace(',', '.'));

  const create = useMutation({
    mutationFn: async () => {
      const created = await endpoints.engineering.createProject({
        name: name.trim(),
        site: {
          latitude: num(lat),
          longitude: num(lng),
          ...(city.trim() ? { city: city.trim() } : {}),
          ...(state ? { state } : {}),
        },
      });
      // Potência-alvo e distribuidora (opcionais) entram na ficha do projeto.
      const target = kwp.trim() ? num(kwp) : undefined;
      if ((target !== undefined && Number.isFinite(target) && target > 0) || distributorId)
        await endpoints.engineering.updateProfile(created.id, {
          ...(target !== undefined && Number.isFinite(target) && target > 0
            ? { targetKwp: target }
            : {}),
          ...(distributorId ? { distributorId } : {}),
        });
      return created;
    },
    onSuccess: async (project) => {
      toast.success(`Projeto ${project.code} criado.`);
      onOpenChange(false);
      await queryClient.invalidateQueries({ queryKey: queryKeys.engineeringProjects() });
      const version = project.versions[0];
      void navigate(
        version
          ? `/engine/projetos/${project.id}/versoes/${version.id}`
          : `/engine/projetos/${project.id}`,
      );
    },
    onError: (e) => toast.error(errorMessage(e, 'Não foi possível criar o projeto.')),
  });

  const submit = () => {
    if (name.trim().length < 2) return setError('Informe o nome do projeto.');
    const la = num(lat);
    const lo = num(lng);
    if (lat.trim() === '' || !Number.isFinite(la) || la < -90 || la > 90)
      return setError('Latitude inválida (−90 a 90).');
    if (lng.trim() === '' || !Number.isFinite(lo) || lo < -180 || lo > 180)
      return setError('Longitude inválida (−180 a 180).');
    setError(null);
    create.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo projeto</DialogTitle>
          <DialogDescription>
            Projeto sem CRM: informe o nome e o local. Projetos de pedidos do CRM nascem na tela de
            pedidos, com os dados da oportunidade.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="np-name">Nome do projeto</Label>
            <Input id="np-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="np-city">Cidade</Label>
              <Input id="np-city" value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="np-uf">UF</Label>
              <NativeSelect id="np-uf" value={state} onChange={(e) => setState(e.target.value)}>
                <option value="">Não informada</option>
                {BRAZILIAN_STATES.map((uf) => (
                  <option key={uf} value={uf}>
                    {uf}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="np-lat">Latitude</Label>
              <Input
                id="np-lat"
                inputMode="decimal"
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                placeholder="-15,78"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="np-lng">Longitude</Label>
              <Input
                id="np-lng"
                inputMode="decimal"
                value={lng}
                onChange={(e) => setLng(e.target.value)}
                placeholder="-47,93"
              />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="np-kwp">Potência-alvo (kWp, opcional)</Label>
              <Input
                id="np-kwp"
                inputMode="decimal"
                value={kwp}
                onChange={(e) => setKwp(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="np-dist">Distribuidora (opcional)</Label>
              <NativeSelect
                id="np-dist"
                value={distributorId}
                onChange={(e) => setDistributorId(e.target.value)}
              >
                <option value="">Não informada</option>
                {(distributors.data ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button disabled={create.isPending} onClick={submit}>
            {create.isPending ? <Spinner /> : null}
            Criar projeto
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ProjectsPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<EngineeringProjectStatus | ''>('');
  const [mine, setMine] = useState(false);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const filters = {
    page,
    pageSize: PAGE_SIZE,
    ...(search ? { search } : {}),
    ...(status ? { status } : {}),
    ...(mine ? { mine: true } : {}),
  };
  const projects = useQuery({
    queryKey: queryKeys.engineeringProjects(filters),
    queryFn: () => endpoints.engineering.projects(filters),
    placeholderData: keepPreviousData,
  });
  const total = projects.data?.meta.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <CardTitle>Projetos</CardTitle>
          <CardDescription>
            Cada projeto tem versões. A versão aprovada pelo responsável técnico é congelada e
            liberada para a cotação no CRM.
          </CardDescription>
        </div>
        <Can permission="engine.project.write">
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus /> Novo projeto
          </Button>
        </Can>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1">
            <Label htmlFor="pj-search">Buscar</Label>
            <Input
              id="pj-search"
              placeholder="Nome ou código"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="pj-status">Situação</Label>
            <NativeSelect
              id="pj-status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as EngineeringProjectStatus | '');
                setPage(1);
              }}
            >
              <option value="">Todas</option>
              <option value="IN_PROGRESS">Em andamento</option>
              <option value="APPROVED">Aprovados</option>
              <option value="CANCELLED">Cancelados</option>
            </NativeSelect>
          </div>
          <Label className="flex items-center gap-1.5 pb-2 text-sm">
            <input
              type="checkbox"
              checked={mine}
              onChange={(e) => {
                setMine(e.target.checked);
                setPage(1);
              }}
            />{' '}
            Só os meus
          </Label>
        </div>
        {projects.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : projects.isError ? (
          <p className="text-sm text-destructive">Não foi possível carregar os projetos.</p>
        ) : projects.data.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum projeto ainda. Pegue um pedido ou crie um projeto avulso.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Projeto</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead>Última versão</TableHead>
                <TableHead>Responsável</TableHead>
                <TableHead>Atualizado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.data.data.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <Link
                      to={`/engine/projetos/${p.id}`}
                      className="font-medium underline-offset-2 hover:underline"
                    >
                      {p.name}
                    </Link>
                    <div className="text-xs text-muted-foreground">{p.code}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={PROJECT_STATUS_BADGE[p.status]}>
                      {PROJECT_STATUS_LABELS[p.status]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {p.latestVersionNumber !== null && p.latestVersionStatus ? (
                      <span className="flex items-center gap-2">
                        v{p.latestVersionNumber}
                        <Badge variant={VERSION_STATUS_BADGE[p.latestVersionStatus]}>
                          {VERSION_STATUS_LABELS[p.latestVersionStatus]}
                        </Badge>
                      </span>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {p.responsibleName ?? '—'}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(p.updatedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {pages > 1 ? (
          <div className="flex items-center justify-end gap-2 text-sm">
            <Button
              size="sm"
              variant="outline"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Anterior
            </Button>
            <span>
              Página {page} de {pages}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= pages}
              onClick={() => setPage((p) => p + 1)}
            >
              Próxima
            </Button>
          </div>
        ) : null}
      </CardContent>
      <NewProjectDialog open={creating} onOpenChange={setCreating} />
    </Card>
  );
}
