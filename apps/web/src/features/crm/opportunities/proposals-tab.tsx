import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Download, FilePlus2, Send } from 'lucide-react';
import { useState } from 'react';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Skeleton,
  Spinner,
  Textarea,
  toast,
} from '@voltex/ui';
import { MAX_PROPOSAL_SCENARIOS, type ProposalDto, type QuoteDto } from '@voltex/shared';
import { Can } from '@/app/guards';
import { Field } from '@/components/field';
import { queryKeys } from '@/features/admin/query-keys';
import { PROPOSAL_STATUS_LABELS } from '@/i18n/labels';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api/errors';
import { formatCents, formatDate, formatDateTime } from '@/lib/format';

const STATUS_BADGE = {
  GENERATED: 'secondary',
  SENT: 'default',
  VIEWED: 'yellow',
  ACCEPTED: 'green',
  SUPERSEDED: 'outline',
} as const;

function useRefreshProposals(opportunityId: string) {
  const queryClient = useQueryClient();
  return async () => {
    for (const key of [
      queryKeys.opportunityProposals(opportunityId),
      queryKeys.opportunityQuotes(opportunityId),
      queryKeys.opportunityTimeline(opportunityId),
      queryKeys.opportunity(opportunityId),
    ])
      await queryClient.invalidateQueries({ queryKey: key });
    await queryClient.invalidateQueries({ queryKey: ['opportunity-board'] });
  };
}

