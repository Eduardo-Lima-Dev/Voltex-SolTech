import { Plus, Trash2 } from 'lucide-react';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@voltex/ui';
import { formatNumber } from '@/lib/format';
import { NumberField } from '../../engine/editor/number-field';
import { useOffgrid } from './offgrid-context';

const money = (cents: number | null | undefined) =>
  cents === null || cents === undefined
    ? '—'
    : (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Etapa 9: cenários, premissas de custo e comparação. */
export function ScenariosStep() {
  const { design, update, readOnly, results } = useOffgrid();
  const eco = design.economics;
  const setEco = (patch: Partial<typeof eco>) =>
    update((d) => ({ ...d, economics: { ...d.economics, ...patch } }));
  const e = results.economics;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Premissas de custo</CardTitle>
          <CardDescription>
            Equipamentos vêm do catálogo (preço vigente ou de referência). Informe o que mais compõe
            o custo.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <NumberField
            id="eco-inst"
            label="Instalação e projeto"
            unit="centavos"
            integer
            min={0}
            disabled={readOnly}
            value={eco.installationCostCents}
            onChange={(v) => v !== undefined && setEco({ installationCostCents: v })}
            hint={money(eco.installationCostCents)}
          />
          <NumberField
            id="eco-other"
            label="Outros custos"
            unit="centavos"
            integer
            min={0}
            disabled={readOnly}
            value={eco.otherCostCents}
            onChange={(v) => v !== undefined && setEco({ otherCostCents: v })}
            hint={money(eco.otherCostCents)}
          />
          <NumberField
            id="eco-maint"
            label="Manutenção"
            unit="% do CAPEX/ano"
            min={0}
            max={30}
            disabled={readOnly}
            value={eco.maintenancePctPerYear}
            onChange={(v) => v !== undefined && setEco({ maintenancePctPerYear: v })}
          />
          <NumberField
            id="eco-rate"
            label="Taxa de desconto"
            unit="%"
            min={0}
            max={100}
            disabled={readOnly}
            value={eco.discountRatePct}
            onChange={(v) => v !== undefined && setEco({ discountRatePct: v })}
          />
          <NumberField
            id="eco-horizon"
            label="Horizonte"
            unit="anos"
            integer
            min={1}
            max={40}
            disabled={readOnly}
            value={eco.horizonYears}
            onChange={(v) => v !== undefined && setEco({ horizonYears: v })}
          />
          <NumberField
            id="eco-avoided"
            label="Custo evitado (comparação)"
            unit="centavos/kWh"
            min={0}
            disabled={readOnly}
            value={eco.avoidedCostCentsPerKwh}
            hint="Gerador a diesel, extensão de rede ou kWh da concessionária"
            onChange={(v) => v !== undefined && setEco({ avoidedCostCentsPerKwh: v })}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Custo do projeto</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {e ? (
            <>
              <dl className="grid grid-cols-2 gap-2 text-sm lg:grid-cols-4">
                <dt>CAPEX</dt>
                <dd>{money(e.capexCents)}</dd>
                <dt>OPEX anual</dt>
                <dd>
                  {money(e.annualOpexCents)} + combustível {money(e.annualFuelCents)} + rede{' '}
                  {money(e.annualGridCents)}
                </dd>
                <dt>Custo nivelado</dt>
                <dd>{e.lcoeCentsPerKwh !== null ? `${money(e.lcoeCentsPerKwh)}/kWh` : '—'}</dd>
                <dt>Retorno</dt>
                <dd>{e.paybackYears !== null ? `${formatNumber(e.paybackYears, 1)} anos` : '—'}</dd>
                <dt>Troca do banco</dt>
                <dd>
                  {e.batteryReplacementYears !== null
                    ? `a cada ${formatNumber(e.batteryReplacementYears, 1)} anos`
                    : '—'}
                </dd>
              </dl>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>Qtd</TableHead>
                    <TableHead>Unitário</TableHead>
                    <TableHead>Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {e.capexItems.map((item, i) => (
                    <TableRow key={`${item.description}-${i}`}>
                      <TableCell>{item.description}</TableCell>
                      <TableCell>{item.quantity}</TableCell>
                      <TableCell>
                        {item.unitCostCents === null ? 'sem preço' : money(item.unitCostCents)}
                      </TableCell>
                      <TableCell>{money(item.totalCents)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Complete o projeto e simule para calcular o custo.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cenários</CardTitle>
          <CardDescription>
            Até três variações do projeto atual (banco maior, mais FV, com gerador) comparadas lado
            a lado.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {design.scenarios.map((s) => (
            <fieldset
              key={s.id}
              className="grid gap-3 rounded border p-3 sm:grid-cols-2 lg:grid-cols-4"
            >
              <legend className="px-1 text-sm font-medium">{s.name}</legend>
              <div className="grid gap-1">
                <label className="text-sm font-medium" htmlFor={`sc-name-${s.id}`}>
                  Nome
                </label>
                <Input
                  id={`sc-name-${s.id}`}
                  disabled={readOnly}
                  value={s.name}
                  onChange={(ev) =>
                    update((d) => ({
                      ...d,
                      scenarios: d.scenarios.map((x) =>
                        x.id === s.id ? { ...x, name: ev.target.value } : x,
                      ),
                    }))
                  }
                />
              </div>
              <NumberField
                id={`sc-par-${s.id}`}
                label="Colunas de baterias"
                integer
                min={1}
                max={20}
                optional
                disabled={readOnly}
                value={s.bank?.parallelCount}
                hint="Vazio = igual ao projeto"
                onChange={(v) =>
                  update((d) => ({
                    ...d,
                    scenarios: d.scenarios.map((x) =>
                      x.id === s.id ? { ...x, bank: { ...(x.bank ?? {}), parallelCount: v } } : x,
                    ),
                  }))
                }
              />
              <NumberField
                id={`sc-str-${s.id}`}
                label="Strings do 1º arranjo"
                integer
                min={1}
                max={50}
                optional
                disabled={readOnly}
                value={s.parallelStrings}
                hint="Vazio = igual ao projeto"
                onChange={(v) =>
                  update((d) => ({
                    ...d,
                    scenarios: d.scenarios.map((x) =>
                      x.id === s.id ? { ...x, parallelStrings: v } : x,
                    ),
                  }))
                }
              />
              <label className="flex items-center gap-2 self-end text-sm">
                <input
                  type="checkbox"
                  disabled={readOnly}
                  checked={s.generatorEnabled ?? design.generator.enabled}
                  onChange={(ev) =>
                    update((d) => ({
                      ...d,
                      scenarios: d.scenarios.map((x) =>
                        x.id === s.id ? { ...x, generatorEnabled: ev.target.checked } : x,
                      ),
                    }))
                  }
                />
                Com gerador
              </label>
              {!readOnly ? (
                <Button
                  className="justify-self-end"
                  variant="ghost"
                  size="sm"
                  aria-label={`Remover ${s.name}`}
                  onClick={() =>
                    update((d) => ({ ...d, scenarios: d.scenarios.filter((x) => x.id !== s.id) }))
                  }
                >
                  <Trash2 /> Remover
                </Button>
              ) : null}
            </fieldset>
          ))}
          {!readOnly && design.scenarios.length < 3 ? (
            <Button
              variant="outline"
              onClick={() =>
                update((d) => ({
                  ...d,
                  scenarios: [
                    ...d.scenarios,
                    {
                      id: `s${Math.random().toString(36).slice(2, 7)}`,
                      name: `Cenário ${d.scenarios.length + 1}`,
                    },
                  ],
                }))
              }
            >
              <Plus /> Adicionar cenário
            </Button>
          ) : null}
          {results.scenarios.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cenário</TableHead>
                  <TableHead>FV</TableHead>
                  <TableHead>Banco</TableHead>
                  <TableHead>Gerador</TableHead>
                  <TableHead>Perda de carga</TableHead>
                  <TableHead>CAPEX</TableHead>
                  <TableHead>Custo nivelado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[
                  {
                    id: 'base',
                    name: 'Projeto atual',
                    pvPowerWp: results.selected?.pvPowerWp ?? 0,
                    bankNominalWh: results.selected?.bankNominalWh ?? 0,
                    generator: design.generator.enabled,
                    lolpPct: results.simulation?.lolpPct ?? 0,
                    capexCents: e?.capexCents ?? 0,
                    lcoeCentsPerKwh: e?.lcoeCentsPerKwh ?? null,
                  },
                  ...results.scenarios,
                ].map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>{s.name}</TableCell>
                    <TableCell>{formatNumber(s.pvPowerWp, 0)} Wp</TableCell>
                    <TableCell>{formatNumber(s.bankNominalWh, 0)} Wh</TableCell>
                    <TableCell>{s.generator ? 'sim' : 'não'}</TableCell>
                    <TableCell>{formatNumber(s.lolpPct, 2)}%</TableCell>
                    <TableCell>{money(s.capexCents)}</TableCell>
                    <TableCell>
                      {s.lcoeCentsPerKwh !== null ? `${money(s.lcoeCentsPerKwh)}/kWh` : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
