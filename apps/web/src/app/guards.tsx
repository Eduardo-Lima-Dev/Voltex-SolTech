import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import type { Permission } from '@voltex/shared';
import { Spinner } from '@voltex/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { ForbiddenPage } from './pages/forbidden-page';

export function FullScreenSpinner() {
  return (
    <div className="flex h-dvh items-center justify-center bg-background text-muted-foreground">
      <Spinner className="size-6" />
    </div>
  );
}

/** Rotas que exigem sessão. Sem sessão, vai para /login guardando de onde veio. */
export function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <FullScreenSpinner />;
  if (status === 'unauthenticated')
    return (
      <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />
    );
  return <Outlet />;
}

/** Rotas só para quem NÃO está logado (login). */
export function GuestOnly({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <FullScreenSpinner />;
  if (status === 'authenticated') {
    const from = (location.state as { from?: string } | null)?.from;
    return (
      <Navigate to={from && from.startsWith('/') && !from.startsWith('//') ? from : '/'} replace />
    );
  }
  return <>{children}</>;
}

interface RequirePermissionProps {
  /** Todas as permissões são exigidas. */
  permission?: Permission | readonly Permission[];
  /** Basta uma delas. */
  anyOf?: readonly Permission[];
  children: ReactNode;
}

/** Mostra "Sem acesso" quando o perfil não tem a permissão. A API continua sendo a barreira real. */
export function RequirePermission({ permission, anyOf, children }: RequirePermissionProps) {
  const { can, canAny } = useAuth();
  const allowed = (permission ? can(permission) : true) && (anyOf ? canAny(anyOf) : true);
  return allowed ? <>{children}</> : <ForbiddenPage />;
}

/** Renderiza os filhos só se o usuário tiver a permissão (para esconder botões e ações). */
export function Can({
  permission,
  anyOf,
  children,
  fallback = null,
}: RequirePermissionProps & { fallback?: ReactNode }) {
  const { can, canAny } = useAuth();
  const allowed = (permission ? can(permission) : true) && (anyOf ? canAny(anyOf) : true);
  return <>{allowed ? children : fallback}</>;
}
