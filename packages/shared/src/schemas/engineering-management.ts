import { z } from 'zod';
import { ENGINEERING_REQUEST_STATUSES } from './engineering.js';

/**
 * Gestão do pedido e do projeto de engenharia (9K). Fluxo do livro EnergIF 2023 (EF-R01, R05, R09, R10): levantamento
 * e análise de carga → dimensionamento → projeto executivo (ART/TRT) → documentos da solicitação de acesso →
 * vistoria. Nada aqui decide regra normativa: prazos e listas de documentos são dado versionado.
 */

export type EngineeringRequestStatus = (typeof ENGINEERING_REQUEST_STATUSES)[number];

export const REQUEST_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export type RequestPriority = (typeof REQUEST_PRIORITIES)[number];

/** Para onde cada estado pode ir. `DONE` normalmente vem da aprovação do projeto; aqui também pode ser manual na revisão. */
export const REQUEST_TRANSITIONS: Record<
  EngineeringRequestStatus,
  readonly EngineeringRequestStatus[]
> = {
  PENDING: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['WAITING_VISIT', 'WAITING_INFO', 'IN_REVIEW', 'CANCELLED'],
  WAITING_VISIT: ['IN_PROGRESS', 'CANCELLED'],
  WAITING_INFO: ['IN_PROGRESS', 'CANCELLED'],
  IN_REVIEW: ['IN_PROGRESS', 'DONE', 'CANCELLED'],
  DONE: [],
  CANCELLED: [],
};

export const changeRequestStatusSchema = z.object({
  status: z.enum(ENGINEERING_REQUEST_STATUSES),
  /** Obrigatória ao aguardar visita/informação, cancelar ou concluir à mão. */
  note: z.string().trim().max(500).optional(),
});
export type ChangeRequestStatusInput = z.infer<typeof changeRequestStatusSchema>;

export const requestCommentSchema = z.object({ text: z.string().trim().min(2).max(2000) });
export type RequestCommentInput = z.infer<typeof requestCommentSchema>;

/** Pergunta da engenharia ao responsável pela oportunidade (vendedor): vira tarefa no CRM e o pedido fica aguardando. */
export const requestInfoSchema = z.object({
  question: z.string().trim().min(5).max(1000),
});
export type RequestInfoInput = z.infer<typeof requestInfoSchema>;

export const updateRequestPlanSchema = z.object({
  priority: z.enum(REQUEST_PRIORITIES).optional(),
  /** `null` remove o prazo. */
  dueAt: z.iso.datetime().nullable().optional(),
});
export type UpdateRequestPlanInput = z.infer<typeof updateRequestPlanSchema>;

export const reassignRequestSchema = z.object({ userId: z.uuid() });

// ---------------------------------------------------------------------------------------------------------
// Ficha do projeto
// ---------------------------------------------------------------------------------------------------------

export const ART_TYPES = ['ART', 'TRT', 'RRT'] as const;
export const COUNCIL_TYPES = ['CREA', 'CFT', 'CAU'] as const;

/** Campos que identificam quem assina o projeto; sem todos eles a versão não pode ser aprovada. */
export const SIGNATORY_FIELD_LABELS = {
  signatoryName: 'nome do profissional',
  councilType: 'conselho (CREA/CFT/CAU)',
  councilRegistration: 'registro no conselho',
  councilState: 'UF do registro',
  artType: 'tipo da responsabilidade técnica (ART/TRT/RRT)',
  artNumber: 'número da ART/TRT/RRT',
} as const;
export type SignatoryField = keyof typeof SIGNATORY_FIELD_LABELS;

/** Lista (em ordem) o que falta para o signatário estar completo. */
export const signatoryMissing = (
  profile: Partial<Record<SignatoryField, string | null | undefined>>,
): SignatoryField[] =>
  (Object.keys(SIGNATORY_FIELD_LABELS) as SignatoryField[]).filter(
    (field) => !profile[field]?.toString().trim(),
  );

export const updateProjectProfileSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  siteId: z.uuid().nullable().optional(),
  consumerUnitId: z.uuid().nullable().optional(),
  distributorId: z.uuid().nullable().optional(),
  targetKwp: z.number().positive().max(100_000).nullable().optional(),
  artType: z.enum(ART_TYPES).nullable().optional(),
  artNumber: z.string().trim().min(3).max(60).nullable().optional(),
  councilRegistration: z.string().trim().min(3).max(60).nullable().optional(),
  signatoryName: z.string().trim().min(3).max(160).nullable().optional(),
  councilType: z.enum(COUNCIL_TYPES).nullable().optional(),
  councilState: z.string().trim().length(2).toUpperCase().nullable().optional(),
  artIssuedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  responsibleId: z.uuid().nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});
export type UpdateProjectProfileInput = z.infer<typeof updateProjectProfileSchema>;

export type ProjectGenerationClass = 'MICRO' | 'MINI' | 'PLANT';

