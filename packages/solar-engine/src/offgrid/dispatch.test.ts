import { describe, expect, it } from 'vitest';
import {
  CHARGER_EFFICIENCY,
  runDispatch,
  type DispatchConfig,
  type DispatchTimeline,
} from './dispatch.js';

const timeline = (
  days: number,
  pv: (hour: number, day: number) => number,
  ac: (hour: number, day: number) => number,
  dc: (hour: number, day: number) => number = () => 0,
): DispatchTimeline => {
  const t: DispatchTimeline = {
    hourOfDay: [],
    dayOfYear: [],
    monthIndex: [],
    pvW: [],
    acWh: [],
    dcWh: [],
  };
  for (let d = 0; d < days; d++)
    for (let h = 0; h < 24; h++) {
      t.hourOfDay.push(h);
      t.dayOfYear.push(d + 1);
      t.monthIndex.push(0);
      t.pvW.push(pv(h, d));
      t.acWh.push(ac(h, d));
      t.dcWh.push(dc(h, d));
    }
  return t;
};

const sun = (peak: number) => (h: number) => (h >= 8 && h < 16 ? peak : 0);

const base: DispatchConfig = {
  nominalWh: 10_000,
  socMinFrac: 0.2,
  roundTripEfficiency: 1,
  maxChargeW: 5000,
  maxDischargeW: 5000,
  controllerEfficiency: 1,
  controllerLimitW: 10_000,
  inverterContinuousW: 3000,
  inverterEfficiency: 1,
  inverterStandbyW: 0,
  passes: 2,
};

describe('despacho horário', () => {
  it('FV sobrando carrega o banco e o banco atende a noite sem perda de carga', () => {
    const r = runDispatch(
      base,
      timeline(5, sun(2000), () => 100),
    );
    expect(r.unmetKwh).toBe(0);
    expect(r.unmetHours).toBe(0);
    expect(r.loadKwh).toBeCloseTo(5 * 24 * 0.1, 2);
    expect(r.minSocFrac).toBeGreaterThan(0.2);
    expect(r.typicalDay.pvKw).toHaveLength(24);
    expect(r.dailyMinSocFrac).toHaveLength(5);
    expect(r.monthly.pvKwh[0]).toBeGreaterThan(0);
  });

  it('desperdiça o excedente quando o banco está cheio e quando o controlador limita', () => {
    const r = runDispatch(
      { ...base, controllerLimitW: 1000 },
      timeline(3, sun(4000), () => 0),
    );
    expect(r.curtailedKwh).toBeGreaterThan(0);
    const full = runDispatch(
      base,
      timeline(3, sun(4000), () => 0),
    );
    expect(full.curtailedKwh).toBeGreaterThan(0);
  });

  it('sem sol o banco esvazia até o piso e a carga deixa de ser atendida', () => {
    const r = runDispatch(
      { ...base, passes: 1 },
      timeline(
        3,
        () => 0,
        () => 500,
      ),
    );
    expect(r.unmetKwh).toBeGreaterThan(0);
    expect(r.unmetHours).toBeGreaterThan(0);
    expect(r.longestUnmetRunHours).toBeGreaterThan(5);
    expect(r.minSocFrac).toBeCloseTo(0.2, 3);
  });

  it('o limite do inversor corta a carga CA acima da potência contínua', () => {
    const r = runDispatch(
      base,
      timeline(2, sun(5000), () => 4000),
    );
    expect(r.unmetKwh).toBeGreaterThan(0);
  });

  it('perdas do ciclo, do inversor e consumo em vazio entram no balanço', () => {
    const lossy = runDispatch(
      { ...base, roundTripEfficiency: 0.81, inverterEfficiency: 0.9, inverterStandbyW: 20 },
      timeline(4, sun(3000), () => 200),
    );
    const ideal = runDispatch(
      base,
      timeline(4, sun(3000), () => 200),
    );
    expect(lossy.minSocFrac).toBeLessThan(ideal.minSocFrac);
  });

  it('cargas CC não passam pelo inversor', () => {
    const r = runDispatch(
      { ...base, inverterContinuousW: 0 },
      timeline(
        2,
        sun(1000),
        () => 0,
        () => 100,
      ),
    );
    expect(r.servedKwh).toBeGreaterThan(0);
  });

  it('o gerador liga no SOC de partida, recarrega até o de parada e consome combustível', () => {
    const noSun = timeline(
      6,
      () => 0,
      () => 400,
    );
    const withGenerator = runDispatch(
      {
        ...base,
        generator: {
          powerW: 3000,
          startSocFrac: 0.3,
          stopSocFrac: 0.8,
          minRunHours: 1,
          fromHour: 0,
          toHour: 24,
          fuelLitersPerHour: 1.5,
          chargerW: 1500,
        },
      },
      noSun,
    );
    expect(withGenerator.generatorHours).toBeGreaterThan(0);
    expect(withGenerator.generatorKwh).toBeGreaterThan(0);
    expect(withGenerator.fuelLiters).toBeGreaterThan(0);
    expect(withGenerator.unmetKwh).toBeLessThan(runDispatch(base, noSun).unmetKwh);
  });

  it('o gerador respeita a janela de horas permitidas (silêncio noturno)', () => {
    const r = runDispatch(
      {
        ...base,
        generator: {
          powerW: 3000,
          startSocFrac: 0.5,
          stopSocFrac: 0.9,
          minRunHours: 0,
          fromHour: 9,
          toHour: 17,
          fuelLitersPerHour: null,
          chargerW: 1500,
        },
      },
      timeline(
        4,
        () => 0,
        () => 500,
      ),
    );
    expect(r.generatorHours).toBeGreaterThan(0);
    expect(r.fuelLiters).toBe(0);
  });

  it('gerador com janela que atravessa a meia-noite', () => {
    const r = runDispatch(
      {
        ...base,
        generator: {
          powerW: 3000,
          startSocFrac: 0.5,
          stopSocFrac: 0.9,
          minRunHours: 0,
          fromHour: 20,
          toHour: 6,
          fuelLitersPerHour: 2,
          chargerW: 2000,
        },
      },
      timeline(
        4,
        () => 0,
        () => 500,
      ),
    );
    expect(r.generatorHours).toBeGreaterThan(0);
  });
});

