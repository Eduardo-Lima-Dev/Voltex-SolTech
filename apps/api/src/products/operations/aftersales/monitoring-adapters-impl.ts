import { MONITORING_FIXTURES } from '@voltex/api-test';

/**
 * Implementação dos 17 adaptadores com fixtures.
 * Cada adaptador mapeia a resposta gravada para o formato Voltex.
 */

export const MONITORING_ADAPTERS_WITH_FIXTURES = {
  async sma() {
    const fixture = MONITORING_FIXTURES.sma;
    return {
      plants: fixture.plants,
      daily: { energy: fixture.daily.energy, date: fixture.daily.date },
      snapshot: { power: fixture.snapshot.powerNow, timestamp: fixture.snapshot.timestamp },
      alarms: fixture.alarms,
    };
  },

  async solaredge() {
    const fixture = MONITORING_FIXTURES.solaredge;
    return {
      plants: fixture.plants,
      daily: { energy: fixture.daily.energy, date: fixture.daily.date },
      snapshot: { power: fixture.snapshot.powerNow, timestamp: fixture.snapshot.timestamp },
      alarms: fixture.alarms,
    };
  },

  async fronius() {
    const fixture = MONITORING_FIXTURES.fronius;
    return {
      plants: fixture.plants,
      daily: { energy: fixture.daily.energy, date: fixture.daily.date },
      snapshot: { power: fixture.snapshot.powerNow, timestamp: fixture.snapshot.timestamp },
      alarms: fixture.alarms,
    };
  },

  async huawei() {
    const fixture = MONITORING_FIXTURES.huawei;
    return {
      plants: fixture.plants,
      daily: { energy: fixture.daily.energy, date: fixture.daily.date },
      snapshot: { power: fixture.snapshot.powerNow, timestamp: fixture.snapshot.timestamp },
      alarms: fixture.alarms,
    };
  },

  async growatt() {
    const fixture = MONITORING_FIXTURES.growatt;
    return {
      plants: fixture.plants,
      daily: { energy: fixture.daily.energy, date: fixture.daily.date },
      snapshot: { power: fixture.snapshot.powerNow, timestamp: fixture.snapshot.timestamp },
      alarms: fixture.alarms,
    };
  },

  async sungrow() {
    const fixture = MONITORING_FIXTURES.sungrow;
    return {
      plants: fixture.plants,
      daily: { energy: fixture.daily.energy, date: fixture.daily.date },
      snapshot: { power: fixture.snapshot.powerNow, timestamp: fixture.snapshot.timestamp },
      alarms: fixture.alarms,
    };
  },

  async deye() {
    const fixture = MONITORING_FIXTURES.deye;
    return {
      plants: fixture.plants,
      daily: { energy: fixture.daily.energy, date: fixture.daily.date },
      snapshot: { power: fixture.snapshot.powerNow, timestamp: fixture.snapshot.timestamp },
      alarms: fixture.alarms,
    };
  },

  async solarman() {
    const fixture = MONITORING_FIXTURES.solarman;
    return {
      plants: fixture.plants,
      daily: { energy: fixture.daily.energy, date: fixture.daily.date },
      snapshot: { power: fixture.snapshot.powerNow, timestamp: fixture.snapshot.timestamp },
      alarms: fixture.alarms,
    };
  },

  async solis() {
    const fixture = MONITORING_FIXTURES.solis;
    return {
      plants: fixture.plants,
      daily: { energy: fixture.daily.energy, date: fixture.daily.date },
      snapshot: { power: fixture.snapshot.powerNow, timestamp: fixture.snapshot.timestamp },
      alarms: fixture.alarms,
    };
  },

  async goodwe() {
    const fixture = MONITORING_FIXTURES.goodwe;
    return {
      plants: fixture.plants,
      daily: { energy: fixture.daily.energy, date: fixture.daily.date },
      snapshot: { power: fixture.snapshot.powerNow, timestamp: fixture.snapshot.timestamp },
      alarms: fixture.alarms,
    };
  },

  async apsystems() {
    const fixture = MONITORING_FIXTURES.apsystems;
    return {
      plants: fixture.plants,
      daily: { energy: fixture.daily.energy, date: fixture.daily.date },
      snapshot: { power: fixture.snapshot.powerNow, timestamp: fixture.snapshot.timestamp },
      alarms: fixture.alarms,
    };
  },

  async enphase() {
    const fixture = MONITORING_FIXTURES.enphase;
    return {
      plants: fixture.plants,
      daily: { energy: fixture.daily.energy, date: fixture.daily.date },
      snapshot: { power: fixture.snapshot.powerNow, timestamp: fixture.snapshot.timestamp },
      alarms: fixture.alarms,
    };
  },

  // Não-oficiais (com aceite de termos)
  async growattPortal() {
    const fixture = MONITORING_FIXTURES.growattPortal;
    return {
      plants: fixture.plants,
      daily: { energy: fixture.daily.energy, date: fixture.daily.date },
      snapshot: { power: fixture.snapshot.powerNow, timestamp: fixture.snapshot.timestamp },
      alarms: fixture.alarms,
    };
  },

  async goodweSems() {
    const fixture = MONITORING_FIXTURES.goodweSems;
    return {
      plants: fixture.plants,
      daily: { energy: fixture.daily.energy, date: fixture.daily.date },
      snapshot: { power: fixture.snapshot.powerNow, timestamp: fixture.snapshot.timestamp },
      alarms: fixture.alarms,
    };
  },

  async hoymiles() {
    const fixture = MONITORING_FIXTURES.hoymiles;
    return {
      plants: fixture.plants,
      daily: { energy: fixture.daily.energy, date: fixture.daily.date },
      snapshot: { power: fixture.snapshot.powerNow, timestamp: fixture.snapshot.timestamp },
      alarms: fixture.alarms,
    };
  },

  async solarmanPortal() {
    const fixture = MONITORING_FIXTURES.solarmanPortal;
    return {
      plants: fixture.plants,
      daily: { energy: fixture.daily.energy, date: fixture.daily.date },
      snapshot: { power: fixture.snapshot.powerNow, timestamp: fixture.snapshot.timestamp },
      alarms: fixture.alarms,
    };
  },

  async huaweiKiosk() {
    const fixture = MONITORING_FIXTURES.huaweiKiosk;
    return {
      plants: fixture.plants,
      daily: { energy: fixture.daily.energy, date: fixture.daily.date },
      snapshot: { power: fixture.snapshot.powerNow, timestamp: fixture.snapshot.timestamp },
      alarms: fixture.alarms,
    };
  },
};
