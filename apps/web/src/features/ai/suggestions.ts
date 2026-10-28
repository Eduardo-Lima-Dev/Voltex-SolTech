/** Sugestões de pergunta por tela: só assuntos que as ferramentas de leitura do assistente cobrem. */
const BY_SCREEN: Array<{ prefix: string; screen: string; questions: string[] }> = [
  {
    prefix: '/operations/financeiro',
    screen: 'financeiro',
    questions: [
      'Quanto recebi nos últimos 30 dias?',
      'Quais parcelas estão vencidas?',
      'Qual é a margem real dos projetos?',
    ],
  },
  {
    prefix: '/operations',
    screen: 'operacao',
    questions: [
      'Quais instalações estão atrasadas?',
      'Quais garantias vencem em breve?',
      'Quantos chamados estão abertos?',
    ],
  },
  {
    prefix: '/crm',
    screen: 'funil',
    questions: [
      'Como está o meu funil de vendas?',
      'Quais oportunidades estão paradas?',
      'Quais são as principais causas de perda?',
    ],
  },
];

const GENERIC = [
  'Como está o meu funil de vendas?',
  'Quanto recebi nos últimos 30 dias?',
  'Quais projetos estão atrasados?',
];

export function suggestionsFor(pathname: string): {
  screen: string | undefined;
  questions: string[];
} {
  const found = BY_SCREEN.find((item) => pathname.startsWith(item.prefix));
  return found
    ? { screen: found.screen, questions: found.questions }
    : { screen: undefined, questions: GENERIC };
}
