import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { TICKET_PRIORITIES, type OperationsSettingsInput } from '@voltex/shared';
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
  Skeleton,
  toast,
} from '@voltex/ui';
import { Can } from '@/app/guards';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api/errors';
import { formatCents } from '@/lib/format';
import { queryKeys } from '../admin/query-keys';
import { TICKET_PRIORITY_LABELS, daysLeftLabel, formatDay } from './aftersales-labels';

const toNumber = (v: string): number | null => {
  const t = v.trim().replace(',', '.');
  return t === '' ? null : Number(t);
};

type Draft = Record<string, string>;

/**
 * Prazos e gatilhos do pós-venda. Cada campo em branco desliga o recurso correspondente: o sistema não usa
 * nenhum prazo que a empresa não tenha escolhido.
 */
function SettingsCard() {
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: queryKeys.aftersalesSettings,
    queryFn: endpoints.operations.aftersales.settings,
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  const current: Draft = draft ?? {
    warrantyAlertDays: String(settings.data?.warrantyAlertDays ?? ''),
    renewalNoticeDays: String(settings.data?.renewalNoticeDays ?? ''),
    maintenanceLeadDays: String(settings.data?.maintenanceLeadDays ?? ''),
    upsellGridKwh: String(settings.data?.upsellGridKwh ?? ''),
    upsellMinBills: String(settings.data?.upsellMinBills ?? ''),
    ...Object.fromEntries(
      TICKET_PRIORITIES.map((p) => [`sla.${p}`, String(settings.data?.slaHours[p] ?? '')]),
    ),
  };
  const set = (key: string, value: string) => setDraft({ ...current, [key]: value });
  const save = useMutation({
    mutationFn: () => {
      const input: OperationsSettingsInput = {
        warrantyAlertDays: toNumber(current.warrantyAlertDays ?? ''),
        renewalNoticeDays: toNumber(current.renewalNoticeDays ?? ''),
        maintenanceLeadDays: toNumber(current.maintenanceLeadDays ?? ''),
        upsellGridKwh: toNumber(current.upsellGridKwh ?? ''),
        upsellMinBills: toNumber(current.upsellMinBills ?? ''),
        slaHours: Object.fromEntries(
          TICKET_PRIORITIES.map((p) => [p, toNumber(current[`sla.${p}`] ?? '')]),
        ),
      };
      return endpoints.operations.aftersales.updateSettings(input);
    },
    onSuccess: async () => {
      toast.success('Configurações salvas.');
      setDraft(null);
      await queryClient.invalidateQueries({ queryKey: ['operations'] });
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível salvar.')),
  });
  const scan = useMutation({
    mutationFn: endpoints.operations.aftersales.scan,
    onSuccess: async () => {
      toast.success('Rotina executada.');
      await queryClient.invalidateQueries({ queryKey: ['operations'] });
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível executar a rotina.')),
  });
  const field = (key: string, label: string, hint?: string) => (
    <div className="grid gap-1.5">
      <Label htmlFor={`cfg-${key}`}>{label}</Label>
      <Input
        id={`cfg-${key}`}
        inputMode="decimal"
        placeholder="Desligado"
        value={current[key] ?? ''}
        onChange={(e) => set(key, e.target.value)}
      />
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Prazos e gatilhos da empresa</CardTitle>
        <CardDescription>
          Deixe em branco para desligar. O sistema não presume prazo nenhum.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {settings.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              {field('warrantyAlertDays', 'Avisar garantias (dias antes)')}
              {field('renewalNoticeDays', 'Avisar renovação de O&M (dias antes)')}
              {field('maintenanceLeadDays', 'Abrir manutenção preventiva (dias antes)')}
              {field(
                'upsellGridKwh',
                'Gatilho de expansão (kWh/mês)',
                'Consumo médio da rede acima disso',
              )}
              {field('upsellMinBills', 'Faturas na média (1 a 12)')}
            </div>
            <fieldset className="grid gap-3 sm:grid-cols-4">
              <legend className="mb-1 text-sm font-medium">Prazo de atendimento (horas)</legend>
              {TICKET_PRIORITIES.map((p) => field(`sla.${p}`, TICKET_PRIORITY_LABELS[p]))}
            </fieldset>
            <Can permission="ops.om.manage">
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
                  Salvar
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={scan.isPending}
                  onClick={() => scan.mutate()}
                >
                  Executar a rotina agora
                </Button>
              </div>
            </Can>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Contratos de O&M (valores informados à mão) e configuração do pós-venda. */
export function ContractsPage() {
  const contracts = useQuery({
    queryKey: queryKeys.omContracts,
    queryFn: () => endpoints.operations.aftersales.contracts.list(),
  });
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Contratos de O&M</CardTitle>
          <CardDescription>
            Cadastrados na ficha de cada planta. Nenhuma cobrança é feita pelo sistema.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {contracts.isPending ? (
            <Skeleton className="h-16 w-full" />
          ) : (contracts.data?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum contrato cadastrado.</p>
          ) : (
            <ul className="divide-y" aria-label="Contratos de O&M">
              {contracts.data?.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <div>
                    <Link
                      to={`/operations/plantas/${c.plantId}`}
                      className="font-medium text-primary underline-offset-2 hover:underline"
                    >
                      {c.plantName}
                    </Link>
                    <div className="text-sm text-muted-foreground">
                      {c.title} · {formatDay(c.startsOn)} a {formatDay(c.endsOn)}
                      {c.status === 'ACTIVE' ? ` (${daysLeftLabel(c.daysLeft)})` : ''} ·{' '}
                      {formatCents(c.monthlyCents)}/mês
                    </div>
                  </div>
                  <Badge variant={c.status === 'ACTIVE' ? 'green' : 'outline'}>
                    {c.status === 'ACTIVE'
                      ? 'Ativo'
                      : c.status === 'EXPIRED'
                        ? 'Vencido'
                        : 'Cancelado'}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <SettingsCard />
    </div>
  );
}
