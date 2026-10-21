import { Navigate, Outlet } from 'react-router';
import { ForbiddenPage } from '@/app/pages/forbidden-page';
import { useAuth } from '@/features/auth/auth-provider';
import { OFFGRID_TABS } from './offgrid-nav';

/** Casca do Off-Grid Designer: as telas ficam no submenu da barra lateral. */
export function OffgridLayout() {
  const { can } = useAuth();
  if (!OFFGRID_TABS.some((tab) => can(tab.permission))) return <ForbiddenPage />;
  return <Outlet />;
}

export function OffgridIndexRedirect() {
  const { can } = useAuth();
  const first = OFFGRID_TABS.find((tab) => can(tab.permission));
  return first ? <Navigate to={`/offgrid/${first.path}`} replace /> : <ForbiddenPage />;
}