function CreateProposalDialog({
  opportunityId,
  quotes,
  open,
  onOpenChange,
}: {
  opportunityId: string;
  quotes: QuoteDto[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const refresh = useRefreshProposals(opportunityId);
  const available = quotes.filter((q) => q.releasedForProposal);
  const [chosen, setChosen] = useState<string[]>([]);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [validityDays, setValidityDays] = useState('15');
  const [paymentTerms, setPaymentTerms] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string>();

  const create = useMutation({
    mutationFn: () =>
      endpoints.opportunities.createProposal(opportunityId, {
        quoteIds: chosen,
        labels: chosen.length > 1 ? chosen.map((id) => labels[id]?.trim() || '') : undefined,
        validityDays: Number(validityDays),
        paymentTerms: paymentTerms.trim() || undefined,
        notes: notes.trim() || undefined,
      }),
    onSuccess: async () => {
      toast.success('Proposta gerada');
      onOpenChange(false);
      setChosen([]);
      await refresh();
    },
    onError: (e) => toast.error(errorMessage(e, 'Não foi possível gerar a proposta.')),
  });

  const toggle = (id: string) =>
    setChosen((current) =>
      current.includes(id)
        ? current.filter((x) => x !== id)
        : current.length < MAX_PROPOSAL_SCENARIOS
          ? [...current, id]
          : current,
    );

  const submit = () => {
    const days = Number(validityDays);
    if (chosen.length === 0) return setError('Escolha ao menos uma cotação');
    if (!Number.isInteger(days) || days < 1 || days > 90)
      return setError('A validade deve ser de 1 a 90 dias');
    if (chosen.length > 1 && chosen.some((id) => !labels[id]?.trim()))
      return setError('Dê um nome a cada cenário');
    setError(undefined);
    create.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Gerar proposta</DialogTitle>
          <DialogDescription>
            Cada cotação escolhida vira um cenário (até {MAX_PROPOSAL_SCENARIOS}). Ao gerar, as
            cotações ficam travadas e a proposta vira uma foto imutável.
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Cotações</legend>
            {available.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhuma cotação liberada: a margem precisa estar dentro da política ou aprovada.
              </p>
            ) : (
              available.map((q) => (
                <div key={q.id} className="grid gap-2 sm:grid-cols-[1fr_12rem] sm:items-center">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={chosen.includes(q.id)}
                      onChange={() => toggle(q.id)}
                    />
                    <span>
                      v{q.version}
                      {q.title ? ` · ${q.title}` : ''} · {formatCents(q.priceCents)}
                    </span>
                  </label>
                  {chosen.length > 1 && chosen.includes(q.id) ? (
                    <Input
                      aria-label={`Nome do cenário da cotação v${q.version}`}
                      placeholder="Nome do cenário"
                      value={labels[q.id] ?? ''}
                      onChange={(e) => setLabels({ ...labels, [q.id]: e.target.value })}
                    />
                  ) : null}
                </div>
              ))
            )}
          </fieldset>
          <Field id="proposal-validity" label="Validade (dias)">
            <Input
              id="proposal-validity"
              inputMode="numeric"
              value={validityDays}
              onChange={(e) => setValidityDays(e.target.value)}
            />
          </Field>
          <Field id="proposal-payment" label="Condições de pagamento (opcional)">
            <Input
              id="proposal-payment"
              placeholder="Ex.: 30% de entrada + 6x"
              value={paymentTerms}
              onChange={(e) => setPaymentTerms(e.target.value)}
            />
          </Field>
          <Field id="proposal-notes" label="Observações (opcional)">
            <Textarea
              id="proposal-notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={create.isPending || available.length === 0}>
              {create.isPending ? <Spinner /> : null}
              Gerar proposta
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function LinkDialog({ url, onClose }: { url: string | null; onClose: () => void }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url ?? '');
      toast.success('Link copiado');
    } catch {
      toast.error('Não foi possível copiar: selecione o link e copie manualmente.');
    }
  };
  return (
    <Dialog open={url !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Proposta enviada</DialogTitle>
          <DialogDescription>
            Envie este link ao cliente. Ele só aparece agora: se perder, gere outro com “Reenviar”
            (o link anterior deixa de funcionar).
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Input
            readOnly
            aria-label="Link público da proposta"
            value={url ?? ''}
            onFocus={(e) => e.target.select()}
          />
          <Button type="button" variant="outline" onClick={copy}>
            <Copy /> Copiar
          </Button>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ProposalsTab({ opportunityId, open }: { opportunityId: string; open: boolean }) {
  const refresh = useRefreshProposals(opportunityId);
  const [creating, setCreating] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const proposals = useQuery({
    queryKey: queryKeys.opportunityProposals(opportunityId),
    queryFn: () => endpoints.opportunities.proposals(opportunityId),
  });
  const quotes = useQuery({
    queryKey: queryKeys.opportunityQuotes(opportunityId),
    queryFn: () => endpoints.opportunities.quotes(opportunityId),
  });
  const send = useMutation({
    mutationFn: (proposal: ProposalDto) => endpoints.proposals.send(proposal.id),
    onSuccess: async (sent) => {
      setLink(sent.publicUrl ?? null);
      await refresh();
    },
    onError: (e) => toast.error(errorMessage(e, 'Não foi possível enviar a proposta.')),
  });
  const download = useMutation({
    mutationFn: async (proposal: ProposalDto) => {
      const { url } = await endpoints.proposals.pdfUrl(proposal.id);
      window.open(url, '_blank', 'noopener');
    },
    onError: (e) => toast.error(errorMessage(e, 'Não foi possível abrir o PDF.')),
  });

  if (proposals.isPending || quotes.isPending) return <Skeleton className="h-24 w-full" />;
  if (proposals.isError || quotes.isError)
    return <p className="text-sm text-destructive">Não foi possível carregar as propostas.</p>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        A proposta é gerada a partir de cotações liberadas e só com a triagem em dia. O cliente a
        abre por um link, sem login, e pode aceitar online.
      </p>
      <Can permission="crm.proposal.write">
        {open ? (
          <div>
            <Button size="sm" onClick={() => setCreating(true)}>
              <FilePlus2 /> Gerar proposta
            </Button>
          </div>
        ) : null}
      </Can>

      {proposals.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma proposta gerada.</p>
      ) : (
        <ul className="space-y-3">
          {proposals.data.map((proposal) => {
            const sendable =
              open &&
              (proposal.status === 'GENERATED' ||
                proposal.status === 'SENT' ||
                proposal.status === 'VIEWED') &&
              !proposal.expired;
            return (
              <li key={proposal.id} className="space-y-3 rounded-lg border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="font-medium">Proposta v{proposal.version}</h4>
                    <Badge variant={STATUS_BADGE[proposal.status]}>
                      {PROPOSAL_STATUS_LABELS[proposal.status]}
                    </Badge>
                    {proposal.expired && proposal.status !== 'SUPERSEDED' ? (
                      <Badge variant="red">Vencida</Badge>
                    ) : null}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    Válida até {formatDate(proposal.validUntil)}
                  </span>
                </div>
                <ul className="text-sm">
                  {proposal.scenarios.map((s) => (
                    <li key={s.quoteId} className="flex justify-between gap-3">
                      <span>
                        {s.label} · {s.installedPowerKwp.toLocaleString('pt-BR')} kWp
                      </span>
                      <span className="font-medium">{formatCents(s.priceCents)}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">
                  {proposal.sentAt
                    ? `Enviada em ${formatDateTime(proposal.sentAt)}`
                    : 'Ainda não enviada'}
                  {proposal.viewCount > 0
                    ? ` · aberta ${proposal.viewCount} ${proposal.viewCount === 1 ? 'vez' : 'vezes'}, a primeira em ${formatDateTime(proposal.firstViewedAt as string)}`
                    : ''}
                  {proposal.acceptedAt
                    ? ` · aceita por ${proposal.acceptedByName} em ${formatDateTime(proposal.acceptedAt)}`
                    : ''}
                </p>
                <div className="flex flex-wrap gap-2">
                  {proposal.pdfDocumentId ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={download.isPending}
                      onClick={() => download.mutate(proposal)}
                    >
                      <Download /> PDF
                    </Button>
                  ) : null}
                  <Can permission="crm.proposal.write">
                    {sendable ? (
                      <Button
                        size="sm"
                        disabled={send.isPending}
                        onClick={() => send.mutate(proposal)}
                      >
                        <Send /> {proposal.status === 'GENERATED' ? 'Enviar' : 'Reenviar'}
                      </Button>
                    ) : null}
                  </Can>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <CreateProposalDialog
        opportunityId={opportunityId}
        quotes={quotes.data}
        open={creating}
        onOpenChange={setCreating}
      />
      <LinkDialog url={link} onClose={() => setLink(null)} />
    </div>
  );
}
