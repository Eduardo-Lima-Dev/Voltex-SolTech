import { describe, expect, it } from 'vitest';
import {
  commissioningRulesDefinitionSchema,
  engineeringDesignSchema,
  type CommissioningRulesDefinition,
} from '@voltex/shared';
import { COMMISSIONING_BASE_DEFINITION, COMMISSIONING_BASE_REF } from './base-model.js';
import { generateTests } from './generate.js';
import { resolveCommissioningModel, testsForLevel } from './model.js';
import { approvalBlockers, summarize } from './summary.js';
import { commissioningSubjects, moduleElectrical } from './subjects.js';

const moduleSpec = { vocV: 40, iscA: 10, betaVocPctPerC: -0.3, alphaIscPctPerC: 0.05 };

const design = engineeringDesignSchema.parse({
  site: { latitude: -15.79, longitude: -47.88 },
  defaultModuleId: '00000000-0000-4000-8000-000000000001',
  surfaces: [
    { id: 's1', name: 'Água norte', azimuthDegrees: 0, tiltDegrees: 20, widthM: 10, depthM: 5 },
    {
      id: 's2',
      name: 'Água leste',
      azimuthDegrees: 90,
      tiltDegrees: 20,
      widthM: 10,
      depthM: 5,
      moduleId: '00000000-0000-4000-8000-000000000002',
    },
  ],
  inverters: [
    {
      id: 'i1',
      inverterId: '00000000-0000-4000-8000-0000000000a1',
      name: 'Sala técnica',
      mppts: [
        { strings: [{ id: 'g1', surfaceId: 's1', modulesInSeries: 10, parallel: 2 }] },
        { strings: [{ id: 'g2', surfaceId: 's2', modulesInSeries: 8, parallel: 1 }] },
      ],
    },
    {
      id: 'i2',
      inverterId: '00000000-0000-4000-8000-0000000000a2',
      mppts: [],
      micro: { surfaceId: 's1', units: 6, modulesPerUnit: 2 },
    },
  ],
});

const equipment = [
  { id: '00000000-0000-4000-8000-000000000001', kind: 'MODULE', spec: moduleSpec },
  // Módulo da água leste sem coeficiente de corrente: não dá para calcular o esperado.
  {
    id: '00000000-0000-4000-8000-000000000002',
    kind: 'MODULE',
    spec: { vocV: 40, iscA: 10, betaVocPctPerC: -0.3 },
  },
];

describe('modelo-base de ensaios', () => {
  it('é válido para o esquema da regra e NÃO traz nenhuma tolerância nem limite', () => {
    expect(() =>
      commissioningRulesDefinitionSchema.parse(COMMISSIONING_BASE_DEFINITION),
    ).not.toThrow();
    for (const t of COMMISSIONING_BASE_DEFINITION.tests) {
      expect(t.tolerancePct).toBeUndefined();
      expect(t.min).toBeUndefined();
      expect(t.max).toBeUndefined();
      expect(t.source.length).toBeGreaterThan(5);
    }
  });

  it('cobre o que o livro descreve: categoria 1, categoria 2, adicionais e o start-up do inversor', () => {
    const codes = COMMISSIONING_BASE_DEFINITION.tests.map((t) => t.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        'GROUND_CONTINUITY',
        'POLARITY',
        'JUNCTION_BOXES',
        'STRING_ISC',
        'STRING_IV_CURVE',
        'INFRARED_INSPECTION',
        'GROUND_RESISTANCE',
        'BLOCKING_DIODE',
        'WET_INSULATION_RESISTANCE',
        'SHADING_ASSESSMENT',
        'STARTUP_AC_CONNECTION',
        'STARTUP_DC_SWITCH',
        'INVERTER_GENERATING',
        'GRID_CONNECTION',
      ]),
    );
    expect(new Set(codes).size).toBe(codes.length);
    // Os ensaios adicionais não são obrigatórios; os demais, sim.
    for (const t of COMMISSIONING_BASE_DEFINITION.tests)
      expect(t.required).toBe(t.group !== 'Ensaios adicionais (opcionais)');
  });

  it('sem regra ativa o modelo é o provisório; com regra, o da regra', () => {
    const base = resolveCommissioningModel(null);
    expect(base).toMatchObject({ ref: COMMISSIONING_BASE_REF, provisional: true });
    expect(base.note).toMatch(/provisório/);
    const rule: CommissioningRulesDefinition = commissioningRulesDefinitionSchema.parse({
      tests: [
        { code: 'ONE', label: 'Um ensaio', group: 'Grupo A', kind: 'CHECK', source: 'Regra do RT' },
      ],
    });
    expect(resolveCommissioningModel({ ref: 'r1@2', definition: rule })).toMatchObject({
      ref: 'r1@2',
      provisional: false,
      note: null,
    });
  });

  it('a categoria 2 só entra no nível ampliado', () => {
    const standard = testsForLevel(COMMISSIONING_BASE_DEFINITION, 'STANDARD').map((t) => t.code);
    const extended = testsForLevel(COMMISSIONING_BASE_DEFINITION, 'EXTENDED').map((t) => t.code);
    expect(standard).not.toContain('STRING_IV_CURVE');
    expect(standard).not.toContain('INFRARED_INSPECTION');
    expect(extended).toContain('STRING_IV_CURVE');
    expect(extended).toContain('INFRARED_INSPECTION');
    expect(extended.length).toBeGreaterThan(standard.length);
  });
});

