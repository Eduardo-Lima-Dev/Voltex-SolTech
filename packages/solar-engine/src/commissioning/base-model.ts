import {
  commissioningRulesDefinitionSchema,
  type CommissioningRulesDefinition,
} from '@voltex/shared';

/**
 * Modelo-base de ensaios, **provisório**. Traz só a ESTRUTURA do comissionamento descrita no livro EnergIF 2023
 * (p. 193–196, que resume a NBR 16274:2014), **sem nenhuma tolerância ou limite**: o livro não os traz e a norma é
 * paga. Enquanto o responsável técnico não ativar uma regra `ops.commissioning` revisada, os ensaios podem ser
 * registrados, mas os resultados medidos ficam "sem regra para julgar" e a aprovação fica travada.
 */
export const COMMISSIONING_BASE_REF = 'base-energif-2023@1';
export const COMMISSIONING_BASE_NOTE =
  'Modelo-base provisório: a lista de ensaios segue o livro EnergIF 2023 (p. 193–196, resumo da NBR 16274:2014). Não há tolerâncias nem limites: o responsável técnico define a regra para julgar e aprovar. Norma e livro não foram revistos por engenheiro.';

const CAT1 = 'Categoria 1: ensaios de todos os sistemas';
const CAT2 = 'Categoria 2: ensaios expandidos (sistemas maiores ou mais complexos)';
const EXTRA = 'Ensaios adicionais (opcionais)';
const STARTUP = 'Start-up do inversor';
const GRID = 'Conexão com a rede';

const book = (page: string, extra = ''): string =>
  `EnergIF 2023, p. ${page} (NBR 16274:2014)${extra}`;

export const COMMISSIONING_BASE_DEFINITION: CommissioningRulesDefinition =
  commissioningRulesDefinitionSchema.parse({
    tests: [
      {
        code: 'GROUND_CONTINUITY',
        label: 'Continuidade da ligação à terra e/ou da equipotencialização dos condutores',
        group: CAT1,
        kind: 'CHECK',
        source: book('194'),
      },
      {
        code: 'POLARITY',
        label: 'Polaridade da string',
        group: CAT1,
        kind: 'CHECK',
        scope: 'STRING',
        source: book('194'),
      },
      {
        code: 'JUNCTION_BOXES',
        label: 'Caixas de junção: inspeção e conexões',
        group: CAT1,
        kind: 'CHECK',
        source: book('194'),
      },
      {
        code: 'STRING_ISC',
        label: 'Ensaio de curto-circuito da string (Isc)',
        group: CAT1,
        kind: 'MEASURE',
        scope: 'STRING',
        unit: 'A',
        expected: 'ISC_STRING',
        source: book('194', ': "ensaio de curto-circuito"'),
      },
      {
        code: 'STRING_VOC',
        label: 'Tensão de circuito aberto da string (Voc)',
        group: CAT1,
        kind: 'MEASURE',
        scope: 'STRING',
        unit: 'V',
        expected: 'VOC_STRING',
        source:
          'Par do ensaio de Isc, incluído pelo sistema. O livro (p. 194) diz "dentre outras especificadas na norma": conferir na NBR 16274:2014',
      },
      {
        code: 'STRING_IV_CURVE',
        label: 'Curva I×V da string conforme o esperado',
        group: CAT2,
        kind: 'CHECK',
        level: 'EXTENDED',
        scope: 'STRING',
        source: book('194', ': "ensaios de curva IxV das séries"'),
      },
      {
        code: 'INFRARED_INSPECTION',
        label: 'Inspeção com câmera infravermelha',
        group: CAT2,
        kind: 'CHECK',
        level: 'EXTENDED',
        source: book('194', ': "inspeção com câmera infravermelha"'),
      },
      {
        code: 'GROUND_RESISTANCE',
        label: 'Resistência do aterramento',
        group: EXTRA,
        kind: 'MEASURE',
        unit: 'Ω',
        required: false,
        source: book('194', ': "análise do aterramento resistivo"'),
      },
      {
        code: 'BLOCKING_DIODE',
        label: 'Diodo de bloqueio',
        group: EXTRA,
        kind: 'CHECK',
        scope: 'STRING',
        required: false,
        source: book('194', ': "ensaio do diodo de bloqueio"'),
      },
      {
        code: 'WET_INSULATION_RESISTANCE',
        label: 'Resistência de isolamento úmido',
        group: EXTRA,
        kind: 'MEASURE',
        scope: 'STRING',
        unit: 'MΩ',
        required: false,
        source: book('194', ': "resistência de isolamento úmido"'),
      },
      {
        code: 'SHADING_ASSESSMENT',
        label: 'Avaliação do sombreamento',
        group: EXTRA,
        kind: 'CHECK',
        required: false,
        source: book('194', ': "avaliação do sombreamento"'),
      },
      ...(
        [
          ['STARTUP_AC_CONNECTION', 'Conexão CA correta', 'Komeco (2022), citada na p. 194'],
          [
            'STARTUP_MODULES_CONNECTED',
            'Todos os módulos solares conectados corretamente ao inversor',
            'Komeco (2022), citada na p. 194',
          ],
          [
            'STARTUP_TIGHTENING',
            'Todos os parafusos e conectores apertados e conectados',
            'Komeco (2022), citada na p. 194',
          ],
          ['STARTUP_AC_BREAKER', 'Disjuntor CA acionado', 'Komeco (2022), citada na p. 194'],
          [
            'STARTUP_DC_SWITCH',
            'Chave seccionadora CC acionada',
            'Komeco (2022), citada na p. 194',
          ],
          [
            'STARTUP_MIN_VOLTAGE',
            'Tensão mínima gerada pelos módulos presente',
            'Komeco (2022), citada na p. 194',
          ],
          [
            'INVERTER_PARAMETERS',
            'Parâmetros do inversor conferidos com o projeto',
            'Modelagem §8.16; o procedimento depende do fabricante (EnergIF p. 195)',
          ],
          [
            'INVERTER_GENERATING',
            'Inversor passou a gerar depois do tempo de inicialização do fabricante',
            'Ginlong (2022), citada nas p. 194–195: 30 a 300 s conforme o requisito local',
          ],
        ] as const
      ).map(([code, label, source]) => ({
        code,
        label,
        group: STARTUP,
        kind: 'CHECK' as const,
        scope: 'INVERTER' as const,
        source,
      })),
      {
        code: 'GRID_CONNECTION',
        label: 'Conexão com a rede conferida (diagrama elétrico e medidor)',
        group: GRID,
        kind: 'CHECK',
        source: 'EnergIF 2023, p. 195–196: depende do fabricante e do modelo do inversor',
      },
    ],
  });
