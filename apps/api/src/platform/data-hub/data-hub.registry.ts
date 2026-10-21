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
 * `docs/referencias/fontes-externas.md`. A liberação exige registro da evidência oficial e atribuição visível.
 */
export const DATA_SOURCES: readonly DataSourceDefinition[] = [
  {
    key: 'nasa-power',
    label: 'NASA POWER',
    baseUrl: 'https://power.larc.nasa.gov/api',
    license:
      'Dados científicos da NASA são CC0 salvo aviso restritivo no conjunto; atribuição à NASA POWER é recomendada. Conferido em 20/10/2026.',
    attribution:
      'Dados do projeto NASA POWER (Langley Research Center), financiado pela NASA Earth Science Directorate Applied Science Program.',
    licenseStatus: 'CLEARED',
    notes:
      'Série horária em hora solar local (LST). A temperatura mínima mensal da climatologia não é a temperatura de projeto.',
  },
  {
    key: 'pvgis',
    label: 'PVGIS (Comissão Europeia, JRC)',
    baseUrl: 'https://re.jrc.ec.europa.eu/api/v5_3',
    license:
      'PVGIS: informação gratuita, sem restrições de uso; a atribuição ao JRC/Comissão Europeia é preservada. Conferido em 20/10/2026.',
    attribution: 'Fonte: PVGIS, Comissão Europeia, Centro Comum de Pesquisa (JRC).',
    licenseStatus: 'CLEARED',
    notes:
      'API: máximo de 30 requisições por segundo por IP; use cache, retentativas e atribuição.',
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
      'Ligada por decisão do responsável do projeto (22/10/2026), com a licença dos arquivos ainda NÃO confirmada: confira antes de uso comercial. Equipamentos do mercado norte-americano: confira registro e venda no Brasil. O botão "Carregar da internet" baixa as planilhas do repositório público do NREL.',
  },
  {
    key: 'techlux',
    label: 'Techlux (distribuidora): fichas técnicas e manuais',
    baseUrl: 'https://techlux.com.br',
    license:
      'Listagem pública de downloads de datasheets e manuais dos fabricantes. O robots.txt do site permite o acesso. Os documentos pertencem aos fabricantes; termos de uso do site NÃO revistos por jurídico.',
    attribution: 'Documentos técnicos publicados por Techlux Distribuidora (techlux.com.br).',
    licenseStatus: 'PENDING_REVIEW',
    notes:
      'Só a lista de links é guardada. O PDF é baixado sob demanda, lido para a prévia e descartado; nada entra no catálogo sem a sua conferência.',
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
