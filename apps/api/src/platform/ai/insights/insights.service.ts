import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  INSIGHT_DEFAULTS,
  INSIGHT_KINDS,
  type InsightDto,
  type InsightFactDto,
  type InsightKind,
  type InsightRunResultDto,
  type UpdateInsightInput,
} from '@voltex/shared';
import { RequestContext } from '../../../common/context/request-context';
import type { RequestUser } from '../../../common/context/request-user';
import { FinanceService } from '../../../products/crm/finance/finance.service';
import { AftersalesDashboardService } from '../../../products/operations/aftersales/dashboard.service';
import { InstallationsService } from '../../../products/operations/installations.service';
import { AnalyticsService } from '../../analytics/analytics.service';
import { AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { isOwnershipRestricted } from '../../prisma/ownership-scope';
import { AiGateService } from '../ai-gate.service';
import { AiGatewayService } from '../ai-gateway.service';
import { AiUnavailableError } from '../ai-errors';
import { formatFact } from '../privacy/facts';
import { AiPrivacySession } from '../privacy/session';
import {
  breachedTickets,
  overdueInstallations,
  overdueReceivables,
  stalledOpportunities,
  warrantiesExpiring,
  type InsightCandidate,
  type InsightFactInput,
} from './insight-detectors';

const DAY = 86_400_000;

const INSIGHT_PROMPT = `Você redige avisos curtos para a equipe de um integrador de energia solar, a partir de um achado do sistema. Escreva no máximo duas frases em português do Brasil, em tom direto.
REGRAS: use só os dados recebidos; NUNCA escreva algarismos (0 a 9): para citar um número ou valor, escreva a referência que veio nos dados, como {{F2}}; não invente causa, não dê ordem, não some nem compare números.
FORMATO: apenas um JSON: {"kind":"ANSWER","text":"..."}`;

const SEVERITY_ORDER = { CRITICAL: 0, ATTENTION: 1, INFO: 2 } as const;

/**
 * Insights proativos (Fase 12G, plano §12). Detectores determinísticos leem o sistema; cada achado vira um `Insight`
 * com o texto padrão do detector, e só depois a IA (se disponível, com cota própria) redige a frase a partir dos
 * fatos, com o mesmo validador do assistente. Sem IA o insight aparece do mesmo jeito, nunca some.
 */
@Injectable()
export class InsightsService {
  private readonly logger = new Logger(InsightsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
    private readonly finance: FinanceService,
    private readonly analytics: AnalyticsService,
    private readonly installations: InstallationsService,
    private readonly aftersales: AftersalesDashboardService,
    private readonly gate: AiGateService,
    private readonly gateway: AiGatewayService,
  ) {}

  // ---- Rotina ----

  /** Roda a rotina para todas as empresas com a IA ligada. */
  async runAll(): Promise<number> {
    const tenants = await this.prisma.system.tenant.findMany({
      where: { deletedAt: null },
      select: { id: true, settings: true },
    });
    let ran = 0;
    for (const tenant of tenants) {
      const ai = (tenant.settings as { ai?: { enabled?: boolean } } | null)?.ai;
      if (ai?.enabled !== true) continue;
      try {
        await this.context.run({ tenantId: tenant.id }, () => this.runForCurrentTenant());
        ran += 1;
      } catch (error) {
        this.logger.error({ err: error, tenantId: tenant.id }, 'Falha na rotina de insights');
      }
    }
    return ran;
  }

  /** Detecta, grava e redige para a empresa do contexto. */
  async runForCurrentTenant(): Promise<InsightRunResultDto> {
    const { candidates, ran } = await this.detect();
    const result: InsightRunResultDto = {
      detected: candidates.length,
      created: 0,
      updated: 0,
      resolved: 0,
      written: 0,
    };
    const db = this.prisma.db;
    const tenantId = this.context.requireTenantId();
    const now = new Date();

    for (const c of candidates) {
      const existing = await db.insight.findFirst({ where: { dedupeKey: c.dedupeKey } });
      const data = {
        kind: c.kind,
        severity: c.severity,
        ownerId: c.ownerId,
        permission: c.permission,
        facts: c.facts as never,
        defaultText: c.defaultText,
        link: c.link,
      };
      if (!existing) {
        await db.insight.create({ data: { ...data, tenantId, dedupeKey: c.dedupeKey } });
        result.created += 1;
        continue;
      }
      const closed = existing.status === 'RESOLVED' || existing.status === 'DISMISSED';
      const quietUntil = existing.statusAt
        ? existing.statusAt.getTime() + INSIGHT_DEFAULTS.reopenAfterDays * DAY
        : 0;
      // Resolvido sozinho (condição sumiu) reabre na hora; dispensado/resolvido por pessoa só depois do prazo.
      if (closed && existing.statusById && quietUntil > now.getTime()) continue;
      const changed = JSON.stringify(existing.facts) !== JSON.stringify(c.facts);
      await db.insight.update({
        where: { id: existing.id },
        data: {
          ...data,
          ...(closed ? { status: 'NEW', statusById: null, statusAt: null } : {}),
          ...(changed || closed ? { aiText: null } : {}),
        },
      });
      result.updated += 1;
    }

    // O que sumiu da detecção (e cujo detector rodou) está resolvido.
    const keep = new Set(candidates.map((c) => c.dedupeKey));
    const active = await db.insight.findMany({
      where: { status: { in: ['NEW', 'SEEN'] }, kind: { in: [...ran] } },
      select: { id: true, dedupeKey: true },
    });
    for (const row of active) {
      if (keep.has(row.dedupeKey)) continue;
      await db.insight.update({
        where: { id: row.id },
        data: { status: 'RESOLVED', statusById: null, statusAt: now },
      });
      result.resolved += 1;
    }

    result.written = await this.writeTexts();
    return result;
  }

  private async detect(): Promise<{ candidates: InsightCandidate[]; ran: Set<InsightKind> }> {
    const candidates: InsightCandidate[] = [];
    const ran = new Set<InsightKind>();
    const step = async (kinds: InsightKind[], fn: () => Promise<InsightCandidate[]>) => {
      try {
        candidates.push(...(await fn()));
        kinds.forEach((k) => ran.add(k));
      } catch (error) {
        this.logger.warn({ err: error, kinds }, 'Detector de insight falhou');
      }
    };
    await step(['OVERDUE_RECEIVABLES'], async () => {
      const o = await this.finance.overview();
      return [
        overdueReceivables({
          minDays: INSIGHT_DEFAULTS.overdueReceivableMinDays,
          overdue: o.overdue,
        }),
      ].filter((c): c is InsightCandidate => c !== null);
    });
    await step(['STALLED_OPPORTUNITIES'], async () => {
      const s = await this.analytics.stalled(500);
      return stalledOpportunities({ stalledAfterDays: s.stalledAfterDays, rows: s.rows });
    });
    await step(['OVERDUE_INSTALLATIONS'], async () => {
      const d = await this.installations.dashboard();
      return [overdueInstallations(d)].filter((c): c is InsightCandidate => c !== null);
    });
    await step(['WARRANTIES_EXPIRING', 'BREACHED_TICKETS'], async () => {
      const d = await this.aftersales.get();
      return [
        warrantiesExpiring({ expiring: d.warrantiesExpiring }),
        breachedTickets({ breached: d.breachedTickets, open: d.openTickets }),
      ].filter((c): c is InsightCandidate => c !== null);
    });
    return { candidates, ran };
  }

  // ---- Redação pela IA ----

  /** Redige os insights ativos que ainda não têm texto da IA. Para na primeira indisponibilidade (cota, desligada). */
  private async writeTexts(): Promise<number> {
    if (await this.gate.blocker()) return 0;
    const pending = await this.prisma.db.insight.findMany({
      where: { status: { in: ['NEW', 'SEEN'] }, aiText: null },
      orderBy: { generatedAt: 'asc' },
      take: 20,
    });
    let written = 0;
    for (const row of pending) {
      try {
        const text = await this.draft(
          row.kind as InsightKind,
          row.facts as unknown as InsightFactInput[],
        );
        if (!text) continue;
        await this.prisma.db.insight.update({ where: { id: row.id }, data: { aiText: text } });
        written += 1;
      } catch (error) {
        if (error instanceof AiUnavailableError) break;
        this.logger.warn({ err: error }, 'Não foi possível redigir um insight');
      }
    }
    return written;
  }

  private async draft(kind: InsightKind, facts: InsightFactInput[]): Promise<string | null> {
    const session = new AiPrivacySession();
    const payload = Object.fromEntries(facts.map((f) => [f.key, f.value]));
    const ingested = session.ingestToolResult(`insight.${kind}`, {}, payload);
    const labels = Object.fromEntries(facts.map((f) => [f.key, f.label]));
    const result = await this.gateway.chat({
      purpose: 'INSIGHTS',
      maxTokens: 300,
      messages: [
        { role: 'system', content: INSIGHT_PROMPT },
        {
          role: 'user',
          content: `Achado: ${kind}\nSignificado de cada campo: ${JSON.stringify(labels)}\nDados: ${JSON.stringify(ingested)}`,
        },
      ],
    });
    const final = session.finalize(result.text, () => false);
    if (!final.ok || final.kind !== 'ANSWER' || final.factsUsed.length === 0) return null;
    return final.text;
  }

  // ---- Leitura e situação ----

  /** Insights que a pessoa pode ver: pela permissão e, para vendedor/SDR, só os da própria carteira. */
  private visibleWhere(user: RequestUser) {
    return {
      permission: { in: [...user.permissions] as string[] },
      ...(isOwnershipRestricted(user.role) ? { ownerId: user.id } : {}),
    };
  }

  private toDto(row: {
    id: string;
    kind: string;
    severity: InsightDto['severity'];
    facts: unknown;
    defaultText: string;
    aiText: string | null;
    link: string;
    status: InsightDto['status'];
    helpful: boolean | null;
    generatedAt: Date;
  }): InsightDto {
    const facts: InsightFactDto[] = (row.facts as InsightFactInput[]).map((f) => ({
      key: f.key,
      label: f.label,
      text: formatFact(f),
    }));
    return {
      id: row.id,
      kind: row.kind as InsightKind,
      severity: row.severity,
      text: row.aiText ?? row.defaultText,
      aiWritten: row.aiText !== null,
      facts,
      link: row.link,
      status: row.status,
      helpful: row.helpful,
      generatedAt: row.generatedAt.toISOString(),
    };
  }

  async list(user: RequestUser): Promise<InsightDto[]> {
    const rows = await this.prisma.db.insight.findMany({
      where: {
        status: { in: ['NEW', 'SEEN'] },
        kind: { in: [...INSIGHT_KINDS] },
        ...this.visibleWhere(user),
      },
      orderBy: { generatedAt: 'desc' },
    });
    return rows
      .map((r) => this.toDto(r))
      .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  }

  async update(user: RequestUser, id: string, input: UpdateInsightInput): Promise<InsightDto> {
    const found = await this.prisma.db.insight.findFirst({
      where: { id, ...this.visibleWhere(user) },
    });
    if (!found) throw new NotFoundException('Insight não encontrado');
    const row = await this.prisma.db.insight.update({
      where: { id },
      data: {
        status: input.status,
        statusById: user.id,
        statusAt: new Date(),
        ...(input.helpful !== undefined ? { helpful: input.helpful } : {}),
      },
    });
    await this.audit.record({
      action: 'ai.insight_status',
      entity: 'Insight',
      entityId: id,
      after: { status: input.status, helpful: input.helpful ?? null },
    });
    return this.toDto(row);
  }
}
