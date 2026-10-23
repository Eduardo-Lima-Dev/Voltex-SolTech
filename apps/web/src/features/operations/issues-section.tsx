import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import {
  FIELD_ISSUE_TYPES,
  type FieldIssueDto,
  type FieldIssueType,
  type InstallationDetailDto,
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
  toast,
} from '@voltex/ui';
import { Can } from '@/app/guards';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api/errors';
import { formatDateTime } from '@/lib/format';
import { queryKeys } from '../admin/query-keys';
import { FIELD_ISSUE_TYPE_LABELS } from './labels';

function NewIssueDialog({
  installationId,
  open,
  onClose,
  onSaved,
}: {
  installationId: string;
  open: boolean;
  onClose: () => void;
  onSaved: () => Promise<unknown>;
}) {
  const [type, setType] = useState<FieldIssueType>('OTHER');
  const [description, setDescription] = useState('');
  const [blocking, setBlocking] = useState(true);
  const create = useMutation({
    mutationFn: () =>
      endpoints.operations.issues.create(installationId, { type, description, blocking }),
    onSuccess: async () => {
      setDescription('');
      await onSaved();
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível registrar a pendência.')),
  });
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar pendência de campo</DialogTitle>
          <DialogDescription>
            Uma pendência que bloqueia pára a instalação até ser resolvida.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="issue-type">Tipo</Label>
            <NativeSelect
              id="issue-type"
              value={type}
              onChange={(e) => setType(e.target.value as FieldIssueType)}
            >
              {FIELD_ISSUE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {FIELD_ISSUE_TYPE_LABELS[t]}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="issue-desc">O que aconteceu</Label>
            <Input
              id="issue-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={blocking}
              onChange={(e) => setBlocking(e.target.checked)}
            />
            Bloqueia a instalação
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={description.trim().length < 3 || create.isPending}
            onClick={() => create.mutate()}
          >
            Registrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResolveDialog({
  issue,
  onClose,
  onSaved,
}: {
  issue: FieldIssueDto | null;
  onClose: () => void;
  onSaved: () => Promise<unknown>;
}) {
  const [resolution, setResolution] = useState('');
  const resolve = useMutation({
    mutationFn: () => endpoints.operations.issues.resolve(issue!.id, { resolution }),
    onSuccess: async () => {
      await onSaved();
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível resolver a pendência.')),
  });
  return (
    <Dialog open={issue !== null} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Resolver pendência</DialogTitle>
          <DialogDescription>{issue?.description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="issue-resolution">Como foi resolvida</Label>
          <Input
            id="issue-resolution"
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={resolution.trim().length < 3 || resolve.isPending}
            onClick={() => resolve.mutate()}
          >
            Resolver
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Pendências de campo da instalação (impedimentos, falta de material, acesso, segurança). */
export function IssuesSection({ installation }: { installation: InstallationDetailDto }) {
  const queryClient = useQueryClient();
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.installation(installation.id) }),
      queryClient.invalidateQueries({ queryKey: ['operations', 'installations'] }),
    ]);
  const [creating, setCreating] = useState(false);
  const [resolving, setResolving] = useState<FieldIssueDto | null>(null);
  const canReport = [
    'CREW_ASSIGNED',
    'IN_PROGRESS',
    'FIELD_ISSUE',
    'INSTALLED',
    'COMMISSIONING',
  ].includes(installation.status);
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle>Pendências de campo</CardTitle>
          <CardDescription>{installation.openIssues} aberta(s).</CardDescription>
        </div>
        <Can permission="ops.workorder.write">
          {canReport ? (
            <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
              <Plus aria-hidden="true" /> Pendência
            </Button>
          ) : null}
        </Can>
      </CardHeader>
      <CardContent>
        {installation.issues.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma pendência registrada.</p>
        ) : (
          <ul className="divide-y" aria-label="Pendências de campo">
            {installation.issues.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2 font-medium">
                    {i.description}
                    <Badge
                      variant={i.status === 'OPEN' ? (i.blocking ? 'red' : 'yellow') : 'green'}
                    >
                      {i.status === 'OPEN' ? (i.blocking ? 'Bloqueia' : 'Aberta') : 'Resolvida'}
                    </Badge>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {FIELD_ISSUE_TYPE_LABELS[i.type]} · {formatDateTime(i.createdAt)}
                    {i.resolution ? ` · ${i.resolution}` : ''}
                  </div>
                </div>
                <Can permission="ops.workorder.write">
                  {i.status === 'OPEN' ? (
                    <Button size="sm" variant="outline" onClick={() => setResolving(i)}>
                      Resolver
                    </Button>
                  ) : null}
                </Can>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <NewIssueDialog
        installationId={installation.id}
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={refresh}
      />
      <ResolveDialog
        key={resolving?.id ?? 'none'}
        issue={resolving}
        onClose={() => setResolving(null)}
        onSaved={refresh}
      />
    </Card>
  );
}
