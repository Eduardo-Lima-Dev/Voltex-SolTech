import type { OffgridCheck } from '@voltex/shared';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@voltex/ui';
import { formatNumber } from '@/lib/format';
import { useOffgrid } from './offgrid-context';

type Status = 'OK' | 'WARNING' | 'ERROR' | 'NONE';

const STROKE: Record<Status, string> = {
  OK: 'stroke-emerald-600',
  WARNING: 'stroke-amber-500',
  ERROR: 'stroke-red-600',
  NONE: 'stroke-slate-400',
};
const FILL: Record<Status, string> = {
  OK: 'fill-emerald-50',
  WARNING: 'fill-amber-50',
  ERROR: 'fill-red-50',
  NONE: 'fill-slate-50',
};
const STATUS_LABEL: Record<Status, string> = {
  OK: 'atende',
  WARNING: 'aviso',
  ERROR: 'erro',
  NONE: 'sem verificação',
};

const statusOf = (checks: OffgridCheck[], prefixes: string[]): Status => {
  const own = checks.filter((c) => prefixes.some((p) => c.code.startsWith(p)));
  if (own.some((c) => c.severity === 'ERROR')) return 'ERROR';
  if (own.some((c) => c.severity === 'WARNING')) return 'WARNING';
  return own.length > 0 ? 'OK' : 'NONE';
};

function Node({
  x,
  y,
  w = 220,
  h = 86,
  title,
  lines,
  status,
  step,
  onOpen,
}: {
  x: number;
  y: number;
  w?: number;
  h?: number;
  title: string;
  lines: string[];
  status: Status;
  step: string;
  onOpen: (step: string) => void;
}) {
  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={`${title}: ${STATUS_LABEL[status]}. Abrir a etapa`}
      className="cursor-pointer outline-none"
      onClick={() => onOpen(step)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(step);
        }
      }}
    >
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={8}
        className={`${FILL[status]} ${STROKE[status]}`}
        strokeWidth={2}
      />
      <text x={x + 10} y={y + 20} fontSize={12} fontWeight={600} className="fill-slate-900">
        {title}
      </text>
      {lines.slice(0, 4).map((line, i) => (
        <text key={i} x={x + 10} y={y + 38 + i * 14} fontSize={10.5} className="fill-slate-700">
          {line.length > 36 ? `${line.slice(0, 35)}…` : line}
        </text>
      ))}
    </g>
  );
}

function Edge({
  x1,
  y1,
  x2,
  y2,
  label,
  dc = true,
  dashed,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label?: string;
  dc?: boolean;
  dashed?: boolean;
}) {
  return (
    <g>
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        className={dc ? 'stroke-red-600' : 'stroke-blue-700'}
        strokeWidth={2.2}
        strokeDasharray={dashed ? '6 4' : undefined}
        markerEnd="url(#arrow)"
      />
      {label ? (
        <text
          x={(x1 + x2) / 2}
          y={(y1 + y2) / 2 - 6}
          fontSize={10}
          textAnchor="middle"
          className="fill-slate-800"
        >
          {label}
        </text>
      ) : null}
    </g>
  );
}

