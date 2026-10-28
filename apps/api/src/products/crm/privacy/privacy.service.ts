import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  DomainEvent,
  PrivacyRequestStatus,
  PrivacySubjectType,
  RETENTION_DEFAULTS,
  RETENTION_FLOORS,
  RETENTION_SOURCES,
  retentionPolicySchema,
  type CreateErasureInput,
  type PrivacyRequestDto,
  type RetentionPolicyDto,
  type RetentionPolicyInput,
} from '@voltex/shared';
import type { Prisma } from '@voltex/database';
import { RequestContext } from '../../../common/context/request-context';
import { toPaginated, toSkipTake } from '../../../common/pagination';
import { AuditService } from '../../../platform/audit/audit.service';
import { S3Service } from '../../../platform/documents/s3.service';
import { EventBus } from '../../../platform/events/event-bus.service';
import { PrismaService } from '../../../platform/prisma/prisma.service';

const REMOVED = 'Titular removido';
const DAY = 86_400_000;
const MONTH = 30.44 * DAY;
const addMonths = (date: Date, months: number) => new Date(date.getTime() + months * MONTH);

type Tx = Parameters<Parameters<PrismaService['db']['$transaction']>[0]>[0];
type Outcome =
  | { status: 'COMPLETED'; summary: Record<string, number>; documentKeys: string[] }
  | { status: 'BLOCKED'; reason: string; retainedUntil: Date | null };

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Troca, sem diferenciar maiúsculas, cada trecho identificador (nome, e-mail, telefone, documento) pelo aviso. */
export function scrubText(text: string, tokens: readonly string[]): string {
  let out = text;
  for (const token of tokens)
    if (token.length >= 3) out = out.replace(new RegExp(escape(token), 'gi'), REMOVED);
  return out;
}

