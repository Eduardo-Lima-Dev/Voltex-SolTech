import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Pencil } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  Badge,
  Button,
  NativeSelect,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@voltex/ui';
import type { OpportunityStage } from '@voltex/shared';
import { Can } from '@/app/guards';
import { queryKeys } from '@/features/admin/query-keys';
import { useAuth } from '@/features/auth/auth-provider';
import { OPPORTUNITY_STATUS_LABELS, PROJECT_TYPE_LABELS } from '@/i18n/labels';
import { endpoints } from '@/lib/api/endpoints';
import { isApiError } from '@/lib/api/errors';
import { BillsTab } from './bills-tab';
import { CalculationsTab } from './calculations-tab';
import { ContractTab } from './contract-tab';
import { EditOpportunityDialog } from './edit-opportunity-dialog';
import { EngineeringTab } from './engineering-tab';
import { GuardTab } from './guard-tab';
import { LostDialog } from './lost-dialog';
import { ProposalsTab } from './proposals-tab';
import { QuotesTab } from './quotes-tab';
import { allowedStages, stageName, useStageChange } from './stage-change';
import { SummaryTab } from './summary-tab';
import { TasksTab } from './tasks-tab';
import { TimelineTab } from './timeline-tab';

export function OpportunityDetailPage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const [editing, setEditing] = useState(false);
  const opportunity = useQuery({
    queryKey: queryKeys.opportunity(id),
    queryFn: () => endpoints.opportunities.get(id),
  });
  const stages = useQuery({ queryKey: queryKeys.pipeline, queryFn: endpoints.pipeline.list });
  const stageChange = useStageChange(stages.data);

  if (opportunity.isPending) return <Skeleton className="h-64 w-full" />;
  if (opportunity.isError)
    return (
      <div className="space-y-3">
        <p className="text-sm text-destructive">
          {isApiError(opportunity.error) && opportunity.error.status === 404
            ? 'Oportunidade não encontrada.'
            : 'Não foi possível carregar a oportunidade.'}
        </p>
        <Button asChild variant="outline">
          <Link to="/crm/oportunidades">Voltar às oportunidades</Link>
        </Button>
      </div>
    );

  const data = opportunity.data;
  const open = data.status === 'OPEN';
  const targets = allowedStages(data.stage);

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <Link
          to="/crm/oportunidades"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden /> Oportunidades
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-2xl font-semibold tracking-tight">{data.title}</h2>
              <Badge
                variant={
                  data.status === 'WON' ? 'green' : data.status === 'LOST' ? 'outline' : 'secondary'
                }
              >
                {open ? stageName(stages.data, data.stage) : OPPORTUNITY_STATUS_LABELS[data.status]}
              </Badge>
            </div>
            <p className="text-muted-foreground">
              <Link className="hover:underline" to={`/crm/contas/${data.accountId}`}>
                {data.accountName}
              </Link>{' '}
              ·{' '}
              <span className="font-mono" title="Código do projeto">
                {data.projectCode}
              </span>{' '}
              · {PROJECT_TYPE_LABELS[data.projectType]}
              {data.ownerName ? ` · ${data.ownerName}` : ''}
            </p>
          </div>
          <Can permission="crm.opportunity.write">
            <div className="flex flex-wrap items-center gap-2">
              {open || data.status === 'LOST' ? (
                <NativeSelect
                  aria-label="Mudar de etapa"
                  className="h-9 w-56"
                  value=""
                  onChange={(e) =>
                    e.target.value && stageChange.request(data, e.target.value as OpportunityStage)
                  }
                  disabled={stageChange.isPending}
                >
                  <option value="">{open ? 'Mover para…' : 'Reabrir em…'}</option>
                  {targets.map((s) => (
                    <option key={s} value={s}>
                      {stageName(stages.data, s)}
                    </option>
                  ))}
                </NativeSelect>
              ) : null}
              {open ? (
                <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                  <Pencil /> Editar
                </Button>
              ) : null}
            </div>
          </Can>
        </div>
      </header>

      <Tabs defaultValue="resumo">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="resumo">Resumo</TabsTrigger>
          <TabsTrigger value="linha-do-tempo">Linha do tempo</TabsTrigger>
          <TabsTrigger value="tarefas">Tarefas</TabsTrigger>
          {can('crm.energy-bill.read') ? <TabsTrigger value="fatura">Fatura</TabsTrigger> : null}
          {can('calculator.session.read') ? (
            <TabsTrigger value="calculos">Cálculos</TabsTrigger>
          ) : null}
          <TabsTrigger value="engenharia">Engenharia</TabsTrigger>
          {can('crm.guard.read') ? <TabsTrigger value="triagem">Triagem</TabsTrigger> : null}
          {can('crm.quote.read') ? <TabsTrigger value="cotacao">Cotação</TabsTrigger> : null}
          {can('crm.proposal.read') ? <TabsTrigger value="proposta">Proposta</TabsTrigger> : null}
          {can('crm.contract.read') ? <TabsTrigger value="contrato">Contrato</TabsTrigger> : null}
        </TabsList>
        <TabsContent value="resumo" className="pt-4">
          <SummaryTab opportunity={data} />
        </TabsContent>
        <TabsContent value="linha-do-tempo" className="pt-4">
          <TimelineTab opportunityId={id} />
        </TabsContent>
        <TabsContent value="tarefas" className="pt-4">
          <TasksTab opportunityId={id} />
        </TabsContent>
        <TabsContent value="fatura" className="pt-4">
          <BillsTab opportunityId={id} />
        </TabsContent>
        <TabsContent value="calculos" className="pt-4">
          <CalculationsTab opportunityId={id} />
        </TabsContent>
        <TabsContent value="engenharia" className="pt-4">
          <EngineeringTab opportunityId={id} />
        </TabsContent>
        <TabsContent value="triagem" className="pt-4">
          <GuardTab opportunityId={id} open={open} />
        </TabsContent>
        <TabsContent value="cotacao" className="pt-4">
          <QuotesTab opportunityId={id} open={open} />
        </TabsContent>
        <TabsContent value="proposta" className="pt-4">
          <ProposalsTab opportunityId={id} open={open} />
        </TabsContent>
        <TabsContent value="contrato" className="pt-4">
          <ContractTab opportunityId={id} stage={data.stage} open={open} />
        </TabsContent>
      </Tabs>

      <EditOpportunityDialog opportunity={data} open={editing} onOpenChange={setEditing} />
      <LostDialog
        open={stageChange.pendingLost !== null}
        title={data.title}
        pending={stageChange.isPending}
        onOpenChange={(o) => !o && stageChange.cancelLost()}
        onConfirm={stageChange.confirmLost}
      />
    </div>
  );
}
