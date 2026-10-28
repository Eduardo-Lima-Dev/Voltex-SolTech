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

/**
 * Explicação clara para "amostra insuficiente": quantos registros existem e quantos a empresa exige. Usa os valores
 * que a própria consulta devolveu (`sampleCount` e `minimumCount`/`requiredCount`); sem eles, devolve `null`.
 */
export function sampleExplanation(
  facts: readonly Fact[],
): { parts: AiMessagePart[]; used: Fact[] } | null {
  const sample = facts.find((f) => /sampleCount$/.test(f.path));
  const minimum = facts.find((f) => /(minimumCount|requiredCount)$/.test(f.path));
  if (!sample || !minimum) return null;
  return {
    used: [sample, minimum],
    parts: [
      {
        type: 'text',
        text: 'Não posso responder com segurança: há poucos registros para essa análise. Encontrei ',
      },
      { type: 'fact', factId: sample.id, text: formatFact(sample) },
      { type: 'text', text: ' e o mínimo para uma análise confiável é ' },
      { type: 'fact', factId: minimum.id, text: formatFact(minimum) },
      { type: 'text', text: '.' },
    ],
  };
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
  sampleCount: 'Registros encontrados',
  minimumCount: 'Mínimo exigido',
  requiredCount: 'Mínimo exigido',
  avgResolutionDays: 'Tempo médio de resolução (dias)',
  breachedCount: 'Fora do prazo',
};

/** Palavras dos nomes de campo (inglês/português técnico) → português para a tela. */
const WORDS: Record<string, string> = {
  open: 'em aberto',
  requests: 'pedidos',
  request: 'pedido',
  overdue: 'vencidos',
  total: 'total',
  received: 'recebido',
  pending: 'pendentes',
  expected: 'esperado',
  scheduled: 'agendadas',
  awaiting: 'aguardando',
  material: 'material',
  rework: 'retrabalho',
  stalled: 'paradas',
  breached: 'fora do prazo',
  tickets: 'chamados',
  ticket: 'chamado',
  plants: 'usinas',
  plant: 'usina',
  clients: 'clientes',
  leads: 'leads',
  lead: 'lead',
  contracts: 'contratos',
  proposals: 'propostas',
  projects: 'projetos',
  project: 'projeto',
  code: 'código',
  days: 'dias',
  day: 'dia',
  status: 'situação',
  priority: 'prioridade',
  value: 'valor',
  margin: 'margem',
  costs: 'custos',
  cost: 'custo',
  commissions: 'comissões',
  sample: 'amostra',
  minimum: 'mínimo',
  required: 'mínimo',
  average: 'média',
  avg: 'média',
  resolution: 'resolução',
  rate: 'taxa',
  win: 'ganho',
  overall: 'geral',
  oldest: 'mais antigos',
  issues: 'pendências',
  urgent: 'urgentes',
  unassigned: 'sem responsável',
  signed: 'assinados',
  sent: 'enviadas',
  viewed: 'visualizadas',
  accepted: 'aceitas',
  stage: 'etapa',
  owner: 'responsável',
  power: 'potência',
  generation: 'geração',
  month: 'mês',
  expiring: 'a vencer',
  warranties: 'garantias',
  missing: 'sem termo',
  mrr: 'receita recorrente',
  streak: 'sequência de',
  version: 'versão',
  versions: 'versões',
  review: 'revisão',
  tasks: 'tarefas',
  list: 'listados',
  listed: 'listados',
  with: 'com',
  without: 'sem',
  task: 'tarefa',
  movement: 'movimento',
  by: 'por',
  at: 'em',
  in: 'em',
  of: 'de',
};
const UNIT_WORDS = new Set(['count', 'cents', 'pct', 'rate', 'kwh', 'kwp']);
/** Trechos de caminho em português (`porPrioridade`, `maisAntigos`). */
const SEGMENTS: Record<string, string> = {
  porPrioridade: 'Por prioridade',
  porSituacao: 'Por situação',
  maisAntigos: 'Mais antigos',
  chamadosPorUsina: 'Chamados por usina',
  primeirasSemanas: 'Próximas semanas',
  meses: 'Por mês',
  equipes: 'Equipes',
  parcelas: 'Parcelas',
  custos: 'Custos',
  baixaPorStatus: 'Por situação',
  count: 'Quantidade',
  projectCode: 'Projeto',
};

function humanize(name: string): string {
  if (SEGMENTS[name]) return SEGMENTS[name];
  const tokens = name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(' ')
    .filter(Boolean);
  // Unidades no fim ("...Count", "...Cents") não entram no nome; "dias" no fim repetido com o do começo, também não.
  while (tokens.length > 1 && UNIT_WORDS.has(tokens[tokens.length - 1] as string)) tokens.pop();
  if (
    tokens.length > 1 &&
    tokens[tokens.length - 1] === 'days' &&
    (tokens.slice(0, -1).includes('days') || tokens.includes('dias'))
  )
    tokens.pop();
  const text = tokens.map((t) => WORDS[t] ?? t).join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Nome legível do campo de uma consulta: `receivedLast30DaysCents` → "Recebido nos últimos 30 dias";
 * `maisAntigos[0].daysOpenDays` → "Mais antigos (1º) · Dias em aberto".
 */
export function fieldLabel(path: string): string {
  const segments = path.split('.');
  const last = (segments[segments.length - 1] ?? path).replace(/\[\d+\]/g, '');
  const hasIndex = /\[\d+\]/.test(path);
  if (!hasIndex && FIELD_LABELS[last]) return FIELD_LABELS[last];
  const named = segments.filter((seg) => seg !== 'meta' && seg !== 'insufficient');
  return named
    .map((seg, i) => {
      const name = seg.replace(/\[\d+\]/g, '');
      const idx = /\[(\d+)\]/.exec(seg)?.[1];
      const text = i === named.length - 1 ? (FIELD_LABELS[name] ?? humanize(name)) : humanize(name);
      return idx !== undefined ? `${text} (${Number(idx) + 1}º)` : text;
    })
    .join(' · ');
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
