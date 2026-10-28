/**
 * Dados pessoais FICTÍCIOS de todos os tipos que nunca podem chegar ao provedor de IA (ADR-0030). A suíte de
 * vazamento da sub-fase 12D injeta isto em cada ferramenta; a 12B já a usa no gateway.
 */
export const PERSONAL_DATA_SAMPLES = {
  CPF: '529.982.247-25',
  CNPJ: '11.222.333/0001-81',
  EMAIL: 'maria.souza@example.com',
  PHONE: '(85) 98877-1001',
  CEP: '60150-160',
  COORDINATES: '-3.7319, -38.5267',
  LONG_NUMBER: '20261025000123',
} as const;

/** Nomes fictícios que devem virar pseudônimo. */
export const PERSONAL_NAMES = ['Helena Duarte Campos', 'Maria Aparecida Souza'] as const;
