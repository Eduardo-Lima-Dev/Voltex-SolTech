import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import {
  COST_CATEGORIES,
  type CommissionDto,
  type CostCategory,
  type CreditApplicationDto,
  type CreditStatus,
  type ProjectCostEntryDto,
  type ProjectFinancialSummaryDto,
  type ReceivableDto,
  type ReceivableStatus,
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
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from '@voltex/ui';
import { Can } from '@/app/guards';
import { SendMessage } from '@/components/send-message';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api/errors';
import { formatCents } from '@/lib/format';
import { parseMoney } from '../opportunities/quote-form';

const RECEIVABLE_LABEL: Record<ReceivableStatus, string> = {
  OPEN: 'A receber',
  PAID: 'Recebida',
  OVERDUE: 'Vencida',
  CANCELLED: 'Cancelada',
};
const RECEIVABLE_BADGE: Record<ReceivableStatus, 'secondary' | 'green' | 'red' | 'outline'> = {
  OPEN: 'secondary',
  PAID: 'green',
  OVERDUE: 'red',
  CANCELLED: 'outline',
};
const COST_LABEL: Record<CostCategory, string> = {
  MATERIAL: 'Material',
  LABOR: 'Mão de obra',
  TRANSPORT: 'Transporte',
  TAXES: 'Impostos',
  OTHER: 'Outros',
};
const CREDIT_LABEL: Record<CreditStatus, string> = {
  SIMULATED: 'Simulado',
  SENT: 'Enviado',
  PENDING: 'Com pendências',
  APPROVED: 'Aprovado',
  REJECTED: 'Recusado',
};
const CREDIT_NEXT: Record<
  CreditStatus,
  { to: 'SENT' | 'PENDING' | 'APPROVED' | 'REJECTED'; label: string }[]
> = {
  SIMULATED: [{ to: 'SENT', label: 'Marcar como enviado' }],
  SENT: [
    { to: 'PENDING', label: 'Pediu pendências' },
    { to: 'APPROVED', label: 'Aprovado' },
    { to: 'REJECTED', label: 'Recusado' },
  ],
  PENDING: [
    { to: 'SENT', label: 'Reenviado' },
    { to: 'APPROVED', label: 'Aprovado' },
    { to: 'REJECTED', label: 'Recusado' },
  ],
  APPROVED: [],
  REJECTED: [],
};

const formatDay = (iso: string): string => {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};
const todayIso = (): string => new Date().toISOString().slice(0, 10);

function useFinanceMutation<T>(
  projectId: string,
  fn: () => Promise<T>,
  success: string,
  onDone: () => void,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      toast.success(success);
      await queryClient.invalidateQueries({ queryKey: ['project-finance', projectId] });
      onDone();
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível salvar.')),
  });
}

