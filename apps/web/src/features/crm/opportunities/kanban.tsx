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
import { AlertTriangle, Clock, GripVertical, Snowflake } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import {
  OpportunityStage,
  canTransition,
  type OpportunityBoardColumnDto,
  type OpportunityDto,
  type PipelineStageDto,
} from '@voltex/shared';
import { NativeSelect, cn } from '@voltex/ui';
import { PROJECT_TYPE_LABELS } from '@/i18n/labels';
import { formatCents, formatDate } from '@/lib/format';
import { LostDialog } from './lost-dialog';
import { allowedStages, stageName, useStageChange } from './stage-change';

/** Parado: sem mudar de etapa há tanto tempo (regra simples e visível, não um palpite). */
export const STALE_AFTER_DAYS = 14;

function indicators(o: OpportunityDto, now = Date.now()) {
  if (o.status !== 'OPEN') return [];
  const list: { key: string; label: string; icon: typeof Clock; tone: string }[] = [];
  if (o.openTaskCount === 0)
    list.push({
      key: 'no-task',
      label: 'Sem próxima tarefa',
      icon: AlertTriangle,
      tone: 'text-amber-600 dark:text-amber-400',
    });
  else if (o.nextTaskDueAt && new Date(o.nextTaskDueAt).getTime() < now)
    list.push({
      key: 'late',
      label: `Tarefa atrasada (${formatDate(o.nextTaskDueAt)})`,
      icon: Clock,
      tone: 'text-destructive',
    });
  const days = Math.floor((now - new Date(o.stageChangedAt).getTime()) / 86_400_000);
  if (days >= STALE_AFTER_DAYS)
    list.push({
      key: 'stale',
      label: `Parada há ${days} dias nesta etapa`,
      icon: Snowflake,
      tone: 'text-sky-600 dark:text-sky-400',
    });
  return list;
}

function CardBody({ opportunity }: { opportunity: OpportunityDto }) {
  const flags = indicators(opportunity);
  return (
    <div className="min-w-0 flex-1 space-y-1">
      <div className="flex items-start justify-between gap-2">
        <Link
          to={`/crm/oportunidades/${opportunity.id}`}
          className="min-w-0 truncate text-sm font-semibold hover:underline"
        >
          {opportunity.accountName}
        </Link>
        <span className="shrink-0 text-sm font-semibold tabular-nums">
          {opportunity.valueCents != null && Number.isFinite(opportunity.valueCents)
            ? formatCents(opportunity.valueCents)
            : '—'}
        </span>
      </div>
      <div className="truncate text-xs text-muted-foreground">{opportunity.title}</div>
      <div className="flex flex-wrap items-center justify-between gap-1.5 text-[11px] text-muted-foreground">
        <span className="truncate">
          <span className="font-mono">{opportunity.projectCode}</span> ·{' '}
          {PROJECT_TYPE_LABELS[opportunity.projectType]}
          {opportunity.ownerName ? ` · ${opportunity.ownerName}` : ''}
        </span>
        {flags.length > 0 ? (
          <span className="flex items-center gap-1">
            {flags.map((f) => (
              <span key={f.key} title={f.label} className={f.tone}>
                <f.icon className="size-3.5" aria-hidden />
                <span className="sr-only">{f.label}</span>
              </span>
            ))}
          </span>
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
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({
    id: opportunity.id,
    data: { opportunity },
    disabled: opportunity.status === 'WON',
  });
  const targets = allowedStages(opportunity.stage);

  return (
    <li
      ref={setNodeRef}
      {...(opportunity.status === 'WON' ? {} : listeners)}
      className={cn(
        'group rounded-lg border bg-card p-3 shadow-xs',
        opportunity.status !== 'WON' && 'cursor-grab touch-pan-y active:cursor-grabbing',
        isDragging && 'opacity-40',
      )}
    >
      <div className="flex items-start gap-2">
        {opportunity.status === 'WON' ? null : (
          <button
            type="button"
            aria-label={`Arrastar ${opportunity.title}`}
            ref={setActivatorNodeRef}
            className="-ml-1 mt-0.5 rounded p-0.5 text-muted-foreground/60 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
            {...attributes}
          >
            <GripVertical className="size-4" aria-hidden />
          </button>
        )}
        <CardBody opportunity={opportunity} />
      </div>
      {targets.length > 0 && opportunity.status === 'OPEN' ? (
        <div className="mt-2 hidden group-focus-within:block group-hover:block [@media(hover:none)]:block">
          <NativeSelect
            aria-label={`Mover ${opportunity.title} para`}
            className="h-8 text-xs"
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
        </div>
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
        'flex w-60 shrink-0 flex-col rounded-xl border bg-muted/40 transition-colors',
        valid === true && 'border-brand-cyan-strong/60',
        valid === false && 'opacity-50',
        isOver && valid && 'bg-accent',
      )}
    >
      <header className="space-y-0.5 px-3 py-2.5">
        <h3 className="truncate text-sm font-semibold">{column.stage.name}</h3>
        <p className="text-xs text-muted-foreground">
          {column.total === 1 ? '1 oportunidade' : `${column.total} oportunidades`}
          {' · '}
          <span className="font-medium text-foreground">
            {formatCents(column.totalValueCents ?? 0)}
          </span>
        </p>
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

/** Quadro Kanban: arraste o cartão, ou use o ícone de alça (teclado) e "Mover para…" (celular). */
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
          <div className="flex min-h-[calc(100dvh-15rem)] items-stretch gap-3">
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
            <div className="w-60 rounded-lg border bg-card p-3 shadow-lg">
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
