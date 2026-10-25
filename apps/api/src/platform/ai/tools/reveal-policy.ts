import type { RequestUser } from '../../../common/context/request-user';
import type { PseudonymEntry } from '../privacy/pseudonymizer';

/**
 * Quais nomes reais podem voltar para a tela de quem perguntou (ADR-0030). Cliente e contato exigem acesso às
 * contas (ou aos leads, no caso de contato); colegas e equipes são visíveis a qualquer usuário interno.
 */
export function revealPolicy(user: RequestUser): (entry: PseudonymEntry) => boolean {
  const has = (p: string) => user.permissions.includes(p as never);
  return (entry) => {
    switch (entry.kind) {
      case 'CLIENTE':
        return has('crm.account.read');
      case 'CONTATO':
        return has('crm.account.read') || has('crm.lead.read');
      case 'USUARIO':
      case 'EQUIPE':
        return true;
    }
  };
}
