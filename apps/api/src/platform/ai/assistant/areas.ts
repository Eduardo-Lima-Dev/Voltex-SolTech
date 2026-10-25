import type { RequestUser } from '../../../common/context/request-user';
import type { AiToolRegistry } from '../tools/tool-registry.service';

interface AreaRule {
  /** Trecho da pergunta que indica o assunto. */
  pattern: RegExp;
  /** Áreas (das ferramentas) que respondem a esse assunto. */
  areas: readonly string[];
  /** Como o assunto é chamado na recusa. */
  label: string;
}

const RULES: readonly AreaRule[] = [
  {
    pattern:
      /financeir|parcela|vencid|inadimpl|receb[ií]|comiss|margem real|custos? d[eo] projeto/i,
    areas: ['financeiro', 'comissões'],
    label: 'aos dados financeiros',
  },
  {
    pattern: /engenharia|projeto t[ée]cnico|\bengine\b|off-?grid/i,
    areas: ['engenharia', 'projetos off-grid'],
    label: 'aos dados de engenharia',
  },
  {
    pattern: /instala[cç]|agenda|equipe de campo|comissionament|pend[eê]ncias? de campo/i,
    areas: ['operação e instalações', 'agenda de campo', 'pendências de campo', 'comissionamento'],
    label: 'aos dados de operação e instalação',
  },
  {
    pattern: /usina|chamado|garantia|o&m|monitoramento|p[óo]s-venda/i,
    areas: ['pós-venda', 'chamados', 'garantias', 'contratos de O&M', 'monitoramento das usinas'],
    label: 'aos dados de pós-venda e das usinas',
  },
];

/**
 * Pergunta sobre um assunto para o qual o perfil NÃO tem nenhuma ferramenta: o sistema recusa na hora, sem chamar o
 * modelo (nem gastar cota). Devolve o texto fixo da recusa, ou `null` se pode seguir.
 */
export function accessDeniedAnswer(
  question: string,
  user: RequestUser,
  registry: AiToolRegistry,
): string | null {
  const offered = new Set(registry.specsFor(user).map((s) => s.name));
  const toolAreas = (area: string) => registry.all().filter((t) => t.area === area);
  for (const rule of RULES) {
    if (!rule.pattern.test(question)) continue;
    const hasAny = rule.areas.some((area) => toolAreas(area).some((t) => offered.has(t.name)));
    if (!hasAny) return `Não posso responder: o seu perfil não tem acesso ${rule.label}.`;
  }
  return null;
}
