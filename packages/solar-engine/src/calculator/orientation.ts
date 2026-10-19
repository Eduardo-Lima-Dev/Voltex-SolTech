import { roundTo } from '../units/index.js';

/**
 * Orientação e inclinação (EnergIF EF-M02 a EF-M04, p. 18 e 163).
 * São orientações qualitativas: NÃO há fator numérico de perda de produção (lacuna EF-G08).
 */

/** Azimute ideal da face dos módulos: Norte geográfico (0°) no hemisfério sul; Sul (180°) no hemisfério norte. */
export const optimalAzimuthDegrees = (latitude?: number): number =>
  latitude !== undefined && latitude > 0 ? 180 : 0;

/** Menor distância angular (0–180°) entre dois azimutes. */
export const azimuthDeviationDegrees = (azimuth: number, optimal: number): number => {
  const diff = Math.abs(azimuth - optimal) % 360;
  return diff > 180 ? 360 - diff : diff;
};

/**
 * Inclinação recomendada por latitude (Tabela 5.3, Villalva e Gazoli, 2012), usando a latitude absoluta:
 * até 10° → 10° · até 20° → latitude · até 30° → latitude + 5° · até 40° → latitude + 10° · acima → latitude + 15°.
 * A tabela impressa traz "31º a 30º" (EF-I01): assumimos 31°–40°. Limites superiores inclusivos para valores
 * fracionários (decisão nossa; a tabela só fala em graus inteiros). Regra prática: revisar com especialista.
 */
export const recommendedTiltDegrees = (latitude: number): number => {
  const lat = Math.abs(latitude);
  if (lat <= 10) return 10;
  if (lat <= 20) return roundTo(lat, 1);
  if (lat <= 30) return roundTo(lat + 5, 1);
  if (lat <= 40) return roundTo(lat + 10, 1);
  return roundTo(lat + 15, 1);
};