/** Mesma troca dentro de um JSON (preserva a estrutura; se algo der errado, devolve o original). */
export function scrubJson<T>(value: T, tokens: readonly string[]): T {
  try {
    return JSON.parse(scrubText(JSON.stringify(value), tokens)) as T;
  } catch {
    return value;
  }
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((p) => `${p[0]?.toUpperCase()}.`)
    .join(' ') || '—';

/**
 * Privacidade (LGPD): eliminação (anonimização) de dados pessoais a pedido do titular ou por política de retenção.
 *
 * O registro de negócio fica (estatísticas, ids, valores, datas), mas **ninguém passa a ser identificável**: nome,
 * contatos, documento, endereço, textos e arquivos. O que a lei manda guardar bloqueia o pedido até o fim do prazo
 * (contratos assinados: 5 anos, piso do sistema). Cada pedido gera um registro imutável sem dado pessoal.
 */
@Injectable()
export class PrivacyService {
  private readonly logger = new Logger(PrivacyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly s3: S3Service,
  ) {}

  // ---- Política de retenção ----

  async getPolicy(): Promise<RetentionPolicyDto> {
    const tenant = await this.prisma.system.tenant.findUniqueOrThrow({
      where: { id: this.context.requireTenantId() },
      select: { settings: true },
    });
    return {
      policy: this.policyFrom(tenant.settings),
      floors: { signedContractsMonths: RETENTION_FLOORS.signedContractsMonths },
      sources: {
        signedContractsMonths: RETENTION_SOURCES.signedContractsMonths,
        fieldPhotosMonths: RETENTION_SOURCES.fieldPhotosMonths,
        geolocationMonths: RETENTION_SOURCES.geolocationMonths,
        aiConversationsMonths: RETENTION_SOURCES.aiConversationsMonths,
        accessLogs: RETENTION_SOURCES.accessLogs,
      },
    };
  }

  async updatePolicy(input: RetentionPolicyInput): Promise<RetentionPolicyDto> {
    const tenantId = this.context.requireTenantId();
    const tenant = await this.prisma.system.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { settings: true },
    });
    const settings = (tenant.settings ?? {}) as Record<string, unknown>;
    const before = this.policyFrom(settings);
    await this.prisma.system.tenant.update({
      where: { id: tenantId },
      data: { settings: { ...settings, retention: input } as object },
    });
    await this.audit.record({
      action: 'privacy.retention_updated',
      entity: 'Tenant',
      entityId: tenantId,
      before,
      after: input,
    });
    return this.getPolicy();
  }

  private policyFrom(settings: unknown): RetentionPolicyInput {
    const raw = (settings as { retention?: unknown } | null)?.retention;
    const parsed = retentionPolicySchema.safeParse({
      ...RETENTION_DEFAULTS,
      ...(raw as object | undefined),
    });
    return parsed.success ? parsed.data : { ...RETENTION_DEFAULTS };
  }

  // ---- Pedidos ----

  async list(query: { page: number; pageSize: number }) {
    const [rows, total] = await Promise.all([
      this.prisma.db.privacyRequest.findMany({
        orderBy: { createdAt: 'desc' },
        ...toSkipTake(query),
      }),
      this.prisma.db.privacyRequest.count(),
    ]);
    const ids = [...new Set(rows.map((r) => r.requestedById).filter((id): id is string => !!id))];
    const users = ids.length
      ? await this.prisma.db.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true },
        })
      : [];
    const names = new Map(users.map((u) => [u.id, u.name]));
    return toPaginated(
      rows.map((r): PrivacyRequestDto => ({
        id: r.id,
        subjectType: r.subjectType,
        subjectLabel: r.subjectLabel,
        status: r.status,
        reason: r.reason,
        blockedReason: r.blockedReason,
        retainedUntil: r.retainedUntil?.toISOString() ?? null,
        summary: r.summary as Record<string, number>,
        requestedById: r.requestedById,
        requestedByName: r.requestedById ? (names.get(r.requestedById) ?? null) : null,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
      query,
    );
  }

  /** Atende um pedido do titular (feito por um usuário). Bloqueado por lei ou negócio aberto: 409 com o motivo. */
  async requestErasure(input: CreateErasureInput): Promise<PrivacyRequestDto> {
    const outcome = await this.erase(
      input.subjectType,
      input.subjectId,
      input.reason,
      this.context.userId ?? null,
    );
    if (outcome.status === 'BLOCKED')
      throw new ConflictException({
        message: outcome.reason,
        code: 'ERASURE_BLOCKED',
        data: {
          retainedUntil: outcome.retainedUntil?.toISOString() ?? null,
          requestId: outcome.requestId,
        },
      });
    const page = await this.list({ page: 1, pageSize: 1 });
    return page.data[0] as PrivacyRequestDto;
  }

  // ---- Núcleo ----

  /** Faz (ou recusa) a eliminação e grava o registro do pedido. Quem chama já está no contexto da empresa. */
  async erase(
    subjectType: PrivacySubjectType,
    subjectId: string,
    reason: string,
    requestedById: string | null,
  ): Promise<Outcome & { requestId: string }> {
    const tenantId = this.context.requireTenantId();
    const policy = (await this.getPolicy()).policy;
    const label = await this.labelOf(subjectType, subjectId);
    let outcome: Outcome;
    let requestId = '';

    await this.prisma.db.$transaction(async (tx) => {
      // Libera a anonimização dos registros imutáveis só dentro desta transação.
      await tx.$executeRaw`SELECT set_config('voltex.privacy_erasure', 'on', true)`;
      await tx.$executeRaw`SELECT set_config('voltex.reencrypt', 'on', true)`;
      outcome =
        subjectType === PrivacySubjectType.LEAD
          ? await this.eraseLead(tx, subjectId, policy)
          : await this.eraseAccount(tx, subjectId, policy);

      const request = await tx.privacyRequest.create({
        data: {
          tenantId,
          subjectType,
          subjectId,
          subjectLabel: label,
          status:
            outcome.status === 'COMPLETED'
              ? PrivacyRequestStatus.COMPLETED
              : PrivacyRequestStatus.BLOCKED,
          reason,
          blockedReason: outcome.status === 'BLOCKED' ? outcome.reason : null,
          retainedUntil: outcome.status === 'BLOCKED' ? outcome.retainedUntil : null,
          summary: (outcome.status === 'COMPLETED' ? outcome.summary : {}) as object,
          requestedById,
        },
      });
      requestId = request.id;
      await this.audit.record(
        {
          action:
            outcome.status === 'COMPLETED'
              ? 'privacy.erasure_completed'
              : 'privacy.erasure_blocked',
          entity: 'PrivacyRequest',
          entityId: request.id,
          actorId: requestedById,
          after: { subjectType, subjectLabel: label, status: outcome.status },
        },
        tx,
      );
      if (outcome.status === 'COMPLETED')
        await this.events.publish(
          {
            type: DomainEvent.PRIVACY_ERASURE_COMPLETED,
            actorId: requestedById,
            payload: { requestId: request.id, subjectType },
          },
          tx,
        );
    });

    // Os arquivos saem do armazenamento só depois que o banco confirmou.
    if (outcome!.status === 'COMPLETED')
      for (const key of outcome!.documentKeys)
        await this.s3
          .remove(key)
          .catch((error: unknown) =>
            this.logger.error({ err: error, key }, 'Não foi possível apagar o arquivo'),
          );
    return { ...outcome!, requestId };
  }

  private async labelOf(type: PrivacySubjectType, id: string): Promise<string> {
    const row =
      type === PrivacySubjectType.LEAD
        ? await this.prisma.db.lead.findFirst({ where: { id }, select: { name: true } })
        : await this.prisma.db.account.findFirst({ where: { id }, select: { name: true } });
    if (!row) throw new NotFoundException('Titular não encontrado');
    return initials(row.name);
  }

  private async eraseLead(tx: Tx, id: string, policy: RetentionPolicyInput): Promise<Outcome> {
    void policy;
    const lead = await tx.lead.findFirst({ where: { id } });
    if (!lead) throw new NotFoundException('Lead não encontrado');
    if (lead.anonymizedAt) throw new ConflictException('Os dados deste lead já foram eliminados.');
    if (lead.status === 'CONVERTED')
      return {
        status: 'BLOCKED',
        reason: 'Este lead virou cliente: peça a eliminação da conta (ela cobre o lead de origem).',
        retainedUntil: null,
      };
    await tx.lead.update({
      where: { id },
      data: {
        name: REMOVED,
        email: null,
        phone: null,
        document: null,
        emailNormalized: null,
        phoneNormalized: null,
        documentNormalized: null,
        notes: null,
        utm: undefined,
        disqualifiedReason: null,
        anonymizedAt: new Date(),
      },
    });
    const conversations = await this.eraseAiConversationsCiting(tx, [id]);
    return {
      status: 'COMPLETED',
      summary: { leads: 1, ...(conversations ? { conversasDaIa: conversations } : {}) },
      documentKeys: [],
    };
  }

  private async eraseAccount(tx: Tx, id: string, policy: RetentionPolicyInput): Promise<Outcome> {
    const account = await tx.account.findFirst({ where: { id } });
    if (!account) throw new NotFoundException('Conta não encontrada');
    if (account.anonymizedAt)
      throw new ConflictException('Os dados desta conta já foram eliminados.');

    const opportunities = await tx.opportunity.findMany({
      where: { accountId: id },
      select: { id: true, status: true },
    });
    if (opportunities.some((o) => o.status === 'OPEN'))
      return {
        status: 'BLOCKED',
        reason:
          'Há oportunidades em aberto para esta conta: encerre-as (perdida) antes de eliminar os dados.',
        retainedUntil: null,
      };
    const oppIds = opportunities.map((o) => o.id);
    const contracts = await tx.contract.findMany({
      where: { opportunityId: { in: oppIds }, status: 'SIGNED' },
    });
    const now = new Date();
    const holds = contracts
      .map((c) => addMonths(c.signedAt ?? c.createdAt, policy.signedContractsMonths))
      .filter((until) => until.getTime() > now.getTime());
    if (holds.length > 0) {
      const retainedUntil = new Date(Math.max(...holds.map((d) => d.getTime())));
      return {
        status: 'BLOCKED',
        reason: `A lei exige guardar o contrato assinado até ${retainedUntil.toLocaleDateString('pt-BR')} (${policy.signedContractsMonths} meses). Os dados poderão ser eliminados depois dessa data.`,
        retainedUntil,
      };
    }

    const [contacts, sites, units] = await Promise.all([
      tx.contact.findMany({ where: { accountId: id } }),
      tx.site.findMany({ where: { accountId: id } }),
      tx.consumerUnit.findMany({ where: { accountId: id } }),
    ]);
    // Tudo o que identifica a pessoa: serve para varrer textos e JSON onde o nome tenha ido parar.
    const tokens = [
      account.name,
      account.email,
      account.phone,
      account.phone?.replace(/\D/g, ''),
      account.document,
      account.document?.replace(/\D/g, ''),
      ...contacts.flatMap((c) => [c.name, c.email, c.phone, c.phone?.replace(/\D/g, '')]),
      ...sites.flatMap((s) => [
        s.street ? `${s.street}${s.number ? `, ${s.number}` : ''}` : null,
        s.zip,
      ]),
      ...units.map((u) => u.number),
    ].filter((t): t is string => !!t && t.length >= 3);

    const summary: Record<string, number> = {
      contas: 1,
      contatos: contacts.length,
      imoveis: sites.length,
      unidades: units.length,
    };
    await tx.account.update({
      where: { id },
      data: {
        name: REMOVED,
        email: null,
        phone: null,
        document: null,
        documentNormalized: null,
        notes: null,
        anonymizedAt: now,
      },
    });
    await tx.contact.updateMany({
      where: { accountId: id },
      data: { name: 'Contato removido', email: null, phone: null, roleTitle: null },
    });
    await tx.site.updateMany({
      where: { accountId: id },
      data: {
        name: 'Imóvel',
        street: null,
        number: null,
        district: null,
        zip: null,
        latitude: null,
        longitude: null,
      },
    });
    for (const unit of units)
      await tx.consumerUnit.update({
        where: { id: unit.id },
        data: { number: `removida-${unit.id.slice(0, 8)}` },
      });

    // Lead de origem das oportunidades desta conta.
    const leadIds = (
      await tx.opportunity.findMany({
        where: { accountId: id, leadId: { not: null } },
        select: { leadId: true },
      })
    ).map((o) => o.leadId as string);
    const convertedLeads = await tx.lead.findMany({
      where: { OR: [{ id: { in: leadIds } }, { convertedAccountId: id }], anonymizedAt: null },
    });
    for (const lead of convertedLeads) {
      tokens.push(
        ...[lead.name, lead.email, lead.phone, lead.phone?.replace(/\D/g, '')].filter(
          (t): t is string => !!t && t.length >= 3,
        ),
      );
      await tx.lead.update({
        where: { id: lead.id },
        data: {
          name: REMOVED,
          email: null,
          phone: null,
          document: null,
          emailNormalized: null,
          phoneNormalized: null,
          documentNormalized: null,
          notes: null,
          disqualifiedReason: null,
          anonymizedAt: now,
        },
      });
    }
    summary.leads = convertedLeads.length;

    // Oportunidades e tudo que carrega o nome em texto livre.
    const opps = await tx.opportunity.findMany({ where: { accountId: id } });
    for (const opp of opps)
      await tx.opportunity.update({
        where: { id: opp.id },
        data: { title: scrubText(opp.title, tokens) },
      });
    const timeline = await tx.timelineEvent.findMany({ where: { opportunityId: { in: oppIds } } });
    let touched = 0;
    for (const event of timeline) {
      const text = scrubText(event.summary, tokens);
      const data = scrubJson(event.data, tokens);
      const isNote = event.type === 'NOTE';
      if (!isNote && text === event.summary && JSON.stringify(data) === JSON.stringify(event.data))
        continue;
      await tx.timelineEvent.update({
        where: { id: event.id },
        data: {
          summary: isNote ? 'Nota removida (LGPD)' : text,
          data: isNote ? {} : (data as object),
        },
      });
      touched += 1;
    }
    summary.registrosDaLinhaDoTempo = touched;
    await tx.task.updateMany({
      where: { opportunityId: { in: oppIds } },
      data: { description: null },
    });

    const proposals = await tx.proposal.findMany({
      where: { opportunityId: { in: oppIds } },
      include: { snapshot: true },
    });
    for (const p of proposals) {
      await tx.proposal.update({
        where: { id: p.id },
        data: {
          acceptedByName: p.acceptedByName ? REMOVED : null,
          acceptedByDocument: null,
          acceptedIp: null,
          acceptedUserAgent: null,
          conditions: scrubJson(p.conditions, tokens) as object,
        },
      });
      if (p.snapshot)
        await tx.proposalSnapshot.update({
          where: { id: p.snapshot.id },
          data: { content: scrubJson(p.snapshot.content, tokens) as object },
        });
    }
    summary.propostas = proposals.length;

    for (const c of contracts) {
      await tx.contract.update({
        where: { id: c.id },
        data: {
          body: 'Contrato anonimizado (LGPD): os dados pessoais foram removidos depois do prazo legal de guarda.',
          variables: {},
          signedByName: null,
        },
      });
    }
    summary.contratos = contracts.length;

    const sessions = await tx.calculationSession.findMany({
      where: { opportunityId: { in: oppIds } },
    });
    for (const s of sessions)
      await tx.calculationSession.update({
        where: { id: s.id },
        data: {
          title: s.title ? scrubText(s.title, tokens) : null,
          customerName: s.customerName ? REMOVED : null,
        },
      });
    const snapshots = await tx.quickCalculationSnapshot.findMany({
      where: { sessionId: { in: sessions.map((s) => s.id) } },
    });
    for (const s of snapshots)
      await tx.quickCalculationSnapshot.update({
        where: { id: s.id },
        data: {
          customerName: s.customerName ? REMOVED : null,
          note: s.note ? scrubText(s.note, tokens) : null,
        },
      });

    // Faturas: campos lidos e arquivos.
    const bills = await tx.energyBill.findMany({
      where: {
        OR: [{ opportunityId: { in: oppIds } }, { consumerUnitId: { in: units.map((u) => u.id) } }],
      },
    });
    for (const b of bills) {
      await tx.energyBill.update({
        where: { id: b.id },
        data: { extracted: {}, filename: 'fatura-removida', deletedAt: now },
      });
      const snaps = await tx.energyBillSnapshot.findMany({ where: { billId: b.id } });
      for (const s of snaps)
        await tx.energyBillSnapshot.update({
          where: { id: s.id },
          data: { fields: scrubJson(s.fields, tokens) as object },
        });
    }
    summary.faturas = bills.length;

    // Fase 11: portal, campo, instalação, comissionamento, pós-venda, financeiro e assinatura eletrônica.
    const execution = await this.eraseExecutionData(tx, id, tokens, now);
    Object.assign(summary, execution.summary);

    // Arquivos: faturas, contratos e PDFs de proposta (e os da execução, listados acima).
    const documents = await tx.document.findMany({
      where: {
        deletedAt: null,
        OR: [
          { id: { in: execution.documentIds } },
          { id: { in: bills.map((b) => b.documentId) } },
          { entityType: 'Contract', entityId: { in: contracts.map((c) => c.id) } },
          { entityType: 'Proposal', entityId: { in: proposals.map((p) => p.id) } },
          {
            entityType: 'Contract',
            entityId: {
              in: (
                await tx.contract.findMany({
                  where: { opportunityId: { in: oppIds } },
                  select: { id: true },
                })
              ).map((c) => c.id),
            },
          },
        ],
      },
    });
    await tx.document.updateMany({
      where: { id: { in: documents.map((d) => d.id) } },
      data: { deletedAt: now },
    });
    summary.arquivos = documents.length;

    // Conversas do assistente que citam a conta ou os contatos de origem.
    const citedIds = [id, ...convertedLeads.map((l) => l.id)];
    const conversations = await this.eraseAiConversationsCiting(tx, citedIds);
    if (conversations > 0) summary.conversasDaIa = conversations;

    return { status: 'COMPLETED', summary, documentKeys: documents.map((d) => d.storageKey) };
  }

  /**
   * Dados da execução (Fase 11) de uma conta: portal, campo (fotos, assinaturas e geolocalização), instalação,
   * comissionamento, pós-venda, financeiro e assinatura eletrônica. Devolve os arquivos a retirar do armazenamento.
   */
  private async eraseExecutionData(
    tx: Tx,
    accountId: string,
    tokens: readonly string[],
    now: Date,
  ): Promise<{ summary: Record<string, number>; documentIds: string[] }> {
    const summary: Record<string, number> = {};
    const docs = new Set<string>();
    const scrub = (text: string | null) => (text ? scrubText(text, tokens) : text);

    const [projects, installations, plants] = await Promise.all([
      tx.project.findMany({ where: { accountId }, select: { id: true, contractId: true } }),
      tx.installation.findMany({ where: { accountId } }),
      tx.plant.findMany({ where: { accountId } }),
    ]);
    const installationIds = installations.map((i) => i.id);
    const projectIds = projects.map((p) => p.id);
    const plantIds = plants.map((p) => p.id);

    // Portal: acessos (com links e sessões em cascata) e arquivos que o cliente enviou.
    const uploads = await tx.portalUpload.findMany({ where: { accountId } });
    uploads.forEach((u) => docs.add(u.documentId));
    await tx.portalUpload.deleteMany({ where: { accountId } });
    summary.acessosAoPortal = (await tx.portalAccess.deleteMany({ where: { accountId } })).count;
    summary.arquivosEnviadosPeloCliente = uploads.length;
    await tx.portalMagicLink.deleteMany({ where: { accountId } });
    await tx.portalSession.deleteMany({ where: { accountId } });

    // Instalação: quem aceitou, de onde e a assinatura.
    for (const inst of installations) {
      if (inst.acceptanceSignatureDocumentId) docs.add(inst.acceptanceSignatureDocumentId);
      await tx.installation.update({
        where: { id: inst.id },
        data: {
          acceptedByName: inst.acceptedByName ? REMOVED : null,
          acceptanceNote: null,
          acceptanceIp: null,
          acceptanceUserAgent: null,
          acceptanceSignatureDocumentId: null,
          cancelReason: scrub(inst.cancelReason),
        },
      });
    }
    summary.instalacoes = installations.length;

    // Ordens de serviço: geolocalização, fotos, assinatura do cliente e textos livres.
    const orders = await tx.workOrder.findMany({
      where: {
        OR: [
          { accountId },
          { installationId: { in: installationIds } },
          { plantId: { in: plantIds } },
        ],
      },
      include: { photos: true },
    });
    let photos = 0;
    for (const order of orders) {
      if (order.signatureDocumentId) docs.add(order.signatureDocumentId);
      await tx.workOrder.update({
        where: { id: order.id },
        data: {
          geo: [],
          notes: scrub(order.notes),
          cancelReason: scrub(order.cancelReason),
          signatureDocumentId: null,
          signedByName: order.signedByName ? REMOVED : null,
          checklist: scrubJson(order.checklist, tokens) as object,
        },
      });
      for (const photo of order.photos) {
        docs.add(photo.documentId);
        photos += 1;
      }
    }
    await tx.workOrderPhoto.updateMany({
      where: { workOrderId: { in: orders.map((o) => o.id) } },
      data: { latitude: null, longitude: null, accuracy: null, visibleToCustomer: false },
    });
    for (const photo of orders.flatMap((o) => o.photos))
      await tx.workOrderPhoto.update({
        where: { id: photo.id },
        data: { caption: scrub(photo.caption) },
      });
    summary.ordensDeServico = orders.length;
    summary.fotosDeCampo = photos;

    // Pendências de campo e comissionamento (relatório e fotos dos ensaios).
    const issues = await tx.fieldIssue.findMany({
      where: { installationId: { in: installationIds } },
    });
    for (const issue of issues)
      await tx.fieldIssue.update({
        where: { id: issue.id },
        data: {
          description: scrubText(issue.description, tokens),
          resolution: scrub(issue.resolution),
        },
      });
    const records = await tx.commissioningRecord.findMany({
      where: { installationId: { in: installationIds } },
    });
    for (const record of records) {
      if (record.reportDocumentId) docs.add(record.reportDocumentId);
      await tx.commissioningRecord.update({
        where: { id: record.id },
        data: { reportDocumentId: null, decisionNote: scrub(record.decisionNote) },
      });
    }
    summary.comissionamentos = records.length;

    // Pós-venda: usina, chamados (inclusive as mensagens do cliente) e histórico.
    for (const plant of plants)
      await tx.plant.update({
        where: { id: plant.id },
        data: { name: scrubText(plant.name, tokens), notes: scrub(plant.notes) },
      });
    const events = await tx.plantEvent.findMany({ where: { plantId: { in: plantIds } } });
    for (const event of events)
      await tx.plantEvent.update({
        where: { id: event.id },
        data: {
          text: scrubText(event.text, tokens),
          data: scrubJson(event.data, tokens) as object,
        },
      });
    const tickets = await tx.ticket.findMany({ where: { plantId: { in: plantIds } } });
    for (const ticket of tickets)
      await tx.ticket.update({
        where: { id: ticket.id },
        data: {
          title: scrubText(ticket.title, tokens),
          description: scrub(ticket.description),
          resolution: scrub(ticket.resolution),
        },
      });
    const comments = await tx.ticketComment.findMany({
      where: { ticketId: { in: tickets.map((t) => t.id) } },
    });
    for (const c of comments)
      await tx.ticketComment.update({
        where: { id: c.id },
        data: c.authorId
          ? { body: scrubText(c.body, tokens) }
          : { body: 'Mensagem removida (LGPD)', authorName: REMOVED },
      });
    summary.chamados = tickets.length;

    // Financeiro: observações, comprovantes e propostas de crédito.
    const receivables = await tx.receivable.findMany({ where: { projectId: { in: projectIds } } });
    for (const r of receivables) {
      if (r.receiptDocumentId) docs.add(r.receiptDocumentId);
      await tx.receivable.update({
        where: { id: r.id },
        data: { notes: scrub(r.notes), receiptDocumentId: null },
      });
    }
    const credits = await tx.creditApplication.findMany({
      where: { projectId: { in: projectIds } },
    });
    for (const c of credits) {
      if (c.documentId) docs.add(c.documentId);
      await tx.creditApplication.update({
        where: { id: c.id },
        data: {
          notes: scrub(c.notes),
          pendencies: scrubJson(c.pendencies, tokens) as object,
          documentId: null,
        },
      });
    }
    const costs = await tx.projectCostEntry.findMany({ where: { projectId: { in: projectIds } } });
    for (const c of costs) if (c.documentId) docs.add(c.documentId);
    summary.parcelas = receivables.length;
    summary.pedidosDeCredito = credits.length;

    // Assinatura eletrônica: nome e e-mail de quem assinou.
    summary.pedidosDeAssinatura = (
      await tx.signatureRequest.updateMany({
        where: { contractId: { in: projects.map((p) => p.contractId) } },
        data: { signerName: REMOVED, signerEmail: 'removido@removido.invalid', error: null },
      })
    ).count;

    // Histórico de comunicações: destinatário e assunto.
    const logs = await tx.communicationLog.findMany({ where: { accountId } });
    for (const log of logs)
      await tx.communicationLog.update({
        where: { id: log.id },
        data: { recipient: null, subject: scrub(log.subject) },
      });
    summary.comunicacoes = logs.length;

    // Arquivos de execução ligados ao projeto, à ordem de serviço, ao comissionamento etc.
    const linked = await tx.document.findMany({
      where: {
        deletedAt: null,
        OR: [
          { entityType: 'WorkOrder', entityId: { in: orders.map((o) => o.id) } },
          { entityType: 'WorkOrderSignature', entityId: { in: orders.map((o) => o.id) } },
          { entityType: 'CommissioningRecord', entityId: { in: records.map((r) => r.id) } },
          { entityType: 'PortalUpload', entityId: { in: projectIds } },
          { entityType: 'Project', entityId: { in: projectIds } },
        ],
      },
      select: { id: true },
    });
    linked.forEach((d) => docs.add(d.id));
    void now;
    return { summary, documentIds: [...docs] };
  }

  // ---- Política de retenção (rotina diária) ----

  /** Aplica a política de cada empresa que configurou prazos. Só elimina o que passou do prazo e não está retido. */
  async sweepAll(): Promise<{
    leads: number;
    accounts: number;
    photos: number;
    geolocation: number;
    aiConversations: number;
  }> {
    const tenants = await this.prisma.system.tenant.findMany({
      select: { id: true, settings: true },
    });
    const total = { leads: 0, accounts: 0, photos: 0, geolocation: 0, aiConversations: 0 };
    for (const tenant of tenants) {
      const policy = this.policyFrom(tenant.settings);
      if (
        policy.unconvertedLeadsMonths === null &&
        policy.lostOpportunitiesMonths === null &&
        policy.fieldPhotosMonths === null &&
        policy.geolocationMonths === null &&
        policy.aiConversationsMonths === null
      )
        continue;
      const done = await this.context.run({ tenantId: tenant.id }, () => this.sweepTenant(policy));
      total.leads += done.leads;
      total.accounts += done.accounts;
      total.photos += done.photos;
      total.geolocation += done.geolocation;
      total.aiConversations += done.aiConversations;
    }
    return total;
  }

  /** Fotos de campo mais antigas que o prazo: arquivo apagado e a linha (legenda, local) esvaziada. */
  private async sweepFieldPhotos(months: number, now: number): Promise<number> {
    const cutoff = new Date(now - months * MONTH);
    const photos = await this.prisma.db.workOrderPhoto.findMany({
      where: { takenAt: { lt: cutoff } },
      take: 500,
    });
    if (photos.length === 0) return 0;
    const docs = await this.prisma.db.document.findMany({
      where: { id: { in: photos.map((p) => p.documentId) }, deletedAt: null },
    });
    await this.prisma.db.$transaction(async (tx) => {
      await tx.document.updateMany({
        where: { id: { in: docs.map((d) => d.id) } },
        data: { deletedAt: new Date(now) },
      });
      await tx.workOrderPhoto.deleteMany({ where: { id: { in: photos.map((p) => p.id) } } });
      await this.audit.record(
        {
          action: 'privacy.field_photos_expired',
          entity: 'Tenant',
          entityId: this.context.requireTenantId(),
          actorId: null,
          after: { photos: photos.length, olderThanMonths: months },
        },
        tx,
      );
    });
    for (const doc of docs)
      await this.s3
        .remove(doc.storageKey)
        .catch((error: unknown) =>
          this.logger.error(
            { err: error, key: doc.storageKey },
            'Não foi possível apagar o arquivo',
          ),
        );
    return photos.length;
  }

  /** Conversas do assistente sem atividade há mais que o prazo: mensagens e conversa apagadas de vez. */
  private async sweepAiConversations(months: number, now: number): Promise<number> {
    const cutoff = new Date(now - months * MONTH);
    const old = await this.prisma.db.aiConversation.findMany({
      where: { updatedAt: { lt: cutoff } },
      select: { id: true },
      take: 500,
    });
    if (old.length === 0) return 0;
    const ids = old.map((c) => c.id);
    await this.prisma.db.$transaction(async (tx) => {
      await tx.aiMessage.deleteMany({ where: { conversationId: { in: ids } } });
      await tx.aiConversation.deleteMany({ where: { id: { in: ids } } });
      await this.audit.record(
        {
          action: 'privacy.ai_conversations_expired',
          entity: 'Tenant',
          entityId: this.context.requireTenantId(),
          actorId: null,
          after: { conversations: ids.length, olderThanMonths: months },
        },
        tx,
      );
    });
    return ids.length;
  }

  /**
   * Apaga as conversas do assistente que citam alguma destas entidades (cliente, contato): os pseudônimos de cada
   * conversa guardam o id de quem foi citado. Faz parte da eliminação do titular (LGPD).
   */
  private async eraseAiConversationsCiting(tx: Tx, entityIds: readonly string[]): Promise<number> {
    if (entityIds.length === 0) return 0;
    const wanted = new Set(entityIds);
    const all = await tx.aiConversation.findMany({ select: { id: true, pseudonyms: true } });
    const hit = all
      .filter((c) =>
        ((c.pseudonyms ?? []) as Array<{ entityId?: string }>).some(
          (p) => p.entityId !== undefined && wanted.has(p.entityId),
        ),
      )
      .map((c) => c.id);
    if (hit.length === 0) return 0;
    await tx.aiMessage.deleteMany({ where: { conversationId: { in: hit } } });
    await tx.aiConversation.deleteMany({ where: { id: { in: hit } } });
    return hit.length;
  }

  /** Geolocalização do app de campo mais antiga que o prazo: coordenadas das fotos e das ordens zeradas. */
  private async sweepGeolocation(months: number, now: number): Promise<number> {
    const cutoff = new Date(now - months * MONTH);
    const photos = await this.prisma.db.workOrderPhoto.updateMany({
      where: {
        takenAt: { lt: cutoff },
        OR: [{ latitude: { not: null } }, { longitude: { not: null } }],
      },
      data: { latitude: null, longitude: null, accuracy: null },
    });
    const orders = await this.prisma.db.workOrder.findMany({
      where: { createdAt: { lt: cutoff }, NOT: { geo: { equals: [] } } },
      select: { id: true },
      take: 500,
    });
    if (orders.length)
      await this.prisma.db.workOrder.updateMany({
        where: { id: { in: orders.map((o) => o.id) } },
        data: { geo: [] },
      });
    const total = photos.count + orders.length;
    if (total > 0)
      await this.audit.record({
        action: 'privacy.geolocation_expired',
        entity: 'Tenant',
        entityId: this.context.requireTenantId(),
        actorId: null,
        after: { photos: photos.count, workOrders: orders.length, olderThanMonths: months },
      });
    return total;
  }

  private async sweepTenant(policy: RetentionPolicyInput): Promise<{
    leads: number;
    accounts: number;
    photos: number;
    geolocation: number;
    aiConversations: number;
  }> {
    const now = Date.now();
    const done = { leads: 0, accounts: 0, photos: 0, geolocation: 0, aiConversations: 0 };
    if (policy.aiConversationsMonths !== null)
      done.aiConversations = await this.sweepAiConversations(policy.aiConversationsMonths, now);
    if (policy.fieldPhotosMonths !== null)
      done.photos = await this.sweepFieldPhotos(policy.fieldPhotosMonths, now);
    if (policy.geolocationMonths !== null)
      done.geolocation = await this.sweepGeolocation(policy.geolocationMonths, now);
    if (policy.unconvertedLeadsMonths !== null) {
      const cutoff = new Date(now - policy.unconvertedLeadsMonths * MONTH);
      const leads = await this.prisma.db.lead.findMany({
        where: { anonymizedAt: null, status: { not: 'CONVERTED' }, createdAt: { lt: cutoff } },
        select: { id: true },
        take: 200,
      });
      for (const lead of leads) {
        const out = await this.erase(
          'LEAD',
          lead.id,
          `Política de retenção: lead sem conversão há mais de ${policy.unconvertedLeadsMonths} meses`,
          null,
        ).catch(() => null);
        if (out?.status === 'COMPLETED') done.leads += 1;
      }
    }
    if (policy.lostOpportunitiesMonths !== null) {
      const cutoff = new Date(now - policy.lostOpportunitiesMonths * MONTH);
      const accounts = await this.prisma.db.account.findMany({
        where: {
          anonymizedAt: null,
          opportunities: { some: {}, every: { status: 'LOST', stageChangedAt: { lt: cutoff } } },
        },
        select: { id: true },
        take: 200,
      });
      for (const account of accounts) {
        const out = await this.erase(
          'ACCOUNT',
          account.id,
          `Política de retenção: negócio perdido há mais de ${policy.lostOpportunitiesMonths} meses`,
          null,
        ).catch(() => null);
        if (out?.status === 'COMPLETED') done.accounts += 1;
      }
    }
    return done;
  }
}

export type { Prisma };
