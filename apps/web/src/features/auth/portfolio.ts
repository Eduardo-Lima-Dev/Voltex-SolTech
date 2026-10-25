import { useAuth } from './auth-provider';

/** Vendedor e SDR trabalham só com a própria carteira (ADR-0028); a API já filtra, a tela só deixa isso claro. */
export function usePortfolioScope(): { restricted: boolean; note: string | null } {
  const { user } = useAuth();
  if (user?.role === 'SALESPERSON')
    return { restricted: true, note: 'Você vê só a sua carteira: o que está em seu nome.' };
  if (user?.role === 'SDR')
    return {
      restricted: true,
      note: 'Você vê os seus registros e os que estão sem responsável, para poder distribuir.',
    };
  return { restricted: false, note: null };
}
