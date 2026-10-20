import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DomainEvent, type DomainEventEnvelope } from '@voltex/shared';
import { RequestContext } from '../../common/context/request-context';
import { PrismaService } from '../../platform/prisma/prisma.service';

/**
 * Impacto de mudanças nos projetos (ADR-0016/0017): quando uma regra `engine.*` é ativada ou um equipamento é
 * aposentado/revisado, as versões afetadas ficam **desatualizadas** (com o motivo). Versão aprovada continua intacta:
 * só ganha a marca "há dado mais novo". Para refazer, cria-se nova versão (ou recalcula-se o rascunho).
 */
@Injectable()
export class EngineeringImpactService {
  private readonly logger = new Logger(EngineeringImpactService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
  ) {}

  private async mark(versionIds: string[], reason: string): Promise<number> {
    let count = 0;
    for (const id of versionIds) {
      const version = await this.prisma.db.engineeringVersion.findFirst({ where: { id } });
      if (!version || version.status === 'REJECTED' || version.status === 'SUPERSEDED') continue;
      const reasons = version.staleReasons as string[];
      if (version.stale && reasons.includes(reason)) continue;
      await this.prisma.db.engineeringVersion.update({
        where: { id },
        data: { stale: true, staleReasons: [...reasons, reason] },
      });
      count += 1;
    }
    return count;
  }

  /** Versões que usam a regra (pela referência) ou que ficaram pendentes de regra. */
  @OnEvent(DomainEvent.RULE_SET_ACTIVATED, { suppressErrors: false })
  async onRuleActivated(event: DomainEventEnvelope): Promise<number> {
    const key = String(event.payload.key ?? '');
    if (!key.startsWith('engine.')) return 0;
    const previousRef = event.payload.previousRef ? String(event.payload.previousRef) : null;
    return this.context.run({ tenantId: event.tenantId }, async () => {
      const versions = await this.prisma.db.engineeringVersion.findMany({
        where: { status: { in: ['DRAFT', 'SUBMITTED', 'APPROVED'] } },
        select: { id: true, ruleRefs: true, results: true },
      });
      const affected = versions
        .filter((v) => {
          const refs = v.ruleRefs as string[];
          const pending =
            (v.results as { compatibility?: { pending?: { kind: string }[] } } | null)
              ?.compatibility?.pending ?? [];
          return (
            (previousRef !== null && refs.includes(previousRef)) ||
            pending.some((p) => p.kind === 'RULE')
          );
        })
        .map((v) => v.id);
      const marked = await this.mark(
        affected,
        `A regra ${key} foi atualizada: recalcule o projeto.`,
      );
      if (marked > 0)
        this.logger.log(`${marked} versão(ões) marcadas como desatualizadas por ${key}`);
      return marked;
    });
  }

  private async onEquipment(
    event: DomainEventEnvelope,
    equipmentId: string,
    reason: string,
  ): Promise<number> {
    return this.context.run({ tenantId: event.tenantId }, async () => {
      const rows = await this.prisma.db.engineeringVersionEquipment.findMany({
        where: { equipmentId },
        select: { versionId: true },
      });
      return this.mark(
        [...new Set(rows.map((r) => r.versionId))],
        reason.replace('{label}', String(event.payload.label ?? 'equipamento')),
      );
    });
  }

  @OnEvent(DomainEvent.EQUIPMENT_RETIRED, { suppressErrors: false })
  onRetired(event: DomainEventEnvelope): Promise<number> {
    return this.onEquipment(
      event,
      String(event.payload.equipmentId),
      'O equipamento {label} foi aposentado.',
    );
  }

  @OnEvent(DomainEvent.EQUIPMENT_REVISION_APPROVED, { suppressErrors: false })
  onRevised(event: DomainEventEnvelope): Promise<number> {
    return this.onEquipment(
      event,
      String(event.payload.retiredEquipmentId),
      'O equipamento {label} ganhou uma nova revisão aprovada.',
    );
  }
}