function FormDialog({
  title,
  description,
  onClose,
  onSubmit,
  pending,
  submitLabel,
  children,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  onSubmit: () => void;
  pending: boolean;
  submitLabel: string;
  children: ReactNode;
}) {
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          {children}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Labeled({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

function AddReceivableDialog({
  projectId,
  nextOrder,
  onClose,
}: {
  projectId: string;
  nextOrder: number;
  onClose: () => void;
}) {
  const [referenceId, setReferenceId] = useState('');
  const [order, setOrder] = useState(String(nextOrder));
  const [amount, setAmount] = useState('');
  const [dueOn, setDueOn] = useState('');
  const cents = parseMoney(amount);
  const save = useFinanceMutation(
    projectId,
    () =>
      endpoints.finance.createReceivable(projectId, {
        referenceId,
        order: Number(order),
        amountCents: cents ?? 0,
        dueOn,
      }),
    'Parcela lançada.',
    onClose,
  );
  const valid = referenceId.trim() && Number(order) > 0 && cents && cents > 0 && dueOn;
  return (
    <FormDialog
      title="Nova parcela"
      description="Valor a receber do cliente. O pagamento é conferido e baixado por você."
      onClose={onClose}
      onSubmit={() => save.mutate()}
      pending={save.isPending || !valid}
      submitLabel="Lançar parcela"
    >
      <Labeled id="rec-ref" label="Referência (nota, pedido ou contrato)">
        <Input id="rec-ref" value={referenceId} onChange={(e) => setReferenceId(e.target.value)} />
      </Labeled>
      <div className="grid grid-cols-2 gap-3">
        <Labeled id="rec-order" label="Parcela nº">
          <Input
            id="rec-order"
            inputMode="numeric"
            value={order}
            onChange={(e) => setOrder(e.target.value)}
          />
        </Labeled>
        <Labeled id="rec-due" label="Vencimento">
          <Input
            id="rec-due"
            type="date"
            value={dueOn}
            onChange={(e) => setDueOn(e.target.value)}
          />
        </Labeled>
      </div>
      <Labeled id="rec-amount" label="Valor (R$)">
        <Input
          id="rec-amount"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </Labeled>
    </FormDialog>
  );
}

function PayDialog({
  projectId,
  receivable,
  onClose,
}: {
  projectId: string;
  receivable: ReceivableDto;
  onClose: () => void;
}) {
  const [method, setMethod] = useState('PIX');
  const [paidOn, setPaidOn] = useState(todayIso());
  const save = useFinanceMutation(
    projectId,
    () =>
      endpoints.finance.payReceivable(projectId, receivable.id, { paymentMethod: method, paidOn }),
    'Recebimento registrado.',
    onClose,
  );
  return (
    <FormDialog
      title={`Baixar parcela ${receivable.order}`}
      description={`${formatCents(receivable.amountCents)} · vence em ${formatDay(receivable.dueOn)}`}
      onClose={onClose}
      onSubmit={() => save.mutate()}
      pending={save.isPending || !method.trim()}
      submitLabel="Confirmar recebimento"
    >
      <Labeled id="pay-method" label="Forma de pagamento">
        <Input id="pay-method" value={method} onChange={(e) => setMethod(e.target.value)} />
      </Labeled>
      <Labeled id="pay-date" label="Data do recebimento">
        <Input
          id="pay-date"
          type="date"
          value={paidOn}
          onChange={(e) => setPaidOn(e.target.value)}
        />
      </Labeled>
    </FormDialog>
  );
}

function CancelDialog({
  projectId,
  receivable,
  onClose,
}: {
  projectId: string;
  receivable: ReceivableDto;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const save = useFinanceMutation(
    projectId,
    () => endpoints.finance.cancelReceivable(projectId, receivable.id, { reason }),
    'Parcela cancelada.',
    onClose,
  );
  return (
    <FormDialog
      title={`Cancelar parcela ${receivable.order}`}
      onClose={onClose}
      onSubmit={() => save.mutate()}
      pending={save.isPending || reason.trim().length < 3}
      submitLabel="Cancelar parcela"
    >
      <Labeled id="cancel-reason" label="Motivo">
        <Input id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Labeled>
    </FormDialog>
  );
}

function AddCostDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [category, setCategory] = useState<CostCategory>('MATERIAL');
  const [description, setDescription] = useState('');
  const [actual, setActual] = useState('');
  const [estimated, setEstimated] = useState('');
  const [supplier, setSupplier] = useState('');
  const actualCents = parseMoney(actual);
  const estimatedCents = estimated.trim() ? parseMoney(estimated) : null;
  const save = useFinanceMutation(
    projectId,
    () =>
      endpoints.finance.addCost(projectId, {
        category,
        description,
        actualCents: actualCents ?? 0,
        ...(estimatedCents ? { estimatedCents } : {}),
        ...(supplier.trim() ? { supplier: supplier.trim() } : {}),
      }),
    'Custo lançado.',
    onClose,
  );
  return (
    <FormDialog
      title="Novo custo"
      description="Custo real do projeto, conforme nota ou recibo."
      onClose={onClose}
      onSubmit={() => save.mutate()}
      pending={
        save.isPending ||
        !description.trim() ||
        actualCents === null ||
        (estimatedCents === null && estimated.trim() !== '')
      }
      submitLabel="Lançar custo"
    >
      <Labeled id="cost-cat" label="Categoria">
        <NativeSelect
          id="cost-cat"
          value={category}
          onChange={(e) => setCategory(e.target.value as CostCategory)}
        >
          {COST_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {COST_LABEL[c]}
            </option>
          ))}
        </NativeSelect>
      </Labeled>
      <Labeled id="cost-desc" label="Descrição">
        <Input
          id="cost-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Labeled>
      <div className="grid grid-cols-2 gap-3">
        <Labeled id="cost-actual" label="Valor real (R$)">
          <Input
            id="cost-actual"
            inputMode="decimal"
            value={actual}
            onChange={(e) => setActual(e.target.value)}
          />
        </Labeled>
        <Labeled id="cost-est" label="Previsto na cotação (R$)">
          <Input
            id="cost-est"
            inputMode="decimal"
            value={estimated}
            onChange={(e) => setEstimated(e.target.value)}
          />
        </Labeled>
      </div>
      <Labeled id="cost-sup" label="Fornecedor (opcional)">
        <Input id="cost-sup" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
      </Labeled>
    </FormDialog>
  );
}

function AddCreditDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [institution, setInstitution] = useState('');
  const [amount, setAmount] = useState('');
  const [rate, setRate] = useState('');
  const [term, setTerm] = useState('');
  const amountCents = parseMoney(amount);
  const rateNumber = rate.trim() ? Number(rate.replace(',', '.')) : undefined;
  const termNumber = term.trim() ? Number(term) : undefined;
  const save = useFinanceMutation(
    projectId,
    () =>
      endpoints.finance.createCredit(projectId, {
        institution,
        amountCents: amountCents ?? 0,
        ...(rateNumber ? { annualRatePct: rateNumber } : {}),
        ...(termNumber ? { termMonths: termNumber } : {}),
      }),
    'Simulação registrada.',
    onClose,
  );
  return (
    <FormDialog
      title="Simulação de crédito"
      description="Só registro do que foi simulado e respondido: a análise é feita pela instituição."
      onClose={onClose}
      onSubmit={() => save.mutate()}
      pending={save.isPending || !institution.trim() || !amountCents}
      submitLabel="Registrar"
    >
      <Labeled id="cr-inst" label="Instituição">
        <Input id="cr-inst" value={institution} onChange={(e) => setInstitution(e.target.value)} />
      </Labeled>
      <Labeled id="cr-amount" label="Valor financiado (R$)">
        <Input
          id="cr-amount"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </Labeled>
      <div className="grid grid-cols-2 gap-3">
        <Labeled id="cr-rate" label="Taxa anual (%)">
          <Input
            id="cr-rate"
            inputMode="decimal"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
          />
        </Labeled>
        <Labeled id="cr-term" label="Prazo (meses)">
          <Input
            id="cr-term"
            inputMode="numeric"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
        </Labeled>
      </div>
    </FormDialog>
  );
}

