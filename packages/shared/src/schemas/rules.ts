import { z } from 'zod';
import { AlertSeverity, CustomerGroup, ProjectType } from '../enums/index.js';
import {
  CALCULATOR_RULESET_KEY,
  calculatorRulesDefinitionSchema,
  ruleSourceSchema,
} from './calculator.js';
import { isoDateTimeSchema } from './common.js';

// ---------------------------------------------------------------------------------------------------------
// Avaliador de condições (ENG-F26, ADR-0016): regras como dado, sem código
// ---------------------------------------------------------------------------------------------------------

export const CONDITION_OPERATORS = [
  '=',
  '!=',
  '>',
  '>=',
  '<',
  '<=',
  'in',
  'between',
  'exists',
] as const;
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

const scalarSchema = z.union([z.string(), z.number(), z.boolean()]);

/** Comparação de um campo do contexto (caminho com pontos, ex.: `connection.phases`). */
export const predicateSchema = z
  .object({
    field: z.string().trim().min(1).max(120),
    op: z.enum(CONDITION_OPERATORS),
    /** Valor fixo. `in` recebe lista; `between` recebe `[mín, máx]` (inclusivo); `exists` recebe booleano (padrão `true`). */
    value: z.union([scalarSchema, z.array(scalarSchema)]).optional(),
    /** Em vez de `value`, compara com outro campo do contexto (ex.: potência instalada × potência disponibilizada). */
    valueFrom: z.string().trim().min(1).max(120).optional(),
  })
  .refine((p) => p.op === 'exists' || p.value !== undefined || p.valueFrom !== undefined, {
    message: 'Informe `value` ou `valueFrom`',
  })
  .refine((p) => p.value === undefined || p.valueFrom === undefined, {
    message: 'Use `value` ou `valueFrom`, não os dois',
  })
  .refine((p) => p.op !== 'in' || p.valueFrom !== undefined || Array.isArray(p.value), {
    message: '`in` exige uma lista',
  })
  .refine(
    (p) =>
      p.op !== 'between' ||
      p.valueFrom !== undefined ||
      (Array.isArray(p.value) &&
        p.value.length === 2 &&
        p.value.every((v) => typeof v === 'number')),
    { message: '`between` exige `[mín, máx]` numéricos' },
  );
export type Predicate = z.infer<typeof predicateSchema>;

export type Condition =
  Predicate | { all: Condition[] } | { any: Condition[] } | { not: Condition };

export const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    predicateSchema,
    z.object({ all: z.array(conditionSchema).min(1) }),
    z.object({ any: z.array(conditionSchema).min(1) }),
    z.object({ not: conditionSchema }),
  ]),
);

/** Saída de uma regra que disparou. */
export const ruleOutcomeSchema = z.object({
  severity: z.enum(AlertSeverity),
  /** Código estável (ex.: `CONN_EXPORT_LIMIT_REQUIRED`). */
  code: z.string().trim().min(3).max(80),
  message: z.string().trim().min(3).max(400),
  /** De onde vem a exigência (norma da distribuidora, resolução...). Obrigatória: regra sem fonte não dispara. */
  source: z.string().trim().min(3).max(300),
});
export type RuleOutcome = z.infer<typeof ruleOutcomeSchema>;

export const conditionalRuleSchema = z.object({
  id: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).optional(),
  when: conditionSchema,
  then: ruleOutcomeSchema,
});
export type ConditionalRule = z.infer<typeof conditionalRuleSchema>;

// ---------------------------------------------------------------------------------------------------------
// Registro de chaves de regra
// ---------------------------------------------------------------------------------------------------------

export const ENGINE_RULESET_KEYS = [
  'engine.design',
  'engine.cables',
  'engine.transposition',
  'engine.connection',
  'engine.economics',
] as const;
export const RULESET_KEYS = [CALCULATOR_RULESET_KEY, ...ENGINE_RULESET_KEYS] as const;
export type RuleSetKey = (typeof RULESET_KEYS)[number];

const tableRowSchema = z.record(z.string(), z.union([z.number(), z.string(), z.null()]));

/**
 * Definição das regras do Engine: parâmetros numéricos (fatores, limites), tabelas versionadas (ex.: capacidade de
 * condução de cabos) e regras condicionais. **Sem valores padrão**: fator normativo sem regra ativa e revisada
 * não existe, e o cálculo que depende dele fica "pendente" (trava da aprovação, ADR-0016).
 */
export const engineRulesDefinitionSchema = z.object({
  parameters: z.record(z.string().min(1).max(80), z.number()).default({}),
  tables: z.record(z.string().min(1).max(80), z.array(tableRowSchema).max(2000)).default({}),
  rules: z.array(conditionalRuleSchema).max(500).default([]),
});
export type EngineRulesDefinition = z.output<typeof engineRulesDefinitionSchema>;

export interface RuleSetDefinition {
  key: RuleSetKey;
  label: string;
  schema: z.ZodType;
  /** Aceita escopo (distribuidora, estado, tipo de projeto, grupo)? */
  scoped: boolean;
}

