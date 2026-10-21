import { roundTo } from '../units/index.js';

/**
 * OFF-F07: despacho horário de energia (balanço no barramento CC). Ordem de prioridade a cada hora:
 *  1. FV (após o controlador) alimenta as cargas;
 *  2. o gerador, se ligado, alimenta as cargas CA direto e recarrega o banco pelo carregador;
 *  3. a rede (só no híbrido, **nunca injeta**) alimenta as cargas CA conforme o modo: `BACKUP` (rede alimenta e a bateria
 *     fica de reserva para as quedas) ou `SELF_CONSUMPTION` (a bateria é usada e a rede cobre o que falta);
 *  4. o banco descarrega até o piso de DoD; o que sobra de FV carrega o banco; o resto é desperdiçado.
 * O ano é simulado duas vezes em sequência e só a segunda passada é reportada (o SOC inicial deixa de pesar).
 * Memorial: `docs/06-calculos/offgrid-despacho.md`.
 */
export const OFFGRID_DISPATCH_VERSION = 'offgrid-dispatch-1.0.0';

/** Eficiência do carregador (CA→CC) usada quando o gerador ou a rede carregam o banco. Premissa do motor. */
export const CHARGER_EFFICIENCY = 0.9;
/** Consumo mínimo do gerador (fração da carga) usado para estimar o combustível em carga baixa. */
export const GENERATOR_MIN_FUEL_FRACTION = 0.25;

export interface DispatchTimeline {
  hourOfDay: number[];
  dayOfYear: number[];
  monthIndex: number[];
  /** Potência FV disponível na entrada do controlador (W = Wh na hora). */
  pvW: number[];
  acWh: number[];
  dcWh: number[];
}

export interface DispatchGenerator {
  powerW: number;
  startSocFrac: number;
  stopSocFrac: number;
  minRunHours: number;
  fromHour: number;
  toHour: number;
  fuelLitersPerHour: number | null;
  /** Corrente do carregador convertida em potência (W). */
  chargerW: number;
}

export interface DispatchGrid {
  mode: 'BACKUP' | 'SELF_CONSUMPTION';
  dailyOutageStartHour: number;
  dailyOutageHours: number;
  extendedOutages: { startDayOfYear: number; days: number }[];
  reserveSocFrac: number;
  chargeBelowSocFrac: number;
  chargerW: number;
}

export interface DispatchConfig {
  nominalWh: number;
  socMinFrac: number;
  roundTripEfficiency: number;
  maxChargeW: number;
  maxDischargeW: number;
  controllerEfficiency: number;
  controllerLimitW: number;
  inverterContinuousW: number;
  inverterEfficiency: number;
  inverterStandbyW: number;
  generator?: DispatchGenerator;
  grid?: DispatchGrid;
  initialSocFrac?: number;
  passes?: number;
}

export interface DispatchResult {
  hours: number;
  pvKwh: number;
  loadKwh: number;
  servedKwh: number;
  unmetKwh: number;
  unmetHours: number;
  curtailedKwh: number;
  generatorKwh: number;
  generatorHours: number;
  fuelLiters: number;
  gridKwh: number;
  dischargedWh: number;
  minSocFrac: number;
  monthly: {
    pvKwh: number[];
    loadKwh: number[];
    unmetKwh: number[];
    generatorKwh: number[];
    gridKwh: number[];
    minSocFrac: number[];
  };
  typicalDay: { pvKw: number[]; loadKw: number[]; socFrac: number[] };
  dailyMinSocFrac: number[];
  longestUnmetRunHours: number;
  /** Série horária da passada reportada, usada pelo teste de estresse. */
  socFrac: number[];
  unmetWh: number[];
}

function gridIsUp(grid: DispatchGrid, hour: number, dayOfYear: number): boolean {
  for (const outage of grid.extendedOutages)
    if (dayOfYear >= outage.startDayOfYear && dayOfYear < outage.startDayOfYear + outage.days)
      return false;
  if (grid.dailyOutageHours <= 0) return true;
  const offset = (hour - grid.dailyOutageStartHour + 24) % 24;
  return offset >= grid.dailyOutageHours;
}

const generatorAllowed = (g: DispatchGenerator, hour: number): boolean =>
  g.toHour > g.fromHour
    ? hour >= g.fromHour && hour < g.toHour
    : hour >= g.fromHour || hour < g.toHour;

