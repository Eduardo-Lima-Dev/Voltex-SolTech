import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import type {
  MonitoringDailyDto,
  MonitoringMonthDto,
  PlantMonitoringPageDto,
} from '@voltex/shared';
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
import { formatKwh } from '@/lib/format';

const STATUS_LABEL = {
  ONLINE: 'Online',
  OFFLINE: 'Sem comunicação',
  ALARM: 'Com alarme',
  UNKNOWN: 'Sem informação',
};
const MONTH_NAMES = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
];

const monthLabel = (key: string): string =>
  `${MONTH_NAMES[Number(key.slice(5, 7)) - 1]}/${key.slice(2, 4)}`;
const percent = (value: number | null): string =>
  value === null ? '—' : `${Math.round(value * 100).toLocaleString('pt-BR')}%`;

/** Barras da geração diária (kWh) dos últimos dias, com a linha da esperada do mês quando existe. */
export function DailyChart({
  daily,
  months,
}: {
  daily: MonitoringDailyDto[];
  months: MonitoringMonthDto[];
}) {
  if (daily.length === 0) return null;
  const expectedOf = (date: string): number | null => {
    const m = months.find((x) => x.month === date.slice(0, 7));
    return m && m.expectedKwh ? m.expectedKwh / m.daysInMonth : null;
  };
  const max = Math.max(...daily.map((d) => d.kwh), ...daily.map((d) => expectedOf(d.date) ?? 0), 1);
  const W = 600;
  const H = 140;
  const barW = Math.min(14, (W - 10) / daily.length - 2);
  const step = (W - 10) / daily.length;
  return (
    <svg
      role="img"
      aria-label={`Geração diária dos últimos ${daily.length} dias com leitura, de ${daily[0]?.date} a ${daily.at(-1)?.date}`}
      viewBox={`0 0 ${W} ${H + 18}`}
      className="h-auto w-full rounded border bg-card"
    >
      {daily.map((d, i) => {
        const h = (d.kwh / max) * H;
        const exp = expectedOf(d.date);
        return (
          <g key={d.date}>
            <rect
              x={5 + i * step}
              y={H - h}
              width={Math.max(2, barW)}
              height={h}
              className={d.source === 'CSV' ? 'fill-muted-foreground/60' : 'fill-primary/80'}
            >
              <title>{`${d.date}: ${d.kwh.toLocaleString('pt-BR')} kWh (${d.source === 'CSV' ? 'planilha' : d.source})`}</title>
            </rect>
            {exp !== null ? (
              <rect
                x={5 + i * step}
                y={H - (exp / max) * H}
                width={Math.max(2, barW)}
                height={1.5}
                className="fill-destructive"
              />
            ) : null}
          </g>
        );
      })}
      <text x={5} y={H + 14} className="fill-muted-foreground text-[10px]">
        {daily[0]?.date}
      </text>
      <text x={W - 5} y={H + 14} textAnchor="end" className="fill-muted-foreground text-[10px]">
        {daily.at(-1)?.date}
      </text>
    </svg>
  );
}

function LinkManager({ plantId, page }: { plantId: string; page: PlantMonitoringPageDto }) {
  const queryClient = useQueryClient();
  const [connectionId, setConnectionId] = useState('');
  const [externalId, setExternalId] = useState('');
  const connections = useQuery({
    queryKey: ['operations', 'plant', plantId, 'monitoring-connections'],
    queryFn: () => endpoints.operations.aftersales.monitoring.connections(plantId),
  });
  const selected = connections.data?.find((c) => c.id === connectionId);
  const external = useQuery({
    queryKey: ['operations', 'plant', plantId, 'external-plants', connectionId],
    queryFn: () => endpoints.operations.aftersales.monitoring.externalPlants(plantId, connectionId),
    enabled: Boolean(selected?.canListPlants),
    retry: false,
  });
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['operations', 'plant', plantId, 'monitoring'] });
  const link = useMutation({
    mutationFn: () =>
      endpoints.operations.aftersales.monitoring.link(plantId, {
        connectionId,
        externalPlantId: externalId,
      }),
    onSuccess: async () => {
      toast.success('Usina vinculada. A leitura acontece na próxima sincronização.');
      setExternalId('');
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível vincular.')),
  });
  const unlink = useMutation({
    mutationFn: (id: string) => endpoints.operations.aftersales.monitoring.unlink(plantId, id),
    onSuccess: async () => {
      toast.success('Vínculo removido.');
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível remover.')),
  });
  return (
    <div className="space-y-3">
      <h4 className="text-sm font-medium">Provedor do inversor</h4>
      {page.links.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma usina vinculada.</p>
      ) : (
        <ul className="space-y-1 text-sm" aria-label="Vínculos de monitoramento">
          {page.links.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-2">
              <span>
                {l.providerLabel} · usina <span className="font-mono">{l.externalPlantId}</span>
              </span>
              <Can permission="ops.plant.write">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={unlink.isPending}
                  onClick={() => unlink.mutate(l.id)}
                >
                  Desvincular
                </Button>
              </Can>
            </li>
          ))}
        </ul>
      )}
      <Can permission="ops.plant.write">
        <form
          className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            link.mutate();
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="mon-conn">Conexão</Label>
            <NativeSelect
              id="mon-conn"
              value={connectionId}
              onChange={(e) => {
                setConnectionId(e.target.value);
                setExternalId('');
              }}
            >
              <option value="">Escolha a conexão</option>
              {connections.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label} ({c.providerLabel})
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="mon-ext">Usina no provedor</Label>
            {selected?.canListPlants && external.data ? (
              <NativeSelect
                id="mon-ext"
                value={externalId}
                onChange={(e) => setExternalId(e.target.value)}
              >
                <option value="">Escolha a usina</option>
                {external.data.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </NativeSelect>
            ) : (
              <Input
                id="mon-ext"
                value={externalId}
                onChange={(e) => setExternalId(e.target.value)}
                placeholder={
                  external.isError
                    ? 'Não foi possível listar: informe o ID'
                    : 'ID da usina no provedor'
                }
              />
            )}
          </div>
          <Button type="submit" disabled={link.isPending || !connectionId || !externalId.trim()}>
            Vincular
          </Button>
        </form>
        {connections.data?.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nenhuma conexão de monitoramento cadastrada. O administrador cadastra em Administração →
            Integrações.
          </p>
        ) : null}
      </Can>
    </div>
  );
}

