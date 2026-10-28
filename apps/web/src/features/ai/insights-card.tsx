import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Sparkles, X } from 'lucide-react';
import { Link } from 'react-router';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  toast,
} from '@voltex/ui';
import type { InsightDto, InsightSeverity } from '@voltex/shared';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api/errors';

export const insightsKey = ['ai', 'insights'] as const;

const SEVERITY: Record<InsightSeverity, { label: string; variant: 'red' | 'yellow' | 'outline' }> =
  {
    CRITICAL: { label: 'Urgente', variant: 'red' },
    ATTENTION: { label: 'Atenção', variant: 'yellow' },
    INFO: { label: 'Informação', variant: 'outline' },
  };

function InsightRow({ insight }: { insight: InsightDto }) {
  const queryClient = useQueryClient();
  const update = useMutation({
    mutationFn: (status: 'RESOLVED' | 'DISMISSED') =>
      endpoints.ai.insights.update(insight.id, {
        status,
        helpful: status === 'RESOLVED' ? true : false,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: insightsKey });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const severity = SEVERITY[insight.severity];

  return (
    <li className="space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={severity.variant}>{severity.label}</Badge>
        {insight.aiWritten ? (
          <span className="text-[11px] text-muted-foreground">Redigido por IA</span>
        ) : null}
      </div>
      <p className="text-sm">{insight.text}</p>
      <ul className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
        {insight.facts.map((fact) => (
          <li key={fact.key}>
            {fact.label}: <span className="font-medium text-foreground">{fact.text}</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <Link
          to={insight.link}
          className="text-sm font-medium text-brand-cyan-strong hover:underline dark:text-brand-cyan"
        >
          Ver os dados
        </Link>
        <span className="flex-1" />
        <Button
          size="sm"
          variant="ghost"
          disabled={update.isPending}
          onClick={() => update.mutate('RESOLVED')}
        >
          <Check /> Resolvido
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={update.isPending}
          onClick={() => update.mutate('DISMISSED')}
        >
          <X /> Não relevante
        </Button>
      </div>
    </li>
  );
}

/** "O que a IA notou hoje": achados da rotina diária. Some quando não há nenhum (ou a IA não está ligada). */
export function InsightsCard() {
  const insights = useQuery({
    queryKey: insightsKey,
    queryFn: () => endpoints.ai.insights.list(),
  });
  if (insights.isError || !insights.data || insights.data.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="size-4 text-brand-cyan" aria-hidden />O que a IA notou hoje
        </CardTitle>
        <CardDescription>
          Achados do sistema. Os números vêm dos seus dados; confira antes de decidir.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {insights.data.map((insight) => (
            <InsightRow key={insight.id} insight={insight} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
