import { Injectable } from '@nestjs/common';
import { PrismaService } from '@voltex/database';

@Injectable()
export class LgpdService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Apaga toda a informação pessoal de uma conta/contato.
   * Inclui: fotos, assinaturas, geolocalização, acessos, sessões, chamados, logs.
   */
  async eraseAccountAsync(
    tenantId: string,
    accountId: string,
  ): Promise<{ deletedRecords: Record<string, number> }> {
    const deletedRecords: Record<string, number> = {};

    // 1. Documentos (fotos, assinaturas, PDFs) relacionados a ordens de serviço
    const documents = await this.prisma.platform.document.findMany({
      where: {
        tenantId,
        entityType: { in: ['WorkOrder', 'CommissioningRecord', 'Proposal', 'Contract'] },
      },
    });

    deletedRecords['documents'] = documents.length;
    if (documents.length > 0) {
      await this.prisma.platform.document.deleteMany({
        where: {
          id: { in: documents.map((d) => d.id) },
        },
      });
    }

    // 2. Fotos de campo (WorkOrderPhoto)
    const photoCount = await this.prisma.operations.workOrderPhoto.deleteMany({
      where: {
        workOrder: {
          installation: {
            project: { accountId },
          },
        },
      },
    });
    deletedRecords['workOrderPhotos'] = photoCount.count;

    // 3. Geolocalização (field actions com lat/lon)
    const fieldActionCount = await this.prisma.operations.fieldAction.deleteMany({
      where: {
        workOrder: {
          installation: {
            project: { accountId },
          },
        },
      },
    });
    deletedRecords['fieldActions'] = fieldActionCount.count;

    // 4. Acessos ao portal
    const portalAccessCount = await this.prisma.platform.portalAccess.deleteMany({
      where: { accountId },
    });
    deletedRecords['portalAccesses'] = portalAccessCount.count;

    // 5. Sessões do portal
    const sessionCount = await this.prisma.platform.portalSession.deleteMany({
      where: {
        portalAccess: { accountId },
      },
    });
    deletedRecords['portalSessions'] = sessionCount.count;

    // 6. Links mágicos
    const linkCount = await this.prisma.platform.portalMagicLink.deleteMany({
      where: {
        portalAccess: { accountId },
      },
    });
    deletedRecords['magicLinks'] = linkCount.count;

    // 7. Chamados (apenas os do cliente)
    const ticketCount = await this.prisma.operations.ticket.deleteMany({
      where: {
        plant: {
          project: { accountId },
        },
      },
    });
    deletedRecords['tickets'] = ticketCount.count;

    // 8. Logs de comunicação
    const commLogCount = await this.prisma.platform.communicationLog.deleteMany({
      where: {
        entityType: { in: ['Account', 'Contact', 'Opportunity', 'Project'] },
        entityId: accountId,
      },
    });
    deletedRecords['communicationLogs'] = commLogCount.count;

    // 9. Anonymizar audit logs (não delete, apenas anonymize)
    const auditCount = await this.prisma.platform.auditLog.updateMany({
      where: {
        tenantId,
        entityType: { in: ['Account', 'Contact'] },
        entityId: accountId,
      },
      data: {
        actorId: null,
        before: { anonymized: true },
        after: { anonymized: true },
      },
    });
    deletedRecords['auditLogsAnonymized'] = auditCount.count;

    return { deletedRecords };
  }

  /**
   * Exporta dados de um tenant para conformidade LGPD.
   */
  async exportTenantDataAsync(tenantId: string): Promise<any> {
    const accounts = await this.prisma.crm.account.findMany({
      where: { tenantId },
      include: {
        contacts: true,
        opportunities: true,
      },
    });

    const projects = await this.prisma.crm.project.findMany({
      where: { tenantId },
      include: {
        contract: true,
        installation: true,
      },
    });

    const leads = await this.prisma.crm.lead.findMany({
      where: { tenantId },
    });

    return {
      exportDate: new Date().toISOString(),
      accounts: accounts.map((a) => ({
        ...a,
        passwordHash: undefined,
      })),
      projects,
      leads,
      // Excluir tokenHash, senhas, credenciais
    };
  }
}
