import { Plus, Trash2 } from 'lucide-react';
import type { CableRun, ProtectionItem, ProtectionRole } from '@voltex/shared';
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
} from '@voltex/ui';
import { formatCents, formatNumber } from '@/lib/format';
import { useEditor } from './editor-context';
import { NumberField } from './number-field';

let sequence = 0;
const newId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}${(sequence++).toString(36)}`;

const statusVariant = {
  VALID: 'green',
  VALID_WITH_WARNINGS: 'yellow',
  INVALID: 'red',
  INCOMPLETE: 'secondary',
} as const;

const roleLabel: Record<ProtectionRole, string> = {
  STRING_FUSE: 'Fusível de string',
  DC_DISCONNECTOR: 'Seccionadora CC',
  DC_SURGE: 'DPS CC',
  AC_BREAKER: 'Disjuntor CA',
  RCD: 'DR',
};

function ProtectionRow({ item }: { item: ProtectionItem }) {
  const { design, update, readOnly, version } = useEditor();
  const candidates = version.candidates.filter((candidate) => candidate.kind === 'PROTECTION');
  const override = design.protectionOverrides.find(
    (entry) =>
      entry.role === item.role &&
      entry.inverterEntryId === item.inverterEntryId &&
      (entry.mpptIndex ?? null) === item.mpptIndex,
  );
  const setOverride = (equipmentId: string) =>
    update((current) => {
      const retained = current.protectionOverrides.filter(
        (entry) =>
          !(
            entry.role === item.role &&
            entry.inverterEntryId === item.inverterEntryId &&
            (entry.mpptIndex ?? null) === item.mpptIndex
          ),
      );
      if (!equipmentId) return { ...current, protectionOverrides: retained };
      return {
        ...current,
        protectionOverrides: [
          ...retained,
          {
            id: newId('protection'),
            role: item.role,
            inverterEntryId: item.inverterEntryId,
            ...(item.mpptIndex === null ? {} : { mpptIndex: item.mpptIndex }),
            equipmentId,
          },
        ],
      };
    });

  return (
    <li className="grid gap-2 rounded-md border p-3 lg:grid-cols-[minmax(14rem,1fr)_minmax(18rem,1.4fr)_minmax(16rem,1fr)]">
      <div>
        <p className="font-medium">{roleLabel[item.role]}</p>
        <p className="text-xs text-muted-foreground">
          {item.inverterEntryId}
          {item.mpptIndex === null ? '' : ` · MPPT ${item.mpptIndex + 1}`} · {item.quantity} un.
        </p>
      </div>
      <div className="text-sm">
        <p>{item.requirement || item.justification}</p>
        <p className="mt-1 text-xs text-muted-foreground">{item.justification}</p>
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`protection-${item.id}`}>Item do catálogo</Label>
        <NativeSelect
          id={`protection-${item.id}`}
          disabled={readOnly}
          value={override?.equipmentId ?? ''}
          onChange={(event) => setOverride(event.target.value)}
        >
          <option value="">
            {item.chosen ? `Sugestão: ${item.chosen.label}` : 'Sem sugestão'}
          </option>
          {candidates.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.label}
            </option>
          ))}
        </NativeSelect>
        <p className="text-xs text-muted-foreground">
          {item.manual
            ? 'Escolha manual: será validada ao salvar.'
            : 'Menor item aprovado que atende.'}
        </p>
      </div>
    </li>
  );
}

function CableEditor() {
  const { design, update, readOnly, version, results } = useEditor();
  const candidates = version.candidates.filter((candidate) => candidate.kind === 'CABLE');
  const change = (id: string, patch: Partial<CableRun>) =>
    update((current) => ({
      ...current,
      cables: current.cables.map((run) => (run.id === id ? { ...run, ...patch } : run)),
    }));
  const add = () => {
    const inverter = design.inverters[0];
    if (!inverter) return;
    update((current) => ({
      ...current,
      cables: [
        ...current.cables,
        {
          id: newId('cable'),
          label: `Trecho ${current.cables.length + 1}`,
          kind: 'DC_STRING',
          inverterEntryId: inverter.id,
          mpptIndex: 0,
          lengthM: 10,
          count: 1,
          lengthEstimated: true,
        },
      ],
    }));
  };

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            Cabos{' '}
            <Badge variant={statusVariant[results.cables.status]}>{results.cables.status}</Badge>
          </CardTitle>
          <CardDescription>
            A seção sugerida considera queda de tensão e a tabela de capacidade da regra vigente.
          </CardDescription>
        </div>
        {!readOnly ? (
          <Button size="sm" variant="outline" disabled={!design.inverters.length} onClick={add}>
            <Plus /> Adicionar trecho
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {results.cables.pending.length ? (
          <ul className="rounded border border-warning/50 bg-warning/10 p-3 text-sm">
            {results.cables.pending.map((pending) => (
              <li key={pending.code}>{pending.message}</li>
            ))}
          </ul>
        ) : null}
        {design.cables.map((run) => {
          const calculated = results.cables.runs.find((item) => item.runId === run.id);
          return (
            <div
              key={run.id}
              className="grid gap-3 rounded-md border p-3 md:grid-cols-2 xl:grid-cols-4"
            >
              <div className="grid gap-1">
                <Label htmlFor={`${run.id}-label`}>Trecho</Label>
                <input
                  id={`${run.id}-label`}
                  className="h-9 rounded-md border bg-background px-3 text-sm"
                  disabled={readOnly}
                  value={run.label}
                  onChange={(event) => change(run.id, { label: event.target.value })}
                />
              </div>
              <div className="grid gap-1">
                <Label htmlFor={`${run.id}-kind`}>Tipo</Label>
                <NativeSelect
                  id={`${run.id}-kind`}
                  disabled={readOnly}
                  value={run.kind}
                  onChange={(event) =>
                    change(run.id, { kind: event.target.value as CableRun['kind'] })
                  }
                >
                  <option value="DC_STRING">CC — string</option>
                  <option value="DC_MAIN">CC — principal</option>
                  <option value="AC">CA</option>
                </NativeSelect>
              </div>
              <NumberField
                id={`${run.id}-length`}
                label="Comprimento de ida"
                unit="m"
                min={0.1}
                max={1000}
                value={run.lengthM}
                disabled={readOnly}
                onChange={(value) => value !== undefined && change(run.id, { lengthM: value })}
              />
              <div className="grid gap-1">
                <Label htmlFor={`${run.id}-cable`}>Cabo</Label>
                <NativeSelect
                  id={`${run.id}-cable`}
                  disabled={readOnly}
                  value={run.cableId ?? ''}
                  onChange={(event) => change(run.id, { cableId: event.target.value || undefined })}
                >
                  <option value="">
                    {calculated?.chosen ? `Sugestão: ${calculated.chosen.label}` : 'Automático'}
                  </option>
                  {candidates.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.label}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <p className="text-sm md:col-span-2 xl:col-span-3">
                {calculated
                  ? `${calculated.sectionMm2 ?? '—'} mm² · queda ${calculated.voltageDropPct === null ? '—' : `${formatNumber(calculated.voltageDropPct, 2)}%`} · ${calculated.status}`
                  : 'Aguardando cálculo.'}
              </p>
              {!readOnly ? (
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Remover ${run.label}`}
                  onClick={() =>
                    update((current) => ({
                      ...current,
                      cables: current.cables.filter((item) => item.id !== run.id),
                    }))
                  }
                >
                  <Trash2 />
                </Button>
              ) : null}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

