import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRightCircle, MoreHorizontal, Plus, Search, Upload } from 'lucide-react';
import { useState } from 'react';
import { toast } from '@voltex/ui';
import { CustomerSegment, LeadSource, LeadStatus, type LeadDto } from '@voltex/shared';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
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
  Textarea,
} from '@voltex/ui';
import { Can } from '@/app/guards';
import { Field } from '@/components/field';
import { Pagination } from '@/components/pagination';
import { ConfirmDialog } from '@/features/admin/company/confirm-delete';
import { queryKeys } from '@/features/admin/query-keys';
import { useAuth } from '@/features/auth/auth-provider';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { LEAD_SOURCE_LABELS, LEAD_STATUS_LABELS, SEGMENT_LABELS } from '@/i18n/labels';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api/errors';
import { formatDateTime, formatRelativeTime } from '@/lib/format';
import { CaptureCard } from './capture-card';
import { ConvertLeadDialog } from './convert-lead-dialog';
import { ImportLeadsDialog } from './import-leads-dialog';
import { LeadFormDialog } from './lead-form-dialog';

const PAGE_SIZE = 10;

const STATUS_BADGE = {
  NEW: 'secondary',
  CONTACTED: 'outline',
  QUALIFIED: 'green',
  DISQUALIFIED: 'outline',
  CONVERTED: 'default',
} as const;

