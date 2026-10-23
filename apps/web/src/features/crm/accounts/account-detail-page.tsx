import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from '@voltex/ui';
import type { ConsumerUnitDto, ContactDto, SiteDto } from '@voltex/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
} from '@voltex/ui';
import { Can } from '@/app/guards';
import { ConfirmDialog } from '@/features/admin/company/confirm-delete';
import { queryKeys } from '@/features/admin/query-keys';
import {
  ACCOUNT_TYPE_LABELS,
  CUSTOMER_GROUP_LABELS,
  PHASE_SYSTEM_LABELS,
  ROOF_TYPE_LABELS,
  SEGMENT_LABELS,
  SHADING_LABELS,
  STAGE_LABELS,
} from '@/i18n/labels';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage, isApiError } from '@/lib/api/errors';
import { NewOpportunityDialog } from '../opportunities/new-opportunity-dialog';
import { PortalCard } from './portal-card';
import {
  AccountFormDialog,
  ConsumerUnitDialog,
  ContactDialog,
  SiteDialog,
} from './account-dialogs';

type Deleting =
  | { kind: 'account' }
  | { kind: 'contact'; item: ContactDto }
  | { kind: 'site'; item: SiteDto }
  | { kind: 'unit'; item: ConsumerUnitDto };

function IntakeSummary({ site }: { site: SiteDto }) {
  const i = site.intake;
  const parts = [
    i.roofType ? ROOF_TYPE_LABELS[i.roofType] : null,
    i.roofAzimuthDegrees !== undefined ? `azimute ${i.roofAzimuthDegrees}°` : null,
    i.tiltDegrees !== undefined ? `inclinação ${i.tiltDegrees}°` : null,
    i.shading ? SHADING_LABELS[i.shading] : null,
    i.availableAreaM2 !== undefined ? `${i.availableAreaM2} m² livres` : null,
    i.entryBreakerAmps !== undefined ? `disjuntor ${i.entryBreakerAmps} A` : null,
    i.groundingAdequate === undefined
      ? null
      : i.groundingAdequate
        ? 'aterramento adequado'
        : 'aterramento inadequado',
    i.technicalVisitRequired && !i.technicalVisitDone ? 'visita técnica pendente' : null,
    i.technicalVisitDone ? 'visita técnica feita' : null,
  ].filter(Boolean);
  return (
    <p className="text-xs text-muted-foreground">
      {parts.length > 0 ? parts.join(' · ') : 'Levantamento técnico não preenchido'}
    </p>
  );
}

