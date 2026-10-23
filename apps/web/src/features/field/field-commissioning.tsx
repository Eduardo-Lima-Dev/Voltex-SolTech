import { useState } from 'react';
import type { CommissioningResultValue, CommissioningTestDto } from '@voltex/shared';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from '@voltex/ui';
import type { FieldViewOrder } from './field-engine';
import { useField } from './field-provider';

export const RESULT_LABELS: Record<CommissioningResultValue, string> = {
  PENDING: 'Sem registro',
  PENDING_RULE: 'Sem regra para julgar',
  PENDING_DATA: 'Sem dado',
  PASS: 'Conforme',
  FAIL: 'Reprovado',
  NOT_APPLICABLE: 'Não se aplica',
};

export const RESULT_VARIANT: Record<
  CommissioningResultValue,
  'green' | 'red' | 'yellow' | 'outline'
> = {
  PENDING: 'outline',
  PENDING_RULE: 'yellow',
  PENDING_DATA: 'yellow',
  PASS: 'green',
  FAIL: 'red',
  NOT_APPLICABLE: 'outline',
};

const num = (text: string): number | null => {
  const n = Number(text.replace(',', '.'));
  return text.trim() !== '' && Number.isFinite(n) ? n : null;
};

const fmt = (value: number | null, digits = 2): string =>
  value === null ? '—' : value.toLocaleString('pt-BR', { maximumFractionDigits: digits });

function TestCard({
  order,
  test,
  editable,
}: {
  order: FieldViewOrder;
  test: CommissioningTestDto;
  editable: boolean;
}) {
  const { engine } = useField();
  const [value, setValue] = useState(test.measuredValue !== null ? String(test.measuredValue) : '');
  const [note, setNote] = useState(test.note ?? '');
  const parsed = num(value);
  return (
    <li className="space-y-2 rounded-md border p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-medium">{test.label}</div>
          <div className="text-xs text-muted-foreground">
            {test.subjectLabel}
            {test.required ? '' : ' · opcional'}
          </div>
        </div>
        <Badge variant={RESULT_VARIANT[test.result]}>{RESULT_LABELS[test.result]}</Badge>
      </div>

      {test.kind === 'CHECK' ? (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={test.passed === true ? 'default' : 'outline'}
            disabled={!editable}
            aria-pressed={test.passed === true}
            onClick={() =>
              void engine.act(order.id, {
                type: 'MEASURE',
                testId: test.id,
                passed: true,
                ...(note.trim() ? { note: note.trim() } : {}),
              })
            }
          >
            Conforme
          </Button>
          <Button
            size="sm"
            variant={test.passed === false ? 'destructive' : 'outline'}
            disabled={!editable}
            aria-pressed={test.passed === false}
            onClick={() =>
              void engine.act(order.id, {
                type: 'MEASURE',
                testId: test.id,
                passed: false,
                ...(note.trim() ? { note: note.trim() } : {}),
              })
            }
          >
            Não conforme
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <div className="grid gap-1">
            <Label htmlFor={`v-${test.id}`} className="text-xs">
              Valor medido{test.unit ? ` (${test.unit})` : ''}
            </Label>
            <Input
              id={`v-${test.id}`}
              inputMode="decimal"
              className="w-32"
              value={value}
              disabled={!editable}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={!editable || parsed === null}
            aria-label={`Registrar medição: ${test.label} – ${test.subjectLabel}`}
            onClick={() =>
              parsed !== null &&
              void engine.act(order.id, {
                type: 'MEASURE',
                testId: test.id,
                value: parsed,
                ...(note.trim() ? { note: note.trim() } : {}),
              })
            }
          >
            Registrar
          </Button>
        </div>
      )}

      {test.expectedValue !== null ? (
        <p className="text-xs text-muted-foreground">
          Esperado: {fmt(test.expectedValue)} {test.unit}
          {test.deviationPct !== null ? ` · desvio ${fmt(test.deviationPct, 1)} %` : ''}
          {test.tolerancePct !== null ? ` · tolerância ${fmt(test.tolerancePct, 1)} %` : ''}
        </p>
      ) : test.min !== null || test.max !== null ? (
        <p className="text-xs text-muted-foreground">
          Limite: {test.min !== null ? `mín. ${fmt(test.min)}` : ''}{' '}
          {test.max !== null ? `máx. ${fmt(test.max)}` : ''} {test.unit}
        </p>
      ) : null}
      {test.reason && test.result !== 'PASS' ? (
        <p className="text-xs text-destructive">{test.reason}</p>
      ) : null}
      <Input
        aria-label={`Observação: ${test.label} – ${test.subjectLabel}`}
        placeholder="Observação (opcional)"
        value={note}
        disabled={!editable}
        onChange={(e) => setNote(e.target.value)}
        className="h-8 text-xs"
      />
    </li>
  );
}

