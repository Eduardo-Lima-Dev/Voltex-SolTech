import { usePortfolioScope } from '@/features/auth/portfolio';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
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
} from '@voltex/ui';
import { Can } from '@/app/guards';
import { Pagination } from '@/components/pagination';
import { queryKeys } from '@/features/admin/query-keys';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { ACCOUNT_TYPE_LABELS, SEGMENT_LABELS } from '@/i18n/labels';
import { endpoints } from '@/lib/api/endpoints';
import { AccountFormDialog } from './account-dialogs';

const PAGE_SIZE = 10;

export function AccountsPage() {
  const portfolio = usePortfolioScope();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const debounced = useDebouncedValue(search.trim());

  const list = useQuery({
    queryKey: queryKeys.accounts({ page, search: debounced }),
    queryFn: () =>
      endpoints.accounts.list({ page, pageSize: PAGE_SIZE, search: debounced || undefined }),
    placeholderData: keepPreviousData,
  });

  return (
    <Card>
      <CardHeader className="flex-col items-start justify-between gap-3 space-y-0 sm:flex-row">
        <div className="space-y-1.5">
          <CardTitle>Contas</CardTitle>
          <CardDescription>
            Clientes, com seus contatos, imóveis e unidades consumidoras.
            {portfolio.note ? ` ${portfolio.note}` : ''}
          </CardDescription>
        </div>
        <Can permission="crm.account.write">
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus /> Nova conta
          </Button>
        </Can>
      </CardHeader>
      <CardContent>
        <div className="relative mb-4 max-w-sm">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            className="pl-9"
            placeholder="Buscar por nome, e-mail ou documento"
            aria-label="Buscar contas"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        {list.isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : list.isError ? (
          <p className="text-sm text-destructive">Não foi possível carregar as contas.</p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Conta</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Segmento</TableHead>
                  <TableHead>Contato</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.data.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                      {debounced
                        ? 'Nenhuma conta encontrada com essa busca.'
                        : 'Nenhuma conta ainda. Converta um lead ou cadastre uma conta.'}
                    </TableCell>
                  </TableRow>
                ) : (
                  list.data.data.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>
                        <Link to={`/crm/contas/${a.id}`} className="font-medium hover:underline">
                          {a.name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{ACCOUNT_TYPE_LABELS[a.type]}</Badge>
                      </TableCell>
                      <TableCell>{a.segment ? SEGMENT_LABELS[a.segment] : '—'}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {[a.phone, a.email].filter(Boolean).join(' · ') || '—'}
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
      <AccountFormDialog item={null} open={creating} onOpenChange={setCreating} />
    </Card>
  );
}
