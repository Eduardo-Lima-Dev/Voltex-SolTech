/**
 * Prazos de guarda. A LGPD manda eliminar o dado pessoal quando acaba a finalidade, MAS permite (e as leis exigem)
 * guardar o que for necessário para cumprir obrigação legal. O sistema impõe um **piso** onde há lei conhecida e
 * deixa o resto por conta da empresa. Os pisos abaixo foram pesquisados e **precisam de confirmação do jurídico**.
 */
export const RETENTION_FLOORS = {
  /** Contratos e documentos da venda: 5 anos (prazo fiscal do CTN e prescrição de relação de consumo, CDC art. 27). */
  signedContractsMonths: 60,
} as const;

export const RETENTION_DEFAULTS = {
  /** `null` = nunca eliminar sozinho. Não há prazo legal mínimo para lead que não virou cliente: decisão da empresa. */
  unconvertedLeadsMonths: null as number | null,
  lostOpportunitiesMonths: null as number | null,
  signedContractsMonths: RETENTION_FLOORS.signedContractsMonths as number,
};

export const RETENTION_SOURCES = {
  signedContractsMonths:
    'CTN (arts. 173, 174 e 195) e CDC (art. 27): 5 anos. Confirme com o seu jurídico; o Código Civil admite prazos maiores (até 10 anos) para ações de contrato.',
  accessLogs:
    'Marco Civil da Internet (Lei 12.965/2014, art. 15): registros de acesso a aplicações por, no mínimo, 6 meses. O histórico de auditoria da plataforma não é eliminado por este recurso.',
} as const;