function CreditStatusDialog({
  projectId,
  credit,
  to,
  onClose,
}: {
  projectId: string;
  credit: CreditApplicationDto;
  to: 'SENT' | 'PENDING' | 'APPROVED' | 'REJECTED';
  onClose: () => void;
}) {
  const [pendencies, setPendencies] = useState(credit.pendencies.join('\n'));
  const save = useFinanceMutation(
    projectId,
    () =>
      endpoints.finance.creditStatus(projectId, credit.id, {
        status: to,
        ...(to === 'PENDING'
          ? {
              pendencies: pendencies
                .split('\n')
                .map((p) => p.trim())
                .filter(Boolean),
            }
          : {}),
      }),
    'Crédito atualizado.',
    onClose,
  );
  return (
    <FormDialog
      title={`Crédito ${credit.institution}: ${CREDIT_LABEL[to]}`}
      onClose={onClose}
      onSubmit={() => save.mutate()}
      pending={save.isPending}
      submitLabel="Confirmar"
    >
      {to === 'PENDING' ? (
        <Labeled id="cr-pend" label="Pendências (uma por linha)">
          <textarea
            id="cr-pend"
            className="min-h-24 rounded-md border bg-background p-2 text-sm"
            value={pendencies}
            onChange={(e) => setPendencies(e.target.value)}
          />
        </Labeled>
      ) : (
        <p className="text-sm text-muted-foreground">Confirma o registro desta resposta?</p>
      )}
    </FormDialog>
  );
}

