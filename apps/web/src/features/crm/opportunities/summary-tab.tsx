import { useQuery } from '@tanstack/react-query';
import { Check, Circle } from 'lucide-react';
import { Link } from 'react-router';
import type { OpportunityDto } from '@voltex/shared';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@voltex/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { queryKeys } from '@/features/admin/query-keys';
import {
  CUSTOMER_GROUP_LABELS,
  PHASE_SYSTEM_LABELS,
  PROJECT_TYPE_LABELS,
  ROOF_TYPE_LABELS,
  SHADING_LABELS,
} from '@/i18n/labels';
import { endpoints } from '@/lib/api/endpoints';
import { formatDate } from '@/lib/format';

function Step({ done, children }: { done: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      {done ? (
        <Check className="mt-0.5 size-4 shrink-0 text-success" aria-label="Feito" />
      ) : (
        <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label="Pendente" />
      )}
      <span className={done ? 'text-muted-foreground' : ''}>{children}</span>
    </li>
  );
}

export function SummaryTab({ opportunity }: { opportunity: OpportunityDto }) {
  const { can } = useAuth();
  const account = useQuery({
    queryKey: queryKeys.account(opportunity.accountId),
    queryFn: () => endpoints.accounts.get(opportunity.accountId),
    enabled: can('crm.account.read'),
  });
  const bills = useQuery({
    queryKey: queryKeys.opportunityBills(opportunity.id),
    queryFn: () => endpoints.energyBills.list({ opportunityId: opportunity.id }),
    enabled: can('crm.energy-bill.read'),
  });
  const calculations = useQuery({
    queryKey: queryKeys.opportunityCalculations(opportunity.id),
    queryFn: () => endpoints.opportunities.calculations(opportunity.id),
    enabled: can('calculator.session.read'),
  });

  const site = account.data?.sites.find((s) => s.id === opportunity.siteId);
  const unit = account.data?.consumerUnits.find((u) => u.id === opportunity.consumerUnitId);
  const intake = site?.intake ?? {};
  const billValidated = bills.data?.some((b) => b.status === 'VALIDATED') ?? false;
  const latest = calculations.data?.[0];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Premissas do negócio</CardTitle>
          <CardDescription>O que o cálculo e a triagem vão usar.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Conta</dt>
              <dd className="font-medium">
                <Link className="hover:underline" to={`/crm/contas/${opportunity.accountId}`}>
                  {opportunity.accountName}
                </Link>
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Tipo de sistema</dt>
              <dd className="font-medium">{PROJECT_TYPE_LABELS[opportunity.projectType]}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Imóvel</dt>
              <dd className="text-right font-medium">
                {site ? `${site.name} — ${site.city}/${site.state}` : 'Não definido'}
              </dd>
            </div>
            {site ? (
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Levantamento técnico</dt>
                <dd className="text-right">
                  {[
                    intake.roofType ? ROOF_TYPE_LABELS[intake.roofType] : null,
                    intake.roofAzimuthDegrees !== undefined
                      ? `azimute ${intake.roofAzimuthDegrees}°`
                      : null,
                    intake.tiltDegrees !== undefined ? `inclinação ${intake.tiltDegrees}°` : null,
                    intake.shading ? SHADING_LABELS[intake.shading] : null,
                  ]
                    .filter(Boolean)
                    .join(' · ') || 'Não preenchido'}
                </dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Unidade consumidora</dt>
              <dd className="text-right font-medium">
                {unit
                  ? [
                      `UC ${unit.number}`,
                      unit.distributorName,
                      CUSTOMER_GROUP_LABELS[unit.customerGroup],
                      unit.phaseSystem ? PHASE_SYSTEM_LABELS[unit.phaseSystem] : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')
                  : 'Não definida'}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Previsão de fechamento</dt>
              <dd className="font-medium">
                {opportunity.expectedCloseDate ? formatDate(opportunity.expectedCloseDate) : '—'}
              </dd>
            </div>
            {opportunity.lostReason ? (
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Motivo da perda</dt>
                <dd className="text-right font-medium">{opportunity.lostReason}</dd>
              </div>
            ) : null}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Próximos passos</CardTitle>
          <CardDescription>Fatura → cálculo → triagem → margem → proposta.</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="space-y-2">
            <Step done={!!opportunity.siteId && !!opportunity.consumerUnitId}>
              Definir o imóvel e a unidade consumidora
            </Step>
            <Step done={billValidated}>Enviar e validar a fatura de energia</Step>
            <Step done={!!latest}>
              Fazer o cálculo de pré-viabilidade
              {latest ? (
                <>
                  {' '}
                  <Badge
                    variant={
                      latest.trafficLight === 'GREEN'
                        ? 'green'
                        : latest.trafficLight === 'YELLOW'
                          ? 'yellow'
                          : 'red'
                    }
                  >
                    {latest.trafficLight === 'GREEN'
                      ? 'Verde'
                      : latest.trafficLight === 'YELLOW'
                        ? 'Amarelo'
                        : 'Vermelho'}
                  </Badge>
                </>
              ) : null}
            </Step>
            <Step done={opportunity.openTaskCount > 0}>Ter uma próxima tarefa definida</Step>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