describe('esquema da regra de comissionamento', () => {
  const row = (o: Record<string, unknown> = {}) => ({
    code: 'T1',
    label: 'Ensaio um',
    group: 'Grupo A',
    kind: 'MEASURE',
    unit: 'V',
    source: 'Regra do RT',
    ...o,
  });
  const parse = (tests: unknown[]) => commissioningRulesDefinitionSchema.safeParse({ tests });

  it('exige fonte, unidade na medição e código no formato', () => {
    expect(parse([row()]).success).toBe(true);
    expect(parse([row({ source: '' })]).success).toBe(false);
    expect(parse([row({ unit: undefined })]).success).toBe(false);
    expect(parse([row({ code: 'minusculo' })]).success).toBe(false);
  });

  it('recusa incoerências: tolerância sem esperado, limite em conferência, mínimo acima do máximo, esperado fora de string', () => {
    expect(parse([row({ tolerancePct: 5 })]).success).toBe(false);
    expect(parse([row({ kind: 'CHECK', unit: undefined, min: 1 })]).success).toBe(false);
    expect(parse([row({ min: 5, max: 1 })]).success).toBe(false);
    expect(parse([row({ expected: 'VOC_STRING', tolerancePct: 3 })]).success).toBe(false); // escopo SYSTEM
    expect(parse([row({ expected: 'VOC_STRING', scope: 'STRING', tolerancePct: 3 })]).success).toBe(
      true,
    );
  });

  it('não aceita código repetido nem lista vazia', () => {
    expect(parse([row(), row()]).success).toBe(false);
    expect(parse([]).success).toBe(false);
  });
});

describe('alvos do projeto técnico', () => {
  it('uma linha por string (paralelo vira .1, .2), com os dados elétricos do módulo certo, e um alvo por inversor', () => {
    const s = commissioningSubjects(design, equipment);
    expect(s.strings.map((x) => x.label)).toEqual([
      'Inversor 1 (Sala técnica) · MPPT 1 · string 1.1',
      'Inversor 1 (Sala técnica) · MPPT 1 · string 1.2',
      'Inversor 1 (Sala técnica) · MPPT 2 · string 1',
    ]);
    expect(s.strings[0]!.electrical).toEqual({
      modulesInSeries: 10,
      vocStcV: 40,
      iscStcA: 10,
      betaVocPctPerC: -0.3,
      alphaIscPctPerC: 0.05,
    });
    // A água leste usa um módulo sem α: sem dados elétricos completos.
    expect(s.strings[2]!.electrical).toBeUndefined();
    expect(s.notes).toHaveLength(1);
    expect(s.notes[0]).toMatch(/MPPT 2/);
    expect(s.inverters.map((x) => x.label)).toEqual([
      'Inversor 1 (Sala técnica)',
      'Inversor 2: 6 microinversor(es)',
    ]);
    expect(new Set(s.strings.map((x) => x.key)).size).toBe(3);
  });

  it('ficha de módulo incompleta ou inválida não gera dados elétricos', () => {
    expect(moduleElectrical(null, 10)).toBeNull();
    expect(moduleElectrical('x', 10)).toBeNull();
    expect(moduleElectrical({ vocV: 40, iscA: 10, betaVocPctPerC: -0.3 }, 10)).toBeNull();
    expect(
      moduleElectrical({ vocV: '40', iscA: 10, betaVocPctPerC: -0.3, alphaIscPctPerC: 0.05 }, 10),
    ).toBeNull();
    expect(moduleElectrical(moduleSpec, 12)).toMatchObject({ modulesInSeries: 12 });
  });

  it('sem módulo no equipamento, a string existe mas sem dados elétricos', () => {
    const s = commissioningSubjects(design, []);
    expect(s.strings).toHaveLength(3);
    expect(s.strings.every((x) => x.electrical === undefined)).toBe(true);
  });
});