function SummaryCards({ summary }: { summary: ProjectFinancialSummaryDto }) {
  const cards = [
    {
      label: 'Contrato',
      value: formatCents(summary.valueCents),
      hint: `${summary.receivablesCount} parcela(s)`,
    },
    {
      label: 'Recebido',
      value: formatCents(summary.totalReceivedCents),
      hint: `${summary.receivablesPaidCount} paga(s) · a receber ${formatCents(summary.totalOpenCents)}`,
    },
    {
      label: 'Custos reais',
      value: formatCents(summary.totalCostsCents),
      hint:
        summary.costDeviationPct === null
          ? 'sem previsão informada'
          : `${summary.costDeviationPct.toFixed(1).replace('.', ',')}% sobre o previsto`,
    },
    {
      label: 'Margem',
      value: formatCents(summary.marginCents),
      hint:
        summary.marginPct === null
          ? 'nada recebido ainda'
          : `${summary.marginPct.toFixed(1).replace('.', ',')}% do recebido (após comissões)`,
    },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((c) => (
        <Card key={c.label}>
          <CardHeader className="pb-2">
            <CardDescription>{c.label}</CardDescription>
            <CardTitle className="text-xl">{c.value}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">{c.hint}</CardContent>
        </Card>
      ))}
    </div>
  );
}

