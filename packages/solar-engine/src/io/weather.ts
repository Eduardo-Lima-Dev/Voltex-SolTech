import { DAYS_IN_MONTH, roundTo } from '../units/index.js';

/**
 * Leitores puros (sem rede) das respostas do NASA POWER e do PVGIS. Recebem o JSON já baixado e devolvem uma
 * forma normalizada, ou lançam `WeatherParseError` com o motivo (resposta mudou, dado faltando, plano inesperado).
 * Quem baixa e guarda é a Central de Dados Externos (`platform/data-hub`). Memorial: `docs/07-desenvolvimento/central-de-dados.md`.
 */
export const WEATHER_IO_VERSION = 'weather-io-1.0.0';

export class WeatherParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WeatherParseError';
  }
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export interface MonthlyClimate {
  latitude: number;
  longitude: number;
  elevationM: number | null;
  /** Irradiação global horizontal média (kWh/m²·dia), jan a dez. */
  ghiKwhM2Day: number[];
  tempMeanC: number[];
  /** Mínima e máxima mensais conforme a fonte. **Não são, por si, a temperatura de projeto**: ver `docs/06-calculos/engine-compatibilidade.md`. */
  tempMinC: number[];
  tempMaxC: number[];
}

/** Série horária normalizada, uma posição por hora a partir de `startAt`. `null` = hora sem dado. */
export interface HourlySeries {
  /** Início da série (ISO 8601). Para o PVGIS é UTC; para o NASA POWER é hora solar local (LST) da fonte. */
  startAt: string;
  timeStandard: 'UTC' | 'LST';
  /** Irradiação em Wh/m² na hora, no plano horizontal. */
  ghiWhM2: (number | null)[];
  dhiWhM2: (number | null)[];
  tempC: (number | null)[];
  missingHours: number;
}