export const RULESET_DEFINITIONS: Record<RuleSetKey, RuleSetDefinition> = {
  'calculator.rules': {
    key: 'calculator.rules',
    label: 'Solar Calculator: limites e custo de disponibilidade',
    schema: calculatorRulesDefinitionSchema,
    scoped: false,
  },
  'engine.design': {
    key: 'engine.design',
    label: 'Engine: fatores de projeto, proteções e limites de compatibilidade',
    schema: engineRulesDefinitionSchema,
    scoped: true,
  },
  'engine.cables': {
    key: 'engine.cables',
    label: 'Engine: capacidade de condução e queda de tensão de cabos',
    schema: engineRulesDefinitionSchema,
    scoped: true,
  },
  'engine.transposition': {
    key: 'engine.transposition',
    label: 'Engine: transposição e decomposição da irradiação',
    schema: engineRulesDefinitionSchema,
    scoped: false,
  },
  'engine.connection': {
    key: 'engine.connection',
    label: 'Engine: exigências de conexão por distribuidora',
    schema: engineRulesDefinitionSchema,
    scoped: true,
  },
  'engine.economics': {
    key: 'engine.economics',
    label: 'Engine: premissas econômicas e compensação (Fio B)',
    schema: engineRulesDefinitionSchema,
    scoped: true,
  },
};

export const isRuleSetKey = (key: string): key is RuleSetKey =>
  Object.prototype.hasOwnProperty.call(RULESET_DEFINITIONS, key);

// ---------------------------------------------------------------------------------------------------------
// Escopo: a regra mais específica que casa com o contexto vence
// ---------------------------------------------------------------------------------------------------------

export const ruleScopeSchema = z.object({
  distributorId: z.uuid().optional(),
  state: z.string().trim().length(2).toUpperCase().optional(),
  projectType: z.enum(ProjectType).optional(),
  customerGroup: z.enum(CustomerGroup).optional(),
});
export type RuleScope = z.infer<typeof ruleScopeSchema>;

const SCOPE_FIELDS = ['customerGroup', 'distributorId', 'projectType', 'state'] as const;

/** Chave canônica do escopo (vazia = regra geral). Usada no índice único "uma ativa por chave e escopo". */
export function ruleScopeKey(scope: RuleScope | null | undefined): string {
  if (!scope) return '';
  return SCOPE_FIELDS.filter((f) => scope[f] !== undefined)
    .map((f) => `${f}=${scope[f]}`)
    .join('|');
}

/** Quantos campos o escopo fixa (0 = geral). Quanto maior, mais específico. */
export const ruleScopeSpecificity = (scope: RuleScope | null | undefined): number =>
  scope ? SCOPE_FIELDS.filter((f) => scope[f] !== undefined).length : 0;

/** O escopo da regra casa com o contexto quando todo campo que ele fixa é igual ao do contexto. */
export function ruleScopeMatches(
  ruleScope: RuleScope | null | undefined,
  context: RuleScope,
): boolean {
  if (!ruleScope) return true;
  return SCOPE_FIELDS.every((f) => ruleScope[f] === undefined || ruleScope[f] === context[f]);
}

// ---------------------------------------------------------------------------------------------------------
// Criação e ativação
// ---------------------------------------------------------------------------------------------------------

export const createRuleSetSchema = z
  .object({
    key: z.enum(RULESET_KEYS).default(CALCULATOR_RULESET_KEY),
    definition: z.unknown(),
    scope: ruleScopeSchema.optional(),
    sources: z.array(ruleSourceSchema).min(1, 'Informe ao menos uma fonte'),
    validFrom: isoDateTimeSchema.optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .superRefine((value, ctx) => {
    const def = RULESET_DEFINITIONS[value.key];
    const parsed = def.schema.safeParse(value.definition ?? {});
    if (!parsed.success) {
      for (const issue of parsed.error.issues)
        ctx.addIssue({
          code: 'custom',
          path: ['definition', ...issue.path],
          message: issue.message,
        });
    }
    if (value.scope && ruleScopeSpecificity(value.scope) > 0 && !def.scoped) {
      ctx.addIssue({
        code: 'custom',
        path: ['scope'],
        message: `A chave ${value.key} não aceita escopo`,
      });
    }
  });
export type CreateRuleSetInput = z.input<typeof createRuleSetSchema>;
/** Corpo já validado (datas convertidas em `Date`). */
export type CreateRuleSetData = z.output<typeof createRuleSetSchema>;

export const activateRuleSetSchema = z.object({
  /** Responsável técnico pela revisão da regra (obrigatório para ativar). */
  reviewedBy: z.string().trim().min(3).max(160),
  /** Registro no conselho (CREA/CFT/CAU) de quem revisou. Obrigatório nas regras do Engine (`engine.*`). */
  reviewedByRegistration: z.string().trim().min(3).max(60).optional(),
});
export type ActivateRuleSetInput = z.infer<typeof activateRuleSetSchema>;

export const effectiveRuleQuerySchema = ruleScopeSchema.extend({
  key: z.string().trim().optional(),
});
export type EffectiveRuleQuery = z.infer<typeof effectiveRuleQuerySchema>;
