import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from '@voltex/ui';
import { formatCents, formatNumber } from '@/lib/format';
import { NumberField } from './number-field';
import { useEditor } from './editor-context';

/** Viabilidade: premissas claras, resultado oficial e trava quando a regra econômica não estiver ativa. */
export function EconomicsStep() {
  const { design, update, readOnly, results } = useEditor();
  const economics = design.economics;
  const result = results.economics;
  const set = (patch: NonNullable<typeof economics>) =>
    update((current) => ({ ...current, economics: patch }));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Premissas econômicas</CardTitle>
          <CardDescription>
            O CAPEX vem da lista de materiais vigente. Informe a tarifa efetiva e sua fonte;
            compensação e Fio B são lidos da regra econômica revisada.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!economics ? (
            <button
              type="button"
              disabled={readOnly}
              className="rounded border px-3 py-2 text-sm"
              onClick={() =>
                set({
                  monthlyConsumptionKwh: 300,
                  tariffCentsPerKwh: 100,
                  tariffSource: 'Fatura da unidade consumidora',
                  tariffEscalationPct: 4,
                  degradationPctPerYear: 0.55,
                  opexPctOfCapex: 1,
                  discountRatePct: 10,
                  horizonYears: 25,
                  scenarios: [],
                })
              }
            >
              Adicionar premissas econômicas
            </button>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <NumberField
                id="economics-consumption"
                label="Consumo mensal"
                unit="kWh"
                min={0.01}
                value={economics.monthlyConsumptionKwh}
                disabled={readOnly}
                onChange={(value) =>
                  value !== undefined && set({ ...economics, monthlyConsumptionKwh: value })
                }
              />
              <NumberField
                id="economics-tariff"
                label="Tarifa efetiva"
                unit="¢/kWh"
                min={0.01}
                value={economics.tariffCentsPerKwh}
                disabled={readOnly}
                onChange={(value) =>
                  value !== undefined && set({ ...economics, tariffCentsPerKwh: value })
                }
              />
              <div className="grid gap-1">
                <Label htmlFor="economics-source">Fonte da tarifa</Label>
                <Input
                  id="economics-source"
                  value={economics.tariffSource}
                  disabled={readOnly}
                  onChange={(event) => set({ ...economics, tariffSource: event.target.value })}
                />
              </div>
              <NumberField
                id="economics-escalation"
                label="Reajuste anual da tarifa"
                unit="%"
                min={0}
                max={100}
                value={economics.tariffEscalationPct}
                disabled={readOnly}
                onChange={(value) =>
                  value !== undefined && set({ ...economics, tariffEscalationPct: value })
                }
              />
              <NumberField
                id="economics-degradation"
                label="Degradação anual"
                unit="%"
                min={0}
                max={20}
                value={economics.degradationPctPerYear}
                disabled={readOnly}
                onChange={(value) =>
                  value !== undefined && set({ ...economics, degradationPctPerYear: value })
                }
              />
              <NumberField
                id="economics-opex"
                label="OPEX anual sobre CAPEX"
                unit="%"
                min={0}
                max={100}
                value={economics.opexPctOfCapex}
                disabled={readOnly}
                onChange={(value) =>
                  value !== undefined && set({ ...economics, opexPctOfCapex: value })
                }
              />
              <NumberField
                id="economics-discount"
                label="Taxa de desconto"
                unit="%"
                min={0}
                max={100}
                value={economics.discountRatePct}
                disabled={readOnly}
                onChange={(value) =>
                  value !== undefined && set({ ...economics, discountRatePct: value })
                }
              />
              <NumberField
                id="economics-horizon"
                label="Horizonte"
                unit="anos"
                min={1}
                max={50}
                value={economics.horizonYears}
                disabled={readOnly}
                onChange={(value) =>
                  value !== undefined && set({ ...economics, horizonYears: value })
                }
              />
            </div>
          )}
          {economics ? <FinancingAndScenarios /> : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Resultado oficial</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <Badge variant={result?.status === 'INCOMPLETE' ? 'yellow' : 'green'}>
            {result?.status ?? 'INCOMPLETE'}
          </Badge>
          <div className="grid gap-2 sm:grid-cols-3">
            <p>
              CAPEX:{' '}
              <strong>
                {result?.capexCents === null || result?.capexCents === undefined
                  ? '—'
                  : formatCents(result.capexCents)}
              </strong>
            </p>
            <p>
              Payback:{' '}
              <strong>
                {result?.simplePaybackYears === null || result?.simplePaybackYears === undefined
                  ? '—'
                  : `${formatNumber(result.simplePaybackYears, 1)} anos`}
              </strong>
            </p>
            <p>
              Payback descontado:{' '}
              <strong>
                {result?.discountedPaybackYears === null ||
                result?.discountedPaybackYears === undefined
                  ? '—'
                  : `${formatNumber(result.discountedPaybackYears, 1)} anos`}
              </strong>
            </p>
            <p>
              VPL:{' '}
              <strong>
                {result?.npvCents === null || result?.npvCents === undefined
                  ? '—'
                  : formatCents(result.npvCents)}
              </strong>
            </p>
            <p>
              TIR:{' '}
              <strong>
                {result?.irrPct === null || result?.irrPct === undefined
                  ? '—'
                  : `${formatNumber(result.irrPct, 2)}%`}
              </strong>
            </p>
            <p>
              LCOE:{' '}
              <strong>
                {result?.lcoeCentsPerKwh === null || result?.lcoeCentsPerKwh === undefined
                  ? '—'
                  : `${formatNumber(result.lcoeCentsPerKwh, 2)} ¢/kWh`}
              </strong>
            </p>
          </div>
          <EconomicsExtras />
          {result?.pending.map((item) => (
            <p key={item.code} className="rounded border border-warning/50 bg-warning/10 p-2">
              {item.message}
            </p>
          ))}
          {result?.warnings.map((warning) => (
            <p key={warning} className="text-muted-foreground">
              {warning}
            </p>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

/** Financiamento (Price ou SAC) e até três cenários sobre o caso-base. */
function FinancingAndScenarios() {
  const { design, update, readOnly } = useEditor();
  const economics = design.economics!;
  const set = (patch: Partial<typeof economics>) =>
    update((current) => ({ ...current, economics: { ...current.economics!, ...patch } }));
  const financing = economics.financing;
  const scenarios = economics.scenarios;
  const setScenario = (index: number, patch: Partial<(typeof scenarios)[number]>) =>
    set({ scenarios: scenarios.map((s, i) => (i === index ? { ...s, ...patch } : s)) });
  return (
    <div className="space-y-4 border-t pt-4">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-sm font-medium">Financiamento</h3>
        {financing ? (
          <button
            type="button"
            disabled={readOnly}
            className="rounded border px-2 py-1 text-xs"
            onClick={() => {
              const { financing: _removed, ...rest } = economics;
              update((current) => ({ ...current, economics: rest }));
            }}
          >
            Compra à vista
          </button>
        ) : (
          <button
            type="button"
            disabled={readOnly}
            className="rounded border px-2 py-1 text-xs"
            onClick={() =>
              set({
                financing: {
                  downPaymentPct: 20,
                  annualRatePct: 18,
                  termMonths: 60,
                  system: 'PRICE',
                },
              })
            }
          >
            Simular financiamento
          </button>
        )}
      </div>
      {financing ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <NumberField
            id="financing-down"
            label="Entrada"
            unit="%"
            min={0}
            max={100}
            value={financing.downPaymentPct}
            disabled={readOnly}
            onChange={(v) =>
              v !== undefined && set({ financing: { ...financing, downPaymentPct: v } })
            }
          />
          <NumberField
            id="financing-rate"
            label="Taxa efetiva anual"
            unit="%"
            min={0}
            max={300}
            value={financing.annualRatePct}
            disabled={readOnly}
            onChange={(v) =>
              v !== undefined && set({ financing: { ...financing, annualRatePct: v } })
            }
          />
          <NumberField
            id="financing-term"
            label="Prazo"
            unit="meses"
            min={1}
            max={480}
            value={financing.termMonths}
            disabled={readOnly}
            onChange={(v) =>
              v !== undefined && set({ financing: { ...financing, termMonths: Math.round(v) } })
            }
          />
          <div className="grid gap-1">
            <Label htmlFor="financing-system">Sistema</Label>
            <select
              id="financing-system"
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={financing.system}
              disabled={readOnly}
              onChange={(event) =>
                set({ financing: { ...financing, system: event.target.value as 'PRICE' | 'SAC' } })
              }
            >
              <option value="PRICE">Price (parcela fixa)</option>
              <option value="SAC">SAC (amortização constante)</option>
            </select>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-sm font-medium">Cenários (até 3)</h3>
        <button
          type="button"
          disabled={readOnly || scenarios.length >= 3}
          className="rounded border px-2 py-1 text-xs"
          onClick={() =>
            set({ scenarios: [...scenarios, { name: `Cenário ${scenarios.length + 1}` }] })
          }
        >
          Adicionar cenário
        </button>
      </div>
      {scenarios.map((scenario, index) => (
        <div key={index} className="grid gap-3 rounded border p-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="grid gap-1">
            <Label htmlFor={`scenario-name-${index}`}>Nome</Label>
            <Input
              id={`scenario-name-${index}`}
              value={scenario.name}
              disabled={readOnly}
              onChange={(event) => setScenario(index, { name: event.target.value })}
            />
          </div>
          <NumberField
            id={`scenario-generation-${index}`}
            label="Geração (fator)"
            min={0.01}
            max={2}
            value={scenario.generationFactor}
            disabled={readOnly}
            onChange={(v) => setScenario(index, { generationFactor: v })}
          />
          <NumberField
            id={`scenario-capex-${index}`}
            label="CAPEX (fator)"
            min={0.01}
            max={3}
            value={scenario.capexFactor}
            disabled={readOnly}
            onChange={(v) => setScenario(index, { capexFactor: v })}
          />
          <NumberField
            id={`scenario-escalation-${index}`}
            label="Reajuste da tarifa"
            unit="%"
            min={0}
            max={100}
            value={scenario.tariffEscalationPct}
            disabled={readOnly}
            onChange={(v) => setScenario(index, { tariffEscalationPct: v })}
          />
          <div className="flex items-end">
            <button
              type="button"
              disabled={readOnly}
              className="rounded border px-2 py-1 text-xs"
              onClick={() => set({ scenarios: scenarios.filter((_, i) => i !== index) })}
            >
              Remover
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Financiamento, cenários, tornado de sensibilidade e caixa acumulado do resultado oficial. */
function EconomicsExtras() {
  const { results } = useEditor();
  const result = results.economics;
  if (!result || result.status === 'INCOMPLETE') return null;
  const maxSwing = Math.max(1, ...(result.sensitivity ?? []).map((s) => s.swingCents));
  const flow = result.cashFlow ?? [];
  const maxAbs = Math.max(1, ...flow.map((f) => Math.abs(f.cumulativeCents)));
  return (
    <div className="space-y-4">
      {result.financing ? (
        <div className="rounded border p-3">
          <h4 className="font-medium">Financiamento {result.financing.system}</h4>
          <p>
            Entrada {formatCents(result.financing.downPaymentCents)}; financiado{' '}
            {formatCents(result.financing.principalCents)}; parcela inicial{' '}
            {formatCents(result.financing.firstInstallmentCents)} e final{' '}
            {formatCents(result.financing.lastInstallmentCents)}; juros totais{' '}
            {formatCents(result.financing.totalInterestCents)}.
          </p>
          <p>
            VPL de quem financia: <strong>{formatCents(result.financing.npvCents)}</strong>; payback
            sobre a entrada:{' '}
            <strong>
              {result.financing.simplePaybackYears === null
                ? '—'
                : `${formatNumber(result.financing.simplePaybackYears, 1)} anos`}
            </strong>
            . Não inclui tarifas, seguros nem IOF.
          </p>
        </div>
      ) : null}
      {result.scenarios && result.scenarios.length > 0 ? (
        <table className="w-full text-left">
          <caption className="mb-1 text-left font-medium">Cenários</caption>
          <thead>
            <tr>
              <th>Cenário</th>
              <th>Payback</th>
              <th>VPL</th>
              <th>TIR</th>
              <th>LCOE</th>
            </tr>
          </thead>
          <tbody>
            {result.scenarios.map((scenario) => (
              <tr key={scenario.name}>
                <td>{scenario.name}</td>
                <td>
                  {scenario.simplePaybackYears === null
                    ? '—'
                    : `${formatNumber(scenario.simplePaybackYears, 1)} anos`}
                </td>
                <td>{formatCents(scenario.npvCents)}</td>
                <td>{scenario.irrPct === null ? '—' : `${formatNumber(scenario.irrPct, 2)}%`}</td>
                <td>
                  {scenario.lcoeCentsPerKwh === null
                    ? '—'
                    : `${formatNumber(scenario.lcoeCentsPerKwh, 2)} ¢/kWh`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {result.sensitivity && result.sensitivity.length > 0 ? (
        <div>
          <h4 className="mb-1 font-medium">Sensibilidade do VPL (±10% em cada premissa)</h4>
          <ul className="space-y-1" aria-label="Tornado de sensibilidade">
            {result.sensitivity.map((item) => (
              <li
                key={item.variable}
                className="grid grid-cols-[12rem_1fr_9rem] items-center gap-2"
              >
                <span>{item.label}</span>
                <span
                  className="block h-3 rounded bg-primary/70"
                  style={{ width: `${(item.swingCents / maxSwing) * 100}%` }}
                  role="presentation"
                />
                <span className="text-right text-muted-foreground">
                  ±{formatCents(Math.round(item.swingCents / 2))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {flow.length > 0 ? (
        <svg
          role="img"
          aria-label={`Caixa acumulado em ${flow.length} anos`}
          viewBox={`0 0 ${flow.length * 10} 60`}
          className="h-32 w-full rounded border bg-card"
          preserveAspectRatio="none"
        >
          <line
            x1={0}
            x2={flow.length * 10}
            y1={30}
            y2={30}
            className="stroke-muted-foreground"
            strokeWidth={0.3}
          />
          {flow.map((f, i) => {
            const h = (Math.abs(f.cumulativeCents) / maxAbs) * 28;
            return (
              <rect
                key={f.year}
                x={i * 10 + 1}
                y={f.cumulativeCents >= 0 ? 30 - h : 30}
                width={8}
                height={h}
                className={f.cumulativeCents >= 0 ? 'fill-primary/70' : 'fill-destructive/60'}
              />
            );
          })}
        </svg>
      ) : null}
    </div>
  );
}
