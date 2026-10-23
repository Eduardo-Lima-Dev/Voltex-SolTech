import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
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
import { formatCents, formatKwp } from '@/lib/format';
import { queryKeys } from '../admin/query-keys';
import { formatDay } from './aftersales-labels';

function Metric({ title, value, hint }: { title: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
      {hint ? <CardContent className="text-xs text-muted-foreground">{hint}</CardContent> : null}
    </Card>
  );
}

/** Indicadores do pós-venda (modelagem §53). Janelas não configuradas aparecem como "não configurado". */
function AftersalesDashboard() {
  const dash = useQuery({
    queryKey: queryKeys.aftersalesDashboard,
    queryFn: endpoints.operations.aftersales.dashboard,
  });
  if (dash.isPending) return <Skeleton className="h-24 w-full" />;
  if (dash.isError)
    return <p className="text-sm text-destructive">Não foi possível carregar os indicadores.</p>;
  const d = dash.data;
  const window = (n: number | null) => (n === null ? 'Não configurado' : String(n));
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Indicadores do pós-venda">
      <Metric
        title="Base instalada"
        value={`${d.installedBase.plants} planta(s)`}
        hint={formatKwp(d.installedBase.powerKwp)}
      />
      <Metric
        title="Receita mensal de O&M"
        value={formatCents(d.mrrCents)}
        hint="Valores informados à mão"
      />
      <Metric
        title="Chamados em aberto"
        value={String(d.openTickets)}
        hint={`${d.breachedTickets} fora do prazo · tempo médio de resolução ${
          d.mttrHours === null ? 'sem amostra' : `${d.mttrHours.toFixed(1)} h`
        }`}
      />
      <Metric
        title="Garantias a vencer"
        value={window(d.warrantiesExpiring)}
        hint={`${d.warrantiesMissing} ativo(s) sem garantia cadastrada`}
      />
      <Metric title="Contratos a renovar" value={window(d.contractsExpiring)} />
      <Metric title="Oportunidades de expansão" value={String(d.upsellOpportunities)} />
    </div>
  );
}

/** Plantas instaladas: nascem do aceite do cliente e concentram ativos, garantias e chamados. */
export function PlantsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const filters = { search: search.trim() || undefined, pageSize: 50 };
  const list = useQuery({
    queryKey: queryKeys.plants(filters),
    queryFn: () => endpoints.operations.aftersales.plants.list(filters),
  });
  const reconcile = useMutation({
    mutationFn: endpoints.operations.aftersales.plants.reconcile,
    onSuccess: async (r) => {
      toast.success(
        r.created > 0
          ? `${r.created} planta(s) criada(s) para instalações já aceitas.`
          : 'Todas as instalações aceitas já têm planta.',
      );
      await queryClient.invalidateQueries({ queryKey: ['operations'] });
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível sincronizar.')),
  });

  return (
    <div className="space-y-4">
      <AftersalesDashboard />
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle>Plantas</CardTitle>
            <CardDescription>
              A planta é criada quando o cliente aceita a instalação.
            </CardDescription>
          </div>
          <Can permission="ops.plant.write">
            <Button
              size="sm"
              variant="outline"
              disabled={reconcile.isPending}
              onClick={() => reconcile.mutate()}
            >
              Criar as que faltam
            </Button>
          </Can>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            aria-label="Buscar planta"
            className="max-w-xs"
            placeholder="Código do projeto ou cliente"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {list.isPending ? (
            <Skeleton className="h-24 w-full" />
          ) : list.isError ? (
            <p className="text-sm text-destructive">Não foi possível carregar as plantas.</p>
          ) : list.data.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma planta encontrada.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Planta</TableHead>
                  <TableHead>Potência</TableHead>
                  <TableHead>Ativada em</TableHead>
                  <TableHead>Chamados</TableHead>
                  <TableHead>Garantia</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.data.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <Link
                        to={`/operations/plantas/${p.id}`}
                        className="font-medium text-primary underline-offset-2 hover:underline"
                      >
                        {p.name}
                      </Link>
                      <div className="text-xs text-muted-foreground">{p.projectCode}</div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {p.powerKwp === null ? '—' : formatKwp(p.powerKwp)}
                    </TableCell>
                    <TableCell className="text-sm">{formatDay(p.activatedAt)}</TableCell>
                    <TableCell className="text-sm">
                      {p.openTickets > 0 ? p.openTickets : '—'}
                    </TableCell>
                    <TableCell className="text-sm">
                      {p.assetsWithoutWarranty > 0 ? (
                        <Badge variant="yellow">{p.assetsWithoutWarranty} sem garantia</Badge>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