/** Etapa 7: diagrama do sistema, com o estado de cada bloco e os valores do cálculo. Clicar abre a etapa do bloco. */
export function DiagramStep() {
  const { design, results, labelOf, goToStep } = useOffgrid();
  const { checks, selected, sizing, load } = results;
  const runs = results.layout?.runs ?? [];
  const run = (id: string) => runs.find((r) => r.id === id);
  const arrays = design.arrays;
  const hybrid = design.systemType === 'HYBRID';
  const generator = design.generator.enabled;
  const rowH = 104;
  const pvTop = 70;
  const midY = Math.max(160, pvTop + (arrays.length * rowH) / 2 - 43);
  const below = hybrid ? 290 : design.loads.some((l) => l.kind === 'DC') ? 240 : 110;
  const height = Math.max(midY + below, pvTop + arrays.length * rowH + 30);
  const arrayStatus = statusOf(checks, ['VOC_', 'VMPP_', 'ARRAY_BELOW', 'PWM_']);
  const dcLoads = design.loads.some((l) => l.kind === 'DC');
  const dcCurrent = (a: (typeof arrays)[number]) => {
    const r = run(`pv-${a.id}`);
    return r
      ? `${formatNumber(r.currentA, 1)} A · ${r.suggestedSectionMm2 ?? '>240'} mm² · ${formatNumber(r.distanceM, 0)} m`
      : undefined;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Diagrama do sistema</CardTitle>
        <CardDescription>
          Fluxo de energia do projeto com os valores do cálculo. A cor de cada bloco é o resultado
          das verificações; clique para abrir a etapa. Vermelho = corrente contínua, azul tracejado
          = corrente alternada.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2 text-xs" aria-label="Legenda">
          {(['OK', 'WARNING', 'ERROR', 'NONE'] as const).map((s) => (
            <Badge
              key={s}
              variant={
                s === 'OK'
                  ? 'green'
                  : s === 'WARNING'
                    ? 'yellow'
                    : s === 'ERROR'
                      ? 'red'
                      : 'outline'
              }
            >
              {STATUS_LABEL[s]}
            </Badge>
          ))}
        </div>
        <svg
          role="group"
          aria-label="Diagrama do sistema off-grid"
          viewBox={`0 0 1120 ${height}`}
          className="w-full rounded border bg-card"
        >
          <defs>
            <marker
              id="arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M0 0 L10 5 L0 10 z" className="fill-slate-700" />
            </marker>
          </defs>
          <text x={20} y={30} fontSize={13} fontWeight={600} className="fill-slate-900">
            {design.systemType === 'HYBRID'
              ? 'Sistema híbrido (rede + bateria, sem injeção)'
              : 'Sistema isolado'}{' '}
            · banco de {design.systemVoltageV} V
          </text>
          {arrays.map((a, i) => (
            <g key={a.id}>
              <Node
                x={20}
                y={pvTop + i * rowH}
                title={`FV: ${a.name}`}
                lines={[
                  `${a.modulesInSeries}×${a.parallelStrings} · ${labelOf(a.moduleId)}`,
                  `${a.azimuthDegrees.toFixed(0)}° az · ${a.tiltDegrees.toFixed(0)}° incl.`,
                  `sombra ${formatNumber(a.shadingLossPct, 1)}%`,
                ]}
                status={arrayStatus}
                step="arranjo"
                onOpen={goToStep}
              />
              <Edge
                x1={240}
                y1={pvTop + i * rowH + 43}
                x2={330}
                y2={midY + 43}
                label={dcCurrent(a)}
              />
            </g>
          ))}
          {arrays.length === 0 ? (
            <Node
              x={20}
              y={pvTop}
              title="Arranjo FV"
              lines={['Nenhum arranjo cadastrado']}
              status="NONE"
              step="arranjo"
              onOpen={goToStep}
            />
          ) : null}
          <Node
            x={330}
            y={midY}
            title={design.controllerId ? 'Controlador de carga' : 'MPPT'}
            lines={[
              design.controllerId ? labelOf(design.controllerId) : 'embutido no inversor',
              selected
                ? `${formatNumber(selected.controllerCurrentA, 0)} A instalados`
                : 'sem seleção',
              sizing.controllerCurrentA !== null
                ? `estimado ${formatNumber(sizing.controllerCurrentA, 0)} A`
                : '',
            ]}
            status={statusOf(checks, ['CONTROLLER_'])}
            step="conversao"
            onOpen={goToStep}
          />
          <Edge
            x1={550}
            y1={midY + 43}
            x2={640}
            y2={midY + 43}
            label={`${design.systemVoltageV} V`}
          />
          <Node
            x={640}
            y={midY}
            title="Banco de baterias"
            lines={[
              labelOf(design.bank.batteryId),
              selected
                ? `${design.bank.seriesCount}S×${design.bank.parallelCount}P · ${formatNumber(selected.bankNominalWh / 1000, 1)} kWh`
                : 'sem seleção',
              selected ? `útil ${formatNumber(selected.bankUsableWh / 1000, 1)} kWh` : '',
              sizing.bankWhRequired !== null
                ? `necessário ${formatNumber(sizing.bankWhRequired / 1000, 1)} kWh`
                : '',
            ]}
            status={statusOf(checks, ['BANK_', 'AUTONOMY', 'DOD', 'CHARGE_RATE', 'BATTERY_'])}
            step="banco"
            onOpen={goToStep}
          />
          <Edge
            x1={860}
            y1={midY + 43}
            x2={930}
            y2={midY + 43}
            label={
              run('dc-bank')
                ? `${formatNumber(run('dc-bank')?.currentA ?? 0, 0)} A · ${run('dc-bank')?.suggestedSectionMm2 ?? '>240'} mm²`
                : undefined
            }
          />
          <Node
            x={930}
            y={midY}
            w={170}
            title="Inversor"
            lines={[
              labelOf(design.inverterId),
              selected
                ? `${formatNumber(selected.inverterContinuousW, 0)} W · surto ${formatNumber(selected.inverterSurgeW, 0)} W`
                : 'sem seleção',
              `pico ${formatNumber(load.peakW, 0)} W · partida ${formatNumber(load.surgeW, 0)} W`,
            ]}
            status={statusOf(checks, ['INVERTER_'])}
            step="conversao"
            onOpen={goToStep}
          />
          <Edge
            x1={1015}
            y1={midY}
            x2={1015}
            y2={midY - 52}
            dc={false}
            label={
              run('ac-load')
                ? `${formatNumber(run('ac-load')?.currentA ?? 0, 1)} A · ${run('ac-load')?.suggestedSectionMm2 ?? '>240'} mm²`
                : undefined
            }
          />
          <Node
            x={930}
            y={midY - 138}
            w={170}
            h={86}
            title="Cargas CA"
            lines={[
              `${formatNumber(load.dailyAcWh, 0)} Wh/dia`,
              `${design.loads.filter((l) => l.kind === 'AC').length} carga(s)`,
              `crítica ${formatNumber(load.criticalDailyWh, 0)} Wh/dia`,
            ]}
            status="NONE"
            step="cargas"
            onOpen={goToStep}
          />
          {dcLoads ? (
            <>
              <Edge x1={750} y1={midY + 86} x2={750} y2={midY + 140} />
              <Node
                x={640}
                y={midY + 140}
                title="Cargas CC"
                lines={[`${formatNumber(load.dailyDcWh, 0)} Wh/dia`, 'direto no banco']}
                status="NONE"
                step="cargas"
                onOpen={goToStep}
              />
            </>
          ) : null}
          {generator ? (
            <>
              <Edge
                x1={860}
                y1={midY - 95}
                x2={950}
                y2={midY}
                dc={false}
                dashed
                label={
                  run('ac-gen') ? `${run('ac-gen')?.suggestedSectionMm2 ?? '>240'} mm²` : undefined
                }
              />
              <Node
                x={640}
                y={midY - 138}
                title="Gerador"
                lines={[
                  labelOf(design.generator.generatorId),
                  `liga ${design.generator.startSocPct}% · desliga ${design.generator.stopSocPct}%`,
                  results.simulation?.generatorHours
                    ? `${results.simulation.generatorHours} h/ano`
                    : '',
                ]}
                status={statusOf(checks, ['GENERATOR_', 'INVERTER_NO_GENERATOR'])}
                step="gerador"
                onOpen={goToStep}
              />
            </>
          ) : null}
          {hybrid ? (
            <>
              <Edge
                x1={1015}
                y1={midY + 190}
                x2={1015}
                y2={midY + 86}
                dc={false}
                dashed
                label="sem injeção"
              />
              <Node
                x={930}
                y={midY + 190}
                w={170}
                title="Rede elétrica"
                lines={[
                  design.grid?.mode === 'SELF_CONSUMPTION' ? 'autoconsumo' : 'reserva (backup)',
                  run('ac-grid')
                    ? `${run('ac-grid')?.suggestedSectionMm2 ?? '>240'} mm² · ${formatNumber(run('ac-grid')?.distanceM ?? 0, 0)} m`
                    : '',
                ]}
                status={statusOf(checks, ['INVERTER_NOT_HYBRID', 'INVERTER_HYBRID'])}
                step="gerador"
                onOpen={goToStep}
              />
            </>
          ) : null}
        </svg>
        {results.simulation ? (
          <p className="text-sm text-muted-foreground">
            Simulação: perda de carga {formatNumber(results.simulation.lolpPct, 2)}%, FV{' '}
            {formatNumber(results.simulation.pvKwh, 0)} kWh/ano, SOC mínimo{' '}
            {formatNumber(results.simulation.minSocPct, 0)}%.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
