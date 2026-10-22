import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

export const EXPORT_VERSION = 1;

/**
 * Exportação dos dados da empresa (portabilidade, LGPD): tudo o que é DELA, em JSON, com documentos pessoais em
 * claro (o servidor os decifra). Fica de fora o que é segredo ou técnico: senhas, MFA, sessões, tokens de link,
 * índices cegos e fila de eventos. Os ARQUIVOS (faturas, contratos, PDFs) não vêm no JSON: os metadados vêm,
 * e cada arquivo se baixa pelo link do documento.
 */
@Injectable()
export class DataExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
  ) {}

  async exportTenant() {
    const db = this.prisma.db;
    const tenantId = this.context.requireTenantId();
    const [tenant, ...rest] = await Promise.all([
      this.prisma.system.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
      db.branch.findMany(),
      db.team.findMany(),
      db.user.findMany({ omit: { passwordHash: true, mfaSecret: true } }),
      db.lead.findMany({
        omit: { emailNormalized: true, phoneNormalized: true, documentNormalized: true },
      }),
      db.account.findMany({ omit: { documentNormalized: true } }),
      db.contact.findMany(),
      db.site.findMany(),
      db.consumerUnit.findMany(),
      db.distributor.findMany(),
      db.opportunity.findMany(),
      db.timelineEvent.findMany(),
      db.task.findMany(),
      db.energyBill.findMany(),
      db.energyBillSnapshot.findMany(),
      db.calculationSession.findMany(),
      db.triageSnapshot.findMany(),
      db.marginPolicy.findMany(),
      db.quote.findMany(),
      db.approvalRequest.findMany(),
      db.proposal.findMany({ omit: { tokenHash: true } }),
      db.proposalSnapshot.findMany(),
      db.contractTemplate.findMany(),
      db.contract.findMany(),
      db.homologationChecklist.findMany(),
      db.project.findMany(),
      db.projectChecklistItem.findMany(),
      db.document.findMany(),
      db.privacyRequest.findMany(),
      // Credenciais dos provedores são segredo: ficam de fora, só o cadastro da conexão vai.
      db.integrationConnection.findMany({ omit: { credentials: true } }),
      db.integrationRun.findMany(),
      db.communicationLog.findMany(),
    ]);
    const [
      branches,
      teams,
      users,
      leads,
      accounts,
      contacts,
      sites,
      consumerUnits,
      distributors,
      opportunities,
      timelineEvents,
      tasks,
      energyBills,
      energyBillSnapshots,
      calculationSessions,
      triageSnapshots,
      marginPolicies,
      quotes,
      approvalRequests,
      proposals,
      proposalSnapshots,
      contractTemplates,
      contracts,
      homologationChecklists,
      projects,
      projectChecklistItems,
      documents,
      privacyRequests,
      integrationConnections,
      integrationRuns,
      communicationLogs,
    ] = rest;

    await this.audit.record({
      action: 'tenant.exported',
      entity: 'Tenant',
      entityId: tenantId,
      after: {
        leads: leads?.length ?? 0,
        accounts: accounts?.length ?? 0,
        opportunities: opportunities?.length ?? 0,
      },
    });

    return {
      exportVersion: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        document: tenant.document,
        settings: tenant.settings,
      },
      branches,
      teams,
      users,
      leads,
      accounts,
      contacts,
      sites,
      consumerUnits,
      distributors,
      opportunities,
      timelineEvents,
      tasks,
      energyBills,
      energyBillSnapshots,
      calculationSessions,
      triageSnapshots,
      marginPolicies,
      quotes,
      approvalRequests,
      proposals,
      proposalSnapshots,
      contractTemplates,
      contracts,
      homologationChecklists,
      projects,
      projectChecklistItems,
      documents,
      privacyRequests,
      integrationConnections,
      integrationRuns,
      communicationLogs,
    };
  }
}
