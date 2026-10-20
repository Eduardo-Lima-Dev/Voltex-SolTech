import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import {
  createSourceWatchSchema,
  SUGGESTED_SOURCES,
  type SuggestedSource,
  type CreateSourceWatchInput,
  type DataSourceDto,
  type SourceWatchDto,
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
  toast,
} from '@voltex/ui';
import { Can } from '@/app/guards';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage, isApiError } from '@/lib/api/errors';
import { formatDate } from '@/lib/format';
import { ConfirmDialog } from '../company/confirm-delete';
import { queryKeys } from '../query-keys';

const LICENSE_BADGE = {
  CLEARED: { variant: 'green', label: 'Termos conferidos' },
  PENDING_REVIEW: { variant: 'yellow', label: 'Termos não conferidos' },
  BLOCKED: { variant: 'red', label: 'Bloqueada' },
} as const;

const KIND_LABELS = { NORM: 'Norma ou resolução', LAW: 'Lei', OTHER: 'Outra' } as const;

const COLLECTION_LABELS = {
  RUNNING: 'Em andamento',
  SUCCEEDED: 'Concluída',
  FAILED: 'Falhou',
  SKIPPED: 'Não executada',
} as const;

function Sources() {
  const sources = useQuery({ queryKey: queryKeys.dataSources, queryFn: endpoints.dataHub.sources });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Bases de dados externas</CardTitle>
        <CardDescription>
          De onde o sistema pode trazer clima, tarifas e equipamentos. Nenhum dado de fora entra
          direto: ele vira uma proposta em <strong>Atualizações</strong> e uma pessoa decide. Uma
          fonte só consulta a internet depois de ligada no servidor, com os termos de uso
          conferidos.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {sources.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : sources.isError ? (
          <p className="text-sm text-destructive">Não foi possível carregar as fontes.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fonte</TableHead>
                <TableHead>Licença</TableHead>
                <TableHead>Consulta</TableHead>
                <TableHead>Última coleta</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sources.data.map((source) => (
                <SourceRow key={source.key} source={source} />
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function SourceRow({ source }: { source: DataSourceDto }) {
  const badge = LICENSE_BADGE[source.licenseStatus];
  return (
    <TableRow>
      <TableCell className="max-w-xs align-top">
        <div className="font-medium">{source.label}</div>
        <div className="text-xs text-muted-foreground">{source.attribution}</div>
      </TableCell>
      <TableCell className="max-w-sm align-top">
        <Badge variant={badge.variant}>{badge.label}</Badge>
        <div className="mt-1 text-xs text-muted-foreground">{source.license}</div>
        {source.termsCheckedAt ? (
          <div className="text-xs text-muted-foreground">
            Conferida em {formatDate(source.termsCheckedAt)}
            {source.termsCheckedBy ? ` por ${source.termsCheckedBy}` : ''}
          </div>
        ) : null}
      </TableCell>
      <TableCell className="align-top">
        <Badge variant={source.enabled ? 'green' : 'outline'}>
          {source.enabled ? 'Ligada' : 'Desligada'}
        </Badge>
        {!source.enabled ? (
          <div className="mt-1 text-xs text-muted-foreground">Só usa o que já está guardado.</div>
        ) : null}
      </TableCell>
      <TableCell className="align-top text-sm text-muted-foreground">
        {source.lastCollection ? (
          <>
            {COLLECTION_LABELS[source.lastCollection.status]} em{' '}
            {formatDate(source.lastCollection.startedAt)}
            {source.lastCollection.error ? (
              <div className="text-xs text-destructive">{source.lastCollection.error}</div>
            ) : null}
          </>
        ) : (
          'Nunca'
        )}
      </TableCell>
    </TableRow>
  );
}

function WatchDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const form = useForm<CreateSourceWatchInput>({
    resolver: zodResolver(createSourceWatchSchema),
    defaultValues: { label: '', url: '', kind: 'NORM' },
  });
  const save = useMutation({
    mutationFn: async (values: CreateSourceWatchInput) => {
      const watch = await endpoints.dataHub.watches.create(values);
      // A primeira coleta guarda o texto de referência: mudanças só são detectadas a partir dela.
      await endpoints.dataHub.watches.check(watch.id).catch(() => undefined);
      return watch;
    },
    onSuccess: async () => {
      toast.success('Fonte cadastrada. O texto atual é a referência para detectar mudanças.');
      form.reset();
      onOpenChange(false);
      await queryClient.invalidateQueries({ queryKey: queryKeys.sourceWatches });
    },
    onError: (error) => {
      if (isApiError(error) && error.status === 409)
        form.setError('url', { message: 'Este endereço já está sendo vigiado.' });
      else if (isApiError(error) && error.status === 400)
        form.setError('url', { message: errorMessage(error, 'Endereço não permitido.') });
      else toast.error(errorMessage(error, 'Não foi possível cadastrar a fonte.'));
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Vigiar uma fonte</DialogTitle>
          <DialogDescription>
            Página ou PDF de uma norma, resolução ou lei. O sistema compara o texto a cada semana e
            avisa quando mudar. Ele <strong>não</strong> altera nenhuma regra sozinho.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            noValidate
            className="grid gap-4"
            onSubmit={form.handleSubmit((values) => save.mutate(values))}
          >
            <FormField
              control={form.control}
              name="label"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome</FormLabel>
                  <FormControl>
                    <Input autoFocus placeholder="Ex.: Norma técnica da distribuidora" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="url"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Endereço (https://…)</FormLabel>
                  <FormControl>
                    <Input inputMode="url" placeholder="https://…" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="kind"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tipo</FormLabel>
                  <FormControl>
                    <NativeSelect {...field}>
                      {Object.entries(KIND_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </NativeSelect>
                  </FormControl>
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? <Spinner /> : null}
                Cadastrar
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

const CHECK_MESSAGES = {
  BASELINE: 'Texto de referência guardado.',
  UNCHANGED: 'Sem mudanças desde a última coleta.',
  CHANGED: 'A fonte mudou: veja a proposta em Atualizações.',
  ERROR: 'Não foi possível ler a fonte agora.',
} as const;

function Watches() {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<SourceWatchDto | null>(null);
  const watches = useQuery({
    queryKey: queryKeys.sourceWatches,
    queryFn: endpoints.dataHub.watches.list,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.sourceWatches });

  const check = useMutation({
    mutationFn: (id: string) => endpoints.dataHub.watches.check(id),
    onSuccess: async ({ status }) => {
      (status === 'ERROR' ? toast.error : toast.success)(CHECK_MESSAGES[status]);
      await refresh();
      if (status === 'CHANGED')
        await queryClient.invalidateQueries({ queryKey: queryKeys.updateProposals() });
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível verificar a fonte.')),
  });
  const toggle = useMutation({
    mutationFn: (watch: SourceWatchDto) =>
      endpoints.dataHub.watches.update(watch.id, { enabled: !watch.enabled }),
    onSuccess: refresh,
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível atualizar a fonte.')),
  });
  const remove = useMutation({
    mutationFn: (id: string) => endpoints.dataHub.watches.remove(id),
    onSuccess: async () => {
      toast.success('Fonte removida');
      setRemoving(null);
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível remover a fonte.')),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1.5">
          <CardTitle>Normas e páginas vigiadas</CardTitle>
          <CardDescription>
            O sistema lê cada fonte toda semana e avisa o responsável técnico quando o texto muda,
            mostrando o que entrou e o que saiu.
          </CardDescription>
        </div>
        <Can permission="platform.rule.manage">
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus /> Vigiar fonte
          </Button>
        </Can>
      </CardHeader>
      <CardContent>
        {watches.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : watches.isError ? (
          <p className="text-sm text-destructive">Não foi possível carregar as fontes vigiadas.</p>
        ) : watches.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma fonte vigiada ainda. Cadastre a norma da sua distribuidora para ser avisado
            quando ela mudar.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fonte</TableHead>
                <TableHead>Última verificação</TableHead>
                <TableHead>Última mudança</TableHead>
                <Can permission="platform.rule.manage">
                  <TableHead className="text-right">Ações</TableHead>
                </Can>
              </TableRow>
            </TableHeader>
            <TableBody>
              {watches.data.map((watch) => (
                <TableRow key={watch.id}>
                  <TableCell className="max-w-sm">
                    <div className="font-medium">
                      {watch.label} <Badge variant="secondary">{KIND_LABELS[watch.kind]}</Badge>{' '}
                      {!watch.enabled ? <Badge variant="outline">Pausada</Badge> : null}
                    </div>
                    <a
                      href={watch.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="block truncate text-xs text-muted-foreground underline"
                    >
                      {watch.url}
                    </a>
                    {watch.lastError ? (
                      <div className="text-xs text-destructive">{watch.lastError}</div>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {watch.checkedAt ? formatDate(watch.checkedAt) : 'Ainda não verificada'}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {watch.changedAt ? formatDate(watch.changedAt) : '—'}
                  </TableCell>
                  <Can permission="platform.rule.manage">
                    <TableCell className="space-x-1 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={check.isPending}
                        onClick={() => check.mutate(watch.id)}
                        aria-label={`Verificar agora: ${watch.label}`}
                      >
                        <RefreshCw /> Verificar
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => toggle.mutate(watch)}
                        aria-label={`${watch.enabled ? 'Pausar' : 'Retomar'}: ${watch.label}`}
                      >
                        {watch.enabled ? 'Pausar' : 'Retomar'}
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setRemoving(watch)}
                        aria-label={`Remover ${watch.label}`}
                      >
                        <Trash2 />
                      </Button>
                    </TableCell>
                  </Can>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <WatchDialog open={creating} onOpenChange={setCreating} />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Remover fonte vigiada?"
        description={`O sistema deixa de vigiar "${removing?.label ?? ''}". As propostas já criadas continuam na caixa de atualizações.`}
        confirmLabel="Remover"
        onConfirm={() => removing && remove.mutate(removing.id)}
      />
    </Card>
  );
}

const MODE_BADGE = {
  INTEGRATED: 'green',
  WATCH: 'secondary',
  MANUAL: 'yellow',
  BLOCKED: 'red',
} as const;
const MODE_LABEL = {
  INTEGRATED: 'Integrada',
  WATCH: 'Pode ser vigiada',
  MANUAL: 'Só consulta manual',
  BLOCKED: 'Bloqueada',
} as const;
const DOMAIN_LABEL = {
  REGULATION: 'Normas',
  TARIFF: 'Tarifas',
  EQUIPMENT: 'Equipamentos',
  SOLAR_RESOURCE: 'Recurso solar',
} as const;

/** Catálogo das fontes oficiais do plano: o que cada uma é, como entra e o cuidado de uso. A escolha é da empresa. */
function SuggestedSources() {
  const queryClient = useQueryClient();
  const watches = useQuery({
    queryKey: queryKeys.sourceWatches,
    queryFn: endpoints.dataHub.watches.list,
  });
  const watched = new Set((watches.data ?? []).map((w) => w.url));
  const add = useMutation({
    mutationFn: async (source: SuggestedSource) => {
      const watch = await endpoints.dataHub.watches.create({
        label: source.label.slice(0, 160),
        url: source.url,
        kind: source.watchKind ?? 'OTHER',
      });
      await endpoints.dataHub.watches.check(watch.id).catch(() => undefined);
    },
    onSuccess: async () => {
      toast.success(
        'Fonte adicionada à vigilância. O texto atual é a referência para detectar mudanças.',
      );
      await queryClient.invalidateQueries({ queryKey: queryKeys.sourceWatches });
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível adicionar a fonte.')),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Fontes oficiais sugeridas</CardTitle>
        <CardDescription>
          Catálogo das fontes públicas e gratuitas mapeadas para o sistema, com o cuidado de uso de
          cada uma. <strong>Você decide</strong> quais acompanhar: as páginas de normas podem ser
          vigiadas (a mudança vira proposta para revisão, nunca altera regra sozinha).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-3 lg:grid-cols-2" aria-label="Fontes oficiais sugeridas">
          {SUGGESTED_SOURCES.map((source) => (
            <li key={source.id} className="space-y-2 rounded-lg border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-medium">{source.label}</h3>
                <div className="flex gap-1">
                  <Badge variant="outline">{DOMAIN_LABEL[source.domain]}</Badge>
                  <Badge variant={MODE_BADGE[source.mode]}>{MODE_LABEL[source.mode]}</Badge>
                </div>
              </div>
              <p className="text-xs break-all text-muted-foreground">
                <a href={source.url} target="_blank" rel="noreferrer" className="underline">
                  {source.url}
                </a>
              </p>
              <p className="text-sm text-muted-foreground">
                Verificação: {source.cadence}. {source.caution}
              </p>
              {source.mode === 'WATCH' ? (
                <Can permission="platform.rule.manage">
                  {watched.has(source.url) ? (
                    <Badge variant="green">Já vigiada</Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={add.isPending}
                      onClick={() => add.mutate(source)}
                    >
                      Vigiar esta fonte
                    </Button>
                  )}
                </Can>
              ) : null}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export function SourcesPage() {
  return (
    <div className="space-y-6">
      <Sources />
      <SuggestedSources />
      <Watches />
    </div>
  );
}
