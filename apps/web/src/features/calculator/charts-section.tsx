import type { QuickCalculationResult } from '@voltex/solar-engine';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@voltex/ui';
import { CashFlowChart, GenerationChart } from './charts';

/** Gráficos em um módulo próprio: o Recharts só baixa quando o resultado é aberto. */
export default function ChartsSection({
  result,
  consumptionKwh,
}: {
  result: QuickCalculationResult;
  consumptionKwh: number[];
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Geração × consumo</CardTitle>
          <CardDescription>kWh por mês.</CardDescription>
        </CardHeader>
        <CardContent>
          <GenerationChart
            generationKwh={result.monthlyGenerationKwh}
            consumptionKwh={consumptionKwh}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Fluxo de caixa acumulado</CardTitle>
          <CardDescription>
            O ano 0 é o investimento; o retorno ocorre quando a linha cruza o zero.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CashFlowChart cashFlow={result.cashFlow} investmentCents={result.investmentCents} />
        </CardContent>
      </Card>
    </div>
  );
}
