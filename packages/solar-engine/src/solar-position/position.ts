import { degToRad, radToDeg, type Degrees } from '../units/index.js';

/**
 * Posição do sol (ENG-F16). Implementa as equações astronômicas do **NOAA Solar Calculator** (baseadas em
 * Meeus, *Astronomical Algorithms*): precisão típica < 0,05° entre 1950 e 2050, suficiente para sombreamento e
 * transposição. **Não** é o NREL SPA completo (incerteza ±0,0003°), que fica como evolução se um caso exigir.
 * Memorial: `docs/06-calculos/engine-posicao-solar-sombreamento.md`.
 */
export const SOLAR_POSITION_ALGORITHM_VERSION = 'solpos-1.0.0';

export interface SolarPosition {
  /** Altura geométrica sobre o horizonte (°), sem refração. */
  elevationDegrees: Degrees;
  /** Altura aparente (°), com refração atmosférica padrão (1010 hPa, 10 °C). */
  apparentElevationDegrees: Degrees;
  /** Azimute (°), medido do norte para o leste (N=0, E=90, S=180, W=270). */
  azimuthDegrees: Degrees;
  zenithDegrees: Degrees;
  declinationDegrees: Degrees;
  /** Equação do tempo (min). */
  equationOfTimeMinutes: number;
  /** Ângulo horário (°), negativo antes do meio-dia solar. */
  hourAngleDegrees: Degrees;
}

const mod = (value: number, base: number): number => ((value % base) + base) % base;

/** Dia juliano de um instante (UTC). */
export const julianDay = (date: Date): number => date.getTime() / 86_400_000 + 2_440_587.5;

/**
 * Posição do sol para um instante e um local.
 * @param latitudeDegrees positiva ao norte (−90…90)
 * @param longitudeDegrees positiva a leste (−180…180); o Brasil é negativo
 */
export function solarPosition(input: {
  at: Date;
  latitudeDegrees: Degrees;
  longitudeDegrees: Degrees;
}): SolarPosition {
  const { at, latitudeDegrees, longitudeDegrees } = input;
  if (Number.isNaN(at.getTime())) throw new RangeError('Data inválida');
  if (Math.abs(latitudeDegrees) > 90) throw new RangeError('Latitude fora de −90…90');
  if (Math.abs(longitudeDegrees) > 180) throw new RangeError('Longitude fora de −180…180');

  const t = (julianDay(at) - 2_451_545) / 36_525;
  const meanLongDeg = mod(280.46646 + t * (36_000.76983 + t * 0.0003032), 360);
  const meanAnomDeg = 357.52911 + t * (35_999.05029 - 0.0001537 * t);
  const eccentricity = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const meanAnomRad = degToRad(meanAnomDeg);
  const centerDeg =
    Math.sin(meanAnomRad) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * meanAnomRad) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * meanAnomRad) * 0.000289;
  const trueLongDeg = meanLongDeg + centerDeg;
  const omegaDeg = 125.04 - 1934.136 * t;
  const apparentLongDeg = trueLongDeg - 0.00569 - 0.00478 * Math.sin(degToRad(omegaDeg));
  const meanObliqDeg = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliqDeg = meanObliqDeg + 0.00256 * Math.cos(degToRad(omegaDeg));
  const declinationRad = Math.asin(
    Math.sin(degToRad(obliqDeg)) * Math.sin(degToRad(apparentLongDeg)),
  );

  const y = Math.tan(degToRad(obliqDeg) / 2) ** 2;
  const l0 = degToRad(meanLongDeg);
  const equationOfTimeMinutes =
    4 *
    radToDeg(
      y * Math.sin(2 * l0) -
        2 * eccentricity * Math.sin(meanAnomRad) +
        4 * eccentricity * y * Math.sin(meanAnomRad) * Math.cos(2 * l0) -
        0.5 * y * y * Math.sin(4 * l0) -
        1.25 * eccentricity * eccentricity * Math.sin(2 * meanAnomRad),
    );

  const utcMinutes =
    at.getUTCHours() * 60 +
    at.getUTCMinutes() +
    at.getUTCSeconds() / 60 +
    at.getUTCMilliseconds() / 60_000;
  const trueSolarTimeMin = mod(utcMinutes + equationOfTimeMinutes + 4 * longitudeDegrees, 1440);
  const hourAngleDegrees = trueSolarTimeMin / 4 - 180;

  const latRad = degToRad(latitudeDegrees);
  const hourRad = degToRad(hourAngleDegrees);
  const cosZenith = clamp(
    Math.sin(latRad) * Math.sin(declinationRad) +
      Math.cos(latRad) * Math.cos(declinationRad) * Math.cos(hourRad),
  );
  const zenithRad = Math.acos(cosZenith);
  const zenithDegrees = radToDeg(zenithRad);
  const elevationDegrees = 90 - zenithDegrees;

  // Azimute a partir do norte, no sentido horário (NOAA).
  const sinZenith = Math.sin(zenithRad);
  let azimuthDegrees: Degrees;
  if (sinZenith < 1e-9) {
    azimuthDegrees = 180; // sol no zênite: azimute indefinido
  } else {
    const ratio = clamp(
      (Math.sin(latRad) * cosZenith - Math.sin(declinationRad)) / (Math.cos(latRad) * sinZenith),
    );
    const base = radToDeg(Math.acos(ratio));
    azimuthDegrees = hourAngleDegrees > 0 ? mod(base + 180, 360) : mod(540 - base, 360);
  }

  return {
    elevationDegrees,
    apparentElevationDegrees: elevationDegrees + refractionDegrees(elevationDegrees),
    azimuthDegrees,
    zenithDegrees,
    declinationDegrees: radToDeg(declinationRad),
    equationOfTimeMinutes,
    hourAngleDegrees,
  };
}

/** Refração atmosférica (°) da fórmula do NOAA, para a altura geométrica. */
export function refractionDegrees(elevationDegrees: Degrees): Degrees {
  if (elevationDegrees > 85) return 0;
  const tanE = Math.tan(degToRad(elevationDegrees));
  let arcSec: number;
  if (elevationDegrees > 5) {
    arcSec = 58.1 / tanE - 0.07 / tanE ** 3 + 0.000086 / tanE ** 5;
  } else if (elevationDegrees > -0.575) {
    arcSec =
      1735 +
      elevationDegrees *
        (-518.2 +
          elevationDegrees * (103.4 + elevationDegrees * (-12.79 + elevationDegrees * 0.711)));
  } else {
    arcSec = -20.774 / tanE;
  }
  return arcSec / 3600;
}

const clamp = (value: number): number => Math.min(1, Math.max(-1, value));
