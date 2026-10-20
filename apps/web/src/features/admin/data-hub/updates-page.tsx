import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CloudDownload } from 'lucide-react';
import { useState } from 'react';
import type { UpdateProposalDto, UpdateProposalStatus } from '@voltex/shared';
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
  Spinner,
  toast,
} from '@voltex/ui';
import { Can } from '@/app/guards';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api/errors';
import { formatDate, formatNumber } from '@/lib/format';
import { queryKeys } from '../query-keys';

const TYPE_LABELS: Record<UpdateProposalDto['type'], string> = {
  TARIFF: 'Tarifa',
  WATCH_CHANGE: 'Fonte mudou',
  CATALOG_ITEM: 'Equipamento',
  SOLAR_RESOURCE: 'Irradiação',
  RULE_REVIEW: 'Revisão de regra',
};

const STATUS_LABELS: Record<UpdateProposalStatus, string> = {
  PENDING: 'Aguardando decisão',
  APPROVED: 'Aprovada',
  DISCARDED: 'Descartada',
};

const STATUS_BADGE = { PENDING: 'yellow', APPROVED: 'green', DISCARDED: 'outline' } as const;

function Detail({ proposal }: { proposal: UpdateProposalDto }) {
  if (proposal.type === 'WATCH_CHANGE') {
    const diff = proposal.diff as {
      added: string[];
      removed: string[];
      addedCount: number;
      removedCount: number;
    } | null;
    if (!diff) return null;
    return (
      <div className="grid gap-3 text-sm md:grid-cols-2">
        <div>
          <h4 className="mb-1 font-medium text-success">Entrou ({diff.addedCount})</h4>
          <ul className="space-y-1">
            {diff.added.slice(0, 8).map((line, i) => (
              <li key={i} className="rounded bg-muted px-2 py-1">
                {line}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h4 className="mb-1 font-medium text-destructive">Saiu ({diff.removedCount})</h4>
          <ul className="space-y-1">
            {diff.removed.slice(0, 8).map((line, i) => (
              <li key={i} className="rounded bg-muted px-2 py-1 line-through">
                {line}
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }
  if (proposal.type === 'SOLAR_RESOURCE') {
    const proposed = proposal.proposed as {
      hspMonthly: number[];
      temperatures?: { note?: string };
    };
    const previous = (proposal.diff as { previousHspMonthly?: number[] } | null)
      ?.previousHspMonthly;
    const avg = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
    return (
      <div className="space-y-1 text-sm">
        <p>
          HSP mensal (kWh/m²·dia):{' '}
          <span className="tabular-nums">
            {proposed.hspMonthly.map((v) => formatNumber(v, 2)).join(' · ')}
          </span>
        </p>
        <p className="text-muted-foreground">
          {previous
            ? `Já existe este local, com média de ${formatNumber(avg(previous), 2)}: aprovar atualiza os valores.`
            : 'Local novo: aprovar cria o registro.'}{' '}
          {proposed.temperatures?.note}
        </p>
      </div>
    );
  }
  if (proposal.type === 'TARIFF') {
    const proposed = proposal.proposed as { energyCentsPerKwh: number; validFrom: string };
    const previous = (proposal.diff as { previousEnergyCentsPerKwh?: number } | null)
      ?.previousEnergyCentsPerKwh;
    return (
      <p className="text-sm">
        Nova tarifa: <strong>{formatNumber(proposed.energyCentsPerKwh, 3)} ¢/kWh</strong> (sem
        impostos) desde {formatDate(proposed.validFrom)}.{' '}
        {previous !== undefined ? (
          <span className="text-muted-foreground">Hoje: {formatNumber(previous, 3)} ¢/kWh.</span>
        ) : (
          <span className="text-muted-foreground">Ainda não existe tarifa para esta vigência.</span>
        )}
      </p>
    );
  }
  return null;
}

function DecisionDialog({
  proposal,
  onClose,
}: {
  proposal: UpdateProposalDto | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const decide = useMutation({
    mutationFn: (decision: 'APPROVE' | 'DISCARD') =>
      endpoints.dataHub.updates.decide(proposal?.id as string, {
        decision,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      }),
    onSuccess: async (_data, decision) => {
      toast.success(decision === 'APPROVE' ? 'Proposta aprovada' : 'Proposta descartada');
      setReason('');
      onClose();
      await queryClient.invalidateQueries({ queryKey: queryKeys.updateProposals() });
      if (proposal?.type === 'TARIFF')
        await queryClient.invalidateQueries({ queryKey: queryKeys.tariffs() });
      if (proposal?.type === 'SOLAR_RESOURCE')
        await queryClient.invalidateQueries({ queryKey: queryKeys.solarResources() });
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível registrar a decisão.')),
  });

  return (
    <Dialog open={proposal !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{proposal?.title}</DialogTitle>
          <DialogDescription>
            {proposal?.type === 'TARIFF'
              ? 'Aprovar cria ou atualiza a tarifa da concessionária, com a fonte registrada.'
              : proposal?.type === 'SOLAR_RESOURCE'
                ? 'Aprovar cria ou atualiza o local na lista de irradiação, com a fonte e as temperaturas informativas.'
                : 'Aprovar registra que você revisou a mudança. Nenhuma regra é alterada automaticamente: crie a nova versão da regra, se for o caso.'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="decision-reason">Motivo (obrigatório para descartar)</Label>
          <Input
            id="decision-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ex.: aguardando a resolução oficial"
          />
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={decide.isPending || reason.trim().length < 3}
            onClick={() => decide.mutate('DISCARD')}
          >
            Descartar
          </Button>
          <Button disabled={decide.isPending} onClick={() => decide.mutate('APPROVE')}>
            {decide.isPending ? <Spinner /> : null}
            Aprovar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function UpdatesPage() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<UpdateProposalStatus | ''>('PENDING');
  const [deciding, setDeciding] = useState<UpdateProposalDto | null>(null);
  const filters = status ? { status } : {};
  const updates = useQuery({
    queryKey: queryKeys.updateProposals(filters),
    queryFn: () => endpoints.dataHub.updates.list(filters),
  });
  const scan = useMutation({
    mutationFn: endpoints.dataHub.scanTariffs,
    onSuccess: async (result) => {
      toast.success(
        result.proposed > 0
          ? `${result.proposed} tarifa(s) nova(s) para revisar.`
          : 'Nenhuma tarifa nova ou alterada.',
      );
      await queryClient.invalidateQueries({ queryKey: queryKeys.updateProposals() });
    },
    onError: (error) =>
      toast.error(errorMessage(error, 'Não foi possível buscar as tarifas agora.')),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1.5">
          <CardTitle>Atualizações</CardTitle>
          <CardDescription>
            Dados que vieram de fora (tarifas da ANEEL, mudanças em normas vigiadas) esperam a sua
            decisão aqui. Cada proposta mostra de onde veio, quando e o que mudou.
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <NativeSelect
            aria-label="Filtrar por situação"
            value={status}
            onChange={(e) => setStatus(e.target.value as UpdateProposalStatus | '')}
          >
            <option value="PENDING">Aguardando decisão</option>
            <option value="">Todas</option>
            <option value="APPROVED">Aprovadas</option>
            <option value="DISCARDED">Descartadas</option>
          </NativeSelect>
          <Can permission="platform.rule.manage">
            <Button
              size="sm"
              variant="outline"
              disabled={scan.isPending}
              onClick={() => scan.mutate()}
            >
              {scan.isPending ? <Spinner /> : <CloudDownload />} Buscar tarifas novas
            </Button>
          </Can>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {updates.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : updates.isError ? (
          <p className="text-sm text-destructive">Não foi possível carregar as atualizações.</p>
        ) : updates.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma atualização por aqui.</p>
        ) : (
          updates.data.map((proposal) => (
            <article key={proposal.id} className="space-y-3 rounded-lg border p-4">
              <header className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="font-medium">{proposal.title}</h3>
                  <p className="text-xs text-muted-foreground">
                    Origem: {proposal.origin.source}
                    {proposal.origin.url ? ` · ${proposal.origin.url}` : ''} · coletado em{' '}
                    {formatDate(proposal.origin.collectedAt)}
                    {proposal.origin.license ? ` · ${proposal.origin.license}` : ''}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Badge variant="secondary">{TYPE_LABELS[proposal.type]}</Badge>
                  <Badge variant={STATUS_BADGE[proposal.status]}>
                    {STATUS_LABELS[proposal.status]}
                  </Badge>
                </div>
              </header>
              <Detail proposal={proposal} />
              {proposal.status === 'PENDING' ? (
                <Can permission="platform.rule.manage">
                  <Button size="sm" onClick={() => setDeciding(proposal)}>
                    Decidir
                  </Button>
                </Can>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Decidida em {proposal.decidedAt ? formatDate(proposal.decidedAt) : '—'}
                  {proposal.decisionReason ? ` · ${proposal.decisionReason}` : ''}
                </p>
              )}
            </article>
          ))
        )}
      </CardContent>
      <DecisionDialog proposal={deciding} onClose={() => setDeciding(null)} />
    </Card>
  );
}
