import { useEffect } from 'react';
import { useMatches } from 'react-router';

/** Atualiza o título da aba conforme a rota atual (`handle.title`): "Usuários · Voltex SolTech". */
export function DocumentTitle() {
  const matches = useMatches();
  const title = [...matches]
    .reverse()
    .map((m) => (m.handle as { title?: string } | undefined)?.title)
    .find(Boolean);
  useEffect(() => {
    document.title = title ? `${title} · Voltex SolTech` : 'Voltex SolTech';
  }, [title]);
  return null;
}
