import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from '@voltex/ui';
import { z } from 'zod';
import type { TeamDto } from '@voltex/shared';
import {
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
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  NativeSelect,
  Skeleton,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@voltex/ui';
import { Can } from '@/app/guards';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api/errors';
import { queryKeys } from '../query-keys';
import { ConfirmDialog } from './confirm-delete';

const schema = z.object({
  name: z.string().trim().min(2, 'Informe o nome do time').max(120, 'No máximo 120 caracteres'),
  branchId: z.string(),
});
type FormValues = z.infer<typeof schema>;

function TeamDialog({
  team,
  open,
  onOpenChange,
}: {
  team: TeamDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const branches = useQuery({
    queryKey: queryKeys.branches,
    queryFn: endpoints.branches.list,
    enabled: open,
  });
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', branchId: '' },
  });

  useEffect(() => {
    if (open) form.reset({ name: team?.name ?? '', branchId: team?.branchId ?? '' });
  }, [open, team, form]);

  const mutation = useMutation({
    mutationFn: (values: FormValues) => {
      const input = { name: values.name, branchId: values.branchId || undefined };
      return team ? endpoints.teams.update(team.id, input) : endpoints.teams.create(input);
    },
    onSuccess: async () => {
      toast.success(team ? 'Time atualizado' : 'Time criado');
      await queryClient.invalidateQueries({ queryKey: queryKeys.teams });
      onOpenChange(false);
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível salvar o time.')),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{team ? 'Editar time' : 'Novo time'}</DialogTitle>
          <DialogDescription>
            Times agrupam pessoas para distribuição de leads e metas.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
            className="grid gap-4"
            noValidate
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome</FormLabel>
                  <FormControl>
                    <Input autoFocus {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="branchId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Filial</FormLabel>
                  <FormControl>
                    <NativeSelect {...field}>
                      <option value="">Sem filial</option>
                      {branches.data?.map((branch) => (
                        <option key={branch.id} value={branch.id}>
                          {branch.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? <Spinner /> : null}
                Salvar
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export function TeamsCard() {
  const queryClient = useQueryClient();
  const teams = useQuery({ queryKey: queryKeys.teams, queryFn: endpoints.teams.list });
  const branches = useQuery({ queryKey: queryKeys.branches, queryFn: endpoints.branches.list });
  const [editing, setEditing] = useState<TeamDto | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState<TeamDto | null>(null);

  const branchName = (id: string | null) => branches.data?.find((b) => b.id === id)?.name ?? '—';

  const remove = useMutation({
    mutationFn: (id: string) => endpoints.teams.remove(id),
    onSuccess: async () => {
      toast.success('Time excluído');
      await queryClient.invalidateQueries({ queryKey: queryKeys.teams });
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível excluir o time.')),
  });

  return (
    <Card>
      <CardHeader className="flex-col items-start justify-between gap-3 space-y-0 sm:flex-row sm:gap-4">
        <div className="space-y-1.5">
          <CardTitle>Times</CardTitle>
          <CardDescription>Equipes comerciais e técnicas.</CardDescription>
        </div>
        <Can permission="platform.tenant.manage">
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <Plus /> Novo time
          </Button>
        </Can>
      </CardHeader>
      <CardContent>
        {teams.isPending ? (
          <Skeleton className="h-20 w-full" />
        ) : teams.isError ? (
          <p className="text-sm text-destructive">Não foi possível carregar os times.</p>
        ) : teams.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum time cadastrado.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Filial</TableHead>
                <TableHead className="w-24 text-right">
                  <span className="sr-only">Ações</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {teams.data.map((team) => (
                <TableRow key={team.id}>
                  <TableCell className="font-medium">{team.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {branchName(team.branchId)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Can permission="platform.tenant.manage">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Editar ${team.name}`}
                        onClick={() => {
                          setEditing(team);
                          setDialogOpen(true);
                        }}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Excluir ${team.name}`}
                        onClick={() => setDeleting(team)}
                      >
                        <Trash2 />
                      </Button>
                    </Can>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <TeamDialog team={editing} open={dialogOpen} onOpenChange={setDialogOpen} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Excluir time?"
        description={
          <>
            O time <strong>{deleting?.name}</strong> será excluído. Times com usuários vinculados
            não podem ser excluídos.
          </>
        }
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </Card>
  );
}
