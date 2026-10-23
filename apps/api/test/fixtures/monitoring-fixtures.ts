/**
 * Fixtures de monitoramento — respostas gravadas de cada provedor.
 * Baseadas em documentação pública de APIs.
 */

export const MONITORING_FIXTURES = {
  sma: {
    plants: [
      {
        id: 'sma-plant-001',
        name: 'Planta Demo SMA 10kWp',
        status: 'ACTIVE',
        power: 10000,
        location: 'São Paulo, SP',
      },
    ],
    daily: {
      date: '2026-10-23',
      energy: 42.5,
      unit: 'kWh',
      peakPower: 9800,
      timestamp: '2026-10-23T18:00:00Z',
    },
    snapshot: {
      powerNow: 850,
      unit: 'W',
      gridFrequency: 59.98,
      timestamp: '2026-10-23T15:30:00Z',
      status: 'OK',
    },
    alarms: [],
  },

  solaredge: {
    plants: [
      {
        id: 'se-123456',
        name: 'SolarEdge Site Demo',
        status: 'Active',
        peakPower: 10000,
        location: 'Rio de Janeiro, RJ',
        installationDate: '2024-01-15',
      },
    ],
    daily: {
      date: '2026-10-23',
      energy: 45,
      unit: 'kWh',
      timestamp: '2026-10-23T18:00:00Z',
    },
    snapshot: {
      powerNow: 8500,
      unit: 'W',
      timestamp: '2026-10-23T15:30:00Z',
      status: 'Active',
    },
    alarms: [],
  },

  fronius: {
    plants: [
      {
        id: 'fronius-001',
        name: 'Fronius Demo Site',
        power: 12000,
        location: 'Minas Gerais, MG',
      },
    ],
    daily: {
      date: '2026-10-23',
      energy: 48,
      unit: 'kWh',
    },
    snapshot: {
      powerNow: 9200,
      unit: 'W',
      timestamp: '2026-10-23T15:30:00Z',
      status: 'OK',
    },
    alarms: [],
  },

  huawei: {
    plants: [
      {
        id: 'hw-plant-1',
        name: 'Huawei Demo 8kWp',
        power: 8000,
        location: 'Brasília, DF',
      },
    ],
    daily: {
      date: '2026-10-23',
      energy: 35,
      unit: 'kWh',
    },
    snapshot: {
      powerNow: 6800,
      unit: 'W',
      timestamp: '2026-10-23T15:30:00Z',
    },
    alarms: [],
  },

  growatt: {
    plants: [
      {
        id: 'grow-123',
        name: 'Growatt Site',
        power: 6000,
        location: 'Paraná, PR',
      },
    ],
    daily: {
      date: '2026-10-23',
      energy: 28,
      unit: 'kWh',
    },
    snapshot: {
      powerNow: 5200,
      unit: 'W',
      timestamp: '2026-10-23T15:30:00Z',
    },
    alarms: [],
  },

  sungrow: {
    plants: [
      {
        id: 'sun-456',
        name: 'Sungrow Demo',
        power: 15000,
        location: 'São Paulo, SP',
      },
    ],
    daily: {
      date: '2026-10-23',
      energy: 58,
      unit: 'kWh',
    },
    snapshot: {
      powerNow: 11200,
      unit: 'W',
      timestamp: '2026-10-23T15:30:00Z',
    },
    alarms: [],
  },

  deye: {
    plants: [
      {
        id: 'deye-001',
        name: 'Deye Demo',
        power: 5000,
        location: 'Santa Catarina, SC',
      },
    ],
    daily: {
      date: '2026-10-23',
      energy: 22,
      unit: 'kWh',
    },
    snapshot: {
      powerNow: 4100,
      unit: 'W',
      timestamp: '2026-10-23T15:30:00Z',
    },
    alarms: [],
  },

  solarman: {
    plants: [
      {
        id: 'sm-789',
        name: 'Solarman Device',
        power: 7000,
        location: 'Bahia, BA',
      },
    ],
    daily: {
      date: '2026-10-23',
      energy: 32,
      unit: 'kWh',
    },
    snapshot: {
      powerNow: 6100,
      unit: 'W',
      timestamp: '2026-10-23T15:30:00Z',
    },
    alarms: [],
  },

  solis: {
    plants: [
      {
        id: 'solis-01',
        name: 'Solis Site',
        power: 9000,
        location: 'Goiás, GO',
      },
    ],
    daily: {
      date: '2026-10-23',
      energy: 38,
      unit: 'kWh',
    },
    snapshot: {
      powerNow: 7300,
      unit: 'W',
      timestamp: '2026-10-23T15:30:00Z',
    },
    alarms: [],
  },

  goodwe: {
    plants: [
      {
        id: 'gw-111',
        name: 'GoodWe Demo',
        power: 4500,
        location: 'Rio Grande do Sul, RS',
      },
    ],
    daily: {
      date: '2026-10-23',
      energy: 19,
      unit: 'kWh',
    },
    snapshot: {
      powerNow: 3600,
      unit: 'W',
      timestamp: '2026-10-23T15:30:00Z',
    },
    alarms: [],
  },

  apsystems: {
    plants: [
      {
        id: 'ap-222',
        name: 'APsystems Microinverters',
        power: 8000,
        location: 'Pernambuco, PE',
      },
    ],
    daily: {
      date: '2026-10-23',
      energy: 35,
      unit: 'kWh',
    },
    snapshot: {
      powerNow: 6800,
      unit: 'W',
      timestamp: '2026-10-23T15:30:00Z',
    },
    alarms: [],
  },

  enphase: {
    plants: [
      {
        id: 'ep-333',
        name: 'Enphase System',
        power: 6500,
        location: 'Ceará, CE',
      },
    ],
    daily: {
      date: '2026-10-23',
      energy: 29,
      unit: 'kWh',
    },
    snapshot: {
      powerNow: 5600,
      unit: 'W',
      timestamp: '2026-10-23T15:30:00Z',
    },
    alarms: [],
  },

  // Não-oficiais
  growattPortal: {
    plants: [
      {
        id: 'grow-portal-1',
        name: 'Growatt Portal Site',
        power: 5500,
        location: 'Maranhão, MA',
      },
    ],
    daily: { date: '2026-10-23', energy: 25, unit: 'kWh' },
    snapshot: { powerNow: 4800, unit: 'W', timestamp: '2026-10-23T15:30:00Z' },
    alarms: [],
  },

  goodweSems: {
    plants: [
      {
        id: 'gw-sems-1',
        name: 'GoodWe SEMS',
        power: 4000,
        location: 'Piauí, PI',
      },
    ],
    daily: { date: '2026-10-23', energy: 18, unit: 'kWh' },
    snapshot: { powerNow: 3400, unit: 'W', timestamp: '2026-10-23T15:30:00Z' },
    alarms: [],
  },

  hoymiles: {
    plants: [
      {
        id: 'hoy-444',
        name: 'Hoymiles Microinverters',
        power: 5000,
        location: 'Paraíba, PB',
      },
    ],
    daily: { date: '2026-10-23', energy: 22, unit: 'kWh' },
    snapshot: { powerNow: 4200, unit: 'W', timestamp: '2026-10-23T15:30:00Z' },
    alarms: [],
  },

  solarmanPortal: {
    plants: [
      {
        id: 'sm-portal-1',
        name: 'Solarman Portal Access',
        power: 6500,
        location: 'Alagoas, AL',
      },
    ],
    daily: { date: '2026-10-23', energy: 29, unit: 'kWh' },
    snapshot: { powerNow: 5900, unit: 'W', timestamp: '2026-10-23T15:30:00Z' },
    alarms: [],
  },

  huaweiKiosk: {
    plants: [
      {
        id: 'hw-kiosk-1',
        name: 'Huawei Kiosk Public Link',
        power: 7000,
        location: 'Distrito Federal, DF',
      },
    ],
    daily: { date: '2026-10-23', energy: 32, unit: 'kWh' },
    snapshot: { powerNow: 6200, unit: 'W', timestamp: '2026-10-23T15:30:00Z' },
    alarms: [],
  },
};
