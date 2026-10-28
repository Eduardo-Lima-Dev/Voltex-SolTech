import { Injectable } from '@nestjs/common';
import {
  AI_UNAVAILABLE_MESSAGES,
  type AiAdminSettingsDto,
  type AiDiagnosticsDto,
  type UpdateAiSettingsInput,
} from '@voltex/shared';
import { RequestContext } from '../../common/context/request-context';
import type { RequestUser } from '../../common/context/request-user';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { AiGateService } from './ai-gate.service';
import { AiGatewayService } from './ai-gateway.service';
import { AiUnavailableError } from './ai-errors';

@Injectable()
export class AiAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
    private readonly gate: AiGateService,
    private readonly gateway: AiGatewayService,
  ) {}

  /** Liga ou desliga a IA da empresa. Ligar registra quem aceitou os termos e quando. */
  async updateSettings(
    input: UpdateAiSettingsInput,
    user: RequestUser,
  ): Promise<AiAdminSettingsDto> {
    const tenantId = this.context.requireTenantId();
    const tenant = await this.prisma.db.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { settings: true },
    });
    const settings = (tenant.settings ?? {}) as Record<string, unknown>;
    const before = await this.gate.tenantSettings();
    const next = input.enabled
      ? {
          enabled: true,
          termsAcceptedBy: user.id,
          termsAcceptedAt: new Date().toISOString(),
        }
      : { ...before.ai, enabled: false };
    await this.prisma.db.tenant.update({
      where: { id: tenantId },
      data: { settings: { ...settings, ai: next } as object },
    });
    await this.audit.record({
      action: 'ai.settings_updated',
      entity: 'Tenant',
      entityId: tenantId,
      before: before.ai,
      after: next,
    });
    return this.gate.adminSettings();
  }

  async diagnostics(): Promise<AiDiagnosticsDto> {
    const started = Date.now();
    try {
      const result = await this.gateway.chat({
        purpose: 'DIAGNOSTICS',
        messages: [
          { role: 'system', content: 'Responda sempre em português do Brasil, em uma palavra.' },
          { role: 'user', content: 'Responda apenas: ok' },
        ],
        maxTokens: 20,
        temperature: 0,
      });
      return {
        ok: true,
        text: result.text,
        model: result.model,
        neurons: result.neurons,
        durationMs: Date.now() - started,
        code: null,
        message: null,
      };
    } catch (error) {
      if (!(error instanceof AiUnavailableError)) throw error;
      return {
        ok: false,
        text: null,
        model: null,
        neurons: null,
        durationMs: Date.now() - started,
        code: error.aiCode,
        message: AI_UNAVAILABLE_MESSAGES[error.aiCode],
      };
    }
  }
}
