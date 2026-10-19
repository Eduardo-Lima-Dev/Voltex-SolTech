import { useQuery } from '@tanstack/react-query';
import type { Thresholds } from '@voltex/shared';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@voltex/ui';
import {
  PHASE_SYSTEM_LABELS,
  RULE_SOURCE_TYPE_LABELS,
  RULE_STATUS_LABELS,
  THRESHOLD_LABELS,
} from '@/i18n/labels';
import { endpoints } from '@/lib/api/endpoints';
import { formatDate, formatNumber } from '@/lib/format';
import { queryKeys } from '../query-keys';

const STATUS_BADGE = { ACTIVE: 'green', DRAFT: 'secondary', RETIRED: 'outline' } as const;

function EffectiveRules() {
  const config = useQuery({
    queryKey: queryKeys.effectiveRules,
    queryFn: endpoints.rules.effective,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Regra em vigor</CardTitle>
        <CardDescription>
          Limites e parâmetros que o Solar Calculator usa agora. Cada cálculo guarda a referência da
          regra aplicada.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {config.isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : config.isError ? (
          <p className="text-sm text-destructive">Não foi possível carregar a regra em vigor.</p>
        ) : (
          <>
            <p className="text-sm">
              Referência: <Badge variant="outline">{config.data.ref}</Badge>
              {config.data.ref === 'builtin@1' ? (
                <span className="ml-2 text-muted-foreground">
                  Padrão do produto: a empresa ainda não ativou uma regra própria.
                </span>
              ) : null}
            </p>
            <div className="grid gap-x-8 md:grid-cols-2">
              <dl>
                {(Object.keys(THRESHOLD_LABELS) as (keyof Thresholds)[]).map((key) => (
                  <div
                    key={key}
                    className="flex items-baseline justify-between gap-4 border-b py-2 text-sm"
                  >
                    <dt className="text-muted-foreground">{THRESHOLD_LABELS[key].label}</dt>
                    <dd className="font-medium tabular-nums">
                      {formatNumber(config.data.thresholds[key], 3)}{' '}
                      {THRESHOLD_LABELS[key].unit ?? ''}
                    </dd>
                  </div>
                ))}
              </dl>
              <div className="space-y-4">
                <div>
                  <h3 className="mb-1 text-sm font-medium">Custo de disponibilidade (kWh/mês)</h3>
                  {Object.keys(config.data.availabilityCostKwh).length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Não definido: o usuário informa o valor da fatura em cada cálculo.
                    </p>
                  ) : (
                    <dl>
                      {Object.entries(config.data.availabilityCostKwh).map(([phase, value]) => (
                        <div
                          key={phase}
                          className="flex justify-between gap-4 border-b py-2 text-sm"
                        >
                          <dt className="text-muted-foreground">
                            {PHASE_SYSTEM_LABELS[phase as keyof typeof PHASE_SYSTEM_LABELS] ??
                              phase}
                          </dt>
                          <dd className="font-medium tabular-nums">{formatNumber(value, 0)} kWh</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>
                <div>
                  <h3 className="mb-1 text-sm font-medium">Fontes</h3>
                  <ul className="space-y-2 text-sm">
                    {config.data.sources.map((source) => (
                      <li key={source.reference}>
                        <Badge variant="secondary" className="mr-2">
                          {RULE_SOURCE_TYPE_LABELS[source.type]}
                        </Badge>
                        {source.reference}
                        {source.notes ? (
                          <span className="block text-xs text-muted-foreground">
                            {source.notes}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Versions() {
  const rules = useQuery({ queryKey: queryKeys.rules, queryFn: endpoints.rules.list });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Versões da regra</CardTitle>
        <CardDescription>
          Regras ativadas são imutáveis e exigem um responsável pela revisão. Rascunhos e ativação
          são feitos pela API nesta fase.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rules.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : rules.isError ? (
          <p className="text-sm text-destructive">Não foi possível carregar as versões.</p>
        ) : rules.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma versão própria criada. O padrão do produto está em uso.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Versão</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead>Vigência</TableHead>
                <TableHead>Revisão</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.data.map((rule) => (
                <TableRow key={rule.id}>
                  <TableCell className="font-medium">v{rule.version}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_BADGE[rule.status]}>
                      {RULE_STATUS_LABELS[rule.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {rule.validFrom ? formatDate(rule.validFrom) : '—'}
                    {rule.validTo ? ` a ${formatDate(rule.validTo)}` : ''}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {rule.reviewedBy ?? 'Sem revisão'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export function RulesPage() {
  return (
    <div className="space-y-6">
      <EffectiveRules />
      <Versions />
    </div>
  );
}
