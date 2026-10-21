import { Plus, Trash2 } from 'lucide-react';
import { offgridGridSchema } from '@voltex/shared';
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
import { EquipmentSearch } from '../../engine/editor/equipment-search';
import { NumberField } from '../../engine/editor/number-field';
import { CHECK_BADGE, CHECK_LABEL } from '../labels';
import { useOffgrid } from './offgrid-context';

/** Etapa 7: gerador de apoio e rede (no híbrido, sem injeção). */
export function GeneratorGridStep() {
  const { design, update, readOnly, results, labelOf } = useOffgrid();
  const gen = design.generator;
  const setGen = (patch: Partial<typeof gen>) =>
    update((d) => ({ ...d, generator: { ...d.generator, ...patch } }));
  const grid = design.grid ?? offgridGridSchema.parse({});
  const setGrid = (patch: Partial<typeof grid>) =>
    update((d) => ({ ...d, grid: { ...(d.grid ?? offgridGridSchema.parse({})), ...patch } }));
  const checks = results.checks.filter((c) => c.code.startsWith('GENERATOR_'));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Gerador de apoio</CardTitle>
          <CardDescription>
            Liga quando o banco desce ao SOC de partida e desliga ao chegar ao de parada, dentro da
            janela permitida.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              disabled={readOnly}
              checked={gen.enabled}
              onChange={(e) => setGen({ enabled: e.target.checked })}
            />
            Usar gerador
          </label>
          {gen.enabled ? (
            <>
              <EquipmentSearch
                kind="GENERATOR"
                label={`Gerador (atual: ${labelOf(gen.generatorId)})`}
                disabled={readOnly}
                onPick={(id) => setGen({ generatorId: id })}
              />
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <NumberField
                  id="gen-start"
                  label="Liga abaixo de"
                  unit="% SOC"
                  min={0}
                  max={100}
                  disabled={readOnly}
                  value={gen.startSocPct}
                  onChange={(v) => v !== undefined && setGen({ startSocPct: v })}
                />
                <NumberField
                  id="gen-stop"
                  label="Desliga acima de"
                  unit="% SOC"
                  min={0}
                  max={100}
                  disabled={readOnly}
                  value={gen.stopSocPct}
                  onChange={(v) => v !== undefined && setGen({ stopSocPct: v })}
                />
                <NumberField
                  id="gen-min"
                  label="Funcionamento mínimo"
                  unit="h"
                  min={0}
                  max={24}
                  disabled={readOnly}
                  value={gen.minRunHours}
                  onChange={(v) => v !== undefined && setGen({ minRunHours: v })}
                />
                <NumberField
                  id="gen-fuel"
                  label="Preço do combustível"
                  unit="centavos/L"
                  min={0}
                  disabled={readOnly}
                  value={gen.fuelPriceCentsPerLiter}
                  onChange={(v) => v !== undefined && setGen({ fuelPriceCentsPerLiter: v })}
                />
                <NumberField
                  id="gen-from"
                  label="Pode ligar a partir de"
                  unit="h"
                  integer
                  min={0}
                  max={23}
                  disabled={readOnly}
                  value={gen.allowedFromHour}
                  onChange={(v) => v !== undefined && setGen({ allowedFromHour: v })}
                />
                <NumberField
                  id="gen-to"
                  label="Até"
                  unit="h"
                  integer
                  min={1}
                  max={24}
                  disabled={readOnly}
                  value={gen.allowedToHour}
                  onChange={(v) => v !== undefined && setGen({ allowedToHour: v })}
                />
              </div>
            </>
          ) : null}
          {checks.length > 0 ? (
            <ul className="space-y-1 text-sm" aria-label="Verificações do gerador">
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

      {design.systemType === 'HYBRID' ? (
        <Card>
          <CardHeader>
            <CardTitle>Rede elétrica (sem injeção)</CardTitle>
            <CardDescription>
              Reserva (backup): a rede alimenta as cargas e a bateria guarda a reserva para as
              quedas. Autoconsumo: a bateria é usada todo dia e a rede cobre o que falta. Este
              sistema nunca injeta energia na rede.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="grid gap-1">
                <Label htmlFor="grid-mode">Modo</Label>
                <NativeSelect
                  id="grid-mode"
                  disabled={readOnly}
                  value={grid.mode}
                  onChange={(e) =>
                    setGrid({ mode: e.target.value as 'BACKUP' | 'SELF_CONSUMPTION' })
                  }
                >
                  <option value="BACKUP">Reserva (backup)</option>
                  <option value="SELF_CONSUMPTION">Autoconsumo</option>
                </NativeSelect>
              </div>
              <NumberField
                id="grid-reserve"
                label="Reserva da bateria"
                unit="% SOC"
                min={0}
                max={100}
                disabled={readOnly}
                value={grid.reserveSocPct}
                onChange={(v) => v !== undefined && setGrid({ reserveSocPct: v })}
              />
              <NumberField
                id="grid-charge"
                label="Recarregar pela rede abaixo de"
                unit="% SOC"
                min={0}
                max={100}
                disabled={readOnly}
                value={grid.gridChargeBelowSocPct}
                hint="0 = nunca"
                onChange={(v) => v !== undefined && setGrid({ gridChargeBelowSocPct: v })}
              />
              <NumberField
                id="grid-out-start"
                label="Queda diária começa às"
                unit="h"
                integer
                min={0}
                max={23}
                disabled={readOnly}
                value={grid.dailyOutageStartHour}
                onChange={(v) => v !== undefined && setGrid({ dailyOutageStartHour: v })}
              />
              <NumberField
                id="grid-out-hours"
                label="Duração da queda diária"
                unit="h"
                min={0}
                max={24}
                disabled={readOnly}
                value={grid.dailyOutageHours}
                onChange={(v) => v !== undefined && setGrid({ dailyOutageHours: v })}
              />
              <NumberField
                id="grid-tariff"
                label="Tarifa"
                unit="centavos/kWh"
                min={0}
                disabled={readOnly}
                value={grid.tariffCentsPerKwh}
                onChange={(v) => v !== undefined && setGrid({ tariffCentsPerKwh: v })}
              />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">Quedas prolongadas</p>
              {grid.extendedOutages.map((o, i) => (
                <div key={i} className="flex flex-wrap items-end gap-3">
                  <NumberField
                    id={`out-d-${i}`}
                    label="Dia do ano"
                    integer
                    min={1}
                    max={365}
                    disabled={readOnly}
                    value={o.startDayOfYear}
                    onChange={(v) =>
                      v !== undefined &&
                      setGrid({
                        extendedOutages: grid.extendedOutages.map((x, j) =>
                          j === i ? { ...x, startDayOfYear: v } : x,
                        ),
                      })
                    }
                  />
                  <NumberField
                    id={`out-n-${i}`}
                    label="Dias"
                    integer
                    min={1}
                    max={30}
                    disabled={readOnly}
                    value={o.days}
                    onChange={(v) =>
                      v !== undefined &&
                      setGrid({
                        extendedOutages: grid.extendedOutages.map((x, j) =>
                          j === i ? { ...x, days: v } : x,
                        ),
                      })
                    }
                  />
                  {!readOnly ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label="Remover queda"
                      onClick={() =>
                        setGrid({ extendedOutages: grid.extendedOutages.filter((_, j) => j !== i) })
                      }
                    >
                      <Trash2 />
                    </Button>
                  ) : null}
                </div>
              ))}
              {!readOnly && grid.extendedOutages.length < 10 ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setGrid({
                      extendedOutages: [...grid.extendedOutages, { startDayOfYear: 100, days: 3 }],
                    })
                  }
                >
                  <Plus /> Adicionar queda prolongada
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
