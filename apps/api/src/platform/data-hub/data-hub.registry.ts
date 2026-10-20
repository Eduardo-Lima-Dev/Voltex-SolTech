import type { DataSourceKey } from '@voltex/shared';

export interface DataSourceDefinition {
  key: DataSourceKey;
  label: string;
  baseUrl: string;
  license: string;
  attribution: string;
  licenseStatus: 'PENDING_REVIEW' | 'CLEARED' | 'BLOCKED';
  notes: string;
}

/**
 * Fontes externas conhecidas. A conferência dos termos (licença, atribuição, uso comercial) está registrada em
 * `docs/referencias/fontes-externas.md`. Mudar `licenseStatus` para `CLEARED` é uma decisão revisada, não um ajuste.
 */
export const DATA_SOURCES: readonly DataSourceDefinition[] = [
  {
    key: 'nasa-power',
    label: 'NASA POWER',
    baseUrl: 'https://power.larc.nasa.gov/api',
    license:
      'Sem restrições de uso declaradas em fontes secundárias; pede citação do projeto POWER. Política oficial a confirmar.',
    attribution:
      'Dados do projeto NASA POWER (Langley Research Center), financiado pela NASA Earth Science Directorate Applied Science Program.',
    licenseStatus: 'PENDING_REVIEW',
    notes:
      'Série horária em hora solar local (LST). A temperatura mínima mensal da climatologia não é a temperatura de projeto.',
  },
  {
    key: 'pvgis',
    label: 'PVGIS (Comissão Europeia, JRC)',
    baseUrl: 'https://re.jrc.ec.europa.eu/api/v5_3',
    license:
      'Dados de download de uso livre com citação da fonte; os serviços web seguem os termos das bases originais (NSRDB, ERA5, SARAH), que restringem uso comercial. A conferir.',
    attribution: 'Fonte: PVGIS, Comissão Europeia, Centro Comum de Pesquisa (JRC).',
    licenseStatus: 'PENDING_REVIEW',
    notes: 'Uso comercial dos serviços web bloqueado até a conferência dos termos.',
  },
  {
    key: 'cec-library',
    label: 'Biblioteca CEC/SAM (NREL): módulos e inversores de referência',
    baseUrl: 'https://github.com/NREL/SAM',
    license:
      'Dados da California Energy Commission reunidos pelo NREL no SAM. Licença dos arquivos de biblioteca NÃO confirmada.',
    attribution:
      'Biblioteca de equipamentos CEC/SAM (NREL, dados da California Energy Commission).',
    licenseStatus: 'PENDING_REVIEW',
    notes:
      'Bloqueada até a leitura da licença. Equipamentos do mercado norte-americano: confira registro e venda no Brasil.',
  },
  {
    key: 'aneel-tariffs',
    label: 'ANEEL: tarifas das distribuidoras (Dados Abertos)',
    baseUrl: 'https://dadosabertos.aneel.gov.br',
    license: 'ODbL (Open Data Commons Open Database License), declarada no portal.',
    attribution: 'ANEEL, Dados Abertos: tarifas das distribuidoras de energia elétrica (ODbL).',
    licenseStatus: 'CLEARED',
    notes:
      'Já usada pelo importador da Fase 7A. Tarifa sem impostos; a conferência jurídica segue pendente.',
  },
];

export const dataSourceDefinition = (key: string): DataSourceDefinition | undefined =>
  DATA_SOURCES.find((s) => s.key === key);
