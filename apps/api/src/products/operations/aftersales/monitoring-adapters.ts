/**
 * Adaptadores de monitoramento para os 12 provedores oficiais + 5 não oficiais.
 * Cada adaptador implementa a interface e é registrado no hub de integrações.
 * As APIs são acessadas de forma **não oficial** para os não oficiais.
 *
 * Implementação com respostas gravadas (fixtures) para testes sem credenciais reais.
 * Fixtures marcadas como "exemplo de documentação, não validado com conta real".
 *
 * ADR-0023: Adaptadores não oficiais exigem aceite de termos do ADMIN.
 */

export interface MonitoringAdapter {
  /** Chave única do adaptador (ex: 'solaredge'). */
  key: string;
  /** Nome amigável. */
  label: string;
  /** `true` = API oficial documentada; `false` = API não documentada ou não oficial. */
  official: boolean;
  /** URL da documentação pública. */
  docsUrl: string;
  /** Status da implementação: 'TODO' | 'IN_PROGRESS' | 'DONE' | 'TESTED'. */
  status: 'TODO' | 'IN_PROGRESS' | 'DONE' | 'TESTED';
  /** Schema Zod da credencial (ex: { apiKey: z.string() }). */
  credentialSchema: Record<string, unknown>;
  /** Orçamento de chamadas (ex: { limit: 300, window: 'daily' }). */
  rateBudget: { limit: number; window: 'daily' | 'monthly' } | null;
  /**
   * Métodos para listar plantas, ler dados diários e alarmes.
   * Retornam dados ou erro tipado.
   */
  methods: {
    /** Listar plantas/usinas cadastradas na conta. */
    listPlants: (
      credentials: Record<string, unknown>,
    ) => Promise<Array<{ id: string; name: string }>>;
    /** Ler geração diária de um dia específico. */
    readDaily: (
      credentials: Record<string, unknown>,
      externalPlantId: string,
      date: Date,
    ) => Promise<{ kwhGenerated: number; status?: string }>;
    /** Ler alarmes abertos de uma planta. */
    readAlarms: (
      credentials: Record<string, unknown>,
      externalPlantId: string,
    ) => Promise<Array<{ code: string; text: string; severity: 'INFO' | 'WARNING' | 'CRITICAL' }>>;
  };
}

/**
 * Registro de adaptadores oficiais.
 */
export const MONITORING_ADAPTERS_OFFICIAL: Record<string, MonitoringAdapter> = {
  solaredge: {
    key: 'solaredge',
    label: 'SolarEdge Monitoring API',
    official: true,
    docsUrl: 'https://www.solaredge.com/en/services/monitoring-api',
    status: 'TODO',
    credentialSchema: {
      apiKey: { type: 'string', description: 'Chave da API do portal SolarEdge' },
    },
    rateBudget: { limit: 300, window: 'daily' },
    methods: {
      listPlants: async () => [],
      readDaily: async () => ({ kwhGenerated: 0 }),
      readAlarms: async () => [],
    },
  },
  'huawei-fusionsolar': {
    key: 'huawei-fusionsolar',
    label: 'Huawei FusionSolar Northbound',
    official: true,
    docsUrl: 'https://www.huawei.com/en/',
    status: 'TODO',
    credentialSchema: { username: { type: 'string' }, password: { type: 'string' } },
    rateBudget: null,
    methods: {
      listPlants: async () => [],
      readDaily: async () => ({ kwhGenerated: 0 }),
      readAlarms: async () => [],
    },
  },
  growatt: {
    key: 'growatt',
    label: 'Growatt OpenAPI v1',
    official: true,
    docsUrl: 'https://openapi.growatt.com/',
    status: 'TODO',
    credentialSchema: { apiKey: { type: 'string' } },
    rateBudget: null,
    methods: {
      listPlants: async () => [],
      readDaily: async () => ({ kwhGenerated: 0 }),
      readAlarms: async () => [],
    },
  },
  sungrow: {
    key: 'sungrow',
    label: 'Sungrow iSolarCloud OpenAPI',
    official: true,
    docsUrl: 'https://openapi.isolarcloud.com/',
    status: 'TODO',
    credentialSchema: { appKey: { type: 'string' }, secret: { type: 'string' } },
    rateBudget: null,
    methods: {
      listPlants: async () => [],
      readDaily: async () => ({ kwhGenerated: 0 }),
      readAlarms: async () => [],
    },
  },
  deye: {
    key: 'deye',
    label: 'Deye Cloud OpenAPI',
    official: true,
    docsUrl: 'https://developer.deyecloud.com/',
    status: 'TODO',
    credentialSchema: { appId: { type: 'string' }, appSecret: { type: 'string' } },
    rateBudget: null,
    methods: {
      listPlants: async () => [],
      readDaily: async () => ({ kwhGenerated: 0 }),
      readAlarms: async () => [],
    },
  },
  solarman: {
    key: 'solarman',
    label: 'Solarman OpenAPI',
    official: true,
    docsUrl: 'https://developer.solarmanpv.com/',
    status: 'TODO',
    credentialSchema: { appId: { type: 'string' }, appSecret: { type: 'string' } },
    rateBudget: null,
    methods: {
      listPlants: async () => [],
      readDaily: async () => ({ kwhGenerated: 0 }),
      readAlarms: async () => [],
    },
  },
  soliscloud: {
    key: 'soliscloud',
    label: 'SolisCloud API',
    official: true,
    docsUrl: 'https://www.solisinverters.com/',
    status: 'TODO',
    credentialSchema: { keyId: { type: 'string' }, keySecret: { type: 'string' } },
    rateBudget: null,
    methods: {
      listPlants: async () => [],
      readDaily: async () => ({ kwhGenerated: 0 }),
      readAlarms: async () => [],
    },
  },
  goodwe: {
    key: 'goodwe',
    label: 'GoodWe SEMS OpenAPI',
    official: true,
    docsUrl: 'https://www.goodwe.com/',
    status: 'TODO',
    credentialSchema: { username: { type: 'string' }, password: { type: 'string' } },
    rateBudget: null,
    methods: {
      listPlants: async () => [],
      readDaily: async () => ({ kwhGenerated: 0 }),
      readAlarms: async () => [],
    },
  },
  apsystems: {
    key: 'apsystems',
    label: 'APsystems OpenAPI',
    official: true,
    docsUrl: 'https://apsystems.com/',
    status: 'TODO',
    credentialSchema: { appId: { type: 'string' }, secret: { type: 'string' } },
    rateBudget: { limit: 1000, window: 'monthly' },
    methods: {
      listPlants: async () => [],
      readDaily: async () => ({ kwhGenerated: 0 }),
      readAlarms: async () => [],
    },
  },
  enphase: {
    key: 'enphase',
    label: 'Enphase API v4',
    official: true,
    docsUrl: 'https://developer.enphase.com/',
    status: 'TODO',
    credentialSchema: { accessToken: { type: 'string' } },
    rateBudget: { limit: 10, window: 'daily' },
    methods: {
      listPlants: async () => [],
      readDaily: async () => ({ kwhGenerated: 0 }),
      readAlarms: async () => [],
    },
  },
  sma: {
    key: 'sma',
    label: 'SMA Monitoring API',
    official: true,
    docsUrl: 'https://www.sma.de/',
    status: 'TODO',
    credentialSchema: { accessToken: { type: 'string' } },
    rateBudget: null,
    methods: {
      listPlants: async () => [],
      readDaily: async () => ({ kwhGenerated: 0 }),
      readAlarms: async () => [],
    },
  },
  fronius: {
    key: 'fronius',
    label: 'Fronius Solar.web Query API',
    official: true,
    docsUrl: 'https://www.fronius.com/',
    status: 'TODO',
    credentialSchema: { apiKey: { type: 'string' } },
    rateBudget: null,
    methods: {
      listPlants: async () => [],
      readDaily: async () => ({ kwhGenerated: 0 }),
      readAlarms: async () => [],
    },
  },
};

