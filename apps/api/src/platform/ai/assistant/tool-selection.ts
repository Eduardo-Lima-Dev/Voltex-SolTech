import type { AiToolSpec } from '../ai-provider';
import { foldKeepLength } from '../privacy/mentions';

/**
 * Escolhe quais ferramentas mostrar ao modelo para esta pergunta. Descrever as 36 ferramentas em toda chamada
 * gastaria milhares de tokens (e a cota grátis); por palavra-chave, ficam as mais prováveis (e o glossário).
 * Erro aqui não vaza nada: só pode esconder uma ferramenta, e o modelo então diz que não tem como consultar.
 */
const SYNONYMS: Record<string, string[]> = {
  vencid: ['recebiveis_vencidos', 'financeiro_visao', 'clientes_risco'],
  inadimpl: ['recebiveis_vencidos', 'financeiro_visao', 'clientes_risco'],
  parcela: ['recebiveis_vencidos', 'financeiro_projeto'],
  receb: ['financeiro_visao', 'financeiro_projeto', 'recebiveis_vencidos'],
  financeir: ['financeiro_visao', 'financeiro_projeto', 'recebiveis_vencidos', 'comissoes_resumo'],
  margem: ['clientes_ranking', 'financeiro_projeto', 'cotacoes_margens', 'oportunidade_detalhe'],
  comiss: ['comissoes_resumo', 'financeiro_projeto'],
  lead: ['leads_resumo', 'leads_buscar', 'clientes_potencial'],
  funil: ['funil_resumo', 'oportunidades_paradas', 'painel_comercial'],
  conversao: ['funil_resumo', 'leads_resumo', 'painel_comercial'],
  convers: ['funil_resumo', 'leads_resumo', 'painel_comercial'],
  parad: ['oportunidades_paradas'],
  travad: ['oportunidades_paradas', 'funil_resumo'],
  oportunid: ['oportunidade_detalhe', 'oportunidades_paradas', 'funil_resumo'],
  perd: ['funil_resumo', 'painel_comercial'],
  vend: ['funil_resumo', 'painel_comercial', 'contratos_resumo'],
  proposta: ['propostas_resumo', 'oportunidade_detalhe'],
  contrato: ['contratos_resumo'],
  cotac: ['cotacoes_margens'],
  projeto: ['projetos_resumo', 'oportunidade_detalhe', 'financeiro_projeto', 'planta_desempenho'],
  homolog: ['projetos_resumo'],
  fatura: ['faturas_resumo'],
  tarefa: ['tarefas_resumo'],
  cliente: ['clientes_ranking', 'cliente_perfil', 'clientes_risco', 'clientes_potencial'],
  melhor: ['clientes_ranking', 'clientes_potencial', 'funil_resumo'],
  pior: ['clientes_ranking', 'clientes_risco'],
  potencial: ['clientes_potencial'],
  engenharia: ['engenharia_painel', 'offgrid_painel'],
  offgrid: ['offgrid_painel'],
  calcul: ['calculos_resumo'],
  instala: ['operacao_painel', 'instalacoes_buscar', 'agenda_resumo'],
  agenda: ['agenda_resumo'],
  equipe: ['operacao_painel', 'agenda_resumo'],
  campo: ['pendencias_campo', 'agenda_resumo', 'operacao_painel'],
  pendenc: ['pendencias_campo'],
  comissionament: ['comissionamento_resumo'],
  usina: ['posvenda_painel', 'planta_desempenho', 'chamados_resumo'],
  gera: ['planta_desempenho'],
  desempenho: ['planta_desempenho'],
  monitor: ['planta_desempenho'],
  chamado: ['chamados_resumo', 'posvenda_painel'],
  garantia: ['garantias_resumo'],
  'o&m': ['om_contratos'],
  manutenc: ['om_contratos', 'chamados_resumo'],
  catalogo: ['catalogo_buscar'],
  equipamento: ['catalogo_buscar'],
  inversor: ['catalogo_buscar'],
  modulo: ['catalogo_buscar'],
  regra: ['regras_ativas'],
  'o que': ['glossario'],
  significa: ['glossario'],
  explique: ['glossario'],
  pos: ['posvenda_painel'],
  previs: [
    'previsoes_recebimentos',
    'previsoes_funil',
    'previsoes_instalacoes',
    'previsoes_geracao',
  ],
  projec: ['previsoes_recebimentos', 'previsoes_funil', 'previsoes_geracao'],
  'vai receber': ['previsoes_recebimentos'],
  'vou receber': ['previsoes_recebimentos'],
  fechar: ['previsoes_funil'],
  fechamento: ['previsoes_funil'],
  atras: ['previsoes_instalacoes', 'recebiveis_vencidos'],
  conclus: ['previsoes_instalacoes'],
};

/** Ferramentas que valem como padrão quando a pergunta não bate com nenhuma palavra-chave. */
const DEFAULTS = [
  'leads_resumo',
  'funil_resumo',
  'oportunidades_paradas',
  'clientes_ranking',
  'financeiro_visao',
  'posvenda_painel',
];

export function selectTools(question: string, specs: readonly AiToolSpec[], max = 8): AiToolSpec[] {
  const text = foldKeepLength(question);
  const available = new Map(specs.map((s) => [s.name, s]));
  const score = new Map<string, number>();
  for (const [key, tools] of Object.entries(SYNONYMS)) {
    if (!text.includes(foldKeepLength(key))) continue;
    for (const name of tools) if (available.has(name)) score.set(name, (score.get(name) ?? 0) + 1);
  }
  // Nome exato de ferramenta na pergunta, ou palavras da descrição, também contam um pouco.
  for (const spec of specs)
    for (const word of foldKeepLength(spec.name).split('_'))
      if (word.length >= 5 && text.includes(word))
        score.set(spec.name, (score.get(spec.name) ?? 0) + 0.5);
  const ranked = [...score.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
  const chosen = ranked.length ? ranked : DEFAULTS.filter((n) => available.has(n));
  const names = [
    ...new Set([...chosen.slice(0, max), ...(available.has('glossario') ? ['glossario'] : [])]),
  ];
  return names.map((n) => available.get(n)!).filter(Boolean);
}