export interface HorizonProfile {
  latitude: number;
  longitude: number;
  elevationM: number | null;
  /** Azimute (° do norte, horário) e altura do horizonte (°), em ordem crescente de azimute. */
  points: { azimuthDegrees: number; heightDegrees: number }[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function record(value: unknown, what: string): Record<string, unknown> {
  if (!isRecord(value)) throw new WeatherParseError(`Resposta sem ${what}`);
  return value;
}

const FILL = -999;

function monthly(parameter: Record<string, unknown>, name: string): number[] {
  const series = record(parameter[name], `o parâmetro ${name}`);
  return MONTHS.map((month) => {
    const value = series[month];
    if (typeof value !== 'number' || value === FILL || !Number.isFinite(value))
      throw new WeatherParseError(`${name}: mês ${month} sem dado`);
    return value;
  });
}

/** NASA POWER, `temporal/climatology/point` com `ALLSKY_SFC_SW_DWN`, `T2M`, `T2M_MIN`, `T2M_MAX`. */
export function parseNasaPowerClimatology(json: unknown): MonthlyClimate {
  const root = record(json, 'objeto');
  const geometry = record(root.geometry, 'geometry');
  const coordinates = geometry.coordinates;
  if (
    !Array.isArray(coordinates) ||
    typeof coordinates[0] !== 'number' ||
    typeof coordinates[1] !== 'number'
  )
    throw new WeatherParseError('Resposta sem coordenadas');
  const parameter = record(record(root.properties, 'properties').parameter, 'parameter');
  return {
    longitude: coordinates[0],
    latitude: coordinates[1],
    elevationM: typeof coordinates[2] === 'number' ? coordinates[2] : null,
    ghiKwhM2Day: monthly(parameter, 'ALLSKY_SFC_SW_DWN'),
    tempMeanC: monthly(parameter, 'T2M'),
    tempMinC: monthly(parameter, 'T2M_MIN'),
    tempMaxC: monthly(parameter, 'T2M_MAX'),
  };
}

/** NASA POWER, `temporal/hourly/point` com `ALLSKY_SFC_SW_DWN`, `ALLSKY_SFC_SW_DIFF`, `T2M`. Chaves `AAAAMMDDHH`. */
export function parseNasaPowerHourly(json: unknown): HourlySeries {
  const parameter = record(
    record(record(json, 'objeto').properties, 'properties').parameter,
    'parameter',
  );
  const ghi = record(parameter.ALLSKY_SFC_SW_DWN, 'ALLSKY_SFC_SW_DWN');
  const dhi = record(parameter.ALLSKY_SFC_SW_DIFF, 'ALLSKY_SFC_SW_DIFF');
  const temp = record(parameter.T2M, 'T2M');
  const keys = Object.keys(ghi).sort();
  const first = keys[0];
  if (!first || !/^\d{10}$/.test(first)) throw new WeatherParseError('Série horária vazia');
  const pick = (source: Record<string, unknown>, key: string): number | null => {
    const value = source[key];
    return typeof value === 'number' && value !== FILL && Number.isFinite(value) ? value : null;
  };
  const ghiWhM2 = keys.map((k) => pick(ghi, k));
  const dhiWhM2 = keys.map((k) => pick(dhi, k));
  const tempC = keys.map((k) => pick(temp, k));
  const startAt = `${first.slice(0, 4)}-${first.slice(4, 6)}-${first.slice(6, 8)}T${first.slice(8, 10)}:00:00`;
  return {
    startAt,
    timeStandard: 'LST',
    ghiWhM2,
    dhiWhM2,
    tempC,
    missingHours: ghiWhM2.filter((v) => v === null).length,
  };
}

/**
 * PVGIS `seriescalc` com `angle=0`, `aspect=0`, `components=1` (plano horizontal). A irradiância global é
 * `Gb(i) + Gd(i)` (no plano horizontal `Gr(i)` é zero). Horas em UTC com minuto 4 (referência do PVGIS), W/m²
 * médios da hora, tratados como Wh/m².
 */
export function parsePvgisSeries(json: unknown): HourlySeries {
  const root = record(json, 'objeto');
  const slope = (
    root.inputs as { mounting_system?: { fixed?: { slope?: { value?: unknown } } } } | undefined
  )?.mounting_system?.fixed?.slope?.value;
  if (slope !== undefined && slope !== 0)
    throw new WeatherParseError('A série do PVGIS precisa ser do plano horizontal (angle=0)');
  const hourly = record(root.outputs, 'outputs').hourly;
  if (!Array.isArray(hourly) || hourly.length === 0)
    throw new WeatherParseError('Série horária vazia');
  const ghiWhM2: (number | null)[] = [];
  const dhiWhM2: (number | null)[] = [];
  const tempC: (number | null)[] = [];
  for (const row of hourly) {
    const r = record(row, 'linha horária');
    const gb = r['Gb(i)'];
    const gd = r['Gd(i)'];
    const t = r['T2m'];
    ghiWhM2.push(typeof gb === 'number' && typeof gd === 'number' ? gb + gd : null);
    dhiWhM2.push(typeof gd === 'number' ? gd : null);
    tempC.push(typeof t === 'number' ? t : null);
  }
  const time = (hourly[0] as { time?: unknown }).time;
  if (typeof time !== 'string' || !/^\d{8}:\d{4}$/.test(time))
    throw new WeatherParseError('Horário da série em formato inesperado');
  const startAt = `${time.slice(0, 4)}-${time.slice(4, 6)}-${time.slice(6, 8)}T${time.slice(9, 11)}:00:00Z`;
  return {
    startAt,
    timeStandard: 'UTC',
    ghiWhM2,
    dhiWhM2,
    tempC,
    missingHours: ghiWhM2.filter((v) => v === null).length,
  };
}

/** PVGIS `printhorizon`: `A` em graus com sul = 0, leste = −90, oeste = +90. Convertido para azimute do norte. */
export function parsePvgisHorizon(json: unknown): HorizonProfile {
  const root = record(json, 'objeto');
  const location = record(record(root.inputs, 'inputs').location, 'location');
  const profile = record(root.outputs, 'outputs').horizon_profile;
  if (!Array.isArray(profile) || profile.length === 0)
    throw new WeatherParseError('Perfil de horizonte vazio');
  const points = profile.map((row) => {
    const r = record(row, 'ponto do horizonte');
    if (typeof r.A !== 'number' || typeof r.H_hor !== 'number')
      throw new WeatherParseError('Ponto do horizonte inválido');
    return { azimuthDegrees: (((r.A + 180) % 360) + 360) % 360, heightDegrees: r.H_hor };
  });
  points.sort((a, b) => a.azimuthDegrees - b.azimuthDegrees);
  // O PVGIS repete o norte nas duas pontas (−180 e +180): fica um ponto só, com o maior horizonte (conservador).
  const unique = points.filter((point, i) => {
    const previous = points[i - 1];
    if (previous && previous.azimuthDegrees === point.azimuthDegrees) {
      previous.heightDegrees = Math.max(previous.heightDegrees, point.heightDegrees);
      return false;
    }
    return true;
  });
  return {
    latitude: Number(location.latitude),
    longitude: Number(location.longitude),
    elevationM: typeof location.elevation === 'number' ? location.elevation : null,
    points: unique,
  };
}

export interface HourlySummary {
  /** kWh/m²·dia por mês (jan a dez), média dos dias do período; meses sem dado ficam `null`. */
  ghiKwhM2Day: (number | null)[];
  tempMeanC: (number | null)[];
  tempMinC: number | null;
  tempMaxC: number | null;
  hours: number;
  missingHours: number;
}

/** Resumo mensal de uma série horária (mês pelo `startAt`, uma hora por posição). */
export function summarizeHourly(series: HourlySeries): HourlySummary {
  const start = new Date(`${series.startAt}${series.timeStandard === 'UTC' ? '' : 'Z'}`);
  const ghiSum = new Array<number>(12).fill(0);
  const tSum = new Array<number>(12).fill(0);
  const tCount = new Array<number>(12).fill(0);
  const hourCount = new Array<number>(12).fill(0);
  let tMin: number | null = null;
  let tMax: number | null = null;
  series.ghiWhM2.forEach((ghi, i) => {
    const month = new Date(start.getTime() + i * 3_600_000).getUTCMonth();
    hourCount[month] = (hourCount[month] ?? 0) + 1;
    if (ghi !== null) ghiSum[month] = (ghiSum[month] ?? 0) + ghi;
    const t = series.tempC[i] ?? null;
    if (t !== null) {
      tSum[month] = (tSum[month] ?? 0) + t;
      tCount[month] = (tCount[month] ?? 0) + 1;
      tMin = tMin === null ? t : Math.min(tMin, t);
      tMax = tMax === null ? t : Math.max(tMax, t);
    }
  });
  return {
    ghiKwhM2Day: ghiSum.map((sum, m) => {
      const hours = hourCount[m] ?? 0;
      if (hours === 0) return null;
      // Dias efetivamente cobertos no mês (meses parciais não são extrapolados para o mês inteiro).
      const days = Math.min(hours / 24, DAYS_IN_MONTH[m] ?? 30);
      return roundTo(sum / 1000 / days, 3);
    }),
    tempMeanC: tSum.map((sum, m) =>
      (tCount[m] ?? 0) === 0 ? null : roundTo(sum / (tCount[m] ?? 1), 2),
    ),
    tempMinC: tMin,
    tempMaxC: tMax,
    hours: series.ghiWhM2.length,
    missingHours: series.missingHours,
  };
}
