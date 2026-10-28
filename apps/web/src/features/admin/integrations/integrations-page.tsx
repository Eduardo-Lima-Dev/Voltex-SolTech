import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import type {
  IntegrationConnectionDto,
  IntegrationDeadLetterDto,
  IntegrationHealth,
  IntegrationProviderDto,
  IntegrationRunDto,
  IntegrationStatus,
} from '@voltex/shared';
import {
  Alert,
  AlertDescription,
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

const STATUS_BADGE: Record<
  IntegrationStatus,
  { variant: 'green' | 'yellow' | 'outline'; label: string }
> = {
  ACTIVE: { variant: 'green', label: 'Ativa' },
  PAUSED: { variant: 'yellow', label: 'Pausada' },
  DISABLED: { variant: 'outline', label: 'Desligada' },
};

const HEALTH_BADGE: Record<
  IntegrationHealth,
  { variant: 'green' | 'yellow' | 'red' | 'outline'; label: string }
> = {
  GREEN: { variant: 'green', label: 'Saudável' },
  YELLOW: { variant: 'yellow', label: 'Instável' },
  RED: { variant: 'red', label: 'Com falha' },
  UNKNOWN: { variant: 'outline', label: 'Sem leitura' },
};

const RUN_LABELS = {
  RUNNING: 'Em andamento',
  SUCCEEDED: 'Concluída',
  FAILED: 'Falhou',
  SKIPPED: 'Não executada',
} as const;

const KIND_LABELS = { MONITORING: 'Monitoramento', SIGNATURE: 'Assinatura eletrônica' } as const;

function useInvalidate() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.integrationConnections }),
      queryClient.invalidateQueries({ queryKey: ['integrations', 'runs'] }),
      queryClient.invalidateQueries({ queryKey: queryKeys.integrationDeadLetters }),
    ]);
}

