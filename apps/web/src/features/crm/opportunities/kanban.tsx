import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { GripVertical } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import {
  OpportunityStage,
  canTransition,
  type OpportunityBoardColumnDto,
  type OpportunityDto,
  type PipelineStageDto,
} from '@voltex/shared';
import { Badge, NativeSelect, cn } from '@voltex/ui';
import { PROJECT_TYPE_LABELS } from '@/i18n/labels';
import { formatDate, formatRelativeTime } from '@/lib/format';
import { LostDialog } from './lost-dialog';
import { allowedStages, stageName, useStageChange } from './stage-change';

function CardBody({ opportunity }: { opportunity: OpportunityDto }) {
  return (
    <div className="min-w-0 space-y-1">
      <Link
        to={`/crm/oportunidades/${opportunity.id}`}
        className="block truncate text-sm font-medium hover:underline"
      >
        {opportunity.title}
      </Link>
      <div className="truncate text-xs text-muted-foreground">{opportunity.accountName}</div>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className="font-mono">{opportunity.projectCode}</span>
        <span>· {PROJECT_TYPE_LABELS[opportunity.projectType]}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {opportunity.status === 'OPEN' ? (
          opportunity.openTaskCount === 0 ? (
            <Badge variant="yellow">Sem próxima tarefa</Badge>
          ) : (
            <span
              className="text-[11px] text-muted-foreground"
              title={formatDate(opportunity.nextTaskDueAt as string)}
            >
              Próxima tarefa {formatRelativeTime(opportunity.nextTaskDueAt as string)}
            </span>
          )
        ) : null}
        {opportunity.ownerName ? (
          <span className="text-[11px] text-muted-foreground">· {opportunity.ownerName}</span>
        ) : null}
      </div>
    </div>
  );
}

function OpportunityCard({
  opportunity,
  stages,
  onMove,
}: {
  opportunity: OpportunityDto;
  stages: PipelineStageDto[];
  onMove: (to: OpportunityStage) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: opportunity.id,
    data: { opportunity },
    disabled: opportunity.status === 'WON',
  });
  const targets = allowedStages(opportunity.stage);

  return (
    <li
      ref={setNodeRef}
      className={cn('rounded-lg border bg-card p-3 shadow-xs', isDragging && 'opacity-40')}
    >
      <div className="flex items-start gap-2">
        {opportunity.status === 'WON' ? null : (
          <button
            type="button"
            aria-label={`Arrastar ${opportunity.title}`}
            className="mt-0.5 cursor-grab touch-none rounded p-0.5 text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
            {...listeners}
            {...attributes}
          >
            <GripVertical className="size-4" aria-hidden />
          </button>
        )}
        <CardBody opportunity={opportunity} />
      </div>
      {targets.length > 0 && opportunity.status === 'OPEN' ? (
        <NativeSelect
          aria-label={`Mover ${opportunity.title} para`}
          className="mt-2 h-8 text-xs"
          value=""
          onChange={(e) => e.target.value && onMove(e.target.value as OpportunityStage)}
        >
          <option value="">Mover para…</option>
          {targets.map((s) => (
            <option key={s} value={s}>
              {stageName(stages, s)}
            </option>
          ))}
        </NativeSelect>
      ) : null}
    </li>
  );
}

function Column({
  column,
  stages,
  dragging,
  onMove,
}: {
  column: OpportunityBoardColumnDto;
  stages: PipelineStageDto[];
  dragging: OpportunityDto | null;
  onMove: (opportunity: OpportunityDto, to: OpportunityStage) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.stage.key });
  const valid = dragging
    ? column.stage.key !== OpportunityStage.WON && canTransition(dragging.stage, column.stage.key)
    : null;

  return (
    <section
      ref={setNodeRef}
      aria-label={`Etapa ${column.stage.name}`}
      className={cn(
        'flex w-72 shrink-0 flex-col rounded-xl border bg-muted/40 transition-colors',
        valid === true && 'border-brand-cyan-strong/60',
        valid === false && 'opacity-50',
        isOver && valid && 'bg-accent',
      )}
    >
      <header className="flex items-center justify-between gap-2 px-3 py-2.5">
        <h3 className="truncate text-sm font-semibold">{column.stage.name}</h3>
        <Badge variant="secondary" aria-label={`${column.total} oportunidades`}>
          {column.total}
        </Badge>
      </header>
      <ul className="flex min-h-16 flex-1 flex-col gap-2 px-2 pb-2">
        {column.items.map((o) => (
          <OpportunityCard
            key={o.id}
            opportunity={o}
            stages={stages}
            onMove={(to) => onMove(o, to)}
          />
        ))}
        {column.total > column.items.length ? (
          <li className="px-1 text-xs text-muted-foreground">
            + {column.total - column.items.length} não exibidas: use a lista com filtros.
          </li>
        ) : null}
      </ul>
    </section>
  );
}

/** Quadro Kanban: arraste pelo ícone ou use "Mover para…" (teclado e celular). */
export function KanbanBoard({
  columns,
  stages,
}: {
  columns: OpportunityBoardColumnDto[];
  stages: PipelineStageDto[];
}) {
  const [dragging, setDragging] = useState<OpportunityDto | null>(null);
  const stageChange = useStageChange(stages);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const onDragStart = (event: DragStartEvent) =>
    setDragging((event.active.data.current?.opportunity as OpportunityDto | undefined) ?? null);
  const onDragEnd = (event: DragEndEvent) => {
    const opportunity = event.active.data.current?.opportunity as OpportunityDto | undefined;
    setDragging(null);
    if (opportunity && event.over)
      stageChange.request(opportunity, event.over.id as OpportunityStage);
  };

  return (
    <>
      <DndContext
        sensors={sensors}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDragging(null)}
      >
        <div className="-mx-4 overflow-x-auto px-4 pb-3 md:-mx-6 md:px-6">
          <div className="flex gap-3">
            {columns.map((column) => (
              <Column
                key={column.stage.id}
                column={column}
                stages={stages}
                dragging={dragging}
                onMove={stageChange.request}
              />
            ))}
          </div>
        </div>
        <DragOverlay>
          {dragging ? (
            <div className="w-72 rounded-lg border bg-card p-3 shadow-lg">
              <CardBody opportunity={dragging} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
      <LostDialog
        open={stageChange.pendingLost !== null}
        title={stageChange.pendingLost?.title ?? ''}
        pending={stageChange.isPending}
        onOpenChange={(open) => !open && stageChange.cancelLost()}
        onConfirm={stageChange.confirmLost}
      />
    </>
  );
}
