import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Label,
  NativeSelect,
} from '@voltex/ui';
import { NumberField } from './number-field';
import { useEditor } from './editor-context';

/** Dados da UC para o checklist de conexão; exigências são avaliadas exclusivamente pela regra ativa. */
export function ConnectionStep() {
  const { design, update, readOnly, results } = useEditor();
  const connection = design.connection ?? { availablePowerKw: null, phases: null, gridZero: false };
  const set = (patch: Partial<typeof connection>) =>
    update((current) => ({ ...current, connection: { ...connection, ...patch } }));
  const result = results.connection;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Dados da unidade consumidora</CardTitle>
          <CardDescription>
            A potência disponibilizada, fases e Grid Zero alimentam a regra versionada da
            distribuidora. A UF do local define o escopo inicial; confirme a regra e sua fonte antes
            da aprovação.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <NumberField
            id="connection-available"
            label="Potência disponibilizada"
            unit="kW"
            optional
            min={0.01}
            value={connection.availablePowerKw}
            disabled={readOnly}
            onChange={(value) => set({ availablePowerKw: value ?? null })}
          />
          <div className="grid gap-1">
            <Label htmlFor="connection-phases">Fases</Label>
            <NativeSelect
              id="connection-phases"
              value={connection.phases ?? ''}
              disabled={readOnly}
              onChange={(event) =>
                set({ phases: event.target.value ? Number(event.target.value) : null })
              }
            >
              <option value="">Não informadas</option>
              <option value="1">Monofásico</option>
              <option value="2">Bifásico</option>
              <option value="3">Trifásico</option>
            </NativeSelect>
          </div>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input
              type="checkbox"
              checked={connection.gridZero}
              disabled={readOnly}
              onChange={(event) => set({ gridZero: event.target.checked })}
            />{' '}
            Grid Zero (sem exportação)
          </label>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Checklist da conexão</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <Badge
            variant={
              result?.status === 'INVALID'
                ? 'destructive'
                : result?.status === 'INCOMPLETE'
                  ? 'yellow'
                  : 'green'
            }
          >
            {result?.status ?? 'INCOMPLETE'}
          </Badge>
          {result?.pending.map((item) => (
            <p key={item.code} className="rounded border border-warning/50 bg-warning/10 p-2">
              {item.message}
            </p>
          ))}
          {result?.findings.map((item) => (
            <p key={item.ruleId} className="rounded border p-2">
              <strong>{item.code}</strong>: {item.message}
              <br />
              <span className="text-xs text-muted-foreground">Fonte: {item.source}</span>
            </p>
          ))}
          {!result?.pending.length && !result?.findings.length ? (
            <p className="text-muted-foreground">Nenhuma regra foi avaliada ainda.</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
