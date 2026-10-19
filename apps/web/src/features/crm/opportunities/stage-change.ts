import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from '@voltex/ui';
import {
  OPPORTUNITY_TRANSITIONS,
  OpportunityStage,
  canTransition,
  type OpportunityDto,
  type PipelineStageDto,
} from '@voltex/shared';
import { queryKeys } from '@/features/admin/query-keys';
import { STAGE_LABELS } from '@/i18n/labels';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api/errors';

/** Etapas para onde dá para ir a partir da atual (sem "Ganho": só o contrato assinado leva a ele). */
export const allowedStages = (from: OpportunityStage): OpportunityStage[] =>
  OPPORTUNITY_TRANSITIONS[from].filter((s) => s !== OpportunityStage.WON);

export const stageName = (stages: PipelineStageDto[] | undefined, key: OpportunityStage): string =>
  stages?.find((s) => s.key === key)?.name ?? STAGE_LABELS[key];

/**
 * Muda a etapa pedindo o motivo quando for "Perdido". Valida a transição no cliente com a mesma máquina de estados
 * da API (mensagem imediata); a API continua sendo a barreira real.
 */
export function useStageChange(stages: PipelineStageDto[] | undefined) {
  const queryClient = useQueryClient();
  const [pendingLost, setPendingLost] = useState<OpportunityDto | null>(null);

  const mutation = useMutation({
    mutationFn: ({
      id,
      stage,
      lostReason,
    }: {
      id: string;
      stage: OpportunityStage;
      lostReason?: string;
    }) => endpoints.opportunities.changeStage(id, { stage, lostReason }),
    onSuccess: async (opportunity) => {
      toast.success(`Movida para ${stageName(stages, opportunity.stage)}`);
      setPendingLost(null);
      await queryClient.invalidateQueries({ queryKey: ['opportunity-board'] });
      await queryClient.invalidateQueries({ queryKey: queryKeys.opportunities() });
      await queryClient.invalidateQueries({ queryKey: queryKeys.opportunity(opportunity.id) });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.opportunityTimeline(opportunity.id),
      });
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível mudar a etapa.')),
  });

  const request = (opportunity: OpportunityDto, to: OpportunityStage) => {
    if (to === opportunity.stage) return;
    if (to === OpportunityStage.WON) {
      toast.error('O ganho é registrado quando o contrato é assinado.');
      return;
    }
    if (!canTransition(opportunity.stage, to)) {
      const options = allowedStages(opportunity.stage)
        .map((s) => stageName(stages, s))
        .join(', ');
      toast.error(
        `De ${stageName(stages, opportunity.stage)} só dá para ir para: ${options || 'nenhuma etapa'}.`,
      );
      return;
    }
    if (to === OpportunityStage.LOST) {
      setPendingLost(opportunity);
      return;
    }
    mutation.mutate({ id: opportunity.id, stage: to });
  };

  return {
    request,
    isPending: mutation.isPending,
    pendingLost,
    cancelLost: () => setPendingLost(null),
    confirmLost: (reason: string) =>
      pendingLost &&
      mutation.mutate({ id: pendingLost.id, stage: OpportunityStage.LOST, lostReason: reason }),
  };
}
