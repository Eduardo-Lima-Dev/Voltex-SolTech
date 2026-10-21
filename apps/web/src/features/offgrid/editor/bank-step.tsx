import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@voltex/ui';
import { formatNumber } from '@/lib/format';
import { EquipmentSearch } from '../../engine/editor/equipment-search';
import { NumberField } from '../../engine/editor/number-field';
import { CHECK_BADGE, CHECK_LABEL } from '../labels';
import { useOffgrid } from './offgrid-context';

const CODES = ['BANK_', 'AUTONOMY', 'DOD', 'CHARGE_RATE', 'BATTERY_COLD', 'EQUIPMENT_NOT'];

/** Etapa 5: banco de baterias. */
export function BankStep() {
  const { design, update, readOnly, results, labelOf } = useOffgrid();
  const { sizing, selected } = results;
  const set = (patch: Partial<typeof design.bank>) =>
    update((d) => ({ ...d, bank: { ...d.bank, ...patch } }));
  const checks = results.checks.filter((c) => CODES.some((p) => c.code.startsWith(p)));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Banco de baterias</CardTitle>
        <CardDescription>
          Capacidade = consumo × autonomia ÷ profundidade de descarga. Em série fecha a tensão do
          sistema ({design.systemVoltageV} V); em paralelo fecha a capacidade (poucas colunas em
          paralelo mantêm o banco equilibrado).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <EquipmentSearch
          kind="BATTERY"
          label={`Bateria (atual: ${labelOf(design.bank.batteryId)})`}
          disabled={readOnly}
          onPick={(id) => set({ batteryId: id })}
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <NumberField
            id="bank-series"
            label="Baterias em série"
            integer
            min={1}
            max={40}
            disabled={readOnly}
            value={design.bank.seriesCount}
            onChange={(v) => v !== undefined && set({ seriesCount: v })}
            hint={
              sizing.batterySeries !== null ? `Recomendado: ${sizing.batterySeries}` : undefined
            }
          />
          <NumberField
            id="bank-parallel"
            label="Colunas em paralelo"
            integer
            min={1}
            max={20}
            disabled={readOnly}
            value={design.bank.parallelCount}
            onChange={(v) => v !== undefined && set({ parallelCount: v })}
            hint={
              sizing.batteryParallel !== null ? `Recomendado: ${sizing.batteryParallel}` : undefined
            }
          />
          <NumberField
            id="bank-dod"
            label="DoD de projeto"
            unit="%"
            min={5}
            max={100}
            optional
            disabled={readOnly}
            value={design.bank.designDodPct}
            onChange={(v) => set({ designDodPct: v })}
            hint={
              sizing.dodPct !== null
                ? `Em uso: ${formatNumber(sizing.dodPct, 0)}% (vazio = a da ficha, limitada pela regra)`
                : 'Vazio = a da ficha, limitada pela regra'
            }
          />
          <NumberField
            id="bank-temp"
            label="Temperatura do local"
            unit="°C"
            min={-20}
            max={60}
            disabled={readOnly}
            value={design.bank.temperatureC}
            onChange={(v) => v !== undefined && set({ temperatureC: v })}
          />
        </div>
        {!readOnly && sizing.batterySeries !== null && sizing.batteryParallel !== null ? (
          <Button
            variant="outline"
            onClick={() =>
              set({
                seriesCount: sizing.batterySeries as number,
                parallelCount: sizing.batteryParallel as number,
              })
            }
          >
            Usar a quantidade recomendada ({sizing.batterySeries} × {sizing.batteryParallel})
          </Button>
        ) : null}
        <dl className="grid grid-cols-2 gap-2 text-sm lg:grid-cols-4">
          <dt>Necessário</dt>
          <dd>
            {sizing.bankWhRequired !== null ? `${formatNumber(sizing.bankWhRequired, 0)} Wh` : '—'}
          </dd>
          <dt>Instalado (nominal)</dt>
          <dd>
            {selected
              ? `${formatNumber(selected.bankNominalWh, 0)} Wh · ${formatNumber(selected.bankAh, 0)} Ah`
              : '—'}
          </dd>
          <dt>Útil</dt>
          <dd>{selected ? `${formatNumber(selected.bankUsableWh, 0)} Wh` : '—'}</dd>
          <dt>Baterias</dt>
          <dd>{selected?.batteryCount ?? '—'}</dd>
        </dl>
        {checks.length > 0 ? (
          <ul className="space-y-1 text-sm" aria-label="Verificações do banco">
            {checks.map((c, i) => (
              <li key={`${c.code}-${i}`} className="flex gap-2">
                <Badge variant={CHECK_BADGE[c.severity]}>{CHECK_LABEL[c.severity]}</Badge>
                {c.message}
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}
