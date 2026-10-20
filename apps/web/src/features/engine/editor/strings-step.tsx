import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, CircleAlert, CircleHelp, Plus, Trash2, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import type {
  CompatibilityCheck,
  CompatibilityStatus,
  EngineeringDesign,
  InverterCompatibility,
  InverterEntry,
  InverterSpec,
  StringGroup,
  SuggestedConfiguration,
} from '@voltex/shared';
import { stringLimits } from '@voltex/solar-engine';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Label,
  NativeSelect,
  Spinner,
  toast,
} from '@voltex/ui';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api/errors';
import { formatCents, formatNumber } from '@/lib/format';
import { useEditor } from './editor-context';
import { EquipmentSearch } from './equipment-search';
import { NumberField } from './number-field';

let counter = 0;
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${(counter++).toString(36)}`;

export const COMPATIBILITY_LABELS: Record<
  CompatibilityStatus,
  { label: string; variant: 'green' | 'yellow' | 'red' | 'secondary' }
> = {
  VALID: { label: 'Válido', variant: 'green' },
  VALID_WITH_WARNINGS: { label: 'Válido com avisos', variant: 'yellow' },
  INVALID: { label: 'Inválido', variant: 'red' },
  INCOMPLETE: { label: 'Incompleto', variant: 'secondary' },
};

function CheckRow({ check }: { check: CompatibilityCheck }) {
  const Icon =
    check.outcome === 'PASS'
      ? CheckCircle2
      : check.outcome === 'PENDING'
        ? CircleHelp
        : check.severity === 'ERROR'
          ? XCircle
          : CircleAlert;
  const color =
    check.outcome === 'PASS'
      ? 'text-success'
      : check.outcome === 'PENDING'
        ? 'text-muted-foreground'
        : check.severity === 'ERROR'
          ? 'text-destructive'
          : 'text-warning';
  const outcome = {
    PASS: 'passou',
    FAIL: check.severity === 'ERROR' ? 'falhou' : 'aviso',
    PENDING: 'pendente',
  }[check.outcome];
  return (
    <li className="rounded-md border p-2 text-sm">
      <div className="flex items-start gap-2">
        <Icon aria-hidden className={`mt-0.5 size-4 shrink-0 ${color}`} />
        <div className="min-w-0 flex-1">
          <p>
            <span className="sr-only">{outcome}: </span>
            {check.message}
          </p>
          <details className="mt-1 text-xs text-muted-foreground">
            <summary className="cursor-pointer">Como foi calculado</summary>
            <dl className="mt-1 grid gap-0.5">
              <div>
                <dt className="inline font-medium">Verificação: </dt>
                <dd className="inline">{check.code}</dd>
              </div>
              <div>
                <dt className="inline font-medium">Fórmula: </dt>
                <dd className="inline">{check.formula}</dd>
              </div>
              {check.value !== null ? (
                <div>
                  <dt className="inline font-medium">Valor × limite: </dt>
                  <dd className="inline tabular-nums">
                    {formatNumber(check.value, 2)} {check.unit}{' '}
                    {check.limit !== null ? `× ${formatNumber(check.limit, 2)} ${check.unit}` : ''}
                  </dd>
                </div>
              ) : null}
              <div>
                <dt className="inline font-medium">Fonte: </dt>
                <dd className="inline">{check.source}</dd>
              </div>
            </dl>
          </details>
        </div>
      </div>
    </li>
  );
}

/** Verificações agrupadas: as que não passaram primeiro. */
function Checks({ checks }: { checks: CompatibilityCheck[] }) {
  const order = { FAIL: 0, PENDING: 1, PASS: 2 } as const;
  const sorted = [...checks].sort((a, b) => order[a.outcome] - order[b.outcome]);
  const failing = sorted.filter((c) => c.outcome !== 'PASS');
  const passing = sorted.filter((c) => c.outcome === 'PASS');
  return (
    <div className="space-y-2">
      {failing.length > 0 ? (
        <ul className="space-y-2" aria-label="Verificações que não passaram">
          {failing.map((c, i) => (
            <CheckRow key={`${c.code}-${c.scope}-${i}`} check={c} />
          ))}
        </ul>
      ) : null}
      {passing.length > 0 ? (
        <details>
          <summary className="cursor-pointer text-sm text-muted-foreground">
            {passing.length} verificação(ões) que passaram
          </summary>
          <ul className="mt-2 space-y-2">
            {passing.map((c, i) => (
              <CheckRow key={`${c.code}-${c.scope}-${i}`} check={c} />
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function StringGroupEditor({
  group,
  surfaces,
  limitsHint,
  readOnly,
  onChange,
  onRemove,
}: {
  group: StringGroup;
  surfaces: EngineeringDesign['surfaces'];
  limitsHint: string | null;
  readOnly: boolean;
  onChange: (g: StringGroup) => void;
  onRemove: () => void;
}) {
  const p = `sg-${group.id}`;
  return (
    <div className="grid items-end gap-3 rounded-md border p-2 sm:grid-cols-[1fr_8rem_8rem_auto]">
      <div className="grid gap-1">
        <Label htmlFor={`${p}-surface`}>Superfície</Label>
        <NativeSelect
          id={`${p}-surface`}
          disabled={readOnly}
          value={group.surfaceId}
          onChange={(e) => onChange({ ...group, surfaceId: e.target.value })}
        >
          {surfaces.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      <NumberField
        id={`${p}-n`}
        label="Módulos em série"
        integer
        min={1}
        max={60}
        value={group.modulesInSeries}
        disabled={readOnly}
        onChange={(v) => v !== undefined && onChange({ ...group, modulesInSeries: v })}
        hint={limitsHint ?? undefined}
      />
      <NumberField
        id={`${p}-p`}
        label="Strings em paralelo"
        integer
        min={1}
        max={20}
        value={group.parallel}
        disabled={readOnly}
        onChange={(v) => v !== undefined && onChange({ ...group, parallel: v })}
      />
      {!readOnly ? (
        <Button size="icon" variant="ghost" aria-label="Remover string" onClick={onRemove}>
          <Trash2 />
        </Button>
      ) : null}
    </div>
  );
}

function InverterCard({
  entry,
  compat,
}: {
  entry: InverterEntry;
  compat: InverterCompatibility | undefined;
}) {
  const { design, update, readOnly, inverters, results } = useEditor();
  const item = inverters.find((i) => i.id === entry.inverterId) ?? null;
  const spec = item?.spec as unknown as InverterSpec | undefined;
  const patch = (fn: (e: InverterEntry) => InverterEntry) =>
    update((d) => ({ ...d, inverters: d.inverters.map((e) => (e.id === entry.id ? fn(e) : e)) }));

  const hintFor = (surfaceId: string): string | null => {
    if (!spec) return null;
    const surface = design.surfaces.find((s) => s.id === surfaceId);
    const moduleId = surface?.moduleId ?? design.defaultModuleId;
    const t = results.compatibility.thermal.find((x) => x.moduleId === moduleId);
    if (!t || t.vocColdV === null || t.vmppColdV === null || t.vmppHotV === null) return null;
    const l = stringLimits({
      vocColdV: t.vocColdV,
      vmppColdV: t.vmppColdV,
      vmppHotV: t.vmppHotV,
      inverter: {
        maxDcVoltageV: spec.vDcMaxV,
        mpptMinV: spec.mpptMinV,
        mpptMaxV: spec.mpptMaxV,
        startVoltageV: spec.vStartV,
      },
    });
    return l.feasible ? `Permitido: ${l.minModules} a ${l.maxModules}` : 'Nenhum nº atende a faixa';
  };

  const title = entry.name?.trim() || (item ? `${item.manufacturer} ${item.model}` : 'Inversor');

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            {title}
            {compat ? (
              <Badge variant={COMPATIBILITY_LABELS[compat.status].variant}>
                {COMPATIBILITY_LABELS[compat.status].label}
              </Badge>
            ) : null}
          </CardTitle>
          <CardDescription>
            {spec
              ? `${spec.topology === 'MICRO' ? 'Microinversor' : 'Inversor'} · ${formatNumber(spec.pAcNomW / 1000, 2)} kW · ${spec.mpptCount} MPPT · MPPT ${spec.mpptMinV}–${spec.mpptMaxV} V · Vcc máx. ${spec.vDcMaxV} V`
              : 'Inversor não encontrado entre os aprovados.'}
          </CardDescription>
        </div>
        {!readOnly ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              update((d) => ({ ...d, inverters: d.inverters.filter((e) => e.id !== entry.id) }))
            }
          >
            <Trash2 /> Remover inversor
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {compat ? (
          <p className="flex flex-wrap gap-2 text-sm">
            <Badge variant="secondary">{compat.metrics.modulesConnected} módulos ligados</Badge>
            <Badge variant="secondary">{formatNumber(compat.metrics.dcPowerKwp, 2)} kWp CC</Badge>
            <Badge variant="secondary">{formatNumber(compat.metrics.acPowerKw, 2)} kW CA</Badge>
            {compat.metrics.dcAcRatio !== null ? (
              <Badge variant="secondary">CC/CA {formatNumber(compat.metrics.dcAcRatio, 2)}</Badge>
            ) : null}
          </p>
        ) : null}

        {spec?.topology === 'MICRO' ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-1">
              <Label htmlFor={`mi-${entry.id}-surface`}>Superfície</Label>
              <NativeSelect
                id={`mi-${entry.id}-surface`}
                disabled={readOnly}
                value={entry.micro?.surfaceId ?? ''}
                onChange={(e) =>
                  patch((en) => ({
                    ...en,
                    micro: {
                      surfaceId: e.target.value,
                      units: en.micro?.units ?? 1,
                      modulesPerUnit: en.micro?.modulesPerUnit ?? 1,
                    },
                  }))
                }
              >
                <option value="">Selecione</option>
                {design.surfaces.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <NumberField
              id={`mi-${entry.id}-units`}
              label="Unidades"
              integer
              min={1}
              max={500}
              value={entry.micro?.units}
              disabled={readOnly || !entry.micro}
              onChange={(v) =>
                v !== undefined &&
                entry.micro &&
                patch((en) => ({
                  ...en,
                  micro: { ...(en.micro as NonNullable<InverterEntry['micro']>), units: v },
                }))
              }
            />
            <NumberField
              id={`mi-${entry.id}-mpu`}
              label="Módulos por unidade"
              integer
              min={1}
              max={8}
              value={entry.micro?.modulesPerUnit}
              disabled={readOnly || !entry.micro}
              onChange={(v) =>
                v !== undefined &&
                entry.micro &&
                patch((en) => ({
                  ...en,
                  micro: {
                    ...(en.micro as NonNullable<InverterEntry['micro']>),
                    modulesPerUnit: v,
                  },
                }))
              }
              hint={
                spec ? `Entradas por unidade: ${spec.mpptCount * spec.inputsPerMppt}` : undefined
              }
            />
          </div>
        ) : (
          <div className="space-y-3">
            {Array.from({ length: spec?.mpptCount ?? entry.mppts.length }, (_, index) => {
              const mppt = entry.mppts[index] ?? { strings: [] };
              const setStrings = (strings: StringGroup[]) =>
                patch((en) => {
                  const mppts = [...en.mppts];
                  while (mppts.length <= index) mppts.push({ strings: [] });
                  mppts[index] = { strings };
                  return { ...en, mppts };
                });
              return (
                <fieldset key={index} className="space-y-2 rounded-lg border p-3">
                  <legend className="px-1 text-sm font-medium">MPPT {index + 1}</legend>
                  {mppt.strings.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Sem strings ligadas.</p>
                  ) : null}
                  {mppt.strings.map((g) => (
                    <StringGroupEditor
                      key={g.id}
                      group={g}
                      surfaces={design.surfaces}
                      limitsHint={hintFor(g.surfaceId)}
                      readOnly={readOnly}
                      onChange={(next) =>
                        setStrings(mppt.strings.map((x) => (x.id === g.id ? next : x)))
                      }
                      onRemove={() => setStrings(mppt.strings.filter((x) => x.id !== g.id))}
                    />
                  ))}
                  {!readOnly && design.surfaces.length > 0 ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setStrings([
                          ...mppt.strings,
                          {
                            id: newId('g'),
                            surfaceId: design.surfaces[0]!.id,
                            modulesInSeries: 6,
                            parallel: 1,
                          },
                        ])
                      }
                    >
                      <Plus /> Adicionar string
                    </Button>
                  ) : null}
                </fieldset>
              );
            })}
          </div>
        )}

        {compat ? <Checks checks={compat.checks} /> : null}
      </CardContent>
    </Card>
  );
}

function Generator() {
  const { version, design, update, readOnly, results, modules, inverters } = useEditor();
  const [surfaceId, setSurfaceId] = useState(design.surfaces[0]?.id ?? '');
  const [target, setTarget] = useState<number | undefined>(undefined);
  const layout = results.layout.find((l) => l.surfaceId === surfaceId);
  const targetKwp = target ?? layout?.powerKwp ?? undefined;

  const suggest = useMutation({
    mutationFn: () =>
      endpoints.engineering.suggestConfigurations(version.id, {
        surfaceId,
        targetKwp: targetKwp as number,
        design,
      }),
    onError: (e) => toast.error(errorMessage(e, 'Não foi possível gerar as configurações.')),
  });

  const label = (id: string) => {
    const m = [...modules, ...inverters, ...version.equipment].find((x) => x.id === id);
    return m ? `${m.manufacturer} ${m.model}` : id;
  };

  const apply = (c: SuggestedConfiguration) => {
    update((d) => ({
      ...d,
      defaultModuleId: d.defaultModuleId ?? c.moduleId,
      // A superfície passa a usar o módulo e só os módulos da configuração; o resto da área fica livre.
      surfaces: d.surfaces.map((s) =>
        s.id === surfaceId ? { ...s, moduleId: c.moduleId, moduleCount: c.moduleCount } : s,
      ),
      inverters: [
        ...d.inverters.filter(
          (e) =>
            !e.mppts.some((m) => m.strings.some((g) => g.surfaceId === surfaceId)) &&
            e.micro?.surfaceId !== surfaceId,
        ),
        ...c.entries.map((e) => ({ ...e, id: newId('inv') })),
      ],
    }));
    toast.success('Configuração aplicada ao desenho. Salve para recalcular no servidor.');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Gerador de configurações</CardTitle>
        <CardDescription>
          Procura, no catálogo <strong>aprovado</strong>, combinações de módulo, inversor e strings
          que passam em todas as verificações. É uma <strong>sugestão</strong>: confira e, se
          servir, use. Ordem: perto da meta, mais barato por kWp, relação CC/CA e folga de tensão.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="grid gap-1">
            <Label htmlFor="gen-surface">Superfície</Label>
            <NativeSelect
              id="gen-surface"
              disabled={design.surfaces.length === 0}
              value={surfaceId}
              onChange={(e) => setSurfaceId(e.target.value)}
            >
              {design.surfaces.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <NumberField
            id="gen-target"
            label="Potência-alvo"
            unit="kWp"
            min={0.1}
            max={10000}
            value={targetKwp}
            onChange={setTarget}
            hint={
              layout?.powerKwp ? `Layout atual: ${formatNumber(layout.powerKwp, 2)} kWp` : undefined
            }
          />
          <div className="flex items-end">
            <Button
              disabled={!surfaceId || !targetKwp || suggest.isPending}
              onClick={() => suggest.mutate()}
            >
              {suggest.isPending ? <Spinner /> : null}
              Gerar configurações
            </Button>
          </div>
        </div>

        {suggest.data ? (
          suggest.data.pending.length > 0 ? (
            <div
              className="space-y-1 rounded border border-warning/50 bg-warning/10 p-3 text-sm"
              role="status"
            >
              <p className="font-medium">Ainda não dá para gerar:</p>
              <ul className="list-disc pl-5">
                {suggest.data.pending.map((p) => (
                  <li key={p.code}>{p.message}</li>
                ))}
              </ul>
            </div>
          ) : suggest.data.configurations.length === 0 ? (
            <div className="space-y-1 text-sm" role="status">
              <p className="font-medium">Nenhuma combinação passou nas verificações.</p>
              <ul className="list-disc pl-5 text-muted-foreground">
                {suggest.data.discarded.slice(0, 6).map((d, i) => (
                  <li key={i}>{d.reason}</li>
                ))}
              </ul>
            </div>
          ) : (
            <ol className="space-y-3" aria-label="Configurações sugeridas">
              {suggest.data.configurations.map((c, i) => (
                <li
                  key={`${c.moduleId}-${c.inverterId}-${c.modulesInSeries}-${c.totalStrings}-${c.inverterCount}`}
                  className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3"
                >
                  <div className="space-y-1 text-sm">
                    <p className="font-medium">
                      {i + 1}. {c.inverterCount} × {label(c.inverterId)}
                    </p>
                    <p>
                      {c.moduleCount} × {label(c.moduleId)} · {c.totalStrings}{' '}
                      {c.entries[0]?.micro ? 'unidade(s)' : `string(s) de ${c.modulesInSeries}`} ·{' '}
                      {formatNumber(c.powerKwp, 2)} kWp
                    </p>
                    <p className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                      {c.dcAcRatio !== null ? (
                        <span>CC/CA {formatNumber(c.dcAcRatio, 2)}</span>
                      ) : null}
                      <span>folga de tensão {formatNumber(c.vocMarginPct, 0)}%</span>
                      <span>
                        {c.costCents !== null
                          ? formatCents(c.costCents)
                          : `sem preço: ${c.unpriced.join(', ')}`}
                      </span>
                      {c.status === 'VALID_WITH_WARNINGS' ? (
                        <Badge variant="yellow">com avisos</Badge>
                      ) : null}
                    </p>
                  </div>
                  {!readOnly ? (
                    <Button size="sm" variant="outline" onClick={() => apply(c)}>
                      Usar esta
                    </Button>
                  ) : null}
                </li>
              ))}
            </ol>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Etapa 3: inversores, strings e MPPT, com a conferência de compatibilidade ao vivo e o gerador de configurações. */
export function StringsStep() {
  const { design, update, readOnly, results, inverters, goToStep, designParameters } = useEditor();
  const compat = results.compatibility;
  const [choice, setChoice] = useState('');
  const hasRule = Object.keys(designParameters).length > 0;

  const addInverter = () => void addInverterById(choice);

  /** Adiciona pelo id; um inversor recém-importado ainda pode não estar na lista da tela, então busca a ficha. */
  const addInverterById = async (id: string) => {
    const item = inverters.find((i) => i.id === id) ?? (await endpoints.catalog.get(id));
    const spec = item.spec as unknown as InverterSpec;
    const entry: InverterEntry = {
      id: newId('inv'),
      inverterId: item.id,
      mppts:
        spec.topology === 'MICRO'
          ? []
          : Array.from({ length: spec.mpptCount }, () => ({ strings: [] })),
      ...(spec.topology === 'MICRO' && design.surfaces[0]
        ? { micro: { surfaceId: design.surfaces[0].id, units: 1, modulesPerUnit: 1 } }
        : {}),
    };
    update((d) => ({ ...d, inverters: [...d.inverters, entry] }));
    setChoice('');
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle className="flex flex-wrap items-center gap-2">
              Compatibilidade
              <Badge variant={COMPATIBILITY_LABELS[compat.status].variant}>
                {COMPATIBILITY_LABELS[compat.status].label}
              </Badge>
            </CardTitle>
            <CardDescription>
              Tensão e corrente das strings com a temperatura de projeto, faixa do MPPT, entradas e
              potência. <strong>Inválido</strong> bloqueia a aprovação; <strong>incompleto</strong>{' '}
              também (falta dado ou regra).
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {compat.pending.length > 0 ? (
            <ul
              className="space-y-1 rounded border border-warning/50 bg-warning/10 p-3 text-sm"
              aria-label="O que falta para concluir a compatibilidade"
            >
              {compat.pending.map((p) => (
                <li key={p.code} className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{p.kind === 'DATA' ? 'dado' : 'regra'}</Badge>
                  <span>{p.message}</span>
                  {p.code.startsWith('TM') ? (
                    <Button
                      size="sm"
                      variant="link"
                      className="h-auto p-0"
                      onClick={() => goToStep('local')}
                    >
                      Ir para Local e clima
                    </Button>
                  ) : null}
                  {p.kind === 'RULE' ? (
                    <Link to="/admin/regras" className="text-xs underline">
                      Ver regras
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {compat.allocation.length > 0 ? <Checks checks={compat.allocation} /> : null}
          {!hasRule ? (
            <p className="text-xs text-muted-foreground">
              Sem a regra <code>engine.design</code> ativa, a relação CC/CA e a temperatura da
              célula quente ficam pendentes. Quem ativa é o responsável técnico.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {!readOnly ? <Generator /> : null}

      <div className="space-y-4">
        {design.inverters.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              Nenhum inversor no projeto. Adicione um abaixo ou use o gerador.
            </CardContent>
          </Card>
        ) : null}
        {design.inverters.map((entry) => (
          <InverterCard
            key={entry.id}
            entry={entry}
            compat={compat.inverters.find((c) => c.entryId === entry.id)}
          />
        ))}
      </div>

      {!readOnly ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Adicionar inversor</CardTitle>
            <CardDescription>Só inversores aprovados do catálogo.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-3">
            <div className="min-w-72">
              <EquipmentSearch
                kind="INVERTER"
                label="Buscar inversor (catálogo e fontes)"
                onPick={(id) => void addInverterById(id)}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="add-inverter">Inversor</Label>
              <NativeSelect
                id="add-inverter"
                value={choice}
                onChange={(e) => setChoice(e.target.value)}
              >
                <option value="">Selecione</option>
                {inverters.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.manufacturer} {i.model}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <Button variant="outline" disabled={!choice} onClick={addInverter}>
              <Plus /> Adicionar
            </Button>
            {inverters.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Nenhum inversor aprovado. Cadastre e aprove um no catálogo.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
