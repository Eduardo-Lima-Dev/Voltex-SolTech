import { Navigate, Outlet } from 'react-router';
import { ForbiddenPage } from '@/app/pages/forbidden-page';
import { useAuth } from '@/features/auth/auth-provider';
import { ADMIN_TABS } from './admin-nav';

export function AdminLayout() {
  const { canAny } = useAuth();
  const tabs = ADMIN_TABS.filter((tab) => canAny(tab.anyOf));
  if (tabs.length === 0) return <ForbiddenPage />;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Administração</h1>
        <p className="text-muted-foreground">
          Gerencie a empresa, as pessoas e o que cada perfil pode fazer.
        </p>
      </header>

      <Outlet />
    </div>
  );
}

/** `/admin` leva para a primeira aba que o usuário pode ver. */
export function AdminIndexRedirect() {
  const { canAny } = useAuth();
  const first = ADMIN_TABS.find((tab) => canAny(tab.anyOf));
  return first ? <Navigate to={`/admin/${first.path}`} replace /> : <ForbiddenPage />;
}