/** Etapa 9F: escolhas justificadas de proteção, trechos de cabo e orçamento técnico. */
export function ProtectionsCablesStep() {
  const { results } = useEditor();
  const { protection, bom } = results;
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Proteções <Badge variant={statusVariant[protection.status]}>{protection.status}</Badge>
          </CardTitle>
          <CardDescription>
            O sistema sugere o menor item aprovado que atende. Trocas manuais são conferidas no
            cálculo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {protection.pending.length ? (
            <ul className="mb-3 rounded border border-warning/50 bg-warning/10 p-3 text-sm">
              {protection.pending.map((pending) => (
                <li key={pending.code}>{pending.message}</li>
              ))}
            </ul>
          ) : null}
          <ul className="space-y-2">
            {protection.items.map((item) => (
              <ProtectionRow key={item.id} item={item} />
            ))}
          </ul>
        </CardContent>
      </Card>
      <CableEditor />
      <Card>
        <CardHeader>
          <CardTitle>Lista de materiais</CardTitle>
          <CardDescription>
            Preço vigente da tabela, ou custo de referência do catálogo.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {bom.lines.map((line, index) => (
            <div
              key={`${line.equipmentId}-${index}`}
              className="flex flex-wrap justify-between gap-2 rounded border p-2"
            >
              <span>
                {line.quantity} {line.unit} · {line.description}
              </span>
              <span>{line.totalCents === null ? 'Sem preço' : formatCents(line.totalCents)}</span>
            </div>
          ))}
          <p className="pt-2 font-medium">
            Total parcial:{' '}
            {bom.totalCents === null ? 'Sem preços disponíveis' : formatCents(bom.totalCents)}{' '}
            {bom.unpricedCount ? `· ${bom.unpricedCount} item(ns) sem preço` : ''}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
