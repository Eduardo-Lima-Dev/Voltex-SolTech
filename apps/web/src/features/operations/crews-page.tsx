import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import type { CrewDto } from '@voltex/shared';
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
  toast,
} from '@voltex/ui';
import { Can } from '@/app/guards';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api/errors';
import { queryKeys } from '../admin/query-keys';

function CrewDialog({ crew, onClose }: { crew: CrewDto | 'new' | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const editing = crew && crew !== 'new' ? crew : null;
  const [name, setName] = useState(editing?.name ?? '');
  const [members, setMembers] = useState<string[]>(editing?.members.map((m) => m.userId) ?? []);
  const users = useQuery({
    queryKey: ['operations', 'crew-users'],
    queryFn: () => endpoints.users.list({ isActive: true, pageSize: 100 }),
    enabled: crew !== null,
  });
  const save = useMutation({
    mutationFn: () =>
      editing
        ? endpoints.operations.crews.update(editing.id, { name, memberIds: members })
        : endpoints.operations.crews.create({ name, memberIds: members }),
    onSuccess: async () => {
      toast.success('Equipe salva.');
      await queryClient.invalidateQueries({ queryKey: queryKeys.crews });
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível salvar a equipe.')),
  });
  const toggle = (id: string) =>
    setMembers((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );

  return (
    <Dialog open={crew !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? 'Editar equipe' : 'Nova equipe'}</DialogTitle>
          <DialogDescription>
            O técnico de uma equipe vê no app de campo as ordens da equipe.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="crew-name">Nome da equipe</Label>
            <Input id="crew-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <fieldset className="grid gap-1.5">
            <legend className="text-sm font-medium">Integrantes</legend>
            {users.isPending ? (
              <Skeleton className="h-16 w-full" />
            ) : (
              <ul className="max-h-48 space-y-1 overflow-auto text-sm">
                {users.data?.data.map((u) => (
                  <li key={u.id}>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={members.includes(u.id)}
                        onChange={() => toggle(u.id)}
                      />
                      {u.name}
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={name.trim().length < 2 || save.isPending} onClick={() => save.mutate()}>
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Equipes de instalação: quem faz parte e quais estão ativas. */
export function CrewsPage() {
  const queryClient = useQueryClient();
  const crews = useQuery({ queryKey: queryKeys.crews, queryFn: endpoints.operations.crews.list });
  const [dialog, setDialog] = useState<CrewDto | 'new' | null>(null);
  const toggleActive = useMutation({
    mutationFn: (c: CrewDto) => endpoints.operations.crews.update(c.id, { active: !c.active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.crews }),
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível alterar a equipe.')),
  });
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle>Equipes</CardTitle>
          <CardDescription>
            As ordens de serviço são designadas a uma equipe ou a um técnico.
          </CardDescription>
        </div>
        <Can permission="ops.installation.write">
          <Button size="sm" onClick={() => setDialog('new')}>
            <Plus aria-hidden="true" /> Nova equipe
          </Button>
        </Can>
      </CardHeader>
      <CardContent>
        {crews.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : (crews.data?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma equipe cadastrada.</p>
        ) : (
          <ul className="divide-y" aria-label="Equipes">
            {crews.data?.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div>
                  <div className="flex items-center gap-2 font-medium">
                    {c.name}
                    <Badge variant={c.active ? 'green' : 'outline'}>
                      {c.active ? 'Ativa' : 'Inativa'}
                    </Badge>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {c.members.length === 0
                      ? 'Sem integrantes'
                      : c.members.map((m) => m.name).join(', ')}
                  </div>
                </div>
                <Can permission="ops.installation.write">
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => setDialog(c)}>
                      Editar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={toggleActive.isPending}
                      onClick={() => toggleActive.mutate(c)}
                    >
                      {c.active ? 'Desativar' : 'Ativar'}
                    </Button>
                  </div>
                </Can>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      {dialog !== null ? (
        <CrewDialog
          key={dialog === 'new' ? 'new' : dialog.id}
          crew={dialog}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </Card>
  );
}