function ReceivablesTab({
  projectId,
  summary,
  accountName,
}: {
  projectId: string;
  summary: ProjectFinancialSummaryDto;
  accountName: string;
}) {
  const [adding, setAdding] = useState(false);
  const [paying, setPaying] = useState<ReceivableDto | null>(null);
  const [cancelling, setCancelling] = useState<ReceivableDto | null>(null);
  const [reminding, setReminding] = useState<ReceivableDto | null>(null);
  const nextOrder = Math.max(0, ...summary.receivables.map((r) => r.order)) + 1;
  return (
    <div className="space-y-3">
      <Can permission="crm.finance.write">
        <Button size="sm" onClick={() => setAdding(true)}>
          <Plus className="size-4" aria-hidden /> Nova parcela
        </Button>
      </Can>
      {summary.receivables.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma parcela lançada.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nº</TableHead>
              <TableHead>Referência</TableHead>
              <TableHead>Vencimento</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {summary.receivables.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{r.order}</TableCell>
                <TableCell>{r.referenceId}</TableCell>
                <TableCell>{formatDay(r.dueOn)}</TableCell>
                <TableCell className="text-right">{formatCents(r.amountCents)}</TableCell>
                <TableCell>
                  <Badge variant={RECEIVABLE_BADGE[r.status]}>{RECEIVABLE_LABEL[r.status]}</Badge>
                  {r.status === 'OVERDUE' ? (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {r.daysOverdue} dia(s)
                    </span>
                  ) : null}
                  {r.status === 'PAID' && r.paidOn ? (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {formatDay(r.paidOn)} · {r.paymentMethod}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="space-x-2 text-right">
                  <Can permission="crm.finance.write">
                    {r.status === 'OPEN' || r.status === 'OVERDUE' ? (
                      <>
                        <Button size="sm" variant="outline" onClick={() => setPaying(r)}>
                          Dar baixa
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setReminding(r)}>
                          Lembrar o cliente
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setCancelling(r)}>
                          Cancelar
                        </Button>
                      </>
                    ) : null}
                  </Can>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {reminding ? (
        <div className="space-y-2 rounded-md border p-3 text-sm">
          <p className="font-medium">
            Lembrete da parcela {reminding.order} ({formatCents(reminding.amountCents)}, vence em{' '}
            {formatDay(reminding.dueOn)})
          </p>
          <p className="text-xs text-muted-foreground">
            O lembrete só sai quando você escolhe um canal: o sistema nunca cobra sozinho.
          </p>
          <SendMessage
            template="payment.reminder"
            variables={{
              nome: accountName,
              valor: formatCents(reminding.amountCents),
              vencimento: formatDay(reminding.dueOn),
            }}
            copyText={`Lembrete: parcela de ${formatCents(reminding.amountCents)} com vencimento em ${formatDay(reminding.dueOn)}.`}
            entityType="Receivable"
            entityId={reminding.id}
          />
          <Button size="sm" variant="ghost" onClick={() => setReminding(null)}>
            Fechar
          </Button>
        </div>
      ) : null}
      {adding ? (
        <AddReceivableDialog
          projectId={projectId}
          nextOrder={nextOrder}
          onClose={() => setAdding(false)}
        />
      ) : null}
      {paying ? (
        <PayDialog projectId={projectId} receivable={paying} onClose={() => setPaying(null)} />
      ) : null}
      {cancelling ? (
        <CancelDialog
          projectId={projectId}
          receivable={cancelling}
          onClose={() => setCancelling(null)}
        />
      ) : null}
    </div>
  );
}

function CostsTab({ projectId, costs }: { projectId: string; costs: ProjectCostEntryDto[] }) {
  const [adding, setAdding] = useState(false);
  const queryClient = useQueryClient();
  const removeCost = useMutation({
    mutationFn: (id: string) => endpoints.finance.removeCost(projectId, id),
    onSuccess: async () => {
      toast.success('Custo removido.');
      await queryClient.invalidateQueries({ queryKey: ['project-finance', projectId] });
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível remover.')),
  });
  return (
    <div className="space-y-3">
      <Can permission="crm.finance.write">
        <Button size="sm" onClick={() => setAdding(true)}>
          <Plus className="size-4" aria-hidden /> Novo custo
        </Button>
      </Can>
      {costs.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum custo lançado.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Categoria</TableHead>
              <TableHead>Descrição</TableHead>
              <TableHead className="text-right">Previsto</TableHead>
              <TableHead className="text-right">Real</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {costs.map((c) => (
              <TableRow key={c.id}>
                <TableCell>{COST_LABEL[c.category]}</TableCell>
                <TableCell>
                  {c.description}
                  {c.supplier ? (
                    <span className="text-xs text-muted-foreground"> · {c.supplier}</span>
                  ) : null}
                </TableCell>
                <TableCell className="text-right">
                  {c.estimatedCents === null ? '—' : formatCents(c.estimatedCents)}
                </TableCell>
                <TableCell className="text-right">{formatCents(c.actualCents)}</TableCell>
                <TableCell className="text-right">
                  <Can permission="crm.finance.write">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={removeCost.isPending}
                      onClick={() => removeCost.mutate(c.id)}
                    >
                      Remover
                    </Button>
                  </Can>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {adding ? <AddCostDialog projectId={projectId} onClose={() => setAdding(false)} /> : null}
    </div>
  );
}

function CreditTab({ projectId, credits }: { projectId: string; credits: CreditApplicationDto[] }) {
  const [adding, setAdding] = useState(false);
  const [changing, setChanging] = useState<{
    credit: CreditApplicationDto;
    to: 'SENT' | 'PENDING' | 'APPROVED' | 'REJECTED';
  } | null>(null);
  return (
    <div className="space-y-3">
      <Can permission="crm.finance.write">
        <Button size="sm" onClick={() => setAdding(true)}>
          <Plus className="size-4" aria-hidden /> Simulação de crédito
        </Button>
      </Can>
      {credits.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma simulação registrada.</p>
      ) : (
        <ul className="space-y-2">
          {credits.map((c) => (
            <li key={c.id} className="rounded-md border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <strong>{c.institution}</strong>
                <Badge
                  variant={
                    c.status === 'APPROVED'
                      ? 'green'
                      : c.status === 'REJECTED'
                        ? 'red'
                        : 'secondary'
                  }
                >
                  {CREDIT_LABEL[c.status]}
                </Badge>
                <span className="text-muted-foreground">
                  {formatCents(c.amountCents)}
                  {c.termMonths ? ` · ${c.termMonths}x` : ''}
                  {c.annualRatePct ? ` · ${String(c.annualRatePct).replace('.', ',')}% a.a.` : ''}
                  {c.totalCents ? ` · total ${formatCents(c.totalCents)}` : ''}
                </span>
              </div>
              {c.pendencies.length > 0 ? (
                <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                  {c.pendencies.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              ) : null}
              <Can permission="crm.finance.write">
                <div className="mt-2 flex flex-wrap gap-2">
                  {CREDIT_NEXT[c.status].map((n) => (
                    <Button
                      key={n.to}
                      size="sm"
                      variant="outline"
                      onClick={() => setChanging({ credit: c, to: n.to })}
                    >
                      {n.label}
                    </Button>
                  ))}
                </div>
              </Can>
            </li>
          ))}
        </ul>
      )}
      {adding ? <AddCreditDialog projectId={projectId} onClose={() => setAdding(false)} /> : null}
      {changing ? (
        <CreditStatusDialog
          projectId={projectId}
          credit={changing.credit}
          to={changing.to}
          onClose={() => setChanging(null)}
        />
      ) : null}
    </div>
  );
}

function CommissionsTab({
  projectId,
  commissions,
}: {
  projectId: string;
  commissions: CommissionDto[];
}) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['project-finance', projectId] });
  const recalc = useMutation({
    mutationFn: () => endpoints.finance.recalculateCommissions(projectId),
    onSuccess: async () => {
      toast.success('Comissões recalculadas.');
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível recalcular.')),
  });
  const pay = useMutation({
    mutationFn: (id: string) => endpoints.finance.payCommission(projectId, id, {}),
    onSuccess: async () => {
      toast.success('Pagamento da comissão registrado.');
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível registrar.')),
  });
  return (
    <div className="space-y-3">
      <Can permission="crm.finance.write">
        <Button
          size="sm"
          variant="outline"
          disabled={recalc.isPending}
          onClick={() => recalc.mutate()}
        >
          Recalcular pela política vigente
        </Button>
      </Can>
      {commissions.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhuma comissão calculada. Sem política de comissão cadastrada pela empresa, nada é
          calculado.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Quem</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {commissions.map((c) => (
              <TableRow key={c.id}>
                <TableCell>{c.userName ?? '—'}</TableCell>
                <TableCell className="text-right">{formatCents(c.amountCents)}</TableCell>
                <TableCell>
                  <Badge variant={c.paidAt ? 'green' : 'secondary'}>
                    {c.paidAt ? 'Paga' : 'A pagar'}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Can permission="crm.finance.write">
                    {c.paidAt ? null : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pay.isPending}
                        onClick={() => pay.mutate(c.id)}
                      >
                        Registrar pagamento
                      </Button>
                    )}
                  </Can>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

/** Financeiro da ficha do projeto (11G): parcelas, custos, crédito e comissões, tudo registrado à mão. */
export function ProjectFinanceSection({
  projectId,
  accountName,
}: {
  projectId: string;
  accountName: string;
}) {
  const summary = useQuery({
    queryKey: ['project-finance', projectId],
    queryFn: () => endpoints.finance.summary(projectId),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Financeiro</CardTitle>
        <CardDescription>
          Registro manual de parcelas, custos, crédito e comissões. Não há integração com banco ou
          gateway.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {summary.isPending ? <Skeleton className="h-40 w-full" /> : null}
        {summary.isError ? (
          <p className="text-sm text-destructive">Não foi possível carregar o financeiro.</p>
        ) : null}
        {summary.data ? (
          <>
            <SummaryCards summary={summary.data} />
            {summary.data.overdueCount > 0 ? (
              <p role="alert" className="text-sm text-destructive">
                {summary.data.overdueCount} parcela(s) vencida(s), somando{' '}
                {formatCents(summary.data.totalOverdueCents)}.
              </p>
            ) : null}
            <Tabs defaultValue="parcelas">
              <TabsList>
                <TabsTrigger value="parcelas">Parcelas</TabsTrigger>
                <TabsTrigger value="custos">Custos</TabsTrigger>
                <TabsTrigger value="credito">Crédito</TabsTrigger>
                <TabsTrigger value="comissoes">Comissões</TabsTrigger>
              </TabsList>
              <TabsContent value="parcelas">
                <ReceivablesTab
                  projectId={projectId}
                  summary={summary.data}
                  accountName={accountName}
                />
              </TabsContent>
              <TabsContent value="custos">
                <CostsTab projectId={projectId} costs={summary.data.costEntries} />
              </TabsContent>
              <TabsContent value="credito">
                <CreditTab projectId={projectId} credits={summary.data.creditApplications} />
              </TabsContent>
              <TabsContent value="comissoes">
                <CommissionsTab projectId={projectId} commissions={summary.data.commissions} />
              </TabsContent>
            </Tabs>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
