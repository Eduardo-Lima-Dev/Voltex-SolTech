import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from '@voltex/ui';
import { Button, Skeleton, Spinner, Textarea } from '@voltex/ui';
import { Can } from '@/app/guards';
import { queryKeys } from '@/features/admin/query-keys';
import { TIMELINE_TYPE_LABELS } from '@/i18n/labels';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api/errors';
import { formatDateTime } from '@/lib/format';

export function TimelineTab({ opportunityId }: { opportunityId: string }) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const timeline = useQuery({
    queryKey: queryKeys.opportunityTimeline(opportunityId),
    queryFn: () => endpoints.opportunities.timeline(opportunityId),
  });
  const add = useMutation({
    mutationFn: () => endpoints.opportunities.addNote(opportunityId, { body: note.trim() }),
    onSuccess: async () => {
      setNote('');
      toast.success('Nota adicionada');
      await queryClient.invalidateQueries({
        queryKey: queryKeys.opportunityTimeline(opportunityId),
      });
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível adicionar a nota.')),
  });

  return (
    <div className="space-y-4">
      <Can permission="crm.opportunity.write">
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (note.trim()) add.mutate();
          }}
        >
          <Textarea
            aria-label="Nova nota"
            rows={2}
            maxLength={2000}
            placeholder="Registre um contato, combinado ou observação…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <Button type="submit" size="sm" disabled={!note.trim() || add.isPending}>
            {add.isPending ? <Spinner /> : null}
            Adicionar nota
          </Button>
        </form>
      </Can>

      {timeline.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : timeline.isError ? (
        <p className="text-sm text-destructive">Não foi possível carregar a linha do tempo.</p>
      ) : (
        <ol className="relative space-y-4 border-l pl-5">
          {timeline.data.map((event) => (
            <li key={event.id} className="relative">
              <span
                aria-hidden
                className="absolute -left-[1.6rem] top-1.5 size-2.5 rounded-full border bg-background"
              />
              <div className="text-xs text-muted-foreground">
                {TIMELINE_TYPE_LABELS[event.type]} · {formatDateTime(event.createdAt)}
                {event.actorName ? ` · ${event.actorName}` : ''}
              </div>
              <p className="whitespace-pre-wrap text-sm">{event.summary}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
