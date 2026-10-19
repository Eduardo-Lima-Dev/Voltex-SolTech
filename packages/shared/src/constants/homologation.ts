import { z } from 'zod';
import type { GenerationClass } from '../enums/index.js';

/**
 * Checklist de homologação (solicitação de acesso à distribuidora): **dado versionado com fonte**, nunca regra
 * embutida no código de negócio. O conjunto-base vem do livro EnergIF 2023 (EF-R04, EF-R05, EF-R06) e é uma
 * lista de **2023**: o conjunto vigente depende da distribuidora. Cada empresa pode publicar uma versão própria
 * (padrão da empresa ou por distribuidora), com fonte obrigatória e, de preferência, revisão do responsável técnico.
 */

/** Quando o item vale: sempre ou só para um tipo de geração. */
export const checklistConditionSchema = z.enum(['ALWAYS', 'MINI_GENERATION_ONLY']);
export type ChecklistCondition = z.infer<typeof checklistConditionSchema>;

export const checklistItemRuleSchema = z.object({
  /** Código estável (ex.: `SINGLE_LINE`); identifica o item entre versões. */
  code: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[A-Z0-9_]+$/, 'Use letras maiúsculas, números e _'),
  title: z.string().trim().min(2).max(160),
  description: z.string().trim().max(400).optional(),
  required: z.boolean(),
  condition: checklistConditionSchema.default('ALWAYS'),
  /** De onde vem a exigência (ex.: `EnergIF 2023, EF-R04 a`). */
  source: z.string().trim().min(2).max(200),
});
export type ChecklistItemRule = z.infer<typeof checklistItemRuleSchema>;
export type ChecklistItemRuleInput = z.input<typeof checklistItemRuleSchema>;

/** Prazo **sugerido** (nunca imposto pelo sistema): a data efetiva é informada por quem acompanha o processo. */
export const checklistDeadlineSchema = z.object({
  code: z.enum(['ACCESS_OPINION', 'INSPECTION', 'POST_APPROVAL_EXECUTION']),
  label: z.string().trim().min(2).max(120),
  days: z.number().int().min(1).max(730),
  source: z.string().trim().min(2).max(200),
});
export type ChecklistDeadline = z.infer<typeof checklistDeadlineSchema>;

export interface HomologationRules {
  /** Identificador legível: `energif-2023@1` (base) ou `empresa@3` / `distribuidora:<id>@2`. */
  ref: string;
  version: number;
  scope: 'BUILT_IN' | 'TENANT' | 'DISTRIBUTOR';
  source: string;
  /** Nome de quem revisou/validou o conjunto; `null` = ainda sem revisão. */
  reviewedBy: string | null;
  notes: string | null;
  items: ChecklistItemRule[];
  deadlines: ChecklistDeadline[];
}

const EF_R04 = 'EnergIF 2023, EF-R04 (p. 121 e 123)';
const EF_R06 = 'EnergIF 2023, EF-R06 (p. 123)';

/**
 * Base EnergIF 2023. **Não é a lista vigente de nenhuma distribuidora em particular**: confirme com a
 * concessionária e publique a versão própria quando houver fonte atual.
 */
export const BUILT_IN_HOMOLOGATION_RULES: HomologationRules = {
  ref: 'energif-2023@1',
  version: 1,
  scope: 'BUILT_IN',
  source: 'EnergIF — Energia Fotovoltaica vol. 3 (2023): EF-R03 a EF-R06',
  reviewedBy: null,
  notes:
    'Lista de 2023. O conjunto vigente de documentos e os prazos dependem da distribuidora e da regulação atual: confirme antes de protocolar. As atribuições de prazo do livro são ambíguas (EF-I06).',
  items: [
    {
      code: 'FORM',
      title: 'Formulário de solicitação de acesso',
      required: true,
      condition: 'ALWAYS',
      source: `${EF_R04}, a`,
    },
    {
      code: 'ART_TRT',
      title: 'ART ou TRT do projeto de execução',
      required: true,
      condition: 'ALWAYS',
      source: `${EF_R04}, b`,
    },
    {
      code: 'SINGLE_LINE',
      title: 'Diagrama unifilar',
      required: true,
      condition: 'ALWAYS',
      source: `${EF_R04}, c`,
    },
    {
      code: 'INVERTER_CERT',
      title: 'Certificado do inversor',
      required: true,
      condition: 'ALWAYS',
      source: `${EF_R04}, d`,
    },
    {
      code: 'POWER_OF_ATTORNEY',
      title: 'Procuração',
      required: true,
      condition: 'ALWAYS',
      source: `${EF_R04}, e`,
    },
    {
      code: 'MEMORIAL',
      title: 'Memorial descritivo',
      required: true,
      condition: 'ALWAYS',
      source: `${EF_R04}, f`,
    },
    {
      code: 'SCHEDULE',
      title: 'Cronograma de implantação',
      description: 'Exigido somente para minigeração.',
      required: true,
      condition: 'MINI_GENERATION_ONLY',
      source: `${EF_R04}, g`,
    },
    {
      code: 'CREDIT_UCS',
      title: 'Unidades consumidoras participantes do rateio de créditos',
      description: 'Se houver rateio de créditos entre unidades.',
      required: false,
      condition: 'ALWAYS',
      source: `${EF_R04}, h`,
    },
    {
      code: 'PROTECTIONS_SPEC',
      title: 'Especificação das proteções',
      required: false,
      condition: 'ALWAYS',
      source: `${EF_R04} (PRODIST módulo 3) — confirmar com a distribuidora`,
    },
    {
      code: 'UC_LOCATION',
      title: 'Localização da unidade consumidora',
      required: false,
      condition: 'ALWAYS',
      source: `${EF_R04} (PRODIST módulo 3) — confirmar com a distribuidora`,
    },
    {
      code: 'SOURCE_TYPE',
      title: 'Tipo de fonte de geração',
      required: false,
      condition: 'ALWAYS',
      source: `${EF_R04} (Grupo Equatorial, 2022) — confirmar com a distribuidora`,
    },
  ],
  deadlines: [
    {
      code: 'ACCESS_OPINION',
      label: 'Parecer de acesso da distribuidora',
      days: 60,
      source: `${EF_R06}: parecer em até 60 dias (ANEEL, 2023)`,
    },
    {
      code: 'INSPECTION',
      label: 'Vistoria da distribuidora',
      days: 7,
      source: `${EF_R06}: vistoria em 7 dias corridos`,
    },
    {
      code: 'POST_APPROVAL_EXECUTION',
      label: 'Executar a instalação e solicitar a vistoria',
      days: 120,
      source: `${EF_R06}: 120 dias após a homologação, senão repete o passo 6`,
    },
  ],
};

/** Itens que valem para o projeto: aplica a condição de geração (cronograma só na minigeração). */
export function applicableChecklistItems(
  rules: Pick<HomologationRules, 'items'>,
  generationClass: GenerationClass | null,
): { item: ChecklistItemRule; applicable: boolean }[] {
  return rules.items.map((item) => ({
    item,
    // Sem a classe conhecida o item condicional entra como aplicável: melhor sobrar um documento do que faltar.
    applicable:
      item.condition === 'ALWAYS' || generationClass === null || generationClass === 'MINI',
  }));
}
