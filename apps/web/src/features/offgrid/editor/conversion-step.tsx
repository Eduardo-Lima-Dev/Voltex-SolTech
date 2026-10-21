import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@voltex/ui';
import { formatNumber } from '@/lib/format';
import { EquipmentSearch } from '../../engine/editor/equipment-search';
import { NumberField } from '../../engine/editor/number-field';
import { CHECK_BADGE, CHECK_LABEL } from '../labels';
import { useOffgrid } from './offgrid-context';

const CONTROLLER = ['CONTROLLER_', 'CONTROLLER_NOT'];
const INVERTER = ['INVERTER_'];

/** Etapa 6: controlador de carga e inversor. */
export function ConversionStep() {
  const { design, update, readOnly, results, labelOf } = useOffgrid();
  const { sizing, selected, load } = results;
  const list = (prefixes: string[], label: string) => {
    const items = results.checks.filter((c) => prefixes.some((p) => c.code.startsWith(p)));
    return items.length > 0 ? (
      <ul className="space-y-1 text-sm" aria-label={label}>
        {items.map((c, i) => (
          <li key={`${c.code}-${i}`} className="flex gap-2">
            <Badge variant={CHECK_BADGE[c.severity]}>{CHECK_LABEL[c.severity]}</Badge>
            {c.message}
          </li>
        ))}
      </ul>
    ) : null;
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Controlador de carga</CardTitle>
          <CardDescription>
            Corrente = fator × Isc × strings em paralelo; a Voc a frio do arranjo precisa ficar
            abaixo do limite de entrada. Sem controlador separado, o inversor precisa ter MPPT
            embutido.
            {sizing.controllerCurrentA !== null
              ? ` Estimativa pelo dimensionamento: ${formatNumber(sizing.controllerCurrentA, 0)} A.`
              : ''}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <EquipmentSearch
            kind="CHARGE_CONTROLLER"
            label={`Controlador (atual: ${labelOf(design.controllerId)})`}
            disabled={readOnly}
            onPick={(id) => update((d) => ({ ...d, controllerId: id }))}
          />
          <div className="max-w-xs">
            <NumberField
              id="ctl-count"
              label="Quantidade em paralelo"
              integer
              min={1}
              max={20}
              disabled={readOnly}
              value={design.controllerCount}
              onChange={(v) => v !== undefined && update((d) => ({ ...d, controllerCount: v }))}
            />
          </div>
          {selected ? (
            <p className="text-sm">
              Capacidade instalada: {formatNumber(selected.controllerCurrentA, 0)} A
            </p>
          ) : null}
          {list(CONTROLLER, 'Verificações do controlador')}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Inversor</CardTitle>
          <CardDescription>
            Pico de {formatNumber(load.peakW, 0)} W e partida de {formatNumber(load.surgeW, 0)} W: o
            inversor mínimo é de {formatNumber(sizing.inverterContinuousW, 0)} W contínuos. Tensão
            de entrada igual à do banco ({design.systemVoltageV} V).
            {design.systemType === 'HYBRID'
              ? ' Sistema híbrido: exige inversor híbrido com entrada de rede (sem injeção).'
              : ''}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <EquipmentSearch
            kind="OFFGRID_INVERTER"
            label={`Inversor (atual: ${labelOf(design.inverterId)})`}
            disabled={readOnly}
            onPick={(id) => update((d) => ({ ...d, inverterId: id }))}
          />
          <div className="max-w-xs">
            <NumberField
              id="inv-count"
              label="Quantidade em paralelo"
              integer
              min={1}
              max={10}
              disabled={readOnly}
              value={design.inverterCount}
              onChange={(v) => v !== undefined && update((d) => ({ ...d, inverterCount: v }))}
            />
          </div>
          {selected ? (
            <p className="text-sm">
              Instalado: {formatNumber(selected.inverterContinuousW, 0)} W contínuos ·{' '}
              {formatNumber(selected.inverterSurgeW, 0)} W de surto
            </p>
          ) : null}
          {list(INVERTER, 'Verificações do inversor')}
        </CardContent>
      </Card>
    </div>
  );
}
