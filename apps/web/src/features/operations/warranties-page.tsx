import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { ASSET_CATEGORIES, type AssetCategory } from '@voltex/shared';
import {
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
  toast,
} from '@voltex/ui';
import { Can } from '@/app/guards';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api/errors';
import { queryKeys } from '../admin/query-keys';
import {
  ASSET_CATEGORY_LABELS,
  WARRANTY_KIND_LABELS,
  daysLeftLabel,
  formatDay,
} from './aftersales-labels';

const num = (v: string): number | undefined =>
  v.trim() === '' ? undefined : Number(v.replace(',', '.'));

function TermDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [manufacturer, setManufacturer] = useState('');
  const [category, setCategory] = useState<AssetCategory>('MODULE');
  const [productYears, setProductYears] = useState('');
  const [performanceYears, setPerformanceYears] = useState('');
  const [performanceEndPct, setPerformanceEndPct] = useState('');
  const [source, setSource] = useState('');
  const save = useMutation({
    mutationFn: () =>
      endpoints.operations.aftersales.warranties.createTerm({
        manufacturer,
        category,
        productYears: num(productYears),
        performanceYears: num(performanceYears),
        performanceEndPct: num(performanceEndPct),
        source,
      }),
    onSuccess: async () => {
      toast.success('Termo cadastrado.');
      await queryClient.invalidateQueries({ queryKey: ['operations'] });
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível salvar o termo.')),
  });
  const hasYears = num(productYears) !== undefined || num(performanceYears) !== undefined;
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo termo de garantia</DialogTitle>
          <DialogDescription>
            Copie os prazos do termo oficial do fabricante e diga de onde vieram. O sistema não
            sugere prazos por conta própria.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="term-manufacturer">Fabricante</Label>
            <Input
              id="term-manufacturer"
              value={manufacturer}
              onChange={(e) => setManufacturer(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="term-category">Equipamento</Label>
            <NativeSelect
              id="term-category"
              value={category}
              onChange={(e) => setCategory(e.target.value as AssetCategory)}
            >
              {ASSET_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {ASSET_CATEGORY_LABELS[c]}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label htmlFor="term-product">Produto (anos)</Label>
              <Input
                id="term-product"
                inputMode="decimal"
                value={productYears}
                onChange={(e) => setProductYears(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="term-performance">Desempenho (anos)</Label>
              <Input
                id="term-performance"
                inputMode="decimal"
                value={performanceYears}
                onChange={(e) => setPerformanceYears(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="term-pct">Potência ao fim (%)</Label>
              <Input
                id="term-pct"
                inputMode="decimal"
                value={performanceEndPct}
                onChange={(e) => setPerformanceEndPct(e.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="term-source">Fonte do termo</Label>
            <Input
              id="term-source"
              placeholder="Documento, página ou link do fabricante"
              value={source}
              onChange={(e) => setSource(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={
              !manufacturer.trim() || !hasYears || source.trim().length < 3 || save.isPending
            }
            onClick={() => save.mutate()}
          >
            Salvar termo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Termos de garantia por fabricante e garantias a vencer. */
export function WarrantiesPage() {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const terms = useQuery({
    queryKey: queryKeys.warrantyTerms,
    queryFn: () => endpoints.operations.aftersales.warranties.terms(),
  });
  const filters = { status: 'ACTIVE' as const, expiringInDays: 90 };
  const expiring = useQuery({
    queryKey: queryKeys.warranties(filters),
    queryFn: () => endpoints.operations.aftersales.warranties.list(filters),
  });
  const retire = useMutation({
    mutationFn: (id: string) => endpoints.operations.aftersales.warranties.retireTerm(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['operations'] }),
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível encerrar o termo.')),
  });
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle>Termos de garantia por fabricante</CardTitle>
            <CardDescription>
              Valem para os ativos novos. Ativo sem termo fica como “garantia não cadastrada”.
            </CardDescription>
          </div>
          <Can permission="ops.warranty.manage">
            <Button size="sm" onClick={() => setCreating(true)}>
              Novo termo
            </Button>
          </Can>
        </CardHeader>
        <CardContent>
          {terms.isPending ? (
            <Skeleton className="h-16 w-full" />
          ) : (terms.data?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum termo cadastrado.</p>
          ) : (
            <ul className="divide-y" aria-label="Termos de garantia">
              {terms.data?.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <div>
                    <div className="font-medium">
                      {t.manufacturer} · {ASSET_CATEGORY_LABELS[t.category]}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {t.productYears ? `Produto ${t.productYears} anos` : ''}
                      {t.productYears && t.performanceYears ? ' · ' : ''}
                      {t.performanceYears
                        ? `Desempenho ${t.performanceYears} anos${
                            t.performanceEndPct ? ` (${t.performanceEndPct}% ao fim)` : ''
                          }`
                        : ''}
                      {' · fonte: '}
                      {t.source}
                    </div>
                  </div>
                  <Can permission="ops.warranty.manage">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={retire.isPending}
                      onClick={() => retire.mutate(t.id)}
                    >
                      Encerrar
                    </Button>
                  </Can>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Garantias que vencem em até 90 dias</CardTitle>
        </CardHeader>
        <CardContent>
          {expiring.isPending ? (
            <Skeleton className="h-16 w-full" />
          ) : (expiring.data?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma garantia vencendo no período.</p>
          ) : (
            <ul className="divide-y" aria-label="Garantias a vencer">
              {expiring.data?.map((w) => (
                <li key={w.id} className="py-2 text-sm">
                  <Link
                    to={`/operations/plantas/${w.plantId}`}
                    className="font-medium text-primary underline-offset-2 hover:underline"
                  >
                    {w.plantName}
                  </Link>{' '}
                  · {w.assetLabel} · {WARRANTY_KIND_LABELS[w.kind]} até {formatDay(w.endsOn)} (
                  {daysLeftLabel(w.daysLeft)})
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      {creating ? <TermDialog onClose={() => setCreating(false)} /> : null}
    </div>
  );
}
