import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  OFFGRID_SYSTEM_TYPES,
  type OffgridProjectDetailDto,
  type OffgridSystemType,
} from '@voltex/shared';
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
import { formatDateTime } from '@/lib/format';
import { queryKeys } from '../admin/query-keys';
import {
  PROJECT_STATUS_BADGE,
  PROJECT_STATUS_LABELS,
  VERSION_STATUS_BADGE,
  VERSION_STATUS_LABELS,
} from '../engine/labels';
import { SYSTEM_TYPE_LABELS } from './labels';

export function NewProjectDialog({
  open,
  onOpenChange,
  requestId,
  systemType: initialType = 'OFFGRID',
  defaultName = '',
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  requestId?: string;
  systemType?: OffgridSystemType;
  defaultName?: string;
  onCreated?: (project: OffgridProjectDetailDto) => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState(defaultName);
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [systemType, setSystemType] = useState<OffgridSystemType>(initialType);
  const [error, setError] = useState<string | null>(null);
  const num = (raw: string) => Number(raw.trim().replace(',', '.'));

  const create = useMutation({
    mutationFn: () =>
      endpoints.offgrid.createProject({
        name: name.trim(),
        systemType,
        site: {
          latitude: num(lat),
          longitude: num(lng),
          ...(city.trim() ? { city: city.trim() } : {}),
          ...(state ? { state } : {}),
        },
        ...(requestId ? { requestId } : {}),
      }),
    onSuccess: async (project) => {
      toast.success(`Projeto ${project.code} criado.`);
      onOpenChange(false);
      await queryClient.invalidateQueries({ queryKey: queryKeys.offgridProjects() });
      await queryClient.invalidateQueries({ queryKey: queryKeys.offgridRequests() });
      if (onCreated) onCreated(project);
      else {
        const version = project.versions[0];
        void navigate(
          version
            ? `/offgrid/projetos/${project.id}/versoes/${version.id}`
            : `/offgrid/projetos/${project.id}`,
        );
      }
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
          <DialogTitle>Novo projeto off-grid</DialogTitle>
          <DialogDescription>Informe o nome, o tipo de sistema e o local.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="op-name">Nome do projeto</Label>
            <Input id="op-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="op-type">Tipo de sistema</Label>
            <NativeSelect
              id="op-type"
              value={systemType}
              disabled={!!requestId}
              onChange={(e) => setSystemType(e.target.value as OffgridSystemType)}
            >
              {OFFGRID_SYSTEM_TYPES.map((t) => (
                <option key={t} value={t}>
                  {SYSTEM_TYPE_LABELS[t]}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="op-city">Cidade</Label>
              <Input id="op-city" value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="op-uf">UF</Label>
              <NativeSelect id="op-uf" value={state} onChange={(e) => setState(e.target.value)}>
                <option value="">Não informada</option>
                {BRAZILIAN_STATES.map((uf) => (
                  <option key={uf} value={uf}>
                    {uf}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="op-lat">Latitude</Label>
              <Input
                id="op-lat"
                inputMode="decimal"
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                placeholder="-15,78"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="op-lng">Longitude</Label>
              <Input
                id="op-lng"
                inputMode="decimal"
                value={lng}
                onChange={(e) => setLng(e.target.value)}
                placeholder="-47,93"
              />
            </div>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button disabled={create.isPending} onClick={submit}>
            {create.isPending ? <Spinner /> : null} Criar projeto
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Lista de projetos off-grid. */
export function OffgridProjectsPage() {
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const filters = search.trim() ? { search: search.trim() } : {};
  const list = useQuery({
    queryKey: queryKeys.offgridProjects(filters),
    queryFn: () => endpoints.offgrid.projects(filters),
  });
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Projetos off-grid</CardTitle>
            <CardDescription>Cada projeto tem versões; a aprovada fica congelada.</CardDescription>
          </div>
          <Can permission="offgrid.project.write">
            <Button onClick={() => setCreating(true)}>
              <Plus /> Novo projeto
            </Button>
          </Can>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid max-w-sm gap-1">
            <Label htmlFor="og-search">Buscar</Label>
            <Input
              id="og-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Nome ou código"
            />
          </div>
          {list.isPending ? (
            <Skeleton className="h-40 w-full" />
          ) : list.isError ? (
            <p className="text-sm text-destructive">Não foi possível carregar os projetos.</p>
          ) : list.data.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum projeto encontrado.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Código</TableHead>
                  <TableHead>Projeto</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Versão</TableHead>
                  <TableHead>Atualizado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.data.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>{p.code}</TableCell>
                    <TableCell>
                      <Link
                        className="font-medium underline-offset-4 hover:underline"
                        to={`/offgrid/projetos/${p.id}`}
                      >
                        {p.name}
                      </Link>
                    </TableCell>
                    <TableCell>{SYSTEM_TYPE_LABELS[p.systemType]}</TableCell>
                    <TableCell>
                      <Badge variant={PROJECT_STATUS_BADGE[p.status]}>
                        {PROJECT_STATUS_LABELS[p.status]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {p.currentVersion ? (
                        <Badge variant={VERSION_STATUS_BADGE[p.currentVersion.status]}>
                          v{p.currentVersion.number} ·{' '}
                          {VERSION_STATUS_LABELS[p.currentVersion.status]}
                        </Badge>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell>{formatDateTime(p.updatedAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <NewProjectDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}
