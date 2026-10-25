import { NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { isoDateTimeSchema } from '@voltex/shared';

export const limitParam = (max = 20, fallback = 10) =>
  z
    .number()
    .int()
    .min(1)
    .max(max)
    .default(fallback)
    .describe(`Quantos itens devolver (até ${max}).`);

export const periodParams = {
  from: isoDateTimeSchema
    .optional()
    .describe('Início do período (AAAA-MM-DD). Padrão: 90 dias atrás.'),
  to: isoDateTimeSchema.optional().describe('Fim do período (AAAA-MM-DD). Padrão: hoje.'),
};

export const projectCodeParam = z
  .string()
  .trim()
  .min(4)
  .max(40)
  .describe('Código do projeto, como VLX-ABC12345.');

export const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

const SOURCE: Record<string, string> = {
  FORM: 'Formulário',
  LANDING_PAGE: 'Landing page',
  WHATSAPP: 'WhatsApp',
  API: 'Integração',
  REFERRAL: 'Indicação',
  CSV_IMPORT: 'Planilha importada',
  MARKETPLACE: 'Marketplace',
  CAMPAIGN: 'Campanha',
  MANUAL: 'Cadastro manual',
  PARTNER_PORTAL: 'Portal do parceiro',
};
const SEGMENT: Record<string, string> = {
  RESIDENTIAL: 'Residencial',
  RURAL: 'Rural',
  COMMERCIAL: 'Comercial',
  INDUSTRIAL: 'Industrial',
};
const LEAD_STATUS: Record<string, string> = {
  NEW: 'Novo',
  CONTACTED: 'Contatado',
  QUALIFIED: 'Qualificado',
  DISQUALIFIED: 'Desqualificado',
  CONVERTED: 'Convertido',
};
const OPP_STATUS: Record<string, string> = { OPEN: 'Em aberto', WON: 'Ganha', LOST: 'Perdida' };
const PROJECT_STATUS: Record<string, string> = {
  DOCUMENTATION: 'Documentação',
  SUBMITTED: 'Protocolado',
  INSPECTION: 'Em vistoria',
  APPROVED: 'Aprovado',
  CANCELLED: 'Cancelado',
};
const INSTALLATION_STATUS: Record<string, string> = {
  AWAITING_ENGINEERING: 'Aguardando engenharia',
  AWAITING_MATERIAL: 'Aguardando material',
  MATERIAL_READY: 'Material pronto',
  SCHEDULING: 'Agendando',
  CREW_ASSIGNED: 'Equipe designada',
  IN_PROGRESS: 'Em instalação',
  FIELD_ISSUE: 'Pendência de campo',
  INSTALLED: 'Instalada',
  COMMISSIONING: 'Em comissionamento',
  CUSTOMER_ACCEPTANCE: 'Aguardando aceite do cliente',
  DONE: 'Finalizada',
  CANCELLED: 'Cancelada',
};

export const LABELS = {
  source: (k: string | null | undefined) => (k ? (SOURCE[k] ?? k) : null),
  segment: (k: string | null | undefined) => (k ? (SEGMENT[k] ?? k) : null),
  leadStatus: (k: string) => LEAD_STATUS[k] ?? k,
  oppStatus: (k: string) => OPP_STATUS[k] ?? k,
  projectStatus: (k: string) => PROJECT_STATUS[k] ?? k,
  installationStatus: (k: string) => INSTALLATION_STATUS[k] ?? k,
};

/** O registro não existe, ou está fora da carteira ou da permissão de quem perguntou: responde "não encontrado". */
export function notFound(): never {
  throw new NotFoundException();
}
