/**
 * Modelo de contrato com variáveis `{{grupo.nome}}`. Funções puras: sem acesso a banco, usadas pela API (que
 * grava o texto final) e pela Web (para mostrar as variáveis disponíveis).
 */

export interface ContractVariable {
  key: string;
  label: string;
}

export const CONTRACT_VARIABLES: readonly ContractVariable[] = [
  { key: 'empresa.nome', label: 'Nome da empresa (contratada)' },
  { key: 'empresa.documento', label: 'CNPJ da empresa' },
  { key: 'cliente.nome', label: 'Nome do cliente (contratante)' },
  { key: 'cliente.documento', label: 'CPF/CNPJ do cliente' },
  { key: 'cliente.endereco', label: 'Endereço do imóvel' },
  { key: 'projeto.codigo', label: 'Project ID' },
  { key: 'projeto.potencia_kwp', label: 'Potência instalada (kWp)' },
  { key: 'projeto.modulos', label: 'Quantidade de módulos' },
  { key: 'projeto.geracao_anual_kwh', label: 'Geração anual estimada (kWh)' },
  { key: 'contrato.valor', label: 'Valor do contrato' },
  { key: 'contrato.pagamento', label: 'Condições de pagamento' },
  { key: 'contrato.data', label: 'Data de geração do contrato' },
  { key: 'proposta.versao', label: 'Versão da proposta aceita' },
  { key: 'proposta.observacoes', label: 'Observações da proposta' },
];

const KNOWN = new Set(CONTRACT_VARIABLES.map((v) => v.key));
const PLACEHOLDER = /\{\{\s*([a-z_.]+)\s*\}\}/g;

export const MISSING_VALUE = '(não informado)';

/** Variáveis usadas no texto, sem repetição. */
export function extractTemplateVariables(body: string): string[] {
  return [...new Set([...body.matchAll(PLACEHOLDER)].map((m) => m[1] as string))];
}

/** Variáveis do texto que o sistema não conhece (erro de digitação): bloqueiam o salvamento do modelo. */
export function unknownTemplateVariables(body: string): string[] {
  return extractTemplateVariables(body).filter((key) => !KNOWN.has(key));
}

export interface RenderedContract {
  text: string;
  /** Variáveis conhecidas que ficaram sem valor (preenchidas com "(não informado)"). */
  missing: string[];
}

export function renderContractTemplate(
  body: string,
  values: Record<string, string | null | undefined>,
): RenderedContract {
  const missing = new Set<string>();
  const text = body.replace(PLACEHOLDER, (_, key: string) => {
    const value = values[key];
    if (value === undefined || value === null || value.trim() === '') {
      missing.add(key);
      return MISSING_VALUE;
    }
    return value;
  });
  return { text, missing: [...missing] };
}

/**
 * Modelo-base: **ponto de partida editável, sem revisão jurídica**. Não define prazos, multas nem garantias
 * numéricas de propósito: a empresa precisa revisar com o seu jurídico e publicar o seu modelo.
 */
export const DEFAULT_CONTRACT_TEMPLATE = `CONTRATO DE FORNECIMENTO E INSTALAÇÃO DE SISTEMA FOTOVOLTAICO

MODELO-BASE — revise com o seu jurídico e publique o modelo da sua empresa antes de usar.

CONTRATADA: {{empresa.nome}}, CNPJ {{empresa.documento}}.
CONTRATANTE: {{cliente.nome}}, CPF/CNPJ {{cliente.documento}}.
Local da instalação: {{cliente.endereco}}.
Projeto: {{projeto.codigo}} (proposta v{{proposta.versao}}).

1. OBJETO
Fornecimento e instalação de sistema fotovoltaico conectado à rede, com potência instalada de {{projeto.potencia_kwp}} kWp ({{projeto.modulos}} módulos) e geração anual estimada de {{projeto.geracao_anual_kwh}} kWh, conforme a proposta aceita pelo CONTRATANTE. A geração real varia com o clima, a instalação e o consumo.

2. VALOR E PAGAMENTO
Valor total: {{contrato.valor}}.
Condições de pagamento: {{contrato.pagamento}}.

3. HOMOLOGAÇÃO NA DISTRIBUIDORA
A CONTRATADA prepara e acompanha a solicitação de acesso junto à distribuidora de energia. A aprovação e os prazos dependem da distribuidora e da regulação vigente, e não são garantidos pela CONTRATADA.

4. OBSERVAÇÕES
{{proposta.observacoes}}

Data: {{contrato.data}}.

______________________________          ______________________________
CONTRATADA                                CONTRATANTE
`;
