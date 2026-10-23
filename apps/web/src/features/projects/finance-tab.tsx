import { useState } from 'react';
import type { ProjectFinancialSummaryDto } from '@voltex/shared';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { formatCurrency, formatPercent } from '@/lib/format';

interface FinanceTabProps {
  projectId: string;
  summary: ProjectFinancialSummaryDto;
  onAddReceivable?: () => void;
  onAddCost?: () => void;
  onSimulateCredit?: () => void;
}

export function FinanceTab({
  projectId,
  summary,
  onAddReceivable,
  onAddCost,
  onSimulateCredit,
}: FinanceTabProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'receivables' | 'costs' | 'credit'>(
    'overview',
  );

  return (
    <div className="space-y-6">
      {/* Cards de resumo */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Contrato</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(summary.valueCents)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Recebido</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {formatCurrency(summary.totalReceivedCents)}
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {summary.receivablesPaidCount} de {summary.receivablesCount} parcelas
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Custos</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              {formatCurrency(summary.totalCostsCents)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Margem</CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-bold ${summary.marginCents >= 0 ? 'text-blue-600' : 'text-red-600'}`}
            >
              {formatPercent(summary.marginPct)}
            </div>
            <p className="text-xs text-gray-500 mt-1">{formatCurrency(summary.marginCents)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Abas */}
      <Card>
        <CardHeader>
          <CardTitle>Detalhes Financeiros</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
            <TabsList>
              <TabsTrigger value="overview">Resumo</TabsTrigger>
              <TabsTrigger value="receivables">Parcelas ({summary.receivablesCount})</TabsTrigger>
              <TabsTrigger value="costs">Custos</TabsTrigger>
              <TabsTrigger value="credit">Crédito</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-4">
              <div className="text-sm space-y-2">
                <div className="flex justify-between">
                  <span>Valor do contrato:</span>
                  <span className="font-semibold">{formatCurrency(summary.valueCents)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Total recebido:</span>
                  <span className="font-semibold text-green-600">
                    {formatCurrency(summary.totalReceivedCents)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Custos reais:</span>
                  <span className="font-semibold text-red-600">
                    {formatCurrency(summary.totalCostsCents)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Comissões:</span>
                  <span className="font-semibold">
                    {formatCurrency(summary.totalCommissionsCents)}
                  </span>
                </div>
                <hr />
                <div className="flex justify-between text-lg">
                  <span>Margem:</span>
                  <span
                    className={`font-bold ${summary.marginCents >= 0 ? 'text-blue-600' : 'text-red-600'}`}
                  >
                    {formatCurrency(summary.marginCents)} ({formatPercent(summary.marginPct)})
                  </span>
                </div>
                {summary.overdueCount > 0 && (
                  <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded text-yellow-700 text-sm">
                    ⚠️ {summary.overdueCount} parcela(s) vencida(s)
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="receivables" className="space-y-4">
              <div className="flex justify-end">
                <Button size="sm" onClick={onAddReceivable}>
                  + Adicionar parcela
                </Button>
              </div>
              <div className="space-y-2">
                {summary.receivables.length === 0 ? (
                  <p className="text-sm text-gray-500">Nenhuma parcela registrada</p>
                ) : (
                  <div className="space-y-2">
                    {summary.receivables.map((r) => (
                      <div key={r.id} className="p-3 border rounded text-sm">
                        <div className="flex justify-between items-center">
                          <div>
                            <div className="font-semibold">{r.referenceId}</div>
                            <div className="text-xs text-gray-500">
                              Parcela {r.order} • Vence em{' '}
                              {new Date(r.dueAt).toLocaleDateString('pt-BR')}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-semibold">{formatCurrency(r.amountCents)}</div>
                            <div
                              className={`text-xs ${
                                r.status === 'PAID'
                                  ? 'text-green-600'
                                  : r.status === 'OVERDUE'
                                    ? 'text-red-600'
                                    : 'text-gray-500'
                              }`}
                            >
                              {r.status === 'PAID' && '✓ Pago'}
                              {r.status === 'OPEN' && 'Aberto'}
                              {r.status === 'OVERDUE' && 'Vencido'}
                              {r.status === 'CANCELLED' && 'Cancelado'}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="costs" className="space-y-4">
              <div className="flex justify-end">
                <Button size="sm" onClick={onAddCost}>
                  + Registrar custo
                </Button>
              </div>
              <div className="space-y-2">
                {summary.costEntries.length === 0 ? (
                  <p className="text-sm text-gray-500">Nenhum custo registrado</p>
                ) : (
                  summary.costEntries.map((c) => (
                    <div key={c.id} className="p-3 border rounded text-sm">
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="font-semibold">{c.description}</div>
                          <div className="text-xs text-gray-500">
                            {c.category} • {c.supplier}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-semibold">{formatCurrency(c.actualCents)}</div>
                          {c.estimatedCents && (
                            <div className="text-xs text-gray-500">
                              Est: {formatCurrency(c.estimatedCents)}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </TabsContent>

            <TabsContent value="credit" className="space-y-4">
              <div className="flex justify-end">
                <Button size="sm" onClick={onSimulateCredit}>
                  + Simular crédito
                </Button>
              </div>
              <p className="text-sm text-gray-500">
                Simulações de crédito aparecem aqui quando criadas.
              </p>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
