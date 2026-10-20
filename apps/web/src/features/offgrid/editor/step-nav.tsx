import { Check, AlertTriangle } from 'lucide-react';
import type { OffgridDesign, OffgridResults } from '@voltex/shared';

export type StepId =
  | 'local'
  | 'cargas'
  | 'premissas'
  | 'arranjo'
  | 'banco'
  | 'conversao'
  | 'gerador'
  | 'diagrama'
  | 'visual'
  | 'simulacao'
  | 'cenarios';

export type StepState = 'done' | 'todo' | 'optional' | 'problem';

export interface StepMeta {
  id: StepId;
  label: string;
  /** Obrigatória para o projeto ficar completo. As demais podem ser puladas. */
  required: boolean;
  /** Explicação curta mostrada sob a etapa. */
  hint: string;
}

export const STEP_META: readonly StepMeta[] = [
  { id: 'local', label: 'Local e clima', required: true, hint: 'onde fica e quanto sol tem' },
  { id: 'cargas', label: 'Cargas', required: true, hint: 'o que será ligado' },
  {
    id: 'premissas',
    label: 'Premissas e dimensionamento',
    required: false,
    hint: 'já vem preenchida',
  },
  { id: 'arranjo', label: 'Arranjo FV', required: true, hint: 'módulos solares' },
  { id: 'banco', label: 'Baterias', required: true, hint: 'banco de baterias' },
  {
    id: 'conversao',
    label: 'Controlador e inversor',
    required: true,
    hint: 'conversão de energia',
  },
  { id: 'gerador', label: 'Gerador e rede', required: false, hint: 'só se houver apoio' },
  { id: 'diagrama', label: 'Diagrama do sistema', required: false, hint: 'só para visualizar' },
  { id: 'visual', label: 'Terreno 2D/3D', required: false, hint: 'desenho e cabos' },
  { id: 'simulacao', label: 'Simulação e estresse', required: false, hint: 'só para conferir' },
  { id: 'cenarios', label: 'Cenários e custo', required: false, hint: 'comparar alternativas' },
];

const has = (results: OffgridResults, ...codes: string[]) =>
  results.pending.some((p) => codes.includes(p.code));
const failing = (results: OffgridResults, ...prefixes: string[]) =>
  results.checks.some((c) => c.severity === 'ERROR' && prefixes.some((p) => c.code.startsWith(p)));

/** Situação de cada etapa a partir do que já foi preenchido e do cálculo. */
export function stepStates(
  design: OffgridDesign,
  results: OffgridResults,
): Record<StepId, StepState> {
  const required = (todo: boolean, problem: boolean): StepState =>
    problem ? 'problem' : todo ? 'todo' : 'done';
  return {
    local: required(has(results, 'NO_SOLAR_RESOURCE', 'DESIGN_TMIN_MISSING'), false),
    cargas: required(has(results, 'NO_LOADS'), false),
    premissas: 'optional',
    arranjo: required(
      has(results, 'NO_ARRAYS', 'MODULE_NOT_SELECTED'),
      failing(results, 'VOC_', 'VMPP_', 'ARRAY_BELOW', 'PWM_'),
    ),
    banco: required(has(results, 'BATTERY_NOT_SELECTED'), failing(results, 'BANK_', 'AUTONOMY')),
    conversao: required(
      has(results, 'CONTROLLER_NOT_SELECTED', 'INVERTER_NOT_SELECTED'),
      failing(results, 'CONTROLLER_', 'INVERTER_'),
    ),
    gerador: failing(results, 'GENERATOR_')
      ? 'problem'
      : design.generator.enabled
        ? 'done'
        : 'optional',
    diagrama: 'optional',
    visual: design.layout.elements.length > 0 ? 'done' : 'optional',
    simulacao: results.simulation ? 'done' : 'optional',
    cenarios: design.scenarios.length > 0 ? 'done' : 'optional',
  };
}

