import { addDays, dayMs, daysBetween, insufficient, isoDay, type Forecast } from './common.js';

/** Caminho normal de uma instalação. `FIELD_ISSUE` é desvio e usa a posição de `IN_PROGRESS`. */
export const INSTALLATION_PATH = [
  'AWAITING_ENGINEERING',
  'AWAITING_MATERIAL',
  'MATERIAL_READY',
  'SCHEDULING',
  'CREW_ASSIGNED',
  'IN_PROGRESS',
  'INSTALLED',
  'COMMISSIONING',
  'CUSTOMER_ACCEPTANCE',
] as const;

export type DurationsByStatus = Partial<Record<string, number>>;

export interface CurrentInstallation {
  id: string;
  status: string;
  /** Quando entrou na situação atual (`YYYY-MM-DD` ou ISO). */
  enteredAt: string;
}

export interface InstallationEta {
  id: string;
  status: string;
  daysInStatus: number;
  /** Já passou do tempo médio que as concluídas ficaram nesta situação. */
  atRisk: boolean;
  /** `YYYY-MM-DD` */
  estimatedDoneOn: string;
  /** Situações do restante do caminho sem nenhum histórico (contadas como zero). */
  missingStatuses: string[];
}

export interface InstallationForecast {
  averageDaysByStatus: Record<string, number>;
  installations: InstallationEta[];
}

const position = (status: string): number => {
  const normalized = status === 'FIELD_ISSUE' ? 'IN_PROGRESS' : status;
  return INSTALLATION_PATH.indexOf(normalized as (typeof INSTALLATION_PATH)[number]);
};

/**
 * Atraso de instalação: tempo médio que as instalações concluídas ficaram em cada situação × situação atual. A data
 * provável soma o que falta na situação atual (média − já decorrido, no mínimo zero) e a média das seguintes.
 */
export function forecastInstallations(input: {
  done: readonly DurationsByStatus[];
  current: readonly CurrentInstallation[];
  today: string;
  minDone: number;
}): Forecast<InstallationForecast> {
  if (input.done.length < input.minDone) return insufficient(input.done.length, input.minDone);
  const today = dayMs(input.today);
  const sums = new Map<string, { total: number; n: number }>();
  for (const durations of input.done)
    for (const [status, days] of Object.entries(durations))
      if (typeof days === 'number') {
        const cur = sums.get(status) ?? { total: 0, n: 0 };
        cur.total += days;
        cur.n += 1;
        sums.set(status, cur);
      }
  const average = (status: string): number | null => {
    const s = sums.get(status);
    return s ? s.total / s.n : null;
  };

  const installations: InstallationEta[] = input.current.flatMap((c) => {
    const at = position(c.status);
    if (at < 0) return [];
    const statusAvg = average(c.status === 'FIELD_ISSUE' ? 'FIELD_ISSUE' : c.status);
    const elapsed = Math.max(0, daysBetween(dayMs(c.enteredAt), today));
    let remaining = statusAvg === null ? 0 : Math.max(0, statusAvg - elapsed);
    const missing: string[] = statusAvg === null ? [c.status] : [];
    for (const next of INSTALLATION_PATH.slice(at + 1)) {
      const avg = average(next);
      if (avg === null) missing.push(next);
      else remaining += avg;
    }
    return [
      {
        id: c.id,
        status: c.status,
        daysInStatus: elapsed,
        atRisk: statusAvg !== null && elapsed > statusAvg,
        estimatedDoneOn: isoDay(addDays(today, Math.ceil(remaining))),
        missingStatuses: missing,
      },
    ];
  });

  return {
    status: 'OK',
    sample: input.done.length,
    required: input.minDone,
    averageDaysByStatus: Object.fromEntries(
      [...sums.entries()].map(([status, s]) => [status, Math.round((s.total / s.n) * 10) / 10]),
    ),
    installations,
  };
}