function DisqualifyDialog({
  lead,
  onOpenChange,
}: {
  lead: LeadDto | null;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const mutation = useMutation({
    mutationFn: () => {
      if (!lead) throw new Error('Nenhum lead selecionado');
      return endpoints.leads.update(lead.id, {
        status: LeadStatus.DISQUALIFIED,
        disqualifiedReason: reason.trim(),
      });
    },
    onSuccess: async () => {
      toast.success('Lead desqualificado');
      setReason('');
      onOpenChange(false);
      await queryClient.invalidateQueries({ queryKey: queryKeys.leads() });
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível desqualificar o lead.')),
  });
  return (
    <Dialog open={lead !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Desqualificar lead</DialogTitle>
          <DialogDescription>
            Explique por que <strong>{lead?.name}</strong> não segue no funil. O motivo fica
            registrado.
          </DialogDescription>
        </DialogHeader>
        <Field id="dq-reason" label="Motivo" hint="Mínimo de 3 caracteres.">
          <Textarea
            id="dq-reason"
            rows={3}
            maxLength={300}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={reason.trim().length < 3 || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? <Spinner /> : null}
            Desqualificar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SlaCell({ lead }: { lead: LeadDto }) {
  if (lead.status !== 'NEW' || !lead.firstContactDueAt)
    return <span className="text-muted-foreground">—</span>;
  if (lead.slaBreached)
    return (
      <Badge variant="red" title={`Prazo: ${formatDateTime(lead.firstContactDueAt)}`}>
        SLA estourado
      </Badge>
    );
  return (
    <span className="text-muted-foreground" title={formatDateTime(lead.firstContactDueAt)}>
      Contato {formatRelativeTime(lead.firstContactDueAt)}
    </span>
  );
}

export function LeadsPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const canWrite = can('crm.lead.write');

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'' | LeadStatus>('');
  const [source, setSource] = useState<'' | LeadSource>('');
  const [segment, setSegment] = useState<'' | CustomerSegment>('');
  const [slaOnly, setSlaOnly] = useState(false);
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebouncedValue(search.trim());

  const [formLead, setFormLead] = useState<LeadDto | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [converting, setConverting] = useState<LeadDto | null>(null);
  const [disqualifying, setDisqualifying] = useState<LeadDto | null>(null);
  const [deleting, setDeleting] = useState<LeadDto | null>(null);

  const filters = { page, search: debouncedSearch, status, source, segment, slaOnly };
  const list = useQuery({
    queryKey: queryKeys.leads(filters),
    queryFn: () =>
      endpoints.leads.list({
        page,
        pageSize: PAGE_SIZE,
        search: debouncedSearch || undefined,
        status: status || undefined,
        source: source || undefined,
        segment: segment || undefined,
        slaBreached: slaOnly ? true : undefined,
      }),
    placeholderData: keepPreviousData,
  });

  const setLeadStatus = useMutation({
    mutationFn: ({ id, next }: { id: string; next: LeadStatus }) =>
      endpoints.leads.update(id, { status: next }),
    onSuccess: async () => {
      toast.success('Lead atualizado');
      await queryClient.invalidateQueries({ queryKey: queryKeys.leads() });
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível atualizar o lead.')),
  });
  const remove = useMutation({
    mutationFn: (id: string) => endpoints.leads.remove(id),
    onSuccess: async () => {
      toast.success('Lead excluído');
      await queryClient.invalidateQueries({ queryKey: queryKeys.leads() });
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível excluir o lead.')),
  });

  const edit = (lead: LeadDto | null) => {
    setFormLead(lead);
    setFormOpen(true);
  };
  const reset =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      setPage(1);
    };
  const openExisting = async (id: string) => {
    try {
      setFormLead(await endpoints.leads.get(id));
    } catch (error) {
      toast.error(errorMessage(error, 'Não foi possível abrir o lead existente.'));
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex-col items-start justify-between gap-3 space-y-0 sm:flex-row">
          <div className="space-y-1.5">
            <CardTitle>Leads</CardTitle>
            <CardDescription>Quem chegou e ainda não virou cliente em negociação.</CardDescription>
          </div>
          <Can permission="crm.lead.write">
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setImporting(true)}>
                <Upload /> Importar CSV
              </Button>
              <Button size="sm" onClick={() => edit(null)}>
                <Plus /> Novo lead
              </Button>
            </div>
          </Can>
        </CardHeader>
        <CardContent>
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_9rem_10rem_9rem_9rem]">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                type="search"
                className="pl-9"
                placeholder="Buscar por nome, e-mail ou telefone"
                aria-label="Buscar leads"
                value={search}
                onChange={(e) => reset(setSearch)(e.target.value)}
              />
            </div>
            <NativeSelect
              aria-label="Filtrar por situação"
              value={status}
              onChange={(e) => reset(setStatus)(e.target.value as '' | LeadStatus)}
            >
              <option value="">Todas as situações</option>
              {Object.values(LeadStatus).map((s) => (
                <option key={s} value={s}>
                  {LEAD_STATUS_LABELS[s]}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              aria-label="Filtrar por origem"
              value={source}
              onChange={(e) => reset(setSource)(e.target.value as '' | LeadSource)}
            >
              <option value="">Todas as origens</option>
              {Object.values(LeadSource).map((s) => (
                <option key={s} value={s}>
                  {LEAD_SOURCE_LABELS[s]}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              aria-label="Filtrar por segmento"
              value={segment}
              onChange={(e) => reset(setSegment)(e.target.value as '' | CustomerSegment)}
            >
              <option value="">Todos os segmentos</option>
              {Object.values(CustomerSegment).map((s) => (
                <option key={s} value={s}>
                  {SEGMENT_LABELS[s]}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              aria-label="Filtrar por prazo de contato"
              value={slaOnly ? 'breached' : ''}
              onChange={(e) => reset(setSlaOnly)(e.target.value === 'breached')}
            >
              <option value="">Qualquer prazo</option>
              <option value="breached">SLA estourado</option>
            </NativeSelect>
          </div>

          {list.isPending ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : list.isError ? (
            <p className="text-sm text-destructive">Não foi possível carregar os leads.</p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Lead</TableHead>
                    <TableHead>Origem</TableHead>
                    <TableHead>Situação</TableHead>
                    <TableHead>Responsável</TableHead>
                    <TableHead>Primeiro contato</TableHead>
                    <TableHead className="w-24 text-right">
                      <span className="sr-only">Ações</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.data.data.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                        {debouncedSearch || status || source || segment || slaOnly
                          ? 'Nenhum lead encontrado com esses filtros.'
                          : 'Nenhum lead ainda. Cadastre, importe um CSV ou use o formulário de captação.'}
                      </TableCell>
                    </TableRow>
                  ) : (
                    list.data.data.map((lead) => {
                      const open = lead.status !== 'CONVERTED' && lead.status !== 'DISQUALIFIED';
                      return (
                        <TableRow key={lead.id}>
                          <TableCell>
                            <div className="font-medium">{lead.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {[lead.phone, lead.email].filter(Boolean).join(' · ') ||
                                'Sem contato'}
                              {lead.segment ? ` · ${SEGMENT_LABELS[lead.segment]}` : ''}
                            </div>
                          </TableCell>
                          <TableCell>{LEAD_SOURCE_LABELS[lead.source]}</TableCell>
                          <TableCell>
                            <Badge variant={STATUS_BADGE[lead.status]}>
                              {LEAD_STATUS_LABELS[lead.status]}
                            </Badge>
                            {lead.status === 'DISQUALIFIED' && lead.disqualifiedReason ? (
                              <div className="mt-1 text-xs text-muted-foreground">
                                {lead.disqualifiedReason}
                              </div>
                            ) : null}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {lead.ownerName ?? '—'}
                          </TableCell>
                          <TableCell>
                            <SlaCell lead={lead} />
                          </TableCell>
                          <TableCell className="text-right">
                            {canWrite ? (
                              <div className="flex justify-end gap-1">
                                {open ? (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    aria-label={`Converter ${lead.name}`}
                                    onClick={() => setConverting(lead)}
                                  >
                                    <ArrowRightCircle />
                                  </Button>
                                ) : null}
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      aria-label={`Ações de ${lead.name}`}
                                    >
                                      <MoreHorizontal />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    {lead.status !== 'CONVERTED' ? (
                                      <DropdownMenuItem onSelect={() => edit(lead)}>
                                        Editar
                                      </DropdownMenuItem>
                                    ) : null}
                                    {lead.status === 'NEW' ? (
                                      <DropdownMenuItem
                                        onSelect={() =>
                                          setLeadStatus.mutate({
                                            id: lead.id,
                                            next: LeadStatus.CONTACTED,
                                          })
                                        }
                                      >
                                        Marcar como contatado
                                      </DropdownMenuItem>
                                    ) : null}
                                    {lead.status === 'NEW' || lead.status === 'CONTACTED' ? (
                                      <DropdownMenuItem
                                        onSelect={() =>
                                          setLeadStatus.mutate({
                                            id: lead.id,
                                            next: LeadStatus.QUALIFIED,
                                          })
                                        }
                                      >
                                        Qualificar
                                      </DropdownMenuItem>
                                    ) : null}
                                    {lead.status === 'DISQUALIFIED' ? (
                                      <DropdownMenuItem
                                        onSelect={() =>
                                          setLeadStatus.mutate({
                                            id: lead.id,
                                            next: LeadStatus.NEW,
                                          })
                                        }
                                      >
                                        Reabrir
                                      </DropdownMenuItem>
                                    ) : null}
                                    {open ? (
                                      <DropdownMenuItem onSelect={() => setDisqualifying(lead)}>
                                        Desqualificar
                                      </DropdownMenuItem>
                                    ) : null}
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onSelect={() => setDeleting(lead)}>
                                      Excluir
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
              <Pagination
                page={list.data.meta.page}
                pageSize={list.data.meta.pageSize}
                total={list.data.meta.total}
                onPageChange={setPage}
              />
            </>
          )}
        </CardContent>
      </Card>

      <Can permission="platform.tenant.manage">
        <CaptureCard />
      </Can>

      <LeadFormDialog
        lead={formLead}
        open={formOpen}
        onOpenChange={setFormOpen}
        onOpenExisting={(id) => void openExisting(id)}
      />
      <ImportLeadsDialog open={importing} onOpenChange={setImporting} />
      <ConvertLeadDialog lead={converting} onOpenChange={(o) => !o && setConverting(null)} />
      <DisqualifyDialog lead={disqualifying} onOpenChange={(o) => !o && setDisqualifying(null)} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Excluir lead?"
        description={
          <>
            <strong>{deleting?.name}</strong> sai da lista. O registro fica na auditoria.
          </>
        }
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </div>
  );
}
