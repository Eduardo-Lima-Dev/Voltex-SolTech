import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type {
  CommunicationLogDto,
  CommunicationTemplateDto,
  LogCopiedLinkInput,
  SendEmailInput,
  WhatsAppLinkDto,
  WhatsAppLinkInput,
} from '@voltex/shared';
import { RequestContext } from '../../common/context/request-context';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  COMMUNICATION_TEMPLATES,
  findTemplate,
  renderTemplate,
  templateVariables,
  type CommunicationTemplate,
} from './communication-templates';
import { buildWhatsAppLink, normalizeBrazilianPhone } from './whatsapp-link';

type LogRow = Awaited<ReturnType<PrismaService['db']['communicationLog']['findFirstOrThrow']>>;

const toDto = (row: LogRow): CommunicationLogDto => ({
  id: row.id,
  channel: row.channel,
  template: row.template,
  recipient: row.recipient,
  subject: row.subject,
  entityType: row.entityType,
  entityId: row.entityId,
  accountId: row.accountId,
  sentById: row.sentById,
  createdAt: row.createdAt.toISOString(),
});

/**
 * Comunicações iniciadas por uma pessoa. E-mail sai pelo SMTP da plataforma; WhatsApp é só um link `wa.me` que o
 * usuário abre no próprio aparelho (nenhuma API, nenhuma mensagem sai do servidor); copiar link também é registrado.
 * Toda saída grava o histórico.
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  listTemplates(): CommunicationTemplateDto[] {
    return COMMUNICATION_TEMPLATES.map((t) => ({
      id: t.id,
      label: t.label,
      variables: templateVariables(t),
    }));
  }

  private templateOrThrow(id: string): CommunicationTemplate {
    const template = findTemplate(id);
    if (!template) throw new NotFoundException(`Modelo de mensagem desconhecido: ${id}`);
    return template;
  }

  private render(template: CommunicationTemplate, variables: Record<string, string>) {
    const rendered = renderTemplate(template, variables);
    if (rendered.missing.length > 0)
      throw new UnprocessableEntityException({
        code: 'MISSING_TEMPLATE_VARIABLES',
        message: `Faltam variáveis do modelo: ${rendered.missing.join(', ')}`,
      });
    return rendered;
  }

  private async record(
    data: Pick<LogRow, 'channel' | 'template'> &
      Partial<Pick<LogRow, 'recipient' | 'subject' | 'entityType' | 'entityId' | 'accountId'>>,
  ): Promise<CommunicationLogDto> {
    const row = await this.prisma.db.communicationLog.create({
      data: {
        tenantId: this.context.requireTenantId(),
        channel: data.channel,
        template: data.template,
        recipient: data.recipient ?? null,
        subject: data.subject ?? null,
        entityType: data.entityType ?? null,
        entityId: data.entityId ?? null,
        accountId: data.accountId ?? null,
        sentById: this.context.userId ?? null,
      },
    });
    await this.audit.record({
      action: 'communication.logged',
      entity: 'CommunicationLog',
      entityId: row.id,
      after: { channel: row.channel, template: row.template },
    });
    return toDto(row);
  }

  async sendEmail(input: SendEmailInput): Promise<CommunicationLogDto> {
    const template = this.templateOrThrow(input.template);
    const rendered = this.render(template, input.variables);
    // O histórico só registra o que de fato saiu: se o SMTP falhar, o erro sobe e nada é gravado.
    await this.mail.send({ to: input.to, subject: rendered.subject, text: rendered.text });
    return this.record({
      channel: 'EMAIL',
      template: template.id,
      recipient: input.to,
      subject: rendered.subject,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      accountId: input.accountId ?? null,
    });
  }

  async whatsAppLink(input: WhatsAppLinkInput): Promise<WhatsAppLinkDto> {
    const template = this.templateOrThrow(input.template);
    const rendered = this.render(template, input.variables);
    const phone = normalizeBrazilianPhone(input.phone);
    if (!phone)
      throw new UnprocessableEntityException({
        code: 'INVALID_PHONE',
        message: 'Telefone inválido. Informe o DDD e o número (Brasil).',
      });
    const log = await this.record({
      channel: 'WHATSAPP_LINK',
      template: template.id,
      recipient: phone,
      subject: rendered.subject,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      accountId: input.accountId ?? null,
    });
    return { url: buildWhatsAppLink(phone, rendered.text), text: rendered.text, log };
  }

  logCopiedLink(input: LogCopiedLinkInput): Promise<CommunicationLogDto> {
    const template = this.templateOrThrow(input.template);
    return this.record({
      channel: 'COPY_LINK',
      template: template.id,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      accountId: input.accountId ?? null,
    });
  }

  async list(query: {
    entityType?: string;
    entityId?: string;
    accountId?: string;
    limit: number;
  }): Promise<CommunicationLogDto[]> {
    const rows = await this.prisma.db.communicationLog.findMany({
      where: {
        ...(query.entityType ? { entityType: query.entityType } : {}),
        ...(query.entityId ? { entityId: query.entityId } : {}),
        ...(query.accountId ? { accountId: query.accountId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: query.limit,
    });
    return rows.map(toDto);
  }
}
