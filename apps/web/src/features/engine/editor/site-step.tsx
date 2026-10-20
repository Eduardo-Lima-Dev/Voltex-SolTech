import { useMutation } from '@tanstack/react-query';
import type { SiteDesign } from '@voltex/shared';
import { CloudDownload } from 'lucide-react';
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
  Spinner,
  toast,
} from '@voltex/ui';
import { BRAZILIAN_STATES } from '@/i18n/labels';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api/errors';
import { formatDateTime, formatNumber } from '@/lib/format';
import { useEditor } from './editor-context';
import { NumberField } from './number-field';

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** Etapa 1: local, clima (da Central de Dados) e temperatura de projeto. */
export function SiteStep() {
  const { design, update, readOnly } = useEditor();
  return (
    <SiteStepView
      site={design.site}
      readOnly={readOnly}
      set={(patch) => update((d) => ({ ...d, site: { ...d.site, ...patch } }))}
    />
  );
}

/** Mesmas telas do local para qualquer produto que tenha um `SiteDesign` (Engine e Off-Grid). */
export function SiteStepView({
  site,
  set,
  readOnly,
}: {
  site: SiteDesign;
  set: (patch: Partial<SiteDesign>) => void;
  readOnly: boolean;
}) {
  const climate = useMutation({
    mutationFn: () =>
      endpoints.dataHub.weather({
        latitude: site.latitude,
        longitude: site.longitude,
        source: 'nasa-power',
        kind: 'climatology',
      }),
    onSuccess: (w) => {
      const s = w.summary;
      set({
        climate: {
          source: 'nasa-power',
          period: w.period,
          fetchedAt: w.fetchedAt,
          ghiKwhM2Day: s.ghiKwhM2Day,
          tempMeanC: s.tempMeanC,
          tempMinC: Array.isArray(s.tempMinC)
            ? s.tempMinC
            : Array<number | null>(12).fill(s.tempMinC),
          tempMaxC: Array.isArray(s.tempMaxC)
            ? s.tempMaxC
            : Array<number | null>(12).fill(s.tempMaxC),
          attribution: w.attribution,
        },
        ...(s.elevationM !== null && site.elevationM === undefined
          ? { elevationM: Math.round(s.elevationM) }
          : {}),
      });
      toast.success(w.cached ? 'Clima carregado do cache.' : 'Clima buscado na NASA POWER.');
      for (const warning of w.warnings) toast.message(warning);
    },
    onError: (e) => toast.error(errorMessage(e, 'Não foi possível buscar o clima.')),
  });
  const horizon = useMutation({
    mutationFn: () =>
      endpoints.dataHub.horizon({ latitude: site.latitude, longitude: site.longitude }),
    onSuccess: (h) => {
      set({ horizon: { source: 'pvgis', fetchedAt: h.fetchedAt, points: h.points } });
      toast.success(h.cached ? 'Horizonte carregado do cache.' : 'Horizonte buscado no PVGIS.');
      for (const warning of h.warnings) toast.message(warning);
    },
    onError: (e) => toast.error(errorMessage(e, 'Não foi possível buscar o horizonte.')),
  });

  const minOfMin = site.climate
    ? Math.min(...(site.climate.tempMinC.filter((v) => v !== null) as number[]))
    : null;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Local</CardTitle>
          <CardDescription>
            Coordenadas do projeto. O clima e o horizonte são buscados por elas.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="grid gap-1">
            <Label htmlFor="site-name">Nome do local</Label>
            <Input
              id="site-name"
              disabled={readOnly}
              value={site.name ?? ''}
              onChange={(e) => set({ name: e.target.value })}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="site-city">Cidade</Label>
            <Input
              id="site-city"
              disabled={readOnly}
              value={site.city ?? ''}
              onChange={(e) => set({ city: e.target.value })}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="site-uf">UF</Label>
            <NativeSelect
              id="site-uf"
              disabled={readOnly}
              value={site.state ?? ''}
              onChange={(e) => set({ state: e.target.value || undefined })}
            >
              <option value="">Não informada</option>
              {BRAZILIAN_STATES.map((uf) => (
                <option key={uf} value={uf}>
                  {uf}
                </option>
              ))}
            </NativeSelect>
          </div>
          <NumberField
            id="site-lat"
            label="Latitude"
            unit="°"
            min={-90}
            max={90}
            value={site.latitude}
            disabled={readOnly}
            onChange={(v) => v !== undefined && set({ latitude: v })}
            hint="Negativa no hemisfério sul"
          />
          <NumberField
            id="site-lng"
            label="Longitude"
            unit="°"
            min={-180}
            max={180}
            value={site.longitude}
            disabled={readOnly}
            onChange={(v) => v !== undefined && set({ longitude: v })}
            hint="Negativa no Brasil"
          />
          <NumberField
            id="site-elev"
            label="Altitude"
            unit="m"
            optional
            min={-500}
            max={9000}
            value={site.elevationM}
            disabled={readOnly}
            onChange={(v) => set({ elevationM: v })}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle>Clima do local</CardTitle>
            <CardDescription>
              Irradiação e temperaturas médias vindas da NASA POWER, pela Central de Dados. Ficam
              guardadas na versão, com a origem.
            </CardDescription>
          </div>
          {!readOnly ? (
            <Button
              size="sm"
              variant="outline"
              disabled={climate.isPending}
              onClick={() => climate.mutate()}
            >
              {climate.isPending ? <Spinner /> : <CloudDownload />} Buscar clima
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-3">
          {site.climate ? (
            <>
              <p className="text-xs text-muted-foreground">
                {site.climate.attribution} Coletado em {formatDateTime(site.climate.fetchedAt)}.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm tabular-nums">
                  <thead>
                    <tr className="text-left text-muted-foreground">
                      <th className="pr-3 font-normal"> </th>
                      {MONTHS.map((m) => (
                        <th key={m} className="px-1 text-right font-normal">
                          {m}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ['HSP (kWh/m²·dia)', site.climate.ghiKwhM2Day, 2],
                      ['Temp. média (°C)', site.climate.tempMeanC, 1],
                      ['Mín. mensal (°C)', site.climate.tempMinC, 1],
                      ['Máx. mensal (°C)', site.climate.tempMaxC, 1],
                    ].map(([label, values, digits]) => (
                      <tr key={String(label)} className="border-t">
                        <td className="py-1 pr-3 text-muted-foreground">{String(label)}</td>
                        {(values as (number | null)[]).map((v, i) => (
                          <td key={i} className="px-1 text-right">
                            {v === null ? '—' : formatNumber(v, Number(digits))}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Clima ainda não buscado.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Temperatura de projeto</CardTitle>
          <CardDescription>
            Usada no Voc frio (tensão máxima das strings). <strong>Não é a mínima da fonte:</strong>{' '}
            dados de grade suavizam os extremos. Quem define é o responsável técnico, com a fonte
            (ex.: registro da estação do INMET mais próxima).
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <NumberField
            id="site-tmin"
            label="Temperatura mínima de projeto"
            unit="°C"
            optional
            min={-60}
            max={30}
            value={site.designTminC}
            disabled={readOnly}
            onChange={(v) => set({ designTminC: v ?? null })}
            hint={
              minOfMin !== null
                ? `Referência da fonte (média das mínimas): ${formatNumber(minOfMin, 1)} °C`
                : undefined
            }
          />
          <NumberField
            id="site-tmax"
            label="Temperatura ambiente máxima"
            unit="°C"
            optional
            min={0}
            max={60}
            value={site.designTmaxAmbientC}
            disabled={readOnly}
            onChange={(v) => set({ designTmaxAmbientC: v ?? null })}
          />
          <div className="grid gap-1">
            <Label htmlFor="site-tsource">Fonte da temperatura</Label>
            <Input
              id="site-tsource"
              disabled={readOnly}
              value={site.designTemperatureSource ?? ''}
              onChange={(e) => set({ designTemperatureSource: e.target.value })}
              placeholder="Ex.: INMET, estação A001, 1991–2020"
            />
          </div>
          {site.designTminC === null ? (
            <p className="text-sm text-muted-foreground sm:col-span-3">
              Sem a temperatura mínima de projeto, o Voc frio das strings não pode ser verificado
              nas próximas etapas.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle>Horizonte</CardTitle>
            <CardDescription>
              Perfil do relevo ao redor (PVGIS), usado no sombreamento distante.
            </CardDescription>
          </div>
          {!readOnly ? (
            <Button
              size="sm"
              variant="outline"
              disabled={horizon.isPending}
              onClick={() => horizon.mutate()}
            >
              {horizon.isPending ? <Spinner /> : <CloudDownload />} Buscar horizonte
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="text-sm">
          {site.horizon ? (
            <p className="flex flex-wrap items-center gap-2">
              <Badge variant="green">horizonte carregado</Badge>
              {site.horizon.points.length} pontos · altura máxima{' '}
              {formatNumber(Math.max(...site.horizon.points.map((p) => p.heightDegrees)), 1)}° ·
              coletado em {formatDateTime(site.horizon.fetchedAt)}
            </p>
          ) : (
            <p className="text-muted-foreground">
              Horizonte ainda não buscado: o sombreamento considera só os obstáculos informados.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
