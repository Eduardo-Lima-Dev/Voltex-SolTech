import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Plus, Search, Trash2, Upload } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from '@voltex/ui';
import type { SolarResourceDto } from '@voltex/shared';
import {
  Alert,
  AlertDescription,
  AlertTitle,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@voltex/ui';
import { Can } from '@/app/guards';
import { Pagination } from '@/components/pagination';
import { Field } from '@/features/calculator/field';
import { parseDecimal } from '@/features/calculator/form';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { BRAZILIAN_STATES, MONTH_LABELS } from '@/i18n/labels';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api/errors';
import { formatNumber } from '@/lib/format';
import { ConfirmDialog } from '../company/confirm-delete';
import { queryKeys } from '../query-keys';
import { SOLAR_RESOURCES_CSV_TEMPLATE, parseSolarResourcesCsv, type CsvParseResult } from './csv';

const PAGE_SIZE = 10;

interface ResourceValues {
  name: string;
  state: string;
  latitude: string;
  longitude: string;
  source: string;
  plane: string;
  hsp: string[];
}

function validate(values: ResourceValues): Record<string, string> {
  const errors: Record<string, string> = {};
  if (values.name.trim().length < 2) errors.name = 'Informe o nome do local';
  if (values.source.trim().length < 2)
    errors.source = 'Informe a origem do dado (ex.: CRESESB SunData). Dado sem fonte não é aceito.';
  const months = values.hsp.map(parseDecimal);
  if (months.some((v) => v === undefined || Number.isNaN(v) || v <= 0 || v > 12))
    errors.hsp = 'Informe os 12 meses com valores entre 0 e 12 kWh/m²·dia';
  for (const key of ['latitude', 'longitude'] as const) {
    const n = parseDecimal(values[key]);
    const limit = key === 'latitude' ? 90 : 180;
    if (n !== undefined && (Number.isNaN(n) || Math.abs(n) > limit))
      errors[key] = `Valor entre -${limit} e ${limit}`;
  }
  return errors;
}

function ResourceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [showErrors, setShowErrors] = useState(false);
  const form = useForm<ResourceValues>({
    defaultValues: {
      name: '',
      state: '',
      latitude: '',
      longitude: '',
      source: '',
      plane: 'Plano horizontal',
      hsp: Array<string>(12).fill(''),
    },
  });
  const errors = showErrors ? validate(form.watch()) : {};

  const close = (next: boolean) => {
    if (!next) {
      form.reset();
      setShowErrors(false);
    }
    onOpenChange(next);
  };

  const save = useMutation({
    mutationFn: (values: ResourceValues) =>
      endpoints.solarResources.create({
        name: values.name.trim(),
        state: values.state || undefined,
        latitude: parseDecimal(values.latitude),
        longitude: parseDecimal(values.longitude),
        source: values.source.trim(),
        plane: values.plane.trim() || undefined,
        hspMonthly: values.hsp.map((v) => parseDecimal(v) as number),
      }),
    onSuccess: async () => {
      toast.success('Irradiação cadastrada');
      close(false);
      await queryClient.invalidateQueries({ queryKey: queryKeys.solarResources() });
    },
    onError: (error) =>
      toast.error(errorMessage(error, 'Não foi possível cadastrar a irradiação.')),
  });

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Nova irradiação</DialogTitle>
          <DialogDescription>
            HSP médio mensal (kWh/m²·dia) de um local. Se já existir um local com o mesmo nome e UF,
            ele é atualizado.
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const values = form.getValues();
            if (Object.keys(validate(values)).length > 0) setShowErrors(true);
            else save.mutate(values);
          }}
        >
          <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
            <Field id="sr-name" label="Local" error={errors.name}>
              <Input id="sr-name" placeholder="Ex.: Fortaleza" {...form.register('name')} />
            </Field>
            <Field id="sr-state" label="UF">
              <NativeSelect id="sr-state" {...form.register('state')}>
                <option value="">—</option>
                {BRAZILIAN_STATES.map((uf) => (
                  <option key={uf} value={uf}>
                    {uf}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="sr-latitude" label="Latitude (opcional)" error={errors.latitude}>
              <Input id="sr-latitude" inputMode="decimal" {...form.register('latitude')} />
            </Field>
            <Field id="sr-longitude" label="Longitude (opcional)" error={errors.longitude}>
              <Input id="sr-longitude" inputMode="decimal" {...form.register('longitude')} />
            </Field>
          </div>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">HSP médio mensal (kWh/m²·dia)</legend>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
              {MONTH_LABELS.map((month, i) => (
                <div key={month} className="grid gap-1">
                  <Label htmlFor={`sr-hsp-${i}`} className="text-xs text-muted-foreground">
                    {month}
                  </Label>
                  <Input
                    id={`sr-hsp-${i}`}
                    inputMode="decimal"
                    aria-invalid={errors.hsp ? true : undefined}
                    {...form.register(`hsp.${i}` as const)}
                  />
                </div>
              ))}
            </div>
            {errors.hsp ? (
              <p role="alert" className="text-xs text-destructive">
                {errors.hsp}
              </p>
            ) : null}
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="sr-source" label="Origem do dado" error={errors.source}>
              <Input
                id="sr-source"
                placeholder="Ex.: CRESESB SunData"
                {...form.register('source')}
              />
            </Field>
            <Field id="sr-plane" label="Plano">
              <Input id="sr-plane" {...form.register('plane')} />
            </Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => close(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? <Spinner /> : null}
              Cadastrar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [parsed, setParsed] = useState<CsvParseResult | null>(null);
  const [fileName, setFileName] = useState('');

  const close = (next: boolean) => {
    if (!next) {
      setParsed(null);
      setFileName('');
    }
    onOpenChange(next);
  };

  const run = useMutation({
    mutationFn: () => endpoints.solarResources.import({ rows: parsed?.rows ?? [] }),
    onSuccess: async (result) => {
      toast.success(`Importação concluída: ${result.created} novos, ${result.updated} atualizados`);
      close(false);
      await queryClient.invalidateQueries({ queryKey: queryKeys.solarResources() });
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível importar o arquivo.')),
  });

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    setParsed(parseSolarResourcesCsv(await file.text()));
  };

  const downloadTemplate = () => {
    const url = URL.createObjectURL(new Blob([SOLAR_RESOURCES_CSV_TEMPLATE], { type: 'text/csv' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'modelo-irradiacao.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Importar irradiação (CSV)</DialogTitle>
          <DialogDescription>
            Colunas: nome, uf, latitude, longitude, fonte, plano (opcional) e jan a dez. Use “;” com
            decimais em vírgula, ou “,” com decimais em ponto. Cada local precisa de fonte.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-fit"
            onClick={downloadTemplate}
          >
            <Download /> Baixar modelo
          </Button>
          <Field id="sr-file" label="Arquivo CSV">
            <Input
              id="sr-file"
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
          </Field>
          {parsed ? (
            <div className="space-y-2 text-sm" aria-live="polite">
              <p>
                <strong>{fileName}</strong>: {parsed.rows.length} local(is) válido(s)
                {parsed.errors.length > 0 ? `, ${parsed.errors.length} com problema` : ''}.
              </p>
              {parsed.errors.length > 0 ? (
                <Alert variant="warning">
                  <AlertTitle>Corrija o arquivo e envie de novo</AlertTitle>
                  <AlertDescription>
                    <ul className="mt-1 max-h-40 list-disc space-y-0.5 overflow-auto pl-5">
                      {parsed.errors.slice(0, 20).map((message) => (
                        <li key={message}>{message}</li>
                      ))}
                      {parsed.errors.length > 20 ? (
                        <li>… e mais {parsed.errors.length - 20}.</li>
                      ) : null}
                    </ul>
                  </AlertDescription>
                </Alert>
              ) : null}
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => close(false)}>
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={
              !parsed || parsed.errors.length > 0 || parsed.rows.length === 0 || run.isPending
            }
            onClick={() => run.mutate()}
          >
            {run.isPending ? <Spinner /> : <Upload />}
            Importar {parsed && parsed.errors.length === 0 ? parsed.rows.length : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SolarResourcesPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [deleting, setDeleting] = useState<SolarResourceDto | null>(null);
  const debouncedSearch = useDebouncedValue(search.trim());

  const filters = { page, search: debouncedSearch };
  const list = useQuery({
    queryKey: queryKeys.solarResources(filters),
    queryFn: () =>
      endpoints.solarResources.list({
        page,
        pageSize: PAGE_SIZE,
        search: debouncedSearch || undefined,
      }),
    placeholderData: keepPreviousData,
  });

  const remove = useMutation({
    mutationFn: (id: string) => endpoints.solarResources.remove(id),
    onSuccess: async () => {
      toast.success('Irradiação excluída');
      await queryClient.invalidateQueries({ queryKey: queryKeys.solarResources() });
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível excluir a irradiação.')),
  });

  return (
    <Card>
      <CardHeader className="flex-col items-start justify-between gap-3 space-y-0 sm:flex-row">
        <div className="space-y-1.5">
          <CardTitle>Irradiação solar</CardTitle>
          <CardDescription>
            HSP mensal por local, sempre com a fonte. O sistema não traz dados prontos: cadastre ou
            importe de uma fonte oficial (ex.: CRESESB, Atlas Solar).
          </CardDescription>
        </div>
        <Can permission="platform.rule.manage">
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setImporting(true)}>
              <Upload /> Importar CSV
            </Button>
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus /> Novo local
            </Button>
          </div>
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
            placeholder="Buscar por local"
            aria-label="Buscar irradiação"
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
          <p className="text-sm text-destructive">Não foi possível carregar a irradiação.</p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Local</TableHead>
                  <TableHead>HSP médio</TableHead>
                  <TableHead>Fonte</TableHead>
                  <TableHead className="w-16 text-right">
                    <span className="sr-only">Ações</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.data.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                      {debouncedSearch
                        ? 'Nenhum local encontrado com essa busca.'
                        : 'Nenhum local cadastrado. Cadastre um ou importe um CSV.'}
                    </TableCell>
                  </TableRow>
                ) : (
                  list.data.data.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">
                        {r.name}
                        {r.state ? (
                          <span className="text-muted-foreground"> — {r.state}</span>
                        ) : null}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {formatNumber(r.hspMonthly.reduce((s, v) => s + v, 0) / 12, 2)} kWh/m²·dia
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {r.source} · {r.plane}
                      </TableCell>
                      <TableCell className="text-right">
                        <Can permission="platform.rule.manage">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Excluir ${r.name}`}
                            onClick={() => setDeleting(r)}
                          >
                            <Trash2 />
                          </Button>
                        </Can>
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
      <ResourceDialog open={creating} onOpenChange={setCreating} />
      <ImportDialog open={importing} onOpenChange={setImporting} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Excluir irradiação?"
        description={
          <>
            <strong>{deleting?.name}</strong> deixa de aparecer na escolha de local. Cálculos já
            salvos não mudam.
          </>
        }
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </Card>
  );
}