/** Etapa que resolve cada pendência (para o botão "ir"). */
export function stepForPending(code: string): StepId | null {
  if (code === 'NO_SOLAR_RESOURCE' || code === 'DESIGN_TMIN_MISSING') return 'local';
  if (code === 'NO_LOADS') return 'cargas';
  if (code === 'NO_ARRAYS' || code === 'MODULE_NOT_SELECTED' || code === 'MODULE_NOT_FOUND')
    return 'arranjo';
  if (code === 'BATTERY_NOT_SELECTED') return 'banco';
  if (code === 'CONTROLLER_NOT_SELECTED' || code === 'INVERTER_NOT_SELECTED') return 'conversao';
  if (code === 'GENERATOR_NOT_SELECTED') return 'gerador';
  return null;
}

const CAPTION: Record<StepState, string> = {
  done: 'feita',
  todo: 'pendente',
  optional: 'opcional',
  problem: 'com erro',
};

/**
 * Trilha de etapas: numeradas e ligadas em sequência, mas **qualquer uma pode ser aberta a qualquer momento**. Etapa
 * obrigatória pendente aparece em destaque; as opcionais dizem que são opcionais.
 */
export function StepNav({
  current,
  states,
  onSelect,
}: {
  current: StepId;
  states: Record<StepId, StepState>;
  onSelect: (id: StepId) => void;
}) {
  return (
    <nav aria-label="Etapas do projeto" className="space-y-2">
      <ol className="flex flex-wrap gap-y-4">
        {STEP_META.map((step, index) => {
          const state = states[step.id];
          const active = step.id === current;
          const circle =
            state === 'done'
              ? 'border-emerald-600 bg-emerald-600 text-white'
              : state === 'problem'
                ? 'border-red-600 bg-red-600 text-white'
                : state === 'todo'
                  ? 'border-amber-500 bg-amber-100 text-amber-900'
                  : 'border-border bg-background text-muted-foreground border-dashed';
          return (
            <li
              key={step.id}
              className="relative flex min-w-[6.5rem] flex-1 basis-[6.5rem] flex-col items-center px-1 text-center"
            >
              {index < STEP_META.length - 1 ? (
                <span
                  aria-hidden
                  className="absolute top-4 left-1/2 hidden h-0.5 w-full bg-border sm:block"
                />
              ) : null}
              <button
                type="button"
                aria-current={active ? 'step' : undefined}
                aria-label={`${index + 1}. ${step.label} (${CAPTION[state]}${step.required ? ', obrigatória' : ''})`}
                title={step.required ? 'Etapa obrigatória' : 'Etapa opcional: você pode pular'}
                onClick={() => onSelect(step.id)}
                className="group relative z-10 flex flex-col items-center gap-1 rounded-md p-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span
                  className={`flex size-8 items-center justify-center rounded-full border-2 text-sm font-semibold ${circle} ${
                    active ? 'ring-2 ring-primary ring-offset-2' : ''
                  }`}
                >
                  {state === 'done' ? (
                    <Check className="size-4" />
                  ) : state === 'problem' ? (
                    <AlertTriangle className="size-4" />
                  ) : (
                    index + 1
                  )}
                </span>
                <span
                  className={`text-xs leading-tight ${active ? 'font-semibold text-foreground' : 'text-muted-foreground group-hover:text-foreground'}`}
                >
                  {step.label}
                </span>
                <span
                  className={`text-[0.65rem] leading-none ${
                    state === 'todo'
                      ? 'font-medium text-amber-700'
                      : state === 'problem'
                        ? 'font-medium text-red-700'
                        : 'text-muted-foreground'
                  }`}
                >
                  {state === 'done'
                    ? 'feita'
                    : state === 'optional'
                      ? 'opcional'
                      : state === 'problem'
                        ? 'com erro'
                        : 'obrigatória'}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <p className="text-xs text-muted-foreground">
        Pode abrir qualquer etapa, em qualquer ordem. <strong>Obrigatórias</strong>: local, cargas,
        arranjo, baterias e controlador/inversor. As <strong>opcionais</strong> (tracejadas) têm
        valores padrão ou servem só para conferir.
      </p>
    </nav>
  );
}
