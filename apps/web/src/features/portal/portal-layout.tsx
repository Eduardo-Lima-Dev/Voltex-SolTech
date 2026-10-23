import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { Button, Skeleton } from '@voltex/ui';
import { endpoints } from '@/lib/api/endpoints';
import { isApiError } from '@/lib/api';

import '@/components/brand-motion.css';

/** Casca do portal do cliente: sessão própria (cookie do link mágico), sem o menu da suíte. */
export function PortalLayout() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const me = useQuery({
    queryKey: ['portal', 'me'],
    queryFn: endpoints.portal.me,
    retry: false,
  });
  const unauthenticated = me.isError && isApiError(me.error) && me.error.status === 401;
  useEffect(() => {
    if (unauthenticated) navigate('/portal/entrar', { replace: true });
  }, [unauthenticated, navigate]);

  if (me.isPending || unauthenticated)
    return (
      <div className="mx-auto max-w-4xl p-6">
        <Skeleton className="h-40 w-full" />
      </div>
    );
  if (me.isError)
    return (
      <p role="alert" className="p-6 text-sm text-destructive">
        Não foi possível carregar o portal. Tente novamente em instantes.
      </p>
    );

  const leave = async () => {
    await endpoints.portal.logout().catch(() => undefined);
    queryClient.clear();
    navigate('/portal/entrar', { replace: true });
  };
  const link = ({ isActive }: { isActive: boolean }) =>
    `text-sm ${isActive ? 'font-semibold text-foreground' : 'text-muted-foreground hover:text-foreground'}`;

  return (
    <div className="min-h-svh bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div>
            <p className="text-base font-semibold">{me.data.companyName}</p>
            <p className="text-xs text-muted-foreground">
              Portal do cliente · {me.data.accountName} ({me.data.email})
            </p>
          </div>
          <nav aria-label="Portal" className="flex items-center gap-4">
            <NavLink to="/portal" end className={link}>
              Meus projetos
            </NavLink>
            <Button variant="outline" size="sm" onClick={leave}>
              Sair
            </Button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
        <Outlet />
      </main>
    </div>
  );
}