describe('geração dos ensaios', () => {
  const subjects = commissioningSubjects(design, equipment);

  it('um ensaio por sistema, por string e por inversor, na ordem do modelo', () => {
    const { tests, skipped } = generateTests(COMMISSIONING_BASE_DEFINITION, 'STANDARD', subjects);
    expect(skipped).toEqual([]);
    const count = (code: string) => tests.filter((t) => t.code === code).length;
    expect(count('GROUND_CONTINUITY')).toBe(1);
    expect(count('STRING_ISC')).toBe(3);
    expect(count('POLARITY')).toBe(3);
    expect(count('STARTUP_AC_BREAKER')).toBe(2);
    expect(tests[0]!.code).toBe('GROUND_CONTINUITY');
    const isc = tests.find((t) => t.code === 'STRING_ISC')!;
    expect(isc).toMatchObject({
      expected: 'ISC_STRING',
      unit: 'A',
      kind: 'MEASURE',
      subjectLabel: 'Inversor 1 (Sala técnica) · MPPT 1 · string 1.1',
    });
    expect(isc.electrical).not.toBeNull();
    // Nenhum limite inventado.
    expect(tests.every((t) => t.tolerancePct === null && t.min === null && t.max === null)).toBe(
      true,
    );
  });

  it('o nível ampliado acrescenta a curva I×V por string e a inspeção infravermelha', () => {
    const standard = generateTests(COMMISSIONING_BASE_DEFINITION, 'STANDARD', subjects).tests;
    const extended = generateTests(COMMISSIONING_BASE_DEFINITION, 'EXTENDED', subjects).tests;
    expect(extended.length - standard.length).toBe(3 + 1);
  });

  it('sem strings ou inversores, os ensaios por string e por inversor são pulados e o motivo aparece', () => {
    const none = generateTests(COMMISSIONING_BASE_DEFINITION, 'STANDARD', {
      strings: [],
      inverters: [],
    });
    expect(none.tests.every((t) => t.scope === 'SYSTEM')).toBe(true);
    expect(none.skipped.find((s) => s.code === 'STRING_ISC')?.reason).toMatch(/strings/);
    expect(none.skipped.find((s) => s.code === 'STARTUP_AC_BREAKER')?.reason).toMatch(/inversores/);
  });

  it('a regra do responsável técnico traz tolerância e a geração a respeita', () => {
    const rule = commissioningRulesDefinitionSchema.parse({
      tests: [
        {
          code: 'STRING_ISC',
          label: 'Isc da string',
          group: 'Grupo A',
          kind: 'MEASURE',
          scope: 'STRING',
          unit: 'A',
          expected: 'ISC_STRING',
          tolerancePct: 5,
          source: 'Regra do RT',
        },
      ],
    });
    const { tests } = generateTests(rule, 'STANDARD', subjects);
    expect(tests).toHaveLength(3);
    expect(tests.every((t) => t.tolerancePct === 5)).toBe(true);
  });
});

describe('resumo e travas da aprovação', () => {
  const t = (result: Parameters<typeof summarize>[0][number]['result'], required = true) => ({
    result,
    required,
  });

  it('conta por resultado e separa obrigatórios sem registro', () => {
    const s = summarize([
      t('PASS'),
      t('PASS'),
      t('FAIL'),
      t('PENDING'),
      t('PENDING', false),
      t('PENDING_RULE'),
      t('PENDING_DATA'),
      t('NOT_APPLICABLE'),
    ]);
    expect(s).toMatchObject({ total: 8, requiredPending: 1, failed: 1, unjudged: 2 });
    expect(s.counts.PASS).toBe(2);
  });

  it('só libera quando tudo passou, nada ficou sem juízo e a regra não é provisória', () => {
    expect(
      approvalBlockers([t('PASS'), t('NOT_APPLICABLE'), t('PENDING', false)], {
        provisional: false,
      }),
    ).toEqual([]);
    expect(approvalBlockers([t('PASS')], { provisional: true })[0]).toMatch(/provisório/);
    const blockers = approvalBlockers([t('FAIL'), t('PENDING'), t('PENDING_RULE'), t('PASS')], {
      provisional: false,
    });
    expect(blockers).toHaveLength(3);
    expect(blockers.join(' ')).toMatch(/obrigatório/);
    expect(blockers.join(' ')).toMatch(/reprovado/);
    expect(blockers.join(' ')).toMatch(/não consegue julgar/);
    expect(approvalBlockers([], { provisional: false })).toEqual(['Nenhum ensaio foi gerado.']);
  });
});
