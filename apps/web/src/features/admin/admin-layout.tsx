import { NavLink, Navigate, Outlet } from 'react-router';
import { cn } from '@voltex/ui';
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

      <nav
        aria-label="Seções da administração"
        className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1"
      >
        {tabs.map((tab) => (
          <NavLink
            key={tab.path}
            to={`/admin/${tab.path}`}
            className={({ isActive }) =>
              cn(
                'inline-flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )
            }
          >
            <tab.icon className="size-4" aria-hidden />
            {tab.label}
          </NavLink>
        ))}
      </nav>

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
