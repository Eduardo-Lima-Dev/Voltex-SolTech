import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import type { InstallationDetailDto, MaterialItemDto } from '@voltex/shared';
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
import { formatCents, formatDate } from '@/lib/format';
import { queryKeys } from '../admin/query-keys';
import { MATERIAL_STATUS_LABELS } from './labels';

const useRefresh = (installationId: string) => {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.installation(installationId) }),
      queryClient.invalidateQueries({ queryKey: ['operations', 'installations'] }),
    ]);
};

function AddItemDialog({
  installationId,
  open,
  onClose,
}: {
  installationId: string;
  open: boolean;
  onClose: () => void;
}) {
  const refresh = useRefresh(installationId);
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('MODULE');
  const [quantity, setQuantity] = useState('1');
  const [unit, setUnit] = useState('un');
  const add = useMutation({
    mutationFn: () =>
      endpoints.operations.materials.add(installationId, {
        description,
        category,
        quantity: Number(quantity.replace(',', '.')),
        unit,
      }),
    onSuccess: async () => {
      setDescription('');
      setQuantity('1');
      await refresh();
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível adicionar o item.')),
  });
  const qty = Number(quantity.replace(',', '.'));
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo item de material</DialogTitle>
          <DialogDescription>
            Item lançado à mão na lista de materiais da instalação.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="mat-desc">Descrição</Label>
            <Input
              id="mat-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="mat-cat">Categoria</Label>
              <Input
                id="mat-cat"
                value={category}
                onChange={(e) => setCategory(e.target.value.toUpperCase())}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="mat-qty">Quantidade</Label>
              <Input
                id="mat-qty"
                inputMode="decimal"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="mat-unit">Unidade</Label>
              <Input id="mat-unit" value={unit} onChange={(e) => setUnit(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={
              !description.trim() || !(qty > 0) || !category.trim() || !unit.trim() || add.isPending
            }
            onClick={() => add.mutate()}
          >
            Adicionar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OrderDialog({
  item,
  onClose,
  onDone,
}: {
  item: MaterialItemDto | null;
  onClose: () => void;
  onDone: () => Promise<unknown>;
}) {
  const [supplier, setSupplier] = useState('');
  const [purchaseOrder, setPurchaseOrder] = useState('');
  const [paid, setPaid] = useState('');
  const order = useMutation({
    mutationFn: () => {
      const cents = paid.trim() ? Math.round(Number(paid.replace(',', '.')) * 100) : undefined;
      return endpoints.operations.materials.order(item!.id, {
        supplier,
        ...(purchaseOrder.trim() ? { purchaseOrder } : {}),
        ...(cents !== undefined && !Number.isNaN(cents) ? { orderedCents: cents } : {}),
      });
    },
    onSuccess: async () => {
      await onDone();
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível registrar o pedido.')),
  });
  return (
    <Dialog open={item !== null} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar pedido de compra</DialogTitle>
          <DialogDescription>
            {item?.description}. O sistema só registra o pedido: a compra é feita por você.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="ord-supplier">Fornecedor</Label>
            <Input
              id="ord-supplier"
              value={supplier}
              onChange={(e) => setSupplier(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="ord-po">Nº do pedido</Label>
              <Input
                id="ord-po"
                value={purchaseOrder}
                onChange={(e) => setPurchaseOrder(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ord-paid">Valor pago (R$)</Label>
              <Input
                id="ord-paid"
                inputMode="decimal"
                value={paid}
                onChange={(e) => setPaid(e.target.value)}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={!supplier.trim() || order.isPending} onClick={() => order.mutate()}>
            Registrar pedido
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Quotes({ installationId }: { installationId: string }) {
  const quotes = useQuery({
    queryKey: queryKeys.installationQuotes(installationId),
    queryFn: () => endpoints.operations.materials.quotes(installationId),
  });
  if (quotes.isPending) return <p className="text-sm text-muted-foreground">Buscando ofertas…</p>;
  if ((quotes.data?.length ?? 0) === 0)
    return (
      <p className="text-sm text-muted-foreground">
        Nenhum item pendente tem equipamento do catálogo com tabela de preços vigente.
      </p>
    );
  return (
    <ul className="space-y-3 text-sm" aria-label="Ofertas por item">
      {quotes.data?.map((q) => (
        <li key={q.materialItemId}>
          <div className="font-medium">
            {q.description} · {q.quantity} {q.unit}
            {q.plannedUnitCostCents !== null
              ? ` · previsto ${formatCents(q.plannedUnitCostCents)}/un`
              : ''}
          </div>
          {q.offers.length === 0 ? (
            <div className="text-muted-foreground">Sem oferta vigente.</div>
          ) : (
            <ul className="ml-4 list-disc">
              {q.offers.map((o) => (
                <li key={o.priceListItemId}>
                  {o.supplier}: {formatCents(o.unitPriceCents)}/un · total{' '}
                  {formatCents(o.totalCents)}
                  {o.best ? ' (menor preço)' : ''}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Lista de materiais da instalação: gerar do projeto técnico, lançar à mão, pedir, receber, separar e comparar preços. */
export function MaterialsSection({ installation }: { installation: InstallationDetailDto }) {
  const refresh = useRefresh(installation.id);
  const [adding, setAdding] = useState(false);
  const [ordering, setOrdering] = useState<MaterialItemDto | null>(null);
  const [showQuotes, setShowQuotes] = useState(false);
  const closed = installation.status === 'DONE' || installation.status === 'CANCELLED';

  const act = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: refresh,
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível concluir a ação.')),
  });
  const generate = useMutation({
    mutationFn: () => endpoints.operations.materials.generate(installation.id),
    onSuccess: async (r) => {
      toast.success(
        r.created > 0
          ? `${r.created} itens gerados do projeto técnico.`
          : 'A lista já tinha sido gerada.',
      );
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível gerar a lista.')),
  });

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle>Materiais</CardTitle>
          <CardDescription>
            {installation.materialsReady} de {installation.materialsTotal} itens recebidos.
          </CardDescription>
        </div>
        <Can permission="ops.installation.write">
          {!closed ? (
            <div className="flex flex-wrap gap-2">
              {installation.engineeringSnapshotId && !installation.materialsGeneratedAt ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={generate.isPending}
                  onClick={() => generate.mutate()}
                >
                  Gerar do projeto técnico
                </Button>
              ) : null}
              <Button size="sm" variant="outline" onClick={() => setShowQuotes((v) => !v)}>
                {showQuotes ? 'Ocultar ofertas' : 'Comparar ofertas'}
              </Button>
              <Button size="sm" onClick={() => setAdding(true)}>
                <Plus aria-hidden="true" /> Item
              </Button>
            </div>
          ) : null}
        </Can>
      </CardHeader>
      <CardContent className="space-y-4">
        {showQuotes ? <Quotes installationId={installation.id} /> : null}
        {installation.materials.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum item na lista de materiais.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Qtd.</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {installation.materials.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>
                    <div className="font-medium">{m.description}</div>
                    <div className="text-xs text-muted-foreground">
                      {m.category}
                      {m.supplier ? ` · ${m.supplier}` : ''}
                      {m.purchaseOrder ? ` · pedido ${m.purchaseOrder}` : ''}
                      {m.expectedAt ? ` · previsão ${formatDate(m.expectedAt)}` : ''}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {m.quantity} {m.unit}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        m.status === 'CANCELLED'
                          ? 'outline'
                          : m.status === 'PENDING'
                            ? 'yellow'
                            : 'secondary'
                      }
                    >
                      {MATERIAL_STATUS_LABELS[m.status]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Can permission="ops.installation.write">
                      {!closed ? (
                        <div className="flex flex-wrap justify-end gap-1">
                          {m.status === 'PENDING' ? (
                            <Button size="sm" variant="outline" onClick={() => setOrdering(m)}>
                              Pedir
                            </Button>
                          ) : null}
                          {m.status === 'PENDING' || m.status === 'ORDERED' ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={act.isPending}
                              onClick={() =>
                                act.mutate(() => endpoints.operations.materials.receive(m.id))
                              }
                            >
                              Receber
                            </Button>
                          ) : null}
                          {m.status === 'RECEIVED' ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={act.isPending}
                              onClick={() =>
                                act.mutate(() => endpoints.operations.materials.separate(m.id))
                              }
                            >
                              Separar
                            </Button>
                          ) : null}
                          {m.status !== 'CANCELLED' && m.status !== 'SEPARATED' ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={act.isPending}
                              onClick={() =>
                                act.mutate(() => endpoints.operations.materials.cancel(m.id))
                              }
                            >
                              Cancelar
                            </Button>
                          ) : null}
                        </div>
                      ) : null}
                    </Can>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <AddItemDialog
        installationId={installation.id}
        open={adding}
        onClose={() => setAdding(false)}
      />
      <OrderDialog
        key={ordering?.id ?? 'none'}
        item={ordering}
        onClose={() => setOrdering(null)}
        onDone={refresh}
      />
    </Card>
  );
}