export function AccountDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const account = useQuery({
    queryKey: queryKeys.account(id),
    queryFn: () => endpoints.accounts.get(id),
  });
  const opportunities = useQuery({
    queryKey: queryKeys.opportunities({ accountId: id }),
    queryFn: () => endpoints.opportunities.list({ accountId: id, pageSize: 50 }),
    enabled: account.isSuccess,
  });

  const [editing, setEditing] = useState(false);
  const [contact, setContact] = useState<{ item: ContactDto | null } | null>(null);
  const [site, setSite] = useState<{ item: SiteDto | null } | null>(null);
  const [unit, setUnit] = useState<{ item: ConsumerUnitDto | null } | null>(null);
  const [newOpportunity, setNewOpportunity] = useState(false);
  const [deleting, setDeleting] = useState<Deleting | null>(null);

  const remove = useMutation({
    mutationFn: (target: Deleting) => {
      if (target.kind === 'account') return endpoints.accounts.remove(id);
      if (target.kind === 'contact') return endpoints.accounts.removeContact(target.item.id);
      if (target.kind === 'site') return endpoints.accounts.removeSite(target.item.id);
      return endpoints.accounts.removeConsumerUnit(target.item.id);
    },
    onSuccess: async (_data, target) => {
      toast.success('Excluído');
      if (target.kind === 'account') {
        await queryClient.invalidateQueries({ queryKey: queryKeys.accounts() });
        void navigate('/crm/contas');
      } else await queryClient.invalidateQueries({ queryKey: queryKeys.account(id) });
    },
    onError: (error) =>
      toast.error(
        isApiError(error) && error.status === 409
          ? error.message
          : errorMessage(error, 'Não foi possível excluir.'),
      ),
  });

  if (account.isPending) return <Skeleton className="h-64 w-full" />;
  if (account.isError)
    return (
      <div className="space-y-3">
        <p className="text-sm text-destructive">
          {isApiError(account.error) && account.error.status === 404
            ? 'Conta não encontrada.'
            : 'Não foi possível carregar a conta.'}
        </p>
        <Button asChild variant="outline">
          <Link to="/crm/contas">Voltar às contas</Link>
        </Button>
      </div>
    );

  const data = account.data;
  const deletingText =
    deleting?.kind === 'account'
      ? `a conta ${data.name}`
      : deleting?.kind === 'contact'
        ? `o contato ${deleting.item.name}`
        : deleting?.kind === 'site'
          ? `o imóvel ${deleting.item.name}`
          : deleting?.kind === 'unit'
            ? `a UC ${deleting.item.number}`
            : '';

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <Link
          to="/crm/contas"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden /> Contas
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-2xl font-semibold tracking-tight">{data.name}</h2>
              <Badge variant="outline">{ACCOUNT_TYPE_LABELS[data.type]}</Badge>
              {data.segment ? (
                <Badge variant="secondary">{SEGMENT_LABELS[data.segment]}</Badge>
              ) : null}
            </div>
            <p className="text-muted-foreground">
              {[data.document, data.phone, data.email].filter(Boolean).join(' · ') ||
                'Sem dados de contato'}
            </p>
            {data.notes ? <p className="text-sm">{data.notes}</p> : null}
          </div>
          <div className="flex gap-2">
            <Can permission="crm.opportunity.write">
              <Button size="sm" onClick={() => setNewOpportunity(true)}>
                <Plus /> Nova oportunidade
              </Button>
            </Can>
            <Can permission="crm.account.write">
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                <Pencil /> Editar
              </Button>
              <Button
                size="sm"
                variant="outline"
                aria-label="Excluir conta"
                onClick={() => setDeleting({ kind: 'account' })}
              >
                <Trash2 />
              </Button>
            </Can>
          </div>
        </div>
      </header>

      <PortalCard accountId={data.id} accountName={data.name} contacts={data.contacts} />

      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div className="space-y-1.5">
            <CardTitle className="text-base">Oportunidades</CardTitle>
            <CardDescription>Negócios abertos e encerrados desta conta.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {opportunities.isPending ? (
            <Skeleton className="h-10 w-full" />
          ) : (opportunities.data?.data.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma oportunidade ainda.</p>
          ) : (
            <ul className="divide-y">
              {opportunities.data?.data.map((o) => (
                <li
                  key={o.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                >
                  <div>
                    <Link to={`/crm/oportunidades/${o.id}`} className="font-medium hover:underline">
                      {o.title}
                    </Link>
                    <div className="text-xs text-muted-foreground">{o.projectCode}</div>
                  </div>
                  <Badge
                    variant={
                      o.status === 'LOST' ? 'outline' : o.status === 'WON' ? 'green' : 'secondary'
                    }
                  >
                    {STAGE_LABELS[o.stage]}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-start justify-between space-y-0">
            <div className="space-y-1.5">
              <CardTitle className="text-base">Contatos</CardTitle>
              <CardDescription>Quem atende pela conta.</CardDescription>
            </div>
            <Can permission="crm.account.write">
              <Button size="sm" variant="outline" onClick={() => setContact({ item: null })}>
                <Plus /> Contato
              </Button>
            </Can>
          </CardHeader>
          <CardContent>
            {data.contacts.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum contato.</p>
            ) : (
              <ul className="divide-y">
                {data.contacts.map((c) => (
                  <li key={c.id} className="flex items-start justify-between gap-2 py-2 text-sm">
                    <div>
                      <div className="flex items-center gap-2 font-medium">
                        {c.name}
                        {c.isPrimary ? (
                          <Badge variant="secondary">
                            <Star /> Principal
                          </Badge>
                        ) : null}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {[c.roleTitle, c.phone, c.email].filter(Boolean).join(' · ') || '—'}
                      </div>
                    </div>
                    <Can permission="crm.account.write">
                      <div className="flex shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Editar contato ${c.name}`}
                          onClick={() => setContact({ item: c })}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Excluir contato ${c.name}`}
                          onClick={() => setDeleting({ kind: 'contact', item: c })}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </Can>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-start justify-between space-y-0">
            <div className="space-y-1.5">
              <CardTitle className="text-base">Unidades consumidoras</CardTitle>
              <CardDescription>UCs das faturas, com concessionária e ligação.</CardDescription>
            </div>
            <Can permission="crm.account.write">
              <Button size="sm" variant="outline" onClick={() => setUnit({ item: null })}>
                <Plus /> UC
              </Button>
            </Can>
          </CardHeader>
          <CardContent>
            {data.consumerUnits.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma unidade consumidora.</p>
            ) : (
              <ul className="divide-y">
                {data.consumerUnits.map((u) => (
                  <li key={u.id} className="flex items-start justify-between gap-2 py-2 text-sm">
                    <div>
                      <div className="font-medium">UC {u.number}</div>
                      <div className="text-xs text-muted-foreground">
                        {[
                          u.distributorName,
                          CUSTOMER_GROUP_LABELS[u.customerGroup],
                          u.phaseSystem ? PHASE_SYSTEM_LABELS[u.phaseSystem] : null,
                          u.consumerClass,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </div>
                    <Can permission="crm.account.write">
                      <div className="flex shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Editar UC ${u.number}`}
                          onClick={() => setUnit({ item: u })}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Excluir UC ${u.number}`}
                          onClick={() => setDeleting({ kind: 'unit', item: u })}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </Can>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div className="space-y-1.5">
            <CardTitle className="text-base">Imóveis</CardTitle>
            <CardDescription>
              Locais da instalação e o levantamento técnico de cada um.
            </CardDescription>
          </div>
          <Can permission="crm.account.write">
            <Button size="sm" variant="outline" onClick={() => setSite({ item: null })}>
              <Plus /> Imóvel
            </Button>
          </Can>
        </CardHeader>
        <CardContent>
          {data.sites.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum imóvel cadastrado.</p>
          ) : (
            <ul className="divide-y">
              {data.sites.map((s) => (
                <li key={s.id} className="flex items-start justify-between gap-2 py-3 text-sm">
                  <div className="space-y-0.5">
                    <div className="font-medium">{s.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {[
                        [s.street, s.number].filter(Boolean).join(', '),
                        s.district,
                        `${s.city}/${s.state}`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                    <IntakeSummary site={s} />
                  </div>
                  <Can permission="crm.account.write">
                    <div className="flex shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Editar imóvel ${s.name}`}
                        onClick={() => setSite({ item: s })}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Excluir imóvel ${s.name}`}
                        onClick={() => setDeleting({ kind: 'site', item: s })}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </Can>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <AccountFormDialog item={data} open={editing} onOpenChange={setEditing} />
      <ContactDialog
        accountId={id}
        item={contact?.item ?? null}
        open={contact !== null}
        onOpenChange={(o) => !o && setContact(null)}
      />
      <SiteDialog
        accountId={id}
        item={site?.item ?? null}
        open={site !== null}
        onOpenChange={(o) => !o && setSite(null)}
      />
      <ConsumerUnitDialog
        account={data}
        item={unit?.item ?? null}
        open={unit !== null}
        onOpenChange={(o) => !o && setUnit(null)}
      />
      <NewOpportunityDialog accountId={id} open={newOpportunity} onOpenChange={setNewOpportunity} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Excluir?"
        description={<>Você vai excluir {deletingText}. O registro permanece na auditoria.</>}
        onConfirm={() => deleting && remove.mutate(deleting)}
      />
    </div>
  );
}