function CsvImport({ plantId }: { plantId: string }) {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [rejected, setRejected] = useState<{ line: number; reason: string }[]>([]);
  const send = useMutation({
    mutationFn: async (file: File) =>
      endpoints.operations.aftersales.monitoring.importCsv(plantId, { csv: await file.text() }),
    onSuccess: async (result) => {
      setRejected(result.rejected);
      toast.success(`${result.imported} dia(s) importado(s).`);
      await queryClient.invalidateQueries({
        queryKey: ['operations', 'plant', plantId, 'monitoring'],
      });
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível importar a planilha.')),
  });
  return (
    <Can permission="ops.plant.write">
      <div className="space-y-2">
        <h4 className="text-sm font-medium">Importar planilha de geração</h4>
        <p className="text-xs text-muted-foreground">
          Serve para qualquer marca. Duas colunas: data (AAAA-MM-DD ou DD/MM/AAAA) e geração do dia
          em kWh.
        </p>
        <input
          ref={input}
          type="file"
          accept=".csv,.txt,text/csv,text/plain"
          aria-label="Planilha de geração"
          className="text-sm"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) send.mutate(file);
            e.target.value = '';
          }}
        />
        {rejected.length > 0 ? (
          <ul className="list-disc pl-5 text-xs text-destructive" aria-label="Linhas recusadas">
            {rejected.map((r) => (
              <li key={r.line}>
                Linha {r.line}: {r.reason}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Can>
  );
}

/** Monitoramento da planta (11F): geração real × esperada, vínculo com o provedor e planilha. */
export function PlantMonitoringSection({ plantId }: { plantId: string }) {
  const page = useQuery({
    queryKey: ['operations', 'plant', plantId, 'monitoring'],
    queryFn: () => endpoints.operations.aftersales.monitoring.page(plantId),
  });
  const d = page.data;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Monitoramento</CardTitle>
        <CardDescription>
          Geração real contra a esperada do projeto aprovado. Chamado automático só existe com a
          regra de monitoramento ativa (Administração → Regras).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {page.isPending ? <Skeleton className="h-32 w-full" /> : null}
        {page.isError ? (
          <p className="text-sm text-destructive">Não foi possível carregar o monitoramento.</p>
        ) : null}
        {d ? (
          <>
            {d.snapshot ? (
              <p className="text-sm">
                <Badge
                  variant={
                    d.snapshot.status === 'ONLINE'
                      ? 'green'
                      : d.snapshot.status === 'UNKNOWN'
                        ? 'outline'
                        : 'red'
                  }
                >
                  {STATUS_LABEL[d.snapshot.status]}
                </Badge>{' '}
                {d.snapshot.powerKw !== null
                  ? `${d.snapshot.powerKw.toLocaleString('pt-BR')} kW agora`
                  : ''}
              </p>
            ) : null}
            {d.openAlarms.length > 0 ? (
              <ul className="space-y-1 text-sm text-destructive" aria-label="Alarmes abertos">
                {d.openAlarms.map((a) => (
                  <li key={a.id}>
                    {a.text} <span className="text-xs">({a.code})</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {!d.hasExpected ? (
              <p className="text-sm text-muted-foreground">
                Esta planta não veio de um projeto técnico aprovado: não há geração esperada para
                comparar.
              </p>
            ) : null}
            {d.deviationRule ? (
              d.deviation?.alert ? (
                <p role="alert" className="text-sm text-destructive">
                  Geração mais de {d.deviationRule.thresholdPct}% abaixo do esperado há{' '}
                  {d.deviation.streak} dia(s) seguidos.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Regra ativa: chamado após {d.deviationRule.consecutiveDays} dia(s) seguidos mais
                  de {d.deviationRule.thresholdPct}% abaixo do esperado.
                </p>
              )
            ) : (
              <p className="text-xs text-muted-foreground">
                Sem regra de monitoramento ativa: o sistema compara, mas não abre chamado sozinho.
              </p>
            )}
            <DailyChart daily={d.daily} months={d.months} />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mês</TableHead>
                  <TableHead className="text-right">Real</TableHead>
                  <TableHead className="text-right">Esperado até a data</TableHead>
                  <TableHead className="text-right">Desempenho</TableHead>
                  <TableHead className="text-right">Dias com leitura</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.months.map((m) => (
                  <TableRow key={m.month}>
                    <TableCell>{monthLabel(m.month)}</TableCell>
                    <TableCell className="text-right">{formatKwh(m.actualKwh)}</TableCell>
                    <TableCell className="text-right">
                      {m.expectedToDateKwh === null ? '—' : formatKwh(m.expectedToDateKwh)}
                    </TableCell>
                    <TableCell className="text-right">{percent(m.performanceIndex)}</TableCell>
                    <TableCell className="text-right">
                      {m.daysWithData}/{m.daysInMonth}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="grid gap-6 lg:grid-cols-2">
              <LinkManager plantId={plantId} page={d} />
              <CsvImport plantId={plantId} />
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
