import { Navigate, Outlet } from 'react-router';
import { ForbiddenPage } from '@/app/pages/forbidden-page';
import { useAuth } from '@/features/auth/auth-provider';
import { CRM_TABS } from './crm-nav';

/** Casca do CRM: as telas ficam no submenu da barra lateral. */
export function CrmLayout() {
  const { can } = useAuth();
  const tabs = CRM_TABS.filter((tab) => can(tab.permission));
  if (tabs.length === 0) return <ForbiddenPage />;

  return <Outlet />;
}

export function CrmIndexRedirect() {
  const { can } = useAuth();
  const first = CRM_TABS.find((tab) => can(tab.permission));
  return first ? <Navigate to={`/crm/${first.path}`} replace /> : <ForbiddenPage />;
}
