export interface CommunicationTemplate {
  id: string;
  label: string;
  subject: string;
  /** Texto com `{{variavel}}`. Vale para o e-mail e para a mensagem pré-preenchida do WhatsApp. */
  body: string;
}

/**
 * Modelos de mensagem. O texto é curto e neutro de propósito: a empresa pode ajustá-lo antes de enviar (o link do
 * WhatsApp abre a conversa com o texto pronto, que o usuário revisa). Novos modelos entram com cada fase.
 */
export const COMMUNICATION_TEMPLATES: readonly CommunicationTemplate[] = [
  {
    id: 'proposal.link',
    label: 'Envio da proposta',
    subject: 'Sua proposta de energia solar',
    body: 'Olá, {{nome}}! Preparamos a sua proposta de energia solar. Você pode vê-la e aceitá-la neste link: {{link}}',
  },
  {
    id: 'portal.access',
    label: 'Acesso ao portal do cliente',
    subject: 'Acompanhe o seu projeto de energia solar',
    body: 'Olá, {{nome}}! Use este link para acompanhar o seu projeto (vale por pouco tempo e só pode ser usado uma vez): {{link}}',
  },
  {
    id: 'installation.scheduled',
    label: 'Instalação agendada',
    subject: 'Instalação agendada',
    body: 'Olá, {{nome}}! A instalação do seu sistema foi agendada para {{data}} ({{janela}}). Qualquer imprevisto, responda esta mensagem.',
  },
  {
    id: 'payment.reminder',
    label: 'Lembrete de parcela',
    subject: 'Lembrete de parcela',
    body: 'Olá, {{nome}}! Lembramos que a parcela de {{valor}} vence em {{vencimento}}. Se já pagou, desconsidere esta mensagem.',
  },
];

export const findTemplate = (id: string): CommunicationTemplate | undefined =>
  COMMUNICATION_TEMPLATES.find((t) => t.id === id);

const VARIABLE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export const templateVariables = (template: CommunicationTemplate): string[] => [
  ...new Set(
    [...`${template.subject} ${template.body}`.matchAll(VARIABLE)].map((m) => m[1] as string),
  ),
];

/** Troca `{{variavel}}`. Devolve também as que ficaram sem valor, para recusar o envio em vez de mandar `{{x}}`. */
export function renderTemplate(
  template: CommunicationTemplate,
  variables: Record<string, string>,
): { subject: string; text: string; missing: string[] } {
  const missing = templateVariables(template).filter((v) => !variables[v]?.trim());
  const fill = (text: string) => text.replace(VARIABLE, (_, name: string) => variables[name] ?? '');
  return { subject: fill(template.subject), text: fill(template.body), missing };
}
