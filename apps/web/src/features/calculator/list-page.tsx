import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  NativeSelect,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@voltex/ui';
import { Can } from '@/app/guards';
import { Pagination } from '@/components/pagination';
import { queryKeys } from '@/features/admin/query-keys';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { TRAFFIC_LIGHT_LABELS } from '@/i18n/labels';
import { endpoints } from '@/lib/api/endpoints';
import { formatCents, formatDateTime, formatKwp, formatYears } from '@/lib/format';
import { TrafficLightBadge } from './result-view';

const PAGE_SIZE = 10;

export function CalculatorListPage() {
  const [search, setSearch] = useState('');
  const [light, setLight] = useState<'' | 'GREEN' | 'YELLOW' | 'RED'>('');
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebouncedValue(search.trim());

  const filters = { page, search: debouncedSearch, light };
  const list = useQuery({
    queryKey: queryKeys.calculations(filters),
    queryFn: () =>
      endpoints.calculator.list({
        page,
        pageSize: PAGE_SIZE,
        search: debouncedSearch || undefined,
        trafficLight: light || undefined,
      }),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Solar Calculator</h1>
          <p className="text-muted-foreground">Pré-viabilidade solar em minutos, com histórico.</p>
        </div>
        <Can permission="calculator.session.create">
          <Button asChild>
            <Link to="/calculator/new">
              <Plus /> Novo cálculo
            </Link>
          </Button>
        </Can>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Cálculos</CardTitle>
          <CardDescription>Cada cálculo guarda as premissas e a regra usadas.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_14rem]">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                type="search"
                className="pl-9"
                placeholder="Buscar por título ou cliente"
                aria-label="Buscar cálculos"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
            </div>
            <NativeSelect
              aria-label="Filtrar por semáforo"
              value={light}
              onChange={(e) => {
                setLight(e.target.value as typeof light);
                setPage(1);
              }}
            >
              <option value="">Todos os semáforos</option>
              {(['GREEN', 'YELLOW', 'RED'] as const).map((l) => (
                <option key={l} value={l}>
                  {TRAFFIC_LIGHT_LABELS[l]}
                </option>
              ))}
            </NativeSelect>
          </div>

          {list.isPending ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : list.isError ? (
            <p className="text-sm text-destructive">Não foi possível carregar os cálculos.</p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cálculo</TableHead>
                    <TableHead>Semáforo</TableHead>
                    <TableHead>Potência</TableHead>
                    <TableHead>Investimento</TableHead>
                    <TableHead>Payback</TableHead>
                    <TableHead>Criado em</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.data.data.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                        {debouncedSearch || light
                          ? 'Nenhum cálculo encontrado com esses filtros.'
                          : 'Nenhum cálculo ainda. Crie o primeiro em “Novo cálculo”.'}
                      </TableCell>
                    </TableRow>
                  ) : (
                    list.data.data.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell>
                          <Link to={`/calculator/${c.id}`} className="font-medium hover:underline">
                            {c.title || c.customerName || 'Cálculo sem título'}
                          </Link>
                          {c.title && c.customerName ? (
                            <div className="text-xs text-muted-foreground">{c.customerName}</div>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <TrafficLightBadge light={c.trafficLight} />
                        </TableCell>
                        <TableCell>{formatKwp(c.result.installedPowerKwp)}</TableCell>
                        <TableCell>{formatCents(c.result.investmentCents)}</TableCell>
                        <TableCell>{formatYears(c.result.simplePaybackYears)}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatDateTime(c.createdAt)}
                        </TableCell>
                      </TableRow>
                    ))
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
    </div>
  );
}
