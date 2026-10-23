import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Spinner } from '@voltex/ui';
import { endpoints } from '@/lib/api/endpoints';
import { isApiError } from '@/lib/api';

import '@/components/brand-motion.css';

/** Abre o link mágico: troca o token pela sessão (uma única vez) e leva o cliente ao portal. */
export function PortalAccessPage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // O link só vale uma vez: em modo de desenvolvimento o efeito roda duas vezes e a segunda tentaria reusar o link.
    if (started.current) return;
    started.current = true;
    endpoints.portal
      .exchange(token)
      .then(() => navigate('/portal', { replace: true }))
      .catch((e: unknown) =>
        setError(
          isApiError(e) && e.status === 410
            ? 'Este link expirou ou já foi usado.'
            : 'Este link não é válido.',
        ),
      );
  }, [token, navigate]);

  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center gap-4 p-6 text-center">
      {error ? (
        <>
          <p role="alert" className="text-base font-medium">
            {error}
          </p>
          <p className="text-sm text-muted-foreground">Peça um novo link com o seu e-mail.</p>
          <Link className="text-sm text-primary underline" to="/portal/entrar">
            Pedir novo link
          </Link>
        </>
      ) : (
        <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Spinner /> Abrindo o seu portal…
        </p>
      )}
    </main>
  );
}
