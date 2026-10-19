import { NavLink, Navigate, Outlet } from 'react-router';
import { cn } from '@voltex/ui';
import { ForbiddenPage } from '@/app/pages/forbidden-page';
import { useAuth } from '@/features/auth/auth-provider';
import { CRM_TABS } from './crm-nav';

/** Casca do CRM: título e as áreas que o perfil pode ver. */
export function CrmLayout() {
  const { can } = useAuth();
  const tabs = CRM_TABS.filter((tab) => can(tab.permission));
  if (tabs.length === 0) return <ForbiddenPage />;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">CRM Solar</h1>
        <p className="text-muted-foreground">
          Do lead à proposta: leads, oportunidades, contas e tarefas da sua equipe.
        </p>
      </header>

      <nav aria-label="Áreas do CRM" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
        {tabs.map((tab) => (
          <NavLink
            key={tab.path}
            to={`/crm/${tab.path}`}
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

export function CrmIndexRedirect() {
  const { can } = useAuth();
  const first = CRM_TABS.find((tab) => can(tab.permission));
  return first ? <Navigate to={`/crm/${first.path}`} replace /> : <ForbiddenPage />;
}