/** Classe pela potência (EnergIF EF-M06: micro ≤ 75 kW; mini > 75 kW e ≤ 5 MW; usina acima). A regulação pode mudar: confirmar. */
export const generationClassOf = (kwp: number): ProjectGenerationClass =>
  kwp <= 75 ? 'MICRO' : kwp <= 5000 ? 'MINI' : 'PLANT';

// ---------------------------------------------------------------------------------------------------------
// Levantamento do local (visita técnica)
// ---------------------------------------------------------------------------------------------------------

const optionalNumber = (min: number, max: number) => z.number().min(min).max(max).optional();
const idSchema = z.string().trim().min(1).max(40);

export const SUPPLY_TYPES = ['MONO', 'BI', 'TRI'] as const;
export const ROOF_TYPES = ['CERAMIC', 'METAL', 'FIBROCEMENT', 'SLAB', 'GROUND', 'OTHER'] as const;
export const CONDITIONS = ['GOOD', 'FAIR', 'POOR'] as const;

export const surveySchema = z.object({
  visitedAt: z.iso.date().optional(),
  visitedBy: z.string().trim().max(120).optional(),
  /** Entrada de energia: o que a distribuidora fornece e o padrão existente. */
  supply: z
    .object({
      type: z.enum(SUPPLY_TYPES).optional(),
      /** Tensões medidas na entrada (V). */
      lineVoltageV: optionalNumber(50, 1000),
      phaseVoltageV: optionalNumber(50, 600),
      breakerA: optionalNumber(1, 2000),
      meterNumber: z.string().trim().max(40).optional(),
      condition: z.enum(CONDITIONS).optional(),
      notes: z.string().trim().max(500).optional(),
    })
    .default({}),
  grounding: z
    .object({
      exists: z.boolean().optional(),
      adequate: z.boolean().nullable().optional(),
      resistanceOhm: optionalNumber(0, 10_000),
      notes: z.string().trim().max(500).optional(),
    })
    .default({}),
  roof: z
    .object({
      type: z.enum(ROOF_TYPES).optional(),
      condition: z.enum(CONDITIONS).optional(),
      usableAreaM2: optionalNumber(0.1, 100_000),
      buildingHeightM: optionalNumber(0, 300),
      tiltDegrees: optionalNumber(0, 90),
      azimuthDegrees: z.number().min(0).lt(360).optional(),
      structureNotes: z.string().trim().max(500).optional(),
      accessNotes: z.string().trim().max(500).optional(),
    })
    .default({}),
  obstacles: z
    .array(
      z.object({
        id: idSchema,
        description: z.string().trim().min(1).max(160),
        heightM: optionalNumber(0, 300),
        distanceM: optionalNumber(0, 500),
        azimuthDegrees: z.number().min(0).lt(360).optional(),
      }),
    )
    .max(50)
    .default([]),
  /** Cargas relevantes (para a análise de carga além da fatura). */
  loads: z
    .array(
      z.object({
        id: idSchema,
        name: z.string().trim().min(1).max(120),
        powerW: z.number().min(1).max(10_000_000),
        quantity: z.number().int().min(1).max(10_000).default(1),
        hoursPerDay: z.number().min(0).max(24),
        daysPerMonth: z.number().int().min(1).max(31).default(30),
      }),
    )
    .max(100)
    .default([]),
  /** Adequações necessárias no padrão de entrada (troca de disjuntor, aterramento...). */
  adequacies: z
    .array(
      z.object({
        id: idSchema,
        description: z.string().trim().min(2).max(200),
        done: z.boolean().default(false),
      }),
    )
    .max(30)
    .default([]),
  /** Fotos e documentos do levantamento (documentos da plataforma). */
  photoDocumentIds: z.array(z.uuid()).max(60).default([]),
  notes: z.string().trim().max(2000).optional(),
});
export type SurveyData = z.output<typeof surveySchema>;
export type SurveyInput = z.input<typeof surveySchema>;

export const saveSurveySchema = z.object({ data: surveySchema });

/** O que falta para o levantamento poder ser concluído. */
export function surveyMissing(data: SurveyData): string[] {
  const missing: string[] = [];
  if (!data.visitedAt) missing.push('Data da visita');
  if (!data.supply.type) missing.push('Tipo de fornecimento');
  if (data.supply.breakerA === undefined) missing.push('Disjuntor geral (A)');
  if (data.grounding.exists === undefined) missing.push('Existência de aterramento');
  if (!data.roof.type) missing.push('Tipo de telhado ou local de instalação');
  if (data.roof.usableAreaM2 === undefined) missing.push('Área útil (m²)');
  return missing;
}

/** Consumo mensal (kWh) de uma carga: potência × quantidade × horas × dias. */
export const loadMonthlyKwh = (l: SurveyData['loads'][number]): number =>
  (l.powerW * l.quantity * l.hoursPerDay * l.daysPerMonth) / 1000;

export const updateDocumentItemSchema = z.object({
  status: z.enum(['PENDING', 'READY', 'NOT_APPLICABLE']).optional(),
  documentId: z.uuid().nullable().optional(),
  note: z.string().trim().max(300).nullable().optional(),
});
export type UpdateDocumentItemInput = z.infer<typeof updateDocumentItemSchema>;
