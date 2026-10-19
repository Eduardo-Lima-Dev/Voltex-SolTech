import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Account, Contact, ConsumerUnit, Distributor, Site } from '@voltex/database';
import {
  OpportunityStatus,
  normalizeDocument,
  type AccountDetailDto,
  type AccountDto,
  type ContactDto,
  type ConsumerUnitDto,
  type CreateAccountData,
  type CreateConsumerUnitData,
  type CreateContactData,
  type CreateSiteData,
  type ListAccountsQuery,
  type SiteDto,
  type SiteIntake,
  type UpdateAccountData,
  type UpdateConsumerUnitData,
  type UpdateContactData,
  type UpdateSiteData,
} from '@voltex/shared';
import { RequestContext } from '../../common/context/request-context';
import { toPaginated, toSkipTake } from '../../common/pagination';
import { AuditService } from '../../platform/audit/audit.service';
import { EventBus } from '../../platform/events/event-bus.service';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { DomainEvent } from '@voltex/shared';

const toAccount = (r: Account): AccountDto => ({
  id: r.id,
  tenantId: r.tenantId,
  type: r.type,
  name: r.name,
  document: r.document,
  segment: r.segment,
  email: r.email,
  phone: r.phone,
  notes: r.notes,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

const toContact = (r: Contact): ContactDto => ({
  id: r.id,
  accountId: r.accountId,
  name: r.name,
  email: r.email,
  phone: r.phone,
  roleTitle: r.roleTitle,
  isPrimary: r.isPrimary,
  createdAt: r.createdAt.toISOString(),
});

const toSite = (r: Site): SiteDto => ({
  id: r.id,
  accountId: r.accountId,
  name: r.name,
  street: r.street,
  number: r.number,
  district: r.district,
  city: r.city,
  state: r.state,
  zip: r.zip,
  latitude: r.latitude,
  longitude: r.longitude,
  intake: (r.intake ?? {}) as SiteIntake,
  createdAt: r.createdAt.toISOString(),
});

const toUnit = (r: ConsumerUnit & { distributor: Distributor | null }): ConsumerUnitDto => ({
  id: r.id,
  accountId: r.accountId,
  siteId: r.siteId,
  number: r.number,
  distributorId: r.distributorId,
  distributorName: r.distributor?.name ?? null,
  customerGroup: r.customerGroup,
  phaseSystem: r.phaseSystem,
  consumerClass: r.consumerClass,
  createdAt: r.createdAt.toISOString(),
});

@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
    private readonly events: EventBus,
  ) {}

  // ---- Contas ----

  async list(query: ListAccountsQuery) {
    const digits = query.search?.replace(/\D/g, '') ?? '';
    const where = {
      deletedAt: null,
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' as const } },
              { email: { contains: query.search, mode: 'insensitive' as const } },
              ...(digits.length >= 4 ? [{ documentNormalized: { contains: digits } }] : []),
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.db.account.findMany({ where, orderBy: { name: 'asc' }, ...toSkipTake(query) }),
      this.prisma.db.account.count({ where }),
    ]);
    return toPaginated(rows.map(toAccount), total, query);
  }

  async get(id: string): Promise<AccountDetailDto> {
    const account = await this.findOrThrow(id);
    const [contacts, sites, units] = await Promise.all([
      this.prisma.db.contact.findMany({
        where: { accountId: id, deletedAt: null },
        orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }],
      }),
      this.prisma.db.site.findMany({
        where: { accountId: id, deletedAt: null },
        orderBy: { name: 'asc' },
      }),
      this.prisma.db.consumerUnit.findMany({
        where: { accountId: id, deletedAt: null },
        include: { distributor: true },
        orderBy: { number: 'asc' },
      }),
    ]);
    return {
      ...toAccount(account),
      contacts: contacts.map(toContact),
      sites: sites.map(toSite),
      consumerUnits: units.map(toUnit),
    };
  }

  async create(input: CreateAccountData): Promise<AccountDto> {
    const documentNormalized = normalizeDocument(input.document);
    if (documentNormalized) {
      const duplicate = await this.prisma.db.account.findFirst({
        where: { documentNormalized, deletedAt: null },
      });
      if (duplicate)
        throw new ConflictException({
          message: `Já existe uma conta com este documento (${duplicate.name})`,
          code: 'DUPLICATE_ACCOUNT',
          data: { matchedAccountId: duplicate.id },
        });
    }
    const row = await this.prisma.db.$transaction(async (tx) => {
      const created = await tx.account.create({
        data: {
          tenantId: this.context.requireTenantId(),
          type: input.type,
          name: input.name,
          document: input.document ?? null,
          documentNormalized,
          segment: input.segment ?? null,
          email: input.email ?? null,
          phone: input.phone ?? null,
          notes: input.notes ?? null,
        },
      });
      await this.audit.record(
        {
          action: 'account.created',
          entity: 'Account',
          entityId: created.id,
          after: { name: created.name },
        },
        tx,
      );
      return created;
    });
    return toAccount(row);
  }

  async update(id: string, input: UpdateAccountData): Promise<AccountDto> {
    const before = await this.findOrThrow(id);
    const documentNormalized =
      input.document === undefined ? undefined : normalizeDocument(input.document);
    if (documentNormalized) {
      const duplicate = await this.prisma.db.account.findFirst({
        where: { documentNormalized, deletedAt: null, id: { not: id } },
      });
      if (duplicate)
        throw new ConflictException({
          message: `Já existe uma conta com este documento (${duplicate.name})`,
          code: 'DUPLICATE_ACCOUNT',
          data: { matchedAccountId: duplicate.id },
        });
    }
    const row = await this.prisma.db.$transaction(async (tx) => {
      const updated = await tx.account.update({
        where: { id },
        data: { ...input, ...(documentNormalized !== undefined ? { documentNormalized } : {}) },
      });
      await this.audit.record(
        {
          action: 'account.updated',
          entity: 'Account',
          entityId: id,
          before: { name: before.name },
          after: { name: updated.name },
        },
        tx,
      );
      return updated;
    });
    return toAccount(row);
  }

  async remove(id: string) {
    const account = await this.findOrThrow(id);
    const open = await this.prisma.db.opportunity.count({
      where: { accountId: id, deletedAt: null, status: OpportunityStatus.OPEN },
    });
    if (open > 0)
      throw new ConflictException('A conta tem oportunidades abertas: encerre-as antes de excluir');
    await this.prisma.db.$transaction(async (tx) => {
      await tx.account.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.record(
        {
          action: 'account.deleted',
          entity: 'Account',
          entityId: id,
          before: { name: account.name },
        },
        tx,
      );
    });
    return { id };
  }

  // ---- Contatos ----

  async addContact(accountId: string, input: CreateContactData): Promise<ContactDto> {
    await this.findOrThrow(accountId);
    const row = await this.prisma.db.$transaction(async (tx) => {
      if (input.isPrimary)
        await tx.contact.updateMany({
          where: { accountId, isPrimary: true },
          data: { isPrimary: false },
        });
      const created = await tx.contact.create({
        data: {
          tenantId: this.context.requireTenantId(),
          accountId,
          name: input.name,
          email: input.email ?? null,
          phone: input.phone ?? null,
          roleTitle: input.roleTitle ?? null,
          isPrimary: input.isPrimary,
        },
      });
      await this.audit.record(
        {
          action: 'contact.created',
          entity: 'Contact',
          entityId: created.id,
          after: { accountId },
        },
        tx,
      );
      return created;
    });
    return toContact(row);
  }

  async updateContact(id: string, input: UpdateContactData): Promise<ContactDto> {
    const before = await this.prisma.db.contact.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new NotFoundException('Contato não encontrado');
    const row = await this.prisma.db.$transaction(async (tx) => {
      if (input.isPrimary)
        await tx.contact.updateMany({
          where: { accountId: before.accountId, isPrimary: true, id: { not: id } },
          data: { isPrimary: false },
        });
      const updated = await tx.contact.update({ where: { id }, data: input });
      await this.audit.record({ action: 'contact.updated', entity: 'Contact', entityId: id }, tx);
      return updated;
    });
    return toContact(row);
  }

  async removeContact(id: string) {
    const before = await this.prisma.db.contact.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new NotFoundException('Contato não encontrado');
    await this.prisma.db.$transaction(async (tx) => {
      await tx.contact.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.record({ action: 'contact.deleted', entity: 'Contact', entityId: id }, tx);
    });
    return { id };
  }

  // ---- Imóveis e intake técnico ----

  async addSite(accountId: string, input: CreateSiteData) {
    await this.findOrThrow(accountId);
    const row = await this.prisma.db.$transaction(async (tx) => {
      const created = await tx.site.create({
        data: {
          tenantId: this.context.requireTenantId(),
          accountId,
          name: input.name,
          street: input.street ?? null,
          number: input.number ?? null,
          district: input.district ?? null,
          city: input.city,
          state: input.state,
          zip: input.zip ?? null,
          latitude: input.latitude ?? null,
          longitude: input.longitude ?? null,
          intake: input.intake as object,
        },
      });
      await this.audit.record(
        { action: 'site.created', entity: 'Site', entityId: created.id, after: { accountId } },
        tx,
      );
      return created;
    });
    return toSite(row);
  }

  async updateSite(id: string, input: UpdateSiteData): Promise<SiteDto> {
    const before = await this.prisma.db.site.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new NotFoundException('Imóvel não encontrado');
    const intakeChanged =
      input.intake !== undefined &&
      JSON.stringify(input.intake) !== JSON.stringify(before.intake ?? {});
    const locationChanged =
      (input.latitude !== undefined && input.latitude !== before.latitude) ||
      (input.longitude !== undefined && input.longitude !== before.longitude);

    const row = await this.prisma.db.$transaction(async (tx) => {
      const updated = await tx.site.update({
        where: { id },
        data: {
          ...input,
          intake: input.intake === undefined ? undefined : (input.intake as object),
        },
      });
      await this.audit.record(
        {
          action: 'site.updated',
          entity: 'Site',
          entityId: id,
          before: { intake: before.intake },
          after: { intake: updated.intake },
        },
        tx,
      );
      if (intakeChanged || locationChanged) {
        // Dados técnicos do local mudaram: oportunidades abertas deste imóvel têm premissas novas.
        const affected = await tx.opportunity.findMany({
          where: { siteId: id, deletedAt: null, status: OpportunityStatus.OPEN },
          select: { id: true, projectCode: true },
        });
        for (const opportunity of affected) {
          await this.events.publish(
            {
              type: DomainEvent.OPPORTUNITY_PREMISES_CHANGED,
              projectCode: opportunity.projectCode,
              payload: { opportunityId: opportunity.id, siteId: id, reason: 'site_intake_changed' },
            },
            tx,
          );
        }
      }
      return updated;
    });
    return toSite(row);
  }

  async removeSite(id: string) {
    const before = await this.prisma.db.site.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new NotFoundException('Imóvel não encontrado');
    const used = await this.prisma.db.opportunity.count({
      where: { siteId: id, deletedAt: null, status: OpportunityStatus.OPEN },
    });
    if (used > 0) throw new ConflictException('Há oportunidades abertas neste imóvel');
    await this.prisma.db.$transaction(async (tx) => {
      await tx.site.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.record({ action: 'site.deleted', entity: 'Site', entityId: id }, tx);
    });
    return { id };
  }

  // ---- Unidades consumidoras ----

  async addConsumerUnit(accountId: string, input: CreateConsumerUnitData) {
    await this.findOrThrow(accountId);
    await this.assertUnitLinks(accountId, input.siteId, input.distributorId);
    const row = await this.prisma.db.$transaction(async (tx) => {
      const created = await tx.consumerUnit.create({
        data: {
          tenantId: this.context.requireTenantId(),
          accountId,
          siteId: input.siteId ?? null,
          number: input.number,
          distributorId: input.distributorId ?? null,
          customerGroup: input.customerGroup,
          phaseSystem: input.phaseSystem ?? null,
          consumerClass: input.consumerClass ?? null,
        },
        include: { distributor: true },
      });
      await this.audit.record(
        {
          action: 'consumer_unit.created',
          entity: 'ConsumerUnit',
          entityId: created.id,
          after: { accountId },
        },
        tx,
      );
      return created;
    });
    return toUnit(row);
  }

  async updateConsumerUnit(id: string, input: UpdateConsumerUnitData): Promise<ConsumerUnitDto> {
    const before = await this.prisma.db.consumerUnit.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new NotFoundException('Unidade consumidora não encontrada');
    await this.assertUnitLinks(before.accountId, input.siteId, input.distributorId);
    const changed =
      (input.customerGroup !== undefined && input.customerGroup !== before.customerGroup) ||
      (input.phaseSystem !== undefined && input.phaseSystem !== before.phaseSystem) ||
      (input.distributorId !== undefined && input.distributorId !== before.distributorId);

    const row = await this.prisma.db.$transaction(async (tx) => {
      const updated = await tx.consumerUnit.update({
        where: { id },
        data: input,
        include: { distributor: true },
      });
      await this.audit.record(
        { action: 'consumer_unit.updated', entity: 'ConsumerUnit', entityId: id },
        tx,
      );
      if (changed) {
        const affected = await tx.opportunity.findMany({
          where: { consumerUnitId: id, deletedAt: null, status: OpportunityStatus.OPEN },
          select: { id: true, projectCode: true },
        });
        for (const opportunity of affected) {
          await this.events.publish(
            {
              type: DomainEvent.OPPORTUNITY_PREMISES_CHANGED,
              projectCode: opportunity.projectCode,
              payload: {
                opportunityId: opportunity.id,
                consumerUnitId: id,
                reason: 'consumer_unit_changed',
              },
            },
            tx,
          );
        }
      }
      return updated;
    });
    return toUnit(row);
  }

  async removeConsumerUnit(id: string) {
    const before = await this.prisma.db.consumerUnit.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new NotFoundException('Unidade consumidora não encontrada');
    const used = await this.prisma.db.opportunity.count({
      where: { consumerUnitId: id, deletedAt: null, status: OpportunityStatus.OPEN },
    });
    if (used > 0) throw new ConflictException('Há oportunidades abertas nesta unidade consumidora');
    await this.prisma.db.$transaction(async (tx) => {
      await tx.consumerUnit.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.record(
        { action: 'consumer_unit.deleted', entity: 'ConsumerUnit', entityId: id },
        tx,
      );
    });
    return { id };
  }

  // ---- Internos ----

  private async findOrThrow(id: string) {
    const row = await this.prisma.db.account.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundException('Conta não encontrada');
    return row;
  }

  private async assertUnitLinks(
    accountId: string,
    siteId?: string | null,
    distributorId?: string | null,
  ) {
    if (siteId) {
      const site = await this.prisma.db.site.findFirst({
        where: { id: siteId, accountId, deletedAt: null },
      });
      if (!site) throw new UnprocessableEntityException('O imóvel não pertence a esta conta');
    }
    if (distributorId) {
      const distributor = await this.prisma.db.distributor.findFirst({
        where: { id: distributorId, deletedAt: null },
      });
      if (!distributor) throw new UnprocessableEntityException('Concessionária não encontrada');
    }
  }
}