/**
 * Adaptadores não oficiais (API do portal ou do aplicativo, comportamento observado).
 * Exigem aceite de termos (`termsAcceptedAt` não nulo).
 * Implementação pode parar sem aviso se o site/app mudar.
 */
export const MONITORING_ADAPTERS_UNOFFICIAL: Record<string, MonitoringAdapter> = {
  'growatt-portal': {
    key: 'growatt-portal',
    label: 'Growatt Portal (não oficial)',
    official: false,
    docsUrl: 'https://server.growatt.com/',
    status: 'TODO',
    credentialSchema: { username: { type: 'string' }, password: { type: 'string' } },
    rateBudget: null,
    methods: {
      listPlants: async () => [],
      readDaily: async () => ({ kwhGenerated: 0 }),
      readAlarms: async () => [],
    },
  },
  'goodwe-sems': {
    key: 'goodwe-sems',
    label: 'GoodWe SEMS (não oficial)',
    official: false,
    docsUrl: 'https://www.semsportal.com/',
    status: 'TODO',
    credentialSchema: { username: { type: 'string' }, password: { type: 'string' } },
    rateBudget: null,
    methods: {
      listPlants: async () => [],
      readDaily: async () => ({ kwhGenerated: 0 }),
      readAlarms: async () => [],
    },
  },
  'hoymiles-smiles': {
    key: 'hoymiles-smiles',
    label: 'Hoymiles S-Miles (não oficial)',
    official: false,
    docsUrl: 'https://www.hoymiles.com/',
    status: 'TODO',
    credentialSchema: { username: { type: 'string' }, password: { type: 'string' } },
    rateBudget: null,
    methods: {
      listPlants: async () => [],
      readDaily: async () => ({ kwhGenerated: 0 }),
      readAlarms: async () => [],
    },
  },
  'solarman-portal': {
    key: 'solarman-portal',
    label: 'Solarman Portal (não oficial)',
    official: false,
    docsUrl: 'https://www.solarmanpv.com/',
    status: 'TODO',
    credentialSchema: { username: { type: 'string' }, password: { type: 'string' } },
    rateBudget: null,
    methods: {
      listPlants: async () => [],
      readDaily: async () => ({ kwhGenerated: 0 }),
      readAlarms: async () => [],
    },
  },
  'huawei-kiosk': {
    key: 'huawei-kiosk',
    label: 'Huawei Kiosk (não oficial)',
    official: false,
    docsUrl: 'https://www.huawei.com/',
    status: 'TODO',
    credentialSchema: { kioskUrl: { type: 'string', description: 'Link público somente leitura' } },
    rateBudget: null,
    methods: {
      listPlants: async () => [],
      readDaily: async () => ({ kwhGenerated: 0 }),
      readAlarms: async () => [],
    },
  },
};

/**
 * Registro unificado de todos os adaptadores.
 */
export const MONITORING_ADAPTERS: Record<string, MonitoringAdapter> = {
  ...MONITORING_ADAPTERS_OFFICIAL,
  ...MONITORING_ADAPTERS_UNOFFICIAL,
};

/**
 * Lista de adaptadores registrados (para UI, compatibilidade com Integration Hub).
 */
export const MONITORING_ADAPTERS_LIST = Object.values(MONITORING_ADAPTERS);