describe('rede (híbrido, sem injeção)', () => {
  const grid = {
    mode: 'BACKUP' as const,
    dailyOutageStartHour: 18,
    dailyOutageHours: 4,
    extendedOutages: [],
    reserveSocFrac: 0.5,
    chargeBelowSocFrac: 0,
    chargerW: 2000,
  };

  it('BACKUP: a rede alimenta as cargas e a bateria guarda a reserva para as quedas', () => {
    const r = runDispatch(
      { ...base, grid },
      timeline(
        5,
        sun(1500),
        () => 300,
        () => 20,
      ),
    );
    expect(r.gridKwh).toBeGreaterThan(0);
    expect(r.unmetKwh).toBe(0);
    expect(r.minSocFrac).toBeGreaterThanOrEqual(0.5);
  });

  it('SELF_CONSUMPTION: usa a bateria todo dia e a rede cobre o que falta', () => {
    const r = runDispatch(
      { ...base, grid: { ...grid, mode: 'SELF_CONSUMPTION', dailyOutageHours: 0 } },
      timeline(5, sun(1500), () => 600),
    );
    expect(r.gridKwh).toBeGreaterThan(0);
    expect(r.minSocFrac).toBeLessThan(0.5);
    expect(r.unmetKwh).toBe(0);
  });

  it('queda prolongada: sem rede nos dias indicados a carga depende do banco', () => {
    const r = runDispatch(
      {
        ...base,
        passes: 1,
        grid: { ...grid, dailyOutageHours: 0, extendedOutages: [{ startDayOfYear: 2, days: 3 }] },
      },
      timeline(
        6,
        () => 0,
        () => 500,
      ),
    );
    expect(r.unmetKwh).toBeGreaterThan(0);
    expect(r.gridKwh).toBeGreaterThan(0);
  });

  it('a rede recarrega o banco abaixo do limiar, com histerese', () => {
    const r = runDispatch(
      {
        ...base,
        initialSocFrac: 0.3,
        passes: 1,
        grid: { ...grid, dailyOutageHours: 0, chargeBelowSocFrac: 0.4, reserveSocFrac: 0.6 },
      },
      timeline(
        2,
        () => 0,
        () => 100,
      ),
    );
    expect(r.gridKwh).toBeGreaterThan(r.loadKwh);
    expect(r.minSocFrac).toBeGreaterThan(0.29);
  });

  it('janela diária de queda atravessando a meia-noite', () => {
    const r = runDispatch(
      { ...base, grid: { ...grid, dailyOutageStartHour: 22, dailyOutageHours: 6 } },
      timeline(3, sun(1000), () => 200),
    );
    expect(r.unmetKwh).toBe(0);
  });

  it('o carregador da rede converte com a eficiência do carregador', () => {
    expect(CHARGER_EFFICIENCY).toBeLessThan(1);
  });
});
