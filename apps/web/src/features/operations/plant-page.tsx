import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { ASSET_CATEGORIES, type AssetCategory, type PlantAssetDto } from '@voltex/shared';
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
  toast,
} from '@voltex/ui';
import { Can } from '@/app/guards';
import { GenerationForecastCard } from '@/features/forecasts/forecast-cards';
import { AskAssistantButton } from '@/features/ai/ask-assistant-button';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api/errors';
import { formatCents, formatDateTime, formatKwp } from '@/lib/format';
import { queryKeys } from '../admin/query-keys';
import {
  ASSET_CATEGORY_LABELS,
  MAINTENANCE_KIND_LABELS,
  WARRANTY_KIND_LABELS,
  daysLeftLabel,
  formatDay,
} from './aftersales-labels';
import { PlantMonitoringSection } from './plant-monitoring';
import { NewTicketDialog, TicketDialog, TicketRows } from './tickets-page';

function AddAssetDialog({ plantId, onClose }: { plantId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [category, setCategory] = useState<AssetCategory>('MODULE');
  const [manufacturer, setManufacturer] = useState('');
  const [model, setModel] = useState('');
  const [quantity, setQuantity] = useState('1');
  const save = useMutation({
    mutationFn: () =>
      endpoints.operations.aftersales.plants.addAsset(plantId, {
        category,
        manufacturer,
        model,
        quantity: Number(quantity),
      }),
    onSuccess: async () => {
      toast.success('Ativo adicionado. A garantia vem do termo cadastrado para o fabricante.');
      await queryClient.invalidateQueries({ queryKey: ['operations'] });
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível adicionar o ativo.')),
  });
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo ativo</DialogTitle>
          <DialogDescription>Equipamento instalado nesta planta.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="asset-category">Categoria</Label>
            <NativeSelect
              id="asset-category"
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
          <div className="grid gap-1.5">
            <Label htmlFor="asset-manufacturer">Fabricante</Label>
            <Input
              id="asset-manufacturer"
              value={manufacturer}
              onChange={(e) => setManufacturer(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="asset-model">Modelo</Label>
            <Input id="asset-model" value={model} onChange={(e) => setModel(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="asset-quantity">Quantidade</Label>
            <Input
              id="asset-quantity"
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={
              !manufacturer.trim() || !model.trim() || Number(quantity) < 1 || save.isPending
            }
            onClick={() => save.mutate()}
          >
            Adicionar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AssetItem({ asset }: { asset: PlantAssetDto }) {
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-2 font-medium">
        {ASSET_CATEGORY_LABELS[asset.category]} · {asset.manufacturer} {asset.model}
        <span className="text-sm font-normal text-muted-foreground">× {asset.quantity}</span>
        {asset.status !== 'ACTIVE' ? (
          <Badge variant="outline">
            {asset.status === 'REPLACED' ? 'Substituído' : 'Retirado'}
          </Badge>
        ) : null}
      </div>
      {asset.status === 'ACTIVE' ? (
        asset.warrantyMissing ? (
          <p className="text-sm text-muted-foreground">
            Garantia não cadastrada: cadastre o termo do fabricante em Garantias.
          </p>
        ) : (
          <ul className="mt-1 text-sm" aria-label="Garantias do ativo">
            {asset.warranties.map((w) => (
              <li key={w.id}>
                {WARRANTY_KIND_LABELS[w.kind]}: até {formatDay(w.endsOn)} (
                {daysLeftLabel(w.daysLeft)})
                {w.performanceEndPct ? ` · ${w.performanceEndPct}% da potência` : ''}
              </li>
            ))}
          </ul>
        )
      ) : null}
    </li>
  );
}

/** Ficha da planta: ativos e garantias, chamados, manutenção, contratos e histórico. */
export function PlantPage() {
  const { id = '' } = useParams();
  const [adding, setAdding] = useState(false);
  const [ticketing, setTicketing] = useState(false);
  const [opened, setOpened] = useState<string | null>(null);
  const plant = useQuery({
    queryKey: queryKeys.plant(id),
    queryFn: () => endpoints.operations.aftersales.plants.get(id),
  });
  if (plant.isPending) return <Skeleton className="h-48 w-full" />;
  if (plant.isError)
    return <p className="text-sm text-destructive">Não foi possível carregar a planta.</p>;
  const p = plant.data;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-3">
            {p.name}
            <AskAssistantButton
              label="Resumir com IA"
              question={`Resuma a situação da planta do projeto ${p.projectCode}`}
              projectCode={p.projectCode}
              screen="planta"
            />
          </CardTitle>
          <CardDescription>
            <Link
              to={`/operations/instalacoes/${p.installationId}`}
              className="text-primary underline-offset-2 hover:underline"
            >
              {p.projectCode}
            </Link>
            {' · ativada em '}
            {formatDay(p.activatedAt)}
            {p.powerKwp !== null ? ` · ${formatKwp(p.powerKwp)}` : ''}
          </CardDescription>
        </CardHeader>
        {p.expectedAnnualKwh !== null ? (
          <CardContent className="text-sm">
            Geração esperada: {Math.round(p.expectedAnnualKwh).toLocaleString('pt-BR')} kWh/ano
            {p.expectedSource ? ' (do projeto técnico aprovado)' : ''}
          </CardContent>
        ) : null}
      </Card>

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
          <CardTitle>Ativos e garantias</CardTitle>
          <Can permission="ops.plant.write">
            <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
              Adicionar ativo
            </Button>
          </Can>
        </CardHeader>
        <CardContent>
          {p.assets.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum ativo registrado.</p>
          ) : (
            <ul className="divide-y" aria-label="Ativos">
              {p.assets.map((a) => (
                <AssetItem key={a.id} asset={a} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <PlantMonitoringSection plantId={p.id} />

      <GenerationForecastCard projectCode={p.projectCode} />

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
          <CardTitle>Chamados</CardTitle>
          <Can permission="ops.ticket.write">
            <Button size="sm" onClick={() => setTicketing(true)}>
              Novo chamado
            </Button>
          </Can>
        </CardHeader>
        <CardContent>
          {p.tickets.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum chamado desta planta.</p>
          ) : (
            <TicketRows tickets={p.tickets} onOpen={setOpened} />
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Manutenção</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm" aria-label="Planos de manutenção">
              {p.plans.map((m) => (
                <li key={m.id}>
                  {m.title} ({MAINTENANCE_KIND_LABELS[m.kind]}, a cada {m.everyMonths} mês(es)) ·
                  próxima em {formatDay(m.nextDueAt)}
                  {m.active ? '' : ' · pausado'}
                </li>
              ))}
              {p.plans.length === 0 ? (
                <li className="text-muted-foreground">Nenhum plano de manutenção.</li>
              ) : null}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Contratos de O&M</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm" aria-label="Contratos de O&M">
              {p.contracts.map((c) => (
                <li key={c.id}>
                  {c.title} · até {formatDay(c.endsOn)} · {formatCents(c.monthlyCents)}/mês
                </li>
              ))}
              {p.contracts.length === 0 ? (
                <li className="text-muted-foreground">Nenhum contrato.</li>
              ) : null}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Histórico</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1 text-sm" aria-label="Histórico da planta">
            {p.events.map((e) => (
              <li key={e.id}>
                <span className="text-muted-foreground">{formatDateTime(e.createdAt)}</span>{' '}
                {e.text}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {adding ? <AddAssetDialog plantId={p.id} onClose={() => setAdding(false)} /> : null}
      <NewTicketDialog plantId={p.id} open={ticketing} onClose={() => setTicketing(false)} />
      {opened ? <TicketDialog id={opened} onClose={() => setOpened(null)} /> : null}
    </div>
  );
}
