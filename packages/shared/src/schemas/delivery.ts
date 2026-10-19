import { z } from 'zod';
import { ChecklistItemStatus, ProjectStatus } from '../enums/index.js';
import { checklistDeadlineSchema, checklistItemRuleSchema } from '../constants/homologation.js';
import { isoDateTimeSchema, paginationQuerySchema } from './common.js';

/** Contrato, projeto, homologação e painel comercial (Fase 7C). */

// ---- Contrato ----

export const updateContractTemplateSchema = z.object({
  name: z.string().trim().min(2).max(80).default('Contrato padrão'),
  body: z.string().trim().min(50, 'O modelo está curto demais').max(30_000),
});
export type UpdateContractTemplateInput = z.input<typeof updateContractTemplateSchema>;
export type UpdateContractTemplateData = z.output<typeof updateContractTemplateSchema>;

/** Gera o contrato a partir de uma proposta **aceita**. Com mais de um cenário, indique o escolhido pelo cliente. */
export const createContractSchema = z.object({
  proposalId: z.uuid().optional(),
  quoteId: z.uuid().optional(),
  /** Documento do cliente e endereço, quando ainda não estão na conta. */
  customerDocument: z.string().trim().max(32).optional(),
  customerAddress: z.string().trim().max(300).optional(),
  /** Documento da empresa (CNPJ), quando não está em Administração → Empresa. */
  companyDocument: z.string().trim().max(32).optional(),
});
export type CreateContractInput = z.infer<typeof createContractSchema>;

export const cancelContractSchema = z.object({
  reason: z.string().trim().min(5, 'Informe o motivo').max(300),
});
export type CancelContractInput = z.infer<typeof cancelContractSchema>;

/** Campos de texto que acompanham o arquivo do contrato assinado (multipart). */
export const signContractSchema = z.object({
  /** Data da assinatura (padrão: hoje). */
  signedAt: isoDateTimeSchema.optional(),
  /** Quem assinou pelo cliente. */
  signedByName: z.string().trim().min(3).max(160).optional(),
});
export type SignContractInput = z.infer<typeof signContractSchema>;

// ---- Projeto e homologação ----

export const updateProjectSchema = z.object({
  /** Responsável técnico pelo projeto (usuário da empresa); `null` remove. */
  responsibleId: z.uuid().nullable().optional(),
  distributorId: z.uuid().nullable().optional(),
});
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

export const updateChecklistItemSchema = z.object({
  status: z.enum(ChecklistItemStatus).optional(),
  /** Obrigatório ao dispensar (WAIVED) ou marcar como não aplicável. */
  note: z.string().trim().max(300).nullable().optional(),
  dueAt: isoDateTimeSchema.nullable().optional(),
  documentId: z.uuid().nullable().optional(),
});
export type UpdateChecklistItemInput = z.infer<typeof updateChecklistItemSchema>;

export const changeProjectStatusSchema = z.object({
  status: z.enum(ProjectStatus),
  /** Número do protocolo da distribuidora (ao protocolar). */
  protocolNumber: z.string().trim().min(2).max(60).optional(),
  /** Prazo para o parecer/vistoria: se omitido, usa a sugestão da regra vigente (com a fonte). */
  dueAt: isoDateTimeSchema.optional(),
  reason: z.string().trim().max(300).optional(),
});
export type ChangeProjectStatusInput = z.infer<typeof changeProjectStatusSchema>;

export const listProjectsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(ProjectStatus).optional(),
  responsibleId: z.uuid().optional(),
  search: z.string().trim().optional(),
});
export type ListProjectsQuery = z.output<typeof listProjectsQuerySchema>;

export const createHomologationChecklistSchema = z.object({
  /** Distribuidora da regra; sem ela, vale como padrão da empresa. */
  distributorId: z.uuid().optional(),
  items: z.array(checklistItemRuleSchema).min(1).max(40),
  deadlines: z.array(checklistDeadlineSchema).max(3).default([]),
  /** Fonte do conjunto (ex.: "Norma técnica NT-xx da Distribuidora, rev. 2026"). Obrigatória. */
  source: z.string().trim().min(5, 'Informe a fonte da regra').max(300),
  notes: z.string().trim().max(500).optional(),
  /** Quem revisou (recomendado: responsável técnico). */
  reviewedBy: z.string().trim().min(2).max(120).optional(),
});
export type CreateHomologationChecklistInput = z.input<typeof createHomologationChecklistSchema>;
export type CreateHomologationChecklistData = z.output<typeof createHomologationChecklistSchema>;

// ---- Painel comercial ----

export const commercialDashboardQuerySchema = z.object({
  /** Período por data de criação/ocorrência (padrão: últimos 30 dias). */
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
});
export type CommercialDashboardQuery = z.infer<typeof commercialDashboardQuerySchema>;