export function runDispatch(cfg: DispatchConfig, tl: DispatchTimeline): DispatchResult {
  const n = tl.pvW.length;
  const etaHalf = Math.sqrt(cfg.roundTripEfficiency);
  const floorWh = cfg.nominalWh * cfg.socMinFrac;
  let soc = cfg.nominalWh * (cfg.initialSocFrac ?? 1);
  let genOn = false;
  let genRun = 0;
  let gridCharging = false;
  const passes = Math.max(1, cfg.passes ?? 2);

  let result: DispatchResult | null = null;
  for (let pass = 0; pass < passes; pass++) {
    const last = pass === passes - 1;
    const acc = {
      pv: 0,
      load: 0,
      served: 0,
      unmet: 0,
      unmetHours: 0,
      curtailed: 0,
      gen: 0,
      genHours: 0,
      fuel: 0,
      grid: 0,
      discharged: 0,
      minSoc: 1,
      run: 0,
      longestRun: 0,
    };
    const monthly = {
      pv: Array<number>(12).fill(0),
      load: Array<number>(12).fill(0),
      unmet: Array<number>(12).fill(0),
      gen: Array<number>(12).fill(0),
      grid: Array<number>(12).fill(0),
      minSoc: Array<number>(12).fill(1),
    };
    const dayPv = Array<number>(24).fill(0);
    const dayLoad = Array<number>(24).fill(0);
    const daySoc = Array<number>(24).fill(0);
    const dayCount = Array<number>(24).fill(0);
    const dailyMin = new Map<number, number>();
    const socSeries: number[] = [];
    const unmetSeries: number[] = [];

    for (let h = 0; h < n; h++) {
      const hour = tl.hourOfDay[h] as number;
      const month = tl.monthIndex[h] as number;
      const day = tl.dayOfYear[h] as number;
      let acLoad = tl.acWh[h] as number;
      const dcLoad = tl.dcWh[h] as number;
      const loadTotal = acLoad + dcLoad;
      // Limite de potência do inversor: o excedente não é atendido.
      let unmet = 0;
      if (acLoad > cfg.inverterContinuousW) {
        unmet += acLoad - cfg.inverterContinuousW;
        acLoad = cfg.inverterContinuousW;
      }
      const standby = cfg.inverterContinuousW > 0 ? cfg.inverterStandbyW : 0;
      let busDemand = acLoad / cfg.inverterEfficiency + dcLoad + standby;
      const busDemand0 = busDemand;
      // Conversão média de barramento para a fonte CA (rede/gerador): CA passa pelo inversor, CC pelo carregador.
      const acFraction = busDemand0 > 0 ? acLoad / cfg.inverterEfficiency / busDemand0 : 0;
      const gridPerBus =
        acFraction * cfg.inverterEfficiency + (1 - acFraction) / CHARGER_EFFICIENCY;

      const pvBus = Math.min(
        (tl.pvW[h] as number) * cfg.controllerEfficiency,
        cfg.controllerLimitW,
      );
      let curtailed = Math.max(0, (tl.pvW[h] as number) * cfg.controllerEfficiency - pvBus);
      const direct = Math.min(pvBus, busDemand);
      const surplus = pvBus - direct;
      busDemand -= direct;

      const socFrac = soc / cfg.nominalWh;
      const up = cfg.grid ? gridIsUp(cfg.grid, hour, day) : false;

      // Gerador: liga no SOC de partida (se a rede não estiver disponível) e desliga no SOC de parada.
      const gen = cfg.generator;
      if (gen) {
        if (genOn) {
          genRun += 1;
          const done = socFrac >= gen.stopSocFrac && genRun > gen.minRunHours;
          if (done || !generatorAllowed(gen, hour)) genOn = false;
        } else if (socFrac <= gen.startSocFrac && !up && generatorAllowed(gen, hour)) {
          genOn = true;
          genRun = 0;
        }
      }

      let genOutW = 0;
      let gridOutW = 0;
      let chargeFromAc = 0;
      // CA servido direto por gerador/rede (passagem): reduz a demanda do barramento.
      const acBusShare = acLoad / cfg.inverterEfficiency;
      const acRemaining = Math.min(acBusShare, busDemand);
      if (genOn && cfg.generator) {
        const direct = Math.min(cfg.generator.powerW, acLoad);
        genOutW += direct;
        busDemand = Math.max(0, busDemand - Math.min(acRemaining, direct / cfg.inverterEfficiency));
        const spare = cfg.generator.powerW - direct;
        chargeFromAc = Math.max(0, Math.min(spare, cfg.generator.chargerW));
        genOutW += chargeFromAc;
      } else if (up && cfg.grid) {
        const backup = cfg.grid.mode === 'BACKUP';
        const floorBackup = cfg.nominalWh * Math.max(cfg.socMinFrac, cfg.grid.reserveSocFrac);
        // Rede alimenta o CA; em autoconsumo só cobre o que o banco não alcança.
        if (backup) {
          gridOutW += busDemand * gridPerBus;
          busDemand = 0;
        } else {
          const available = Math.max(0, soc - floorWh) * etaHalf;
          const fromBattery = Math.min(busDemand, available, cfg.maxDischargeW);
          gridOutW += (busDemand - fromBattery) * gridPerBus;
          busDemand = fromBattery;
        }
        // Recarga pela rede (histerese entre o limiar e a reserva).
        if (cfg.grid.chargeBelowSocFrac > 0) {
          if (socFrac < cfg.grid.chargeBelowSocFrac) gridCharging = true;
          if (socFrac >= Math.max(floorBackup / cfg.nominalWh, cfg.grid.chargeBelowSocFrac))
            gridCharging = false;
          if (gridCharging) {
            chargeFromAc = Math.min(
              cfg.grid.chargerW,
              Math.max(0, (cfg.nominalWh - soc) / etaHalf),
            );
            gridOutW += chargeFromAc;
          }
        }
      } else gridCharging = false;

      // Banco: descarrega para a demanda restante.
      let discharge = 0;
      if (busDemand > 1e-9) {
        const available = Math.max(0, soc - floorWh) * etaHalf;
        discharge = Math.min(busDemand, available, cfg.maxDischargeW);
        soc -= discharge / etaHalf;
        acc.discharged += discharge / etaHalf;
        const shortfall = busDemand - discharge;
        if (shortfall > 1e-9) {
          unmet += (acLoad + dcLoad) * Math.min(1, shortfall / (busDemand0 + 1e-9));
        }
      }
      // Carga: FV excedente e carregador (gerador/rede).
      const chargeIn = surplus + chargeFromAc * CHARGER_EFFICIENCY;
      if (chargeIn > 0) {
        const room = Math.max(0, cfg.nominalWh - soc) / etaHalf;
        const accepted = Math.min(chargeIn, room, cfg.maxChargeW);
        soc += accepted * etaHalf;
        const fromPv = Math.min(surplus, accepted);
        curtailed += surplus - fromPv;
        // O excedente do carregador que não coube volta como energia não aproveitada do gerador/rede (não contado).
      } else curtailed += surplus;

      soc = Math.min(cfg.nominalWh, Math.max(0, soc));
      const socNow = soc / cfg.nominalWh;
      const unmetHour = Math.min(loadTotal, unmet);
      const unmetFlag = unmetHour > 1;

      if (last) {
        socSeries.push(socNow);
        unmetSeries.push(unmetHour);
        acc.pv += tl.pvW[h] as number;
        acc.load += loadTotal;
        acc.served += loadTotal - unmetHour;
        acc.unmet += unmetHour;
        if (unmetFlag) {
          acc.unmetHours += 1;
          acc.run += 1;
          acc.longestRun = Math.max(acc.longestRun, acc.run);
        } else acc.run = 0;
        acc.curtailed += curtailed;
        acc.gen += genOutW;
        if (genOutW > 0) {
          acc.genHours += 1;
          if (cfg.generator?.fuelLitersPerHour)
            acc.fuel +=
              (cfg.generator.fuelLitersPerHour *
                Math.max(GENERATOR_MIN_FUEL_FRACTION, genOutW / cfg.generator.powerW)) /
              0.75;
        }
        acc.grid += gridOutW;
        acc.minSoc = Math.min(acc.minSoc, socNow);
        monthly.pv[month] = (monthly.pv[month] as number) + (tl.pvW[h] as number);
        monthly.load[month] = (monthly.load[month] as number) + loadTotal;
        monthly.unmet[month] = (monthly.unmet[month] as number) + unmetHour;
        monthly.gen[month] = (monthly.gen[month] as number) + genOutW;
        monthly.grid[month] = (monthly.grid[month] as number) + gridOutW;
        monthly.minSoc[month] = Math.min(monthly.minSoc[month] as number, socNow);
        dayPv[hour] = (dayPv[hour] as number) + (tl.pvW[h] as number);
        dayLoad[hour] = (dayLoad[hour] as number) + loadTotal;
        daySoc[hour] = (daySoc[hour] as number) + socNow;
        dayCount[hour] = (dayCount[hour] as number) + 1;
        dailyMin.set(day, Math.min(dailyMin.get(day) ?? 1, socNow));
      }
    }

    if (last) {
      const kwh = (wh: number): number => roundTo(wh / 1000, 2);
      result = {
        hours: n,
        pvKwh: kwh(acc.pv),
        loadKwh: kwh(acc.load),
        servedKwh: kwh(acc.served),
        unmetKwh: kwh(acc.unmet),
        unmetHours: acc.unmetHours,
        curtailedKwh: kwh(acc.curtailed),
        generatorKwh: kwh(acc.gen),
        generatorHours: acc.genHours,
        fuelLiters: roundTo(acc.fuel, 1),
        gridKwh: kwh(acc.grid),
        dischargedWh: acc.discharged,
        minSocFrac: roundTo(acc.minSoc, 4),
        monthly: {
          pvKwh: monthly.pv.map(kwh),
          loadKwh: monthly.load.map(kwh),
          unmetKwh: monthly.unmet.map(kwh),
          generatorKwh: monthly.gen.map(kwh),
          gridKwh: monthly.grid.map(kwh),
          minSocFrac: monthly.minSoc.map((v) => roundTo(v, 4)),
        },
        typicalDay: {
          pvKw: dayPv.map((v, i) => roundTo(v / Math.max(1, dayCount[i] as number) / 1000, 3)),
          loadKw: dayLoad.map((v, i) => roundTo(v / Math.max(1, dayCount[i] as number) / 1000, 3)),
          socFrac: daySoc.map((v, i) => roundTo(v / Math.max(1, dayCount[i] as number), 4)),
        },
        dailyMinSocFrac: [...dailyMin.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([, v]) => roundTo(v, 4)),
        longestUnmetRunHours: acc.longestRun,
        socFrac: socSeries,
        unmetWh: unmetSeries,
      };
    }
  }
  return result as DispatchResult;
}