/** Ensaios do comissionamento no app de campo: condições medidas, conferências e medições, com prévia do julgamento. */
export function FieldCommissioning({ order }: { order: FieldViewOrder }) {
  const { engine } = useField();
  const commissioning = order.commissioning;
  const [irradiance, setIrradiance] = useState('');
  const [moduleTemp, setModuleTemp] = useState('');
  const [ambient, setAmbient] = useState('');
  if (!commissioning) return null;
  const editable = commissioning.status === 'IN_PROGRESS' && order.status !== 'CANCELLED';
  const groups = [...new Set(commissioning.tests.map((t) => t.group))];
  const c = commissioning.conditions;
  const g = num(irradiance);
  const mt = num(moduleTemp);
  const amb = num(ambient);
  const canSave = editable && (g !== null || mt !== null || amb !== null);

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="text-base">Ensaios do comissionamento</CardTitle>
        <p className="text-xs text-muted-foreground">
          Nível{' '}
          {commissioning.level === 'EXTENDED'
            ? 'ampliado (categorias 1 e 2)'
            : 'padrão (categoria 1)'}
          {commissioning.status !== 'IN_PROGRESS'
            ? ' · enviado para revisão do responsável técnico'
            : ''}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {commissioning.provisional ? (
          <p
            role="note"
            className="rounded-md bg-yellow-50 p-2 text-xs text-yellow-900 dark:bg-yellow-950 dark:text-yellow-100"
          >
            Modelo provisório: dá para registrar os ensaios, mas o resultado das medições só é
            julgado quando o responsável técnico ativar a regra de comissionamento.
          </p>
        ) : null}

        <section aria-label="Condições da medição" className="space-y-2">
          <h3 className="text-sm font-semibold">Condições da medição</h3>
          <p className="text-xs text-muted-foreground">
            Atual: irradiância {fmt(c.irradianceWm2 ?? null, 0)} W/m² · módulo{' '}
            {fmt(c.moduleTempC ?? null, 1)} °C · ambiente {fmt(c.ambientC ?? null, 1)} °C
          </p>
          <div className="grid grid-cols-3 gap-2">
            <div className="grid gap-1">
              <Label htmlFor="cond-g" className="text-xs">
                Irradiância (W/m²)
              </Label>
              <Input
                id="cond-g"
                inputMode="decimal"
                value={irradiance}
                disabled={!editable}
                onChange={(e) => setIrradiance(e.target.value)}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="cond-t" className="text-xs">
                Temp. do módulo (°C)
              </Label>
              <Input
                id="cond-t"
                inputMode="decimal"
                value={moduleTemp}
                disabled={!editable}
                onChange={(e) => setModuleTemp(e.target.value)}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="cond-a" className="text-xs">
                Temp. ambiente (°C)
              </Label>
              <Input
                id="cond-a"
                inputMode="decimal"
                value={ambient}
                disabled={!editable}
                onChange={(e) => setAmbient(e.target.value)}
              />
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={!canSave}
            onClick={() => {
              void engine.act(order.id, {
                type: 'CONDITIONS',
                conditions: {
                  ...(g !== null ? { irradianceWm2: g } : {}),
                  ...(mt !== null ? { moduleTempC: mt } : {}),
                  ...(amb !== null ? { ambientC: amb } : {}),
                },
              });
              setIrradiance('');
              setModuleTemp('');
              setAmbient('');
            }}
          >
            Salvar condições
          </Button>
        </section>

        {groups.map((group) => (
          <details key={group} open className="space-y-2">
            <summary className="cursor-pointer text-sm font-semibold">{group}</summary>
            <ul className="mt-2 space-y-2" aria-label={group}>
              {commissioning.tests
                .filter((t) => t.group === group)
                .map((t) => (
                  <TestCard key={t.id} order={order} test={t} editable={editable} />
                ))}
            </ul>
          </details>
        ))}
      </CardContent>
    </Card>
  );
}
