import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { COMMISSION_BASES, type CommissionBase } from '@voltex/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
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
import { errorMessage } from '@/lib/api/errors';
import { formatCents } from '@/lib/format';
import { ROLE_LABELS } from '@/i18n/labels';

const BASE_LABEL: Record<CommissionBase, string> = {
  RECEIVED: 'Valor recebido',
  SIGNED: 'Valor do contrato assinado',
};
const COMMISSION_ROLES = [
  'SALESPERSON',
  'SALES_MANAGER',
  'SDR',
  'ENGINEERING',
  'OPERATIONS',
] as const;

const formatDay = (iso: string): string => {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};

function PolicyCard() {
  const queryClient = useQueryClient();
  const policies = useQuery({
    queryKey: ['finance', 'policies'],
    queryFn: endpoints.finance.policies,
  });
  const [base, setBase] = useState<CommissionBase>('RECEIVED');
  const [validFrom, setValidFrom] = useState(new Date().toISOString().slice(0, 10));
  const [weights, setWeights] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () =>
      endpoints.finance.createPolicy({
        base,
        validFrom,
        weights: Object.fromEntries(
          Object.entries(weights)
            .filter(([, v]) => v.trim() !== '')
            .map(([k, v]) => [k, Number(v.replace(',', '.'))]),
        ),
      }),
    onSuccess: async () => {
      toast.success('Política de comissão publicada.');
      setWeights({});
      await queryClient.invalidateQueries({ queryKey: ['finance', 'policies'] });
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível publicar a política.')),
  });
  const current = policies.data?.find((p) => p.validTo === null);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Política de comissão</CardTitle>
        <CardDescription>
          Definida pela empresa: o sistema não traz percentual padrão. Sem política, nenhuma
          comissão é calculada.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {policies.isPending ? <Skeleton className="h-12 w-full" /> : null}
        {current ? (
          <p className="text-sm">
            Vigente desde {formatDay(current.validFrom)}:{' '}
            <strong>{BASE_LABEL[current.base]}</strong>
            {' · '}
            {Object.entries(current.weights)
              .map(([k, v]) => `${ROLE_LABELS[k as keyof typeof ROLE_LABELS] ?? k} ${v}%`)
              .join(', ') || 'sem percentuais'}
          </p>
        ) : policies.data ? (
          <p className="text-sm text-muted-foreground">Nenhuma política cadastrada.</p>
        ) : null}
        <Can permission="crm.finance.write">
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate();
            }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor="pol-base">Base de cálculo</Label>
              <NativeSelect
                id="pol-base"
                value={base}
                onChange={(e) => setBase(e.target.value as CommissionBase)}
              >
                {COMMISSION_BASES.map((b) => (
                  <option key={b} value={b}>
                    {BASE_LABEL[b]}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pol-from">Vale a partir de</Label>
              <Input
                id="pol-from"
                type="date"
                value={validFrom}
                onChange={(e) => setValidFrom(e.target.value)}
              />
            </div>
            {COMMISSION_ROLES.map((role) => (
              <div key={role} className="grid gap-1.5">
                <Label htmlFor={`pol-${role}`}>{ROLE_LABELS[role]} (%)</Label>
                <Input
                  id={`pol-${role}`}
                  inputMode="decimal"
                  value={weights[role] ?? ''}
                  onChange={(e) => setWeights({ ...weights, [role]: e.target.value })}
                />
              </div>
            ))}
            <div className="sm:col-span-2">
              <Button
                type="submit"
                disabled={save.isPending || Object.values(weights).every((v) => !v.trim())}
              >
                Publicar nova política
              </Button>
            </div>
          </form>
        </Can>
      </CardContent>
    </Card>
  );
}

/** Financeiro da empresa: a receber, vencido, recebido no mês, comissões pendentes e a política de comissão. */
export function FinancePage() {
  const overview = useQuery({
    queryKey: ['finance', 'overview'],
    queryFn: endpoints.finance.overview,
  });
  const data = overview.data;
  const cards = data
    ? [
        { label: 'A receber', value: formatCents(data.totalOpenCents) },
        { label: 'Vencido', value: formatCents(data.totalOverdueCents) },
        { label: 'Recebido (30 dias)', value: formatCents(data.receivedLast30DaysCents) },
        { label: 'Comissões a pagar', value: formatCents(data.commissionsPendingCents) },
      ]
    : [];
  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-2xl font-semibold tracking-tight">Financeiro</h2>
        <p className="text-muted-foreground">
          Parcelas, inadimplência e comissões. Tudo é registro manual, sem gateway de pagamento.
        </p>
      </header>
      {overview.isPending ? <Skeleton className="h-28 w-full" /> : null}
      {overview.isError ? (
        <p className="text-sm text-destructive">Não foi possível carregar o financeiro.</p>
      ) : null}
      {data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {cards.map((c) => (
              <Card key={c.label}>
                <CardHeader className="pb-2">
                  <CardDescription>{c.label}</CardDescription>
                  <CardTitle className="text-xl">{c.value}</CardTitle>
                </CardHeader>
              </Card>
            ))}
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Parcelas vencidas</CardTitle>
              <CardDescription>
                A cobrança ao cliente é sempre disparada por você (e-mail ou link do WhatsApp),
                nunca automática.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {data.overdue.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma parcela vencida.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Projeto</TableHead>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Parcela</TableHead>
                      <TableHead>Venceu em</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.overdue.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>
                          <Link
                            className="font-mono hover:underline"
                            to={`/crm/projetos/${r.projectId}`}
                          >
                            {r.projectCode}
                          </Link>
                        </TableCell>
                        <TableCell>{r.accountName ?? '—'}</TableCell>
                        <TableCell>
                          {r.order} · {r.referenceId}
                        </TableCell>
                        <TableCell>
                          {formatDay(r.dueOn)} <Badge variant="red">{r.daysOverdue} dia(s)</Badge>
                        </TableCell>
                        <TableCell className="text-right">{formatCents(r.amountCents)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
      <PolicyCard />
    </div>
  );
}
