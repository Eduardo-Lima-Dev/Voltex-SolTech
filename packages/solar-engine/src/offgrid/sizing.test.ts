import { describe, expect, it } from 'vitest';
import {
  bankCapacity,
  batteriesInParallel,
  batteriesInSeries,
  batteryLifeYears,
  controllerCurrentA,
  dailyBatteryEnergyWh,
  inverterRequirement,
  pvPeakPowerWp,
  recommendedSystemVoltage,
  ruleDodLimitPct,
  suggestedAutonomyDays,
} from './sizing.js';

describe('dimensionamento CRESESB', () => {
  it('6.2: energia do banco por dia', () => {
    expect(
      dailyBatteryEnergyWh({
        dcWh: 860,
        acWh: 2580,
        batteryEfficiency: 0.86,
        inverterEfficiency: 0.9,
      }),
    ).toBeCloseTo(860 / 0.86 + 2580 / (0.86 * 0.9), 6);
  });

  it('6.3: potência de pico pelo pior mês', () => {
    const r = pvPeakPowerWp({
      monthlyEnergyWh: [1000, 1000, 0, ...Array(9).fill(500)],
      monthlyHsp: [5, 4, 4, ...Array(9).fill(5)],
      red1: 0.75,
      red2: 0.9,
    });
    expect(r.monthIndex).toBe(1);
    expect(r.wp).toBeCloseTo(1000 / (4 * 0.75 * 0.9), 1);
  });

  it('6.3: sem recurso solar a potência é infinita', () => {
    const r = pvPeakPowerWp({
      monthlyEnergyWh: Array(12).fill(1000),
      monthlyHsp: Array(12).fill(0),
      red1: 0.75,
      red2: 0.9,
    });
    expect(r.wp).toBe(Infinity);
  });

  it('6.13: autonomia sugerida nunca abaixo de 1 dia', () => {
    expect(suggestedAutonomyDays(4)).toBeCloseTo(2.66, 2);
    expect(suggestedAutonomyDays(9)).toBe(1);
  });

  it('6.10–6.12, 6.16–6.17: banco', () => {
    const bank = bankCapacity({
      dailyEnergyWh: 3000,
      autonomyDays: 2,
      dodFraction: 0.5,
      systemVoltageV: 24,
    });
    expect(bank).toEqual({ wh: 12000, ah: 500 });
    expect(batteriesInSeries(24, 12)).toBe(2);
    expect(batteriesInSeries(12, 51.2)).toBe(1);
    expect(batteriesInParallel(500, 220)).toBe(3);
  });

  it('6.18: corrente do controlador e inversor', () => {
    expect(controllerCurrentA(1.25, 10, 3)).toBeCloseTo(37.5);
    expect(inverterRequirement({ peakW: 1000, surgeW: 3000, margin: 0.25 })).toEqual({
      continuousW: 1250,
      surgeW: 3000,
    });
  });

  it('tensão recomendada pela potência', () => {
    expect([
      recommendedSystemVoltage(800),
      recommendedSystemVoltage(2500),
      recommendedSystemVoltage(5000),
    ]).toEqual([12, 24, 48]);
  });

  it('DoD da regra por química', () => {
    const p = {
      dodMaxLeadFlooded: 50,
      dodMaxLeadVrla: 60,
      dodMaxStationary: 80,
      dodMaxLithium: 90,
    };
    expect(ruleDodLimitPct('LEAD_FLOODED', p)).toBe(50);
    expect(ruleDodLimitPct('LEAD_AGM', p)).toBe(60);
    expect(ruleDodLimitPct('LEAD_GEL', p)).toBe(60);
    expect(ruleDodLimitPct('OPZS', p)).toBe(80);
    expect(ruleDodLimitPct('LFP', p)).toBe(90);
    expect(ruleDodLimitPct('OTHER', p)).toBeUndefined();
  });

  it('vida do banco pela energia processada e pelo calendário', () => {
    expect(
      batteryLifeYears({
        cycleLife: 1000,
        cycleDodPct: 50,
        nominalWh: 10000,
        annualThroughputWh: 2_500_000,
      }),
    ).toBe(2);
    expect(
      batteryLifeYears({
        cycleLife: 6000,
        cycleDodPct: 80,
        nominalWh: 10000,
        annualThroughputWh: 2000,
        calendarLifeYears: 12,
      }),
    ).toBe(12);
    expect(batteryLifeYears({ nominalWh: 1, annualThroughputWh: 1 })).toBeNull();
  });
});