function Providers({ providers }: { providers: IntegrationProviderDto[] | undefined }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Provedores</CardTitle>
        <CardDescription>
          Serviços externos que o sistema sabe consultar. Um provedor só consulta a internet depois
          de ligado no servidor, com os termos de uso conferidos. Endpoints{' '}
          <strong>não oficiais</strong> (os usados pelos apps dos fabricantes) podem violar os
          termos e parar sem aviso.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!providers ? (
          <Skeleton className="h-16 w-full" />
        ) : providers.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum provedor disponível nesta versão.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Provedor</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead>No servidor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {providers.map((p) => (
                <TableRow key={p.key}>
                  <TableCell className="max-w-sm align-top">
                    <div className="font-medium">{p.label}</div>
                    {p.notes ? (
                      <div className="text-xs text-muted-foreground">{p.notes}</div>
                    ) : null}
                    {p.docsUrl ? (
                      <a
                        href={p.docsUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-primary underline"
                      >
                        Documentação do provedor
                      </a>
                    ) : null}
                  </TableCell>
                  <TableCell className="align-top">{KIND_LABELS[p.kind]}</TableCell>
                  <TableCell className="align-top">
                    <Badge variant={p.official ? 'green' : 'yellow'}>
                      {p.official ? 'Oficial' : 'Não oficial'}
                    </Badge>
                  </TableCell>
                  <TableCell className="align-top">
                    {p.available ? (
                      <Badge variant={p.enabled ? 'green' : 'outline'}>
                        {p.enabled ? 'Ligado' : 'Desligado'}
                      </Badge>
                    ) : (
                      <Badge variant="outline">Sem adaptador</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function ConnectionDialog({
  open,
  onOpenChange,
  providers,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providers: IntegrationProviderDto[];
}) {
  const invalidate = useInvalidate();
  const [providerKey, setProviderKey] = useState('');
  const [label, setLabel] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const provider = providers.find((p) => p.key === providerKey);

  const reset = () => {
    setProviderKey('');
    setLabel('');
    setValues({});
  };
  const save = useMutation({
    mutationFn: () =>
      endpoints.integrations.connections.create({
        provider: providerKey,
        label,
        credentials: values,
        config: {},
      }),
    onSuccess: async () => {
      toast.success('Conexão cadastrada. Teste e ligue quando estiver pronta.');
      reset();
      onOpenChange(false);
      await invalidate();
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível cadastrar a conexão.')),
  });
  const missing =
    !provider ||
    !label.trim() ||
    provider.credentialFields.some((f) => f.required && !values[f.name]?.trim());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nova conexão</DialogTitle>
          <DialogDescription>
            As credenciais ficam cifradas e nunca voltam para a tela depois de salvas.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="int-provider">Provedor</Label>
            <NativeSelect
              id="int-provider"
              value={providerKey}
              onChange={(e) => {
                setProviderKey(e.target.value);
                setValues({});
              }}
            >
              <option value="">Escolha…</option>
              {providers.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                  {p.official ? '' : ' (não oficial)'}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="int-label">Nome da conexão</Label>
            <Input
              id="int-label"
              value={label}
              placeholder="Ex.: Conta da empresa"
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          {provider?.credentialFields.map((field) => (
            <div key={field.name} className="grid gap-1.5">
              <Label htmlFor={`int-${field.name}`}>{field.label}</Label>
              <Input
                id={`int-${field.name}`}
                type={field.secret ? 'password' : 'text'}
                autoComplete="off"
                value={values[field.name] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
              />
              {field.hint ? <p className="text-xs text-muted-foreground">{field.hint}</p> : null}
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button disabled={missing || save.isPending} onClick={() => save.mutate()}>
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TermsDialog({
  connection,
  onClose,
  onConfirm,
  pending,
}: {
  connection: IntegrationConnectionDto | null;
  onClose: () => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  const [accepted, setAccepted] = useState(false);
  return (
    <Dialog
      open={Boolean(connection)}
      onOpenChange={(open) => {
        if (!open) {
          setAccepted(false);
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ligar endpoint não oficial</DialogTitle>
          <DialogDescription>
            {connection?.providerLabel} usa o mesmo caminho dos aplicativos do fabricante, sem
            contrato de API.
          </DialogDescription>
        </DialogHeader>
        <Alert>
          <AlertDescription>
            Isso pode <strong>violar os termos de uso</strong> do fabricante, ser bloqueado sem
            aviso e parar de funcionar quando o fabricante mudar o serviço. O seu aceite fica
            registrado com o seu nome e a data.
          </AlertDescription>
        </Alert>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
          />
          <span>Entendo o risco e assumo a responsabilidade por usar este provedor.</span>
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={!accepted || pending} onClick={onConfirm}>
            Aceitar e ligar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Connections({ providers }: { providers: IntegrationProviderDto[] | undefined }) {
  const invalidate = useInvalidate();
  const connections = useQuery({
    queryKey: queryKeys.integrationConnections,
    queryFn: endpoints.integrations.connections.list,
  });
  const [creating, setCreating] = useState(false);
  const [terms, setTerms] = useState<IntegrationConnectionDto | null>(null);
  const [removing, setRemoving] = useState<IntegrationConnectionDto | null>(null);

  const run = useMutation({
    mutationFn: (action: () => Promise<unknown>) => action(),
    onSuccess: async (result) => {
      const r = result as
        { ok?: boolean; message?: string; status?: string; error?: string } | undefined;
      if (r?.ok === false) toast.error(r.message ?? 'O teste falhou.');
      else if (r?.ok === true) toast.success(r.message ?? 'Conexão testada com sucesso.');
      else if (r?.status === 'FAILED') toast.error(r.error ?? 'A sincronização falhou.');
      else if (r?.status === 'SKIPPED') toast.info(r.error ?? 'Nada foi consultado.');
      await invalidate();
    },
    onError: (error) => {
      if (isApiError(error) && error.status === 503)
        toast.error('Este provedor está desligado no servidor.');
      else toast.error(errorMessage(error, 'Não foi possível concluir a ação.'));
    },
  });

  const activate = (c: IntegrationConnectionDto) => {
    if (!c.official && !c.termsAcceptedAt) setTerms(c);
    else
      run.mutate(() => endpoints.integrations.connections.activate(c.id, { acceptTerms: false }));
  };

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle>Conexões da empresa</CardTitle>
          <CardDescription>
            Cada conexão é uma conta sua em um provedor. Falhas seguidas pausam a conexão e a mandam
            para a lista de falhas, abaixo.
          </CardDescription>
        </div>
        <Can permission="platform.integration.manage">
          <Button size="sm" onClick={() => setCreating(true)} disabled={!providers?.length}>
            <Plus aria-hidden="true" /> Nova conexão
          </Button>
        </Can>
      </CardHeader>
      <CardContent>
        {connections.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : connections.isError ? (
          <p className="text-sm text-destructive">Não foi possível carregar as conexões.</p>
        ) : connections.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma conexão cadastrada ainda.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Conexão</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead>Última sincronização</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {connections.data.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="align-top">
                    <div className="font-medium">{c.label}</div>
                    <div className="text-xs text-muted-foreground">
                      {c.providerLabel}
                      {c.official ? '' : ' · não oficial'}
                    </div>
                  </TableCell>
                  <TableCell className="align-top">
                    <div className="flex flex-wrap gap-1">
                      <Badge variant={STATUS_BADGE[c.status].variant}>
                        {STATUS_BADGE[c.status].label}
                      </Badge>
                      <Badge variant={HEALTH_BADGE[c.health].variant}>
                        {HEALTH_BADGE[c.health].label}
                      </Badge>
                    </div>
                    {c.lastError ? (
                      <div className="mt-1 text-xs text-destructive">{c.lastError}</div>
                    ) : null}
                  </TableCell>
                  <TableCell className="align-top text-sm text-muted-foreground">
                    {c.lastSyncAt ? formatDate(c.lastSyncAt) : 'Nunca'}
                  </TableCell>
                  <TableCell className="align-top">
                    <Can permission="platform.integration.manage">
                      <div className="flex flex-wrap justify-end gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={run.isPending}
                          onClick={() =>
                            run.mutate(() => endpoints.integrations.connections.test(c.id))
                          }
                        >
                          Testar
                        </Button>
                        {c.status === 'ACTIVE' ? (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={run.isPending}
                              onClick={() =>
                                run.mutate(() => endpoints.integrations.connections.sync(c.id))
                              }
                            >
                              Sincronizar
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={run.isPending}
                              onClick={() =>
                                run.mutate(() => endpoints.integrations.connections.pause(c.id))
                              }
                            >
                              Pausar
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="sm"
                            disabled={run.isPending || !c.providerAvailable}
                            title={
                              c.providerAvailable
                                ? undefined
                                : 'O adaptador deste provedor ainda não foi implementado'
                            }
                            onClick={() => activate(c)}
                          >
                            Ligar
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => setRemoving(c)}>
                          Remover
                        </Button>
                      </div>
                    </Can>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <ConnectionDialog open={creating} onOpenChange={setCreating} providers={providers ?? []} />
      <TermsDialog
        connection={terms}
        onClose={() => setTerms(null)}
        pending={run.isPending}
        onConfirm={() => {
          const target = terms;
          setTerms(null);
          if (target)
            run.mutate(() =>
              endpoints.integrations.connections.activate(target.id, { acceptTerms: true }),
            );
        }}
      />
      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title="Remover a conexão?"
        description={`A conexão "${removing?.label ?? ''}" deixa de sincronizar. O histórico de execuções continua guardado.`}
        confirmLabel="Remover"
        onConfirm={() => {
          const target = removing;
          setRemoving(null);
          if (target) run.mutate(() => endpoints.integrations.connections.remove(target.id));
        }}
      />
    </Card>
  );
}

function DeadLetters() {
  const invalidate = useInvalidate();
  const letters = useQuery({
    queryKey: queryKeys.integrationDeadLetters,
    queryFn: endpoints.integrations.deadLetters.list,
  });
  const connections = useQuery({
    queryKey: queryKeys.integrationConnections,
    queryFn: endpoints.integrations.connections.list,
  });
  const retry = useMutation({
    mutationFn: (id: string) => endpoints.integrations.deadLetters.retry(id),
    onSuccess: async (r) => {
      if (r.resolved) toast.success('Reprocessada com sucesso.');
      else toast.error('A falha continua. Confira a credencial e o provedor.');
      await invalidate();
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível reprocessar.')),
  });
  const dismiss = useMutation({
    mutationFn: (id: string) => endpoints.integrations.deadLetters.dismiss(id),
    onSuccess: invalidate,
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível descartar.')),
  });
  const nameOf = (l: IntegrationDeadLetterDto) =>
    connections.data?.find((c) => c.id === l.connectionId)?.label ?? 'Conexão removida';

  return (
    <Card>
      <CardHeader>
        <CardTitle>Falhas à espera de uma pessoa</CardTitle>
        <CardDescription>
          Sincronizações que esgotaram as tentativas. Reprocessar reativa a conexão e tenta de novo.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {letters.isPending ? (
          <Skeleton className="h-12 w-full" />
        ) : (letters.data?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma falha pendente.</p>
        ) : (
          <ul className="divide-y" aria-label="Falhas pendentes">
            {letters.data?.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <div className="text-sm font-medium">{nameOf(l)}</div>
                  <div className="text-xs text-destructive">{l.error}</div>
                  <div className="text-xs text-muted-foreground">
                    {formatDate(l.createdAt)} · {l.attempts} tentativa(s)
                  </div>
                </div>
                <Can permission="platform.integration.manage">
                  <div className="flex gap-1">
                    <Button size="sm" disabled={retry.isPending} onClick={() => retry.mutate(l.id)}>
                      Reprocessar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={dismiss.isPending}
                      onClick={() => dismiss.mutate(l.id)}
                    >
                      Descartar
                    </Button>
                  </div>
                </Can>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function Runs() {
  const runs = useQuery({
    queryKey: queryKeys.integrationRuns(),
    queryFn: () => endpoints.integrations.runs(),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Últimas execuções</CardTitle>
      </CardHeader>
      <CardContent>
        {runs.isPending ? (
          <Skeleton className="h-12 w-full" />
        ) : (runs.data?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma execução ainda.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quando</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead>Resultado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.data?.map((r: IntegrationRunDto) => (
                <TableRow key={r.id}>
                  <TableCell className="text-sm">{formatDate(r.startedAt)}</TableCell>
                  <TableCell className="text-sm">{r.trigger}</TableCell>
                  <TableCell className="text-sm">
                    {RUN_LABELS[r.status]}
                    {r.error ? (
                      <span className="text-xs text-destructive"> · {r.error}</span>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export function IntegrationsPage() {
  const providers = useQuery({
    queryKey: queryKeys.integrationProviders,
    queryFn: endpoints.integrations.providers,
  });
  return (
    <div className="grid gap-6">
      <Providers providers={providers.data} />
      <Connections providers={providers.data} />
      <DeadLetters />
      <Runs />
    </div>
  );
}
