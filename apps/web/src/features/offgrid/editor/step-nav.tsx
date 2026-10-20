import { Check, AlertTriangle } from 'lucide-react';
import { OFFGRID_DESIGN_PARAMETERS, type OffgridDesign, type OffgridResults } from '@voltex/shared';
import { OFFGRID_PROVISIONAL_PARAMETERS } from '@voltex/solar-engine';
import { Badge, Button } from '@voltex/ui';

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
      <div className="overflow-x-auto pb-1">
        <ol className="grid min-w-[64rem] grid-flow-col auto-cols-fr">
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
              <li key={step.id} className="relative flex flex-col items-center px-1 text-center">
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
      </div>
      <p className="text-xs text-muted-foreground">
        Pode abrir qualquer etapa, em qualquer ordem. <strong>Obrigatórias</strong>: local, cargas,
        arranjo, baterias e controlador/inversor. As <strong>opcionais</strong> (tracejadas) têm
        valores padrão ou servem só para conferir.
      </p>
    </nav>
  );
}

const RULE_CODE = 'RULE_PARAMETERS_MISSING';

/**
 * Pendências em duas partes: o que **falta preencher** (cada linha leva à etapa) e o aviso da **regra de projeto**, que
 * não é tarefa de quem desenha (só trava o envio até o responsável técnico ativá-la).
 */
export function PendingPanel({
  results,
  onGo,
}: {
  results: OffgridResults;
  onGo: (id: StepId) => void;
}) {
  const rule = results.pending.find((p) => p.code === RULE_CODE);
  const todo = results.pending.filter((p) => p.code !== RULE_CODE);
  if (!rule && todo.length === 0) return null;
  const missing = rule?.message.match(/não traz: (.+?)\. Foram/)?.[1]?.split(', ') ?? [];
  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_20rem]">
      {todo.length > 0 ? (
        <section
          className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:bg-amber-950/30"
          aria-label="O que falta preencher"
        >
          <h3 className="mb-2 text-sm font-semibold">O que falta preencher ({todo.length})</h3>
          <ul className="divide-y divide-amber-200/70 text-sm" aria-label="Pendências do projeto">
            {todo.map((p) => {
              const target = stepForPending(p.code);
              const meta = STEP_META.find((m) => m.id === target);
              return (
                <li key={p.code} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="flex min-w-0 items-center gap-2">
                    {meta ? <Badge variant="yellow">{meta.label}</Badge> : null}
                    <span>{p.message}</span>
                  </span>
                  {target ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0"
                      onClick={() => onGo(target)}
                    >
                      Abrir etapa
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      {rule ? (
        <section
          className="rounded-lg border bg-muted/50 p-3 text-sm"
          aria-label="Regra de projeto"
        >
          <h3 className="mb-1 font-semibold">Regra de projeto não ativada</h3>
          <p className="text-muted-foreground">
            Os cálculos usam valores provisórios. Só impede <strong>enviar para revisão</strong>: o
            responsável técnico ativa a regra <em>offgrid.design</em> em Administração → Regras.
          </p>
          {missing.length > 0 ? (
            <details className="mt-3 text-xs">
              <summary className="cursor-pointer text-muted-foreground">
                Ver os {missing.length} parâmetros e os valores provisórios
              </summary>
              <ul
                className="mt-2 max-h-72 divide-y overflow-y-auto rounded border bg-background"
                aria-label="Parâmetros da regra"
              >
                {missing.map((key) => (
                  <li key={key} className="flex items-start justify-between gap-3 px-2 py-1.5">
                    <span className="min-w-0">
                      <span className="block font-medium text-foreground">
                        {OFFGRID_DESIGN_PARAMETERS[key as keyof typeof OFFGRID_DESIGN_PARAMETERS] ??
                          key}
                      </span>
                      <code className="text-[0.65rem] text-muted-foreground">{key}</code>
                    </span>
                    <span
                      className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-foreground"
                      title="Valor provisório em uso"
                    >
                      {OFFGRID_PROVISIONAL_PARAMETERS[
                        key as keyof typeof OFFGRID_PROVISIONAL_PARAMETERS
                      ] ?? '—'}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
