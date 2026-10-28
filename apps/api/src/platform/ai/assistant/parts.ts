import type { AiFactDto, AiMessagePart } from '@voltex/shared';
import { formatFact, type Fact } from '../privacy/facts';
import type { PseudonymEntry, Pseudonymizer } from '../privacy/pseudonymizer';

const REF = /\{\{\s*(F\d+)\s*\}\}/g;

/** Rótulos curtos, em português, do que cada consulta fez (para o "de onde veio" da tela). */
export function toolLabel(tool: string, area: string | undefined): string {
  return area ? `Consulta de ${area}` : tool;
}

/** Divide o texto do modelo em texto e valores (chips), já com os nomes reais para quem pode vê-los. */
export function splitParts(
  maskedText: string,
  facts: ReadonlyMap<string, Fact>,
  pseudonyms: Pseudonymizer,
  canSee: (entry: PseudonymEntry) => boolean,
): AiMessagePart[] {
  const parts: AiMessagePart[] = [];
  let cursor = 0;
  const pushText = (text: string) => {
    if (text) parts.push({ type: 'text', text: pseudonyms.reveal(text, canSee) });
  };
  for (const m of maskedText.matchAll(REF)) {
    const fact = facts.get(m[1] as string);
    pushText(maskedText.slice(cursor, m.index));
    if (fact) parts.push({ type: 'fact', factId: fact.id, text: formatFact(fact) });
    else pushText(m[0]);
    cursor = (m.index ?? 0) + m[0].length;
  }
  pushText(maskedText.slice(cursor));
  return parts;
}

export const plainText = (parts: readonly AiMessagePart[]): string =>
  parts.map((p) => p.text).join('');

const FIELD_LABELS: Record<string, string> = {
  totalReceivedCents: 'Total recebido',
  totalOpenCents: 'Total a receber',
  totalOverdueCents: 'Total vencido',
  totalCostsCents: 'Custos realizados',
  marginCents: 'Margem real',
  marginPct: 'Margem real (%)',
  valueCents: 'Valor do contrato',
  receivedLast30DaysCents: 'Recebido nos últimos 30 dias',
  commissionsPendingCents: 'Comissões pendentes',
  overdueInstallmentsCount: 'Parcelas vencidas',
  totalCount: 'Total',
  openCount: 'Em aberto',
  overdueCount: 'Atrasadas',
  slaBreachedCount: 'Com primeiro contato atrasado',
  stalledCount: 'Paradas',
  stalledAfterDays: 'Parada a partir de (dias)',
  withoutOpenTaskCount: 'Sem tarefa aberta',
  noMovementCount: 'Sem movimento',
  mrrCents: 'Receita recorrente mensal',
  queriedAt: 'Data da consulta',
  scheduledCount: 'Agendadas',
  awaitingMaterialCount: 'Aguardando material',
  openIssuesCount: 'Pendências de campo',
  reworkCount: 'Retrabalho',
  openTicketsCount: 'Chamados abertos',
  breachedTicketsCount: 'Chamados fora do prazo',
  plantsCount: 'Usinas',
  powerKwp: 'Potência instalada',
  overallWinRate: 'Taxa de ganho',
  openCents: 'Em aberto',
  sampleCount: 'Base da previsão',
};

/** Nome legível do campo de uma consulta ("receivedLast30DaysCents" → "Recebido nos últimos 30 dias"). */
export function fieldLabel(path: string): string {
  const last =
    path
      .split('.')
      .pop()
      ?.replace(/\[\d+\]/g, '') ?? path;
  if (FIELD_LABELS[last]) return FIELD_LABELS[last];
  const words = last
    .replace(/(Cents|Count|Days|Pct|Rate|Kwh|Kwp)$/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : last;
}

export function toFactDto(fact: Fact, labelOf: (tool: string) => string): AiFactDto {
  return {
    id: fact.id,
    text: formatFact(fact),
    type: fact.type,
    tool: fact.source.tool,
    toolLabel: labelOf(fact.source.tool),
    field: fact.path,
    label: fieldLabel(fact.path),
    queriedAt: fact.source.at,
  };
}
