import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from '@voltex/ui';
import { z } from 'zod';
import type { BranchDto } from '@voltex/shared';
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
import { BRAZILIAN_STATES } from '@/i18n/labels';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api/errors';
import { queryKeys } from '../query-keys';
import { ConfirmDialog } from './confirm-delete';

const schema = z.object({
  name: z.string().trim().min(2, 'Informe o nome da filial').max(120, 'No máximo 120 caracteres'),
  city: z.string().trim().max(120, 'No máximo 120 caracteres'),
  state: z.string(),
});
type FormValues = z.infer<typeof schema>;

function BranchDialog({
  branch,
  open,
  onOpenChange,
}: {
  branch: BranchDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', city: '', state: '' },
  });

  useEffect(() => {
    if (open)
      form.reset({
        name: branch?.name ?? '',
        city: branch?.city ?? '',
        state: branch?.state ?? '',
      });
  }, [open, branch, form]);

  const mutation = useMutation({
    mutationFn: (values: FormValues) => {
      const input = {
        name: values.name,
        city: values.city || undefined,
        state: values.state || undefined,
      };
      return branch
        ? endpoints.branches.update(branch.id, input)
        : endpoints.branches.create(input);
    },
    onSuccess: async () => {
      toast.success(branch ? 'Filial atualizada' : 'Filial criada');
      await queryClient.invalidateQueries({ queryKey: queryKeys.branches });
      onOpenChange(false);
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível salvar a filial.')),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{branch ? 'Editar filial' : 'Nova filial'}</DialogTitle>
          <DialogDescription>
            Filiais organizam equipes e usuários por unidade da empresa.
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
            <div className="grid gap-4 sm:grid-cols-[1fr_7rem]">
              <FormField
                control={form.control}
                name="city"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cidade</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="state"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>UF</FormLabel>
                    <FormControl>
                      <NativeSelect {...field}>
                        <option value="">—</option>
                        {BRAZILIAN_STATES.map((uf) => (
                          <option key={uf} value={uf}>
                            {uf}
                          </option>
                        ))}
                      </NativeSelect>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
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

export function BranchesCard() {
  const queryClient = useQueryClient();
  const { data, isPending, isError } = useQuery({
    queryKey: queryKeys.branches,
    queryFn: endpoints.branches.list,
  });
  const [editing, setEditing] = useState<BranchDto | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState<BranchDto | null>(null);

  const remove = useMutation({
    mutationFn: (id: string) => endpoints.branches.remove(id),
    onSuccess: async () => {
      toast.success('Filial excluída');
      await queryClient.invalidateQueries({ queryKey: queryKeys.branches });
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível excluir a filial.')),
  });

  return (
    <Card>
      <CardHeader className="flex-col items-start justify-between gap-3 space-y-0 sm:flex-row sm:gap-4">
        <div className="space-y-1.5">
          <CardTitle>Filiais</CardTitle>
          <CardDescription>Unidades da empresa.</CardDescription>
        </div>
        <Can permission="platform.tenant.manage">
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <Plus /> Nova filial
          </Button>
        </Can>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <Skeleton className="h-20 w-full" />
        ) : isError ? (
          <p className="text-sm text-destructive">Não foi possível carregar as filiais.</p>
        ) : data.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma filial cadastrada.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Cidade/UF</TableHead>
                <TableHead className="w-24 text-right">
                  <span className="sr-only">Ações</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((branch) => (
                <TableRow key={branch.id}>
                  <TableCell className="font-medium">{branch.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {[branch.city, branch.state].filter(Boolean).join(' / ') || '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    <Can permission="platform.tenant.manage">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Editar ${branch.name}`}
                        onClick={() => {
                          setEditing(branch);
                          setDialogOpen(true);
                        }}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Excluir ${branch.name}`}
                        onClick={() => setDeleting(branch)}
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

      <BranchDialog branch={editing} open={dialogOpen} onOpenChange={setDialogOpen} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Excluir filial?"
        description={
          <>
            A filial <strong>{deleting?.name}</strong> será excluída. Filiais com usuários
            vinculados não podem ser excluídas.
          </>
        }
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </Card>
  );
}
