import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CloudDownload, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { toast } from '@voltex/ui';
import {
  CustomerGroup,
  createDistributorSchema,
  type DistributorDto,
  type TariffDto,
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
import { parseDecimal } from '@/features/calculator/form';
import { BRAZILIAN_STATES, CUSTOMER_GROUP_LABELS } from '@/i18n/labels';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage, isApiError } from '@/lib/api/errors';
import { formatDate, formatNumber } from '@/lib/format';
import { ConfirmDialog } from '../company/confirm-delete';
import { AneelImportDialog } from './aneel-import-dialog';
import { queryKeys } from '../query-keys';

// ---- Concessionárias ----

const distributorForm = z.object({
  name: createDistributorSchema.shape.name,
  state: z.string(),
});
type DistributorValues = z.infer<typeof distributorForm>;

function DistributorDialog({
  distributor,
  open,
  onOpenChange,
}: {
  distributor: DistributorDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const form = useForm<DistributorValues>({
    resolver: zodResolver(distributorForm),
    defaultValues: { name: '', state: '' },
  });
  useEffect(() => {
    if (open) form.reset({ name: distributor?.name ?? '', state: distributor?.state ?? '' });
  }, [open, distributor, form]);

  const save = useMutation({
    mutationFn: (values: DistributorValues) => {
      const body = { name: values.name, state: values.state || undefined };
      return distributor
        ? endpoints.distributors.update(distributor.id, body)
        : endpoints.distributors.create(body);
    },
    onSuccess: async () => {
      toast.success(distributor ? 'Concessionária atualizada' : 'Concessionária cadastrada');
      onOpenChange(false);
      await queryClient.invalidateQueries({ queryKey: queryKeys.distributors });
    },
    onError: (error) => {
      if (isApiError(error) && error.status === 409)
        form.setError('name', { message: 'Já existe uma concessionária com este nome.' });
      else toast.error(errorMessage(error, 'Não foi possível salvar a concessionária.'));
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{distributor ? 'Editar concessionária' : 'Nova concessionária'}</DialogTitle>
          <DialogDescription>Distribuidora de energia atendida pela sua empresa.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            noValidate
            className="grid gap-4"
            onSubmit={form.handleSubmit((values) => save.mutate(values))}
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome</FormLabel>
                  <FormControl>
                    <Input autoFocus placeholder="Ex.: Enel Ceará" {...field} />
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
                      <option value="">Não informada</option>
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
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? <Spinner /> : null}
                Salvar
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function DistributorsCard({ distributors }: { distributors: DistributorDto[] }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<DistributorDto | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<DistributorDto | null>(null);
  const [aneel, setAneel] = useState(false);

  const remove = useMutation({
    mutationFn: (id: string) => endpoints.distributors.remove(id),
    onSuccess: async () => {
      toast.success('Concessionária excluída');
      await queryClient.invalidateQueries({ queryKey: queryKeys.distributors });
    },
    onError: (error) =>
      toast.error(
        isApiError(error) && error.status === 409
          ? 'Esta concessionária tem tarifas cadastradas. Exclua as tarifas antes.'
          : errorMessage(error, 'Não foi possível excluir a concessionária.'),
      ),
  });

  return (
    <Card>
      <CardHeader className="flex-col items-start justify-between gap-3 space-y-0 sm:flex-row">
        <div className="space-y-1.5">
          <CardTitle>Concessionárias</CardTitle>
          <CardDescription>Distribuidoras de energia que você atende.</CardDescription>
        </div>
        <Can permission="platform.rule.manage">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setAneel(true)}>
              <CloudDownload /> Importar da ANEEL
            </Button>
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus /> Nova concessionária
            </Button>
          </div>
        </Can>
      </CardHeader>
      <CardContent>
        {distributors.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma concessionária cadastrada.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>UF</TableHead>
                <TableHead className="w-24 text-right">
                  <span className="sr-only">Ações</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {distributors.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-medium">{d.name}</TableCell>
                  <TableCell>{d.state ?? '—'}</TableCell>
                  <TableCell className="text-right">
                    <Can permission="platform.rule.manage">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Editar ${d.name}`}
                        onClick={() => setEditing(d)}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Excluir ${d.name}`}
                        onClick={() => setDeleting(d)}
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
      <AneelImportDialog open={aneel} onOpenChange={setAneel} />
      <DistributorDialog
        distributor={editing}
        open={creating || editing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setCreating(false);
            setEditing(null);
          }
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Excluir concessionária?"
        description={
          <>
            <strong>{deleting?.name}</strong> será removida. Só é possível se não houver tarifas
            cadastradas para ela.
          </>
        }
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </Card>
  );
}

// ---- Tarifas ----

const tariffForm = z.object({
  distributorId: z.string().min(1, 'Escolha a concessionária'),
  customerGroup: z.enum(CustomerGroup),
  modality: z.string().trim().max(60),
  energyReais: z.string().refine((v) => {
    const n = parseDecimal(v);
    return n !== undefined && !Number.isNaN(n) && n > 0;
  }, 'Informe um valor maior que zero (ex.: 0,95)'),
  validFrom: z.string().min(1, 'Informe o início da vigência'),
  validTo: z.string(),
  source: z.string().trim().min(2, 'Informe a origem do valor').max(300),
});
type TariffValues = z.infer<typeof tariffForm>;

function TariffDialog({
  distributors,
  open,
  onOpenChange,
}: {
  distributors: DistributorDto[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const form = useForm<TariffValues>({
    resolver: zodResolver(tariffForm),
    defaultValues: {
      distributorId: '',
      customerGroup: 'B',
      modality: '',
      energyReais: '',
      validFrom: '',
      validTo: '',
      source: '',
    },
  });
  useEffect(() => {
    if (open) form.reset();
  }, [open, form]);

  const save = useMutation({
    mutationFn: (values: TariffValues) =>
      endpoints.tariffs.create({
        distributorId: values.distributorId,
        customerGroup: values.customerGroup,
        modality: values.modality || undefined,
        energyCentsPerKwh: Number(((parseDecimal(values.energyReais) ?? 0) * 100).toFixed(3)),
        validFrom: values.validFrom,
        validTo: values.validTo || undefined,
        source: values.source,
      }),
    onSuccess: async () => {
      toast.success('Tarifa cadastrada');
      onOpenChange(false);
      await queryClient.invalidateQueries({ queryKey: queryKeys.tariffs() });
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível cadastrar a tarifa.')),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nova tarifa</DialogTitle>
          <DialogDescription>
            Toda tarifa precisa de origem (resolução, fatura, contrato). Tarifas antigas permanecem
            para o histórico dos cálculos.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            noValidate
            className="grid gap-4"
            onSubmit={form.handleSubmit((v) => save.mutate(v))}
          >
            <FormField
              control={form.control}
              name="distributorId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Concessionária</FormLabel>
                  <FormControl>
                    <NativeSelect {...field}>
                      <option value="">Selecione</option>
                      {distributors.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="customerGroup"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Grupo</FormLabel>
                    <FormControl>
                      <NativeSelect {...field}>
                        {Object.values(CustomerGroup).map((g) => (
                          <option key={g} value={g}>
                            {CUSTOMER_GROUP_LABELS[g]}
                          </option>
                        ))}
                      </NativeSelect>
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="modality"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Modalidade (opcional)</FormLabel>
                    <FormControl>
                      <Input placeholder="Ex.: Convencional" {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="energyReais"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tarifa de energia (R$/kWh)</FormLabel>
                  <FormControl>
                    <Input inputMode="decimal" placeholder="0,95" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="validFrom"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Vigência a partir de</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="validTo"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Até (opcional)</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="source"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Origem do valor</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Ex.: fatura do cliente, resolução homologatória"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? <Spinner /> : null}
                Cadastrar tarifa
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function TariffsCard({ distributors }: { distributors: DistributorDto[] }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState<TariffDto | null>(null);
  const names = useMemo(() => new Map(distributors.map((d) => [d.id, d.name])), [distributors]);

  const tariffs = useQuery({
    queryKey: queryKeys.tariffs(),
    queryFn: () => endpoints.tariffs.list(),
  });
  const remove = useMutation({
    mutationFn: (id: string) => endpoints.tariffs.remove(id),
    onSuccess: async () => {
      toast.success('Tarifa excluída');
      await queryClient.invalidateQueries({ queryKey: queryKeys.tariffs() });
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível excluir a tarifa.')),
  });

  return (
    <Card>
      <CardHeader className="flex-col items-start justify-between gap-3 space-y-0 sm:flex-row">
        <div className="space-y-1.5">
          <CardTitle>Tarifas</CardTitle>
          <CardDescription>
            Valores de energia por concessionária, com vigência e origem.
          </CardDescription>
        </div>
        <Can permission="platform.rule.manage">
          <Button size="sm" onClick={() => setOpen(true)} disabled={distributors.length === 0}>
            <Plus /> Nova tarifa
          </Button>
        </Can>
      </CardHeader>
      <CardContent>
        {tariffs.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : tariffs.isError ? (
          <p className="text-sm text-destructive">Não foi possível carregar as tarifas.</p>
        ) : tariffs.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {distributors.length === 0
              ? 'Cadastre uma concessionária para começar a registrar tarifas.'
              : 'Nenhuma tarifa cadastrada.'}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Concessionária</TableHead>
                <TableHead>Grupo</TableHead>
                <TableHead>Tarifa</TableHead>
                <TableHead>Vigência</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead className="w-16 text-right">
                  <span className="sr-only">Ações</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tariffs.data.map((t) => {
                const expired = t.validTo !== null && new Date(t.validTo).getTime() <= Date.now();
                return (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">
                      {names.get(t.distributorId) ?? '—'}
                    </TableCell>
                    <TableCell>
                      {t.customerGroup}
                      {t.modality ? (
                        <span className="text-muted-foreground"> · {t.modality}</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      R$ {formatNumber(t.energyCentsPerKwh / 100, 4)}/kWh
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(t.validFrom)}
                      {t.validTo ? ` a ${formatDate(t.validTo)}` : ' em diante'}{' '}
                      {expired ? <Badge variant="secondary">Encerrada</Badge> : null}
                    </TableCell>
                    <TableCell className="max-w-48 truncate text-muted-foreground" title={t.source}>
                      {t.source}
                    </TableCell>
                    <TableCell className="text-right">
                      <Can permission="platform.rule.manage">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Excluir tarifa de ${names.get(t.distributorId) ?? 'concessionária'}`}
                          onClick={() => setDeleting(t)}
                        >
                          <Trash2 />
                        </Button>
                      </Can>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <TariffDialog distributors={distributors} open={open} onOpenChange={setOpen} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Excluir tarifa?"
        description="Cálculos e snapshots já salvos não mudam: eles guardam o valor usado na época."
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </Card>
  );
}

export function TariffsPage() {
  const distributors = useQuery({
    queryKey: queryKeys.distributors,
    queryFn: endpoints.distributors.list,
  });
  if (distributors.isPending) return <Skeleton className="h-64 w-full" />;
  if (distributors.isError)
    return (
      <p className="text-sm text-destructive">Não foi possível carregar as concessionárias.</p>
    );
  return (
    <div className="space-y-6">
      <DistributorsCard distributors={distributors.data} />
      <TariffsCard distributors={distributors.data} />
    </div>
  );
}
